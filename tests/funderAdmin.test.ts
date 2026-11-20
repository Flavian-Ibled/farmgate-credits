import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { openDb, type Db } from '../server/db.ts';
import { createApp } from '../server/app.ts';
import { invalidate } from '../server/facts.ts';
import { dryRun, applyImport } from '../server/importer/apply.ts';
import { farmFunding } from '../server/funders.ts';
import { createUser } from '../server/auth.ts';
import { workbook, COLS, farm } from './helpers.ts';

let db: Db, app: ReturnType<typeof createApp>; const c: Record<string, string> = {}; let f1 = 0, f2 = 0;
const req = async (method: string, p: string, cookie = '', b?: unknown) => { const r = await app.request(p, { method, headers: { 'content-type': 'application/json', cookie }, body: b === undefined ? undefined : JSON.stringify(b) }); const text = await r.text(); return { status: r.status, text, body: (() => { try { return JSON.parse(text); } catch { return null; } })() as any }; };
const left = async (id: string) => (await farmFunding(db, [id])).get(id)!.remaining;
beforeAll(async () => {
  db = await openDb({ memory: true }); invalidate();
  const rows = [farm('AAA-001', { Projet: 'Projet A', 'Volume vendable': 200, 'Volume Vendu': 0 }), farm('AAA-002', { Projet: 'Projet A', 'Volume vendable': 100, 'Volume Vendu': 0 }), farm('AAA-003', { Projet: 'Projet A', 'Volume vendable': 0, 'Volume Vendu': 0 }), farm('AAA-004', { Projet: 'Projet A', 'Statut LBC': 'Désengagé', 'Volume vendable': 50, 'Volume Vendu': 0 })];
  const d: any = await dryRun(db, await workbook([...COLS, { group: 'Données Carbone', unit: 'tCO2e', label: 'Volume vendable' }], rows), { filename: 't.xlsx' }); await applyImport(db, d.id);
  f1 = (await db.owner.query(`insert into organizations(type,name,seat_limit) values('funder','Client Un',2) returning id`)).rows[0].id; f2 = (await db.owner.query(`insert into organizations(type,name) values('funder','Client Deux') returning id`)).rows[0].id;
  for (const [n, role, o] of [['admin', 'platform_admin', null], ['staff', 'staff', null], ['u1', 'funder_user', f1], ['u2', 'funder_user', f2]] as const) await createUser(db, { email: `${n}@test.local`, password: 'correct-horse-battery', role, organization_id: o });
  app = createApp(db); for (const n of ['admin', 'staff', 'u1', 'u2']) c[n] = (await app.request('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: `${n}@test.local`, password: 'correct-horse-battery' }) })).headers.get('set-cookie')!.split(';')[0];
});
afterAll(() => db.close());

describe('funder management in the admin', () => {
  it('a funder can be edited; users listed and disabled (platform admin only)', async () => {
    const d = (await req('GET', `/api/admin/funders/${f1}`, c.admin)).body; expect(d.org).toMatchObject({ name: 'Client Un', seat_limit: 2 }); expect(d.users.map((u: any) => u.email)).toEqual(['u1@test.local']);
    expect((await req('PUT', `/api/admin/funders/${f1}`, c.admin, { name: 'Client Un SA', sector: 'Banque', public_name_policy: 'named', seat_limit: '3', status: 'active' })).body.name).toBe('Client Un SA');
    expect((await req('GET', `/api/admin/funders/${f1}`, c.admin)).body.org).toMatchObject({ sector: 'Banque', public_name_policy: 'named', seat_limit: 3 });
    expect((await req('PUT', `/api/admin/funders/${f1}`, c.admin, { name: '  ' })).status).toBe(400); expect((await req('PUT', `/api/admin/funders/${f1}`, c.u1, { name: 'X' })).status).toBe(403);
    const uid = d.users[0].id; expect((await req('PUT', `/api/admin/users/${uid}/status`, c.staff, { status: 'disabled' })).status).toBe(403);
    expect((await req('PUT', `/api/admin/users/${uid}/status`, c.admin, { status: 'disabled' })).body.status).toBe('disabled'); expect((await req('GET', '/api/funder/portfolio', c.u1)).status).toBe(401); // session closed
    expect((await req('PUT', `/api/admin/users/${uid}/status`, c.admin, { status: 'active' })).body.status).toBe('active');
    c.u1 = (await app.request('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'u1@test.local', password: 'correct-horse-battery' }) })).headers.get('set-cookie')!.split(';')[0]; // a disabled user must sign in again
    expect((await req('PUT', `/api/admin/users/1/status`, c.admin, { status: 'disabled' })).status).toBe(400); // not its own account
  });
  it('seat limit blocks invitations beyond the limit', async () => {
    await req('PUT', `/api/admin/funders/${f1}`, c.admin, { name: 'Client Un SA', seat_limit: 1 });
    const r = await req('POST', `/api/admin/funders/${f1}/invitations`, c.admin, { email: 'new@client.fr' }); expect(r.status).toBe(400); expect(r.body.error).toMatch(/sièges atteint \(1 sur 1\)/);
    await req('PUT', `/api/admin/funders/${f1}`, c.admin, { name: 'Client Un SA', seat_limit: 2 }); expect((await req('POST', `/api/admin/funders/${f1}/invitations`, c.admin, { email: 'new@client.fr' })).status).toBe(200);
  });
  it('attributes farms with a financing percentage: preview first, then applied with the same guard', async () => {
    const b = { farm_ids: 'AAA-001, AAA-002\nAAA-003 AAA-004', pct: '25', price_per_tco2e: '40', status: 'reserved' };
    const pv = (await req('POST', `/api/admin/funders/${f1}/attribute`, c.admin, { ...b, dry_run: true })).body; expect(pv).toMatchObject({ dry_run: true, farms: 2, volume_tco2e: 75, amount_eur: 3000 }); expect(pv.lines.map((l: any) => [l.farm_id, l.volume])).toEqual([['AAA-001', 50], ['AAA-002', 25]]);
    expect(pv.skipped.map((s: any) => [s.farm_id, s.reason])).toEqual([['AAA-003', 'aucun volume vendable'], ['AAA-004', 'désengagée']]); expect(await left('AAA-001')).toBe(200); // a preview writes nothing
    const ok = (await req('POST', `/api/admin/funders/${f1}/attribute`, c.admin, b)).body; expect(ok.reference).toMatch(/^FG-/); expect(await left('AAA-001')).toBe(150); expect(await left('AAA-002')).toBe(75);
    const d = (await req('GET', `/api/admin/funders/${f1}`, c.admin)).body; expect(d.allocations[0]).toMatchObject({ farms: 2, status: 'reserved' }); expect(Number(d.allocations[0].pct)).toBe(25);
    const bad = await req('POST', `/api/admin/funders/${f2}/attribute`, c.admin, { farm_ids: 'AAA-001,AAA-002', pct: 80 }); expect(bad.status).toBe(400); expect(bad.body.error).toMatch(/Crédits insuffisants sur 2 ferme/); expect(await left('AAA-001')).toBe(150); // nothing written
    expect((await req('POST', `/api/admin/funders/${f2}/attribute`, c.admin, { farm_ids: 'ZZZ-1', pct: 10 })).body.error).toMatch(/Fermes inconnues/); expect((await req('POST', `/api/admin/funders/${f2}/attribute`, c.admin, { farm_ids: 'AAA-001', pct: 150 })).status).toBe(400);
    expect((await req('POST', `/api/admin/funders/${f2}/attribute`, c.u2, { farm_ids: 'AAA-001', pct: 10 })).status).toBe(403);
    expect((await req('GET', '/api/me/notifications', c.u1)).body.items[0].title).toMatch(/25 % de 2 fermes/);
  });
  it('shares a selection of farms with a funder; only that funder sees it, with public data only', async () => {
    const s = await req('POST', `/api/admin/funders/${f2}/selections`, c.admin, { name: 'Sélection Centre-Val de Loire', farm_ids: 'AAA-001, AAA-002', note: 'Proposition de novembre' }); expect(s.status).toBe(200);
    const mine = (await req('GET', '/api/funder/selections', c.u2)).body; expect(mine).toHaveLength(1); expect(mine[0]).toMatchObject({ name: 'Sélection Centre-Val de Loire', farms: 2, note: 'Proposition de novembre' }); expect(mine[0].remaining).toBe(225); expect(mine[0].sample[0].id).toBe('AAA-001');
    expect(mine[0].sample[0]).not.toHaveProperty('name'); expect(JSON.stringify(mine)).not.toMatch(/SECRET|DUPONT|VILLESECRETE/); expect((await req('GET', '/api/funder/selections', c.u1)).body).toEqual([]);
    expect((await req('GET', '/api/me/notifications', c.u2)).body.items[0].title).toMatch(/Nouvelle sélection/);
    expect((await req('POST', `/api/admin/funders/${f2}/selections`, c.admin, { name: 'x', farm_ids: 'ZZZ-9' })).status).toBe(400); expect((await req('POST', `/api/admin/funders/${f2}/selections`, c.u1, { name: 'x', farm_ids: 'AAA-001' })).status).toBe(403);
    expect((await req('DELETE', `/api/admin/selections/${s.body.id}`, c.u2)).status).toBe(403); expect((await req('DELETE', `/api/admin/selections/${s.body.id}`, c.admin)).body.ok).toBe(true); expect((await req('GET', '/api/funder/selections', c.u2)).body).toEqual([]);
  });
});
