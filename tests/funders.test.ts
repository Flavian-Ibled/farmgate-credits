import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { spread, funding, funderShare, TRANSITIONS } from '../shared/allocation.ts';
import { openDb, PUBLIC, type Db, type Ctx } from '../server/db.ts';
import { createApp } from '../server/app.ts';
import { invalidate } from '../server/facts.ts';
import { dryRun, applyImport } from '../server/importer/apply.ts';
import { createAllocation, updateAllocation, openingBalances, farmFunding } from '../server/funders.ts';
import { createUser } from '../server/auth.ts';
import { workbook, COLS, farm } from './helpers.ts';

describe('allocation rules (pure)', () => {
  it('spreads pro rata of the weight, never above what remains, and sums exactly to the volume', () => {
    expect(spread(100, [{ id: 'A', remaining: 300, weight: 300 }, { id: 'B', remaining: 100, weight: 100 }])).toEqual([{ farm_id: 'A', volume: 75 }, { farm_id: 'B', volume: 25 }]);
    // B is capped at 10: its overflow goes to A
    expect(spread(100, [{ id: 'A', remaining: 300, weight: 100 }, { id: 'B', remaining: 10, weight: 100 }])).toEqual([{ farm_id: 'A', volume: 90 }, { farm_id: 'B', volume: 10 }]);
    const l = spread(100, [1, 2, 3].map(i => ({ id: 'F' + i, remaining: 50, weight: 1 }))); expect(l.reduce((s, x) => s + x.volume, 0)).toBeCloseTo(100, 6); expect(l.map(x => x.volume).sort()).toEqual([33.33, 33.33, 33.34]);
    expect(spread(5, [{ id: 'A', remaining: 0, weight: 9 }, { id: 'B', remaining: 5, weight: 0 }])).toEqual([{ farm_id: 'B', volume: 5 }]);
  });
  it('refuses to over-allocate', () => { expect(() => spread(401, [{ id: 'A', remaining: 300, weight: 1 }, { id: 'B', remaining: 100, weight: 1 }])).toThrow(/supérieur aux crédits restants/); expect(() => spread(0, [])).toThrow(); });
  it('funded %, remaining and funder share', () => {
    expect(funding(500, 125)).toEqual({ sellable: 500, allocated: 125, remaining: 375, funded_pct: 0.25 }); expect(funding(100, 100).remaining).toBe(0); expect(funding(null, 0).funded_pct).toBeNull();
    expect(funderShare(50, 200)).toBe(0.25); expect(funderShare(50, null)).toBeNull(); expect(TRANSITIONS.retired).toEqual([]);
  });
});

describe('allocations in the database', () => {
  let db: Db, app: ReturnType<typeof createApp>, f1 = 0, f2 = 0, cAdmin = '', cF1 = '', cF2 = ''; const admin: Ctx = { role: 'platform_admin', uid: 1 };
  const json = async (p: string, init?: RequestInit) => { const r = await app.request(p, init); const text = await r.text(); return { status: r.status, text, body: (() => { try { return JSON.parse(text); } catch { return null; } })() as any }; };
  const send = (method: string, p: string, b: unknown, cookie: string) => json(p, { method, headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(b) });
  beforeAll(async () => {
    db = await openDb({ memory: true }); invalidate();
    const wb = await workbook([...COLS, { group: 'Données Carbone', unit: 'tCO2e', label: 'Volume vendable' }], [
      farm('AAA-001', { Projet: 'Projet A', 'RE totales labellisées  (sur 5 ans)': 300, 'RE Stockage totales\n(sur 5 ans)': 260, 'Volume Vendu': 100, 'Volume Disponible': 200, 'Volume vendable': 300 }),
      farm('AAA-002', { Projet: 'Projet A', 'RE totales labellisées  (sur 5 ans)': 100, 'Volume Vendu': 0, 'Volume Disponible': 80, 'Volume vendable': 80 }), // 20 tCO2e valued through supply chains
      farm('BBB-001', { Projet: 'Projet B', 'RE totales labellisées  (sur 5 ans)': 200, 'RE Stockage totales\n(sur 5 ans)': 160, 'Volume Vendu': 0, 'Volume Disponible': 200, 'Volume vendable': 200 })]);
    const d: any = await dryRun(db, wb, { filename: 't.xlsx' }); await applyImport(db, d.id);
    const org = async (n: string, pol: string) => (await db.owner.query(`insert into organizations(type,name,public_name_policy) values('funder',$1,$2) returning id`, [n, pol])).rows[0].id;
    f1 = await org('Financeur Public', 'named'); f2 = await org('Financeur Discret', 'private');
    await createUser(db, { email: 'admin@test.local', password: 'correct-horse-battery', role: 'platform_admin' });
    await createUser(db, { email: 'f1@test.local', password: 'correct-horse-battery', role: 'funder_user', organization_id: f1 }); await createUser(db, { email: 'f2@test.local', password: 'correct-horse-battery', role: 'funder_user', organization_id: f2 });
    app = createApp(db);
    const login = async (email: string) => (await app.request('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'correct-horse-battery' }) })).headers.get('set-cookie')!.split(';')[0];
    cAdmin = await login('admin@test.local'); cF1 = await login('f1@test.local'); cF2 = await login('f2@test.local');
  });
  afterAll(() => db.close());
  const fund = async (id: string) => (await farmFunding(db, [id])).get(id)!;

  it('opening balances turn "Volume Vendu" into historical lines without a funder — idempotent, totals match the Data Master', async () => {
    const r = await openingBalances(db, admin); expect(r).toMatchObject({ farms: 1, created: 1, total_tco2e: 100 });
    expect(await openingBalances(db, admin)).toMatchObject({ created: 0, updated: 0, total_tco2e: 100 });
    expect(await fund('AAA-001')).toMatchObject({ sellable: 300, allocated: 100, remaining: 200, unassigned: 100, funders: [] });
    const s = (await send('GET', '/api/admin/funding/summary', undefined, cAdmin)).body; expect(Number(s.master_sold)).toBe(100); expect(Number(s.historical)).toBe(100); expect(Number(s.unassigned)).toBe(100);
  });
  it('a project allocation is spread pro rata of labelled volume within what remains; sellable excludes supply-chain volume', async () => {
    const a = await createAllocation(db, admin, { funder_org_id: f1, target_type: 'project', target_id: 'projet-a', volume_tco2e: 140, price_per_tco2e: 40, status: 'reserved' });
    expect(a.reference).toMatch(/^FG-\d{4}-\d{6}$/); expect(a.lines).toEqual([{ farm_id: 'AAA-001', volume: 105 }, { farm_id: 'AAA-002', volume: 35 }]);
    expect(await fund('AAA-001')).toMatchObject({ allocated: 205, remaining: 95 }); expect(await fund('AAA-002')).toMatchObject({ sellable: 80, allocated: 35, remaining: 45 });
    expect(Number((await db.owner.query(`select amount_eur from allocations where id=$1`, [a.id])).rows[0].amount_eur)).toBe(5600);
  });
  it('never over-allocates: the second funder is refused and nothing is written', async () => {
    const before = (await db.owner.query(`select count(*)::int n from allocations`)).rows[0].n;
    await expect(createAllocation(db, admin, { funder_org_id: f2, target_type: 'project', target_id: 'projet-a', volume_tco2e: 140.5, status: 'reserved' })).rejects.toThrow(/supérieur aux crédits restants \(140/);
    expect((await db.owner.query(`select count(*)::int n from allocations`)).rows[0].n).toBe(before); // the whole transaction was rolled back
    await expect(createAllocation(db, admin, { funder_org_id: f2, target_type: 'farm', target_id: 'ZZZ-999', volume_tco2e: 1 })).rejects.toThrow(/Aucune ferme/);
  });
  it('a farm becomes Sold Out when nothing remains and re-opens when the allocation is cancelled', async () => {
    const a = await createAllocation(db, admin, { funder_org_id: f2, target_type: 'farm', target_id: 'AAA-002', volume_tco2e: 45, status: 'contracted' });
    const st = async () => (await db.owner.query(`select lbc_status from farms where id='AAA-002'`)).rows[0].lbc_status;
    expect(await st()).toBe('Sold Out'); expect((await fund('AAA-002')).funded_pct).toBe(1);
    expect((await db.owner.query(`select bool_and(frozen) f from allocation_lines where allocation_id=$1`, [a.id])).rows[0].f).toBe(true); // frozen at contract signature
    await expect(updateAllocation(db, admin, a.id, { status: 'reserved' })).rejects.toThrow(/non autorisé/);
    await updateAllocation(db, admin, a.id, { status: 'cancelled' });
    expect(await st()).toBe('Labellisé'); expect(await fund('AAA-002')).toMatchObject({ allocated: 35, remaining: 45 });
  });
  it('a quote reserves nothing until an admin converts it — and the guard applies at that moment', async () => {
    const q = await send('POST', '/api/funder/quotes', { target_type: 'farm', target_id: 'BBB-001', volume_tco2e: 150, notes: 'Pour notre rapport RSE' }, cF2);
    expect(q.status).toBe(200); expect(q.body.status).toBe('quote'); expect(q.body.lines).toEqual([]); expect((await fund('BBB-001')).allocated).toBe(0);
    await createAllocation(db, admin, { funder_org_id: f1, target_type: 'farm', target_id: 'BBB-001', volume_tco2e: 100, status: 'reserved' });
    expect((await send('PUT', `/api/admin/allocations/${q.body.id}`, { status: 'reserved' }, cAdmin)).status).toBe(400); // only 100 left for a 150 quote
    expect((await db.owner.query(`select status from allocations where id=$1`, [q.body.id])).rows[0].status).toBe('quote');
    expect((await fund('BBB-001')).allocated).toBe(100);
  });
  it('funder portal: only my allocations, my share of each farm and the impact attributed to me', async () => {
    const p1 = (await json('/api/funder/portfolio', { headers: { cookie: cF1 } })).body, p2 = await json('/api/funder/portfolio', { headers: { cookie: cF2 } });
    expect(p1.organization.name).toBe('Financeur Public'); expect(p1.farms.map((f: any) => [f.id, f.my_volume])).toEqual([['AAA-001', 105], ['BBB-001', 100], ['AAA-002', 35]]);
    expect(p1.farms[0].share).toBeCloseTo(105 / 300); expect(p1.farms[0].attributed.sau).toBeCloseTo(100 * 105 / 300); expect(p1.totals.funded).toBe(240); expect(p1.totals.amount_eur).toBe(5600);
    expect(p2.body.farms).toEqual([]); expect(p2.body.allocations.map((a: any) => a.status).sort()).toEqual(['cancelled', 'quote']);
    for (const s of ['Financeur Public', 'FG-' + new Date().getFullYear() + '-000002', '5600']) expect(p2.text).not.toContain(s); // nothing about the other funder
    expect((await json('/api/funder/portfolio')).status).toBe(401); expect((await json('/api/funder/portfolio', { headers: { cookie: cAdmin } })).status).toBe(403);
    expect((await send('POST', '/api/admin/allocations', { target_type: 'farm', target_id: 'BBB-001', volume_tco2e: 1 }, cF1)).status).toBe(403);
  });
  it('public pages show funded % and only the funders who agreed to be named; the ledger verifies a reference without personal data', async () => {
    await createAllocation(db, admin, { funder_org_id: f2, target_type: 'farm', target_id: 'BBB-001', volume_tco2e: 50, price_per_tco2e: 99, status: 'contracted' });
    const farmPage = await json('/api/public/farms/BBB-001'); expect(farmPage.body.funding).toMatchObject({ sellable: 200, allocated: 150, remaining: 50, funded_pct: 0.75, funders: ['Financeur Public'], n_funders: 2 });
    const proj = await json('/api/public/projects/projet-a'); expect(proj.body.funding).toMatchObject({ sellable: 380, allocated: 240, remaining: 140, unassigned: 100, funders: ['Financeur Public'] });
    for (const t of [farmPage.text, proj.text]) { expect(t).not.toContain('Financeur Discret'); expect(t).not.toContain('"price'); }
    const refs = (await db.owner.query(`select reference, funder_org_id from allocations where status='contracted' and kind='standard' order by id`)).rows;
    const priv = await json(`/api/public/ledger/${refs.find(r => r.funder_org_id === f2)!.reference}`); expect(priv.body).toMatchObject({ funder: null, funder_visibility: 'private', volume_tco2e: 50, status: 'contracted', valid: true, farms: 1 }); expect(priv.text).not.toMatch(/Discret|price|amount|99/);
    expect((await json(`/api/public/ledger/${refs.find(r => r.funder_org_id === f2)!.reference}`, { headers: { cookie: cF2 } })).body.funder).toBe('Financeur Discret'); // the funder sees its own name
    const res = (await db.owner.query(`select reference from allocations where funder_org_id=$1 and status='reserved' limit 1`, [f1])).rows[0].reference;
    expect((await json(`/api/public/ledger/${res}`)).body).toMatchObject({ funder: 'Financeur Public', funder_visibility: 'named' }); expect((await json('/api/public/ledger/FG-0000-000000')).status).toBe(404);
    // the public "available volume" now follows the ledger
    invalidate(); const sel = (await send('POST', '/api/public/selection', { filters: { ids: ['BBB-001'] } }, '')).body; expect(sel.carbon.vol_vendu).toBe(150); expect(sel.carbon.vol_dispo).toBe(50);
  });
  it('invitation: an admin creates a link, the invited person sets a 12+ character password, then signs in to the portal', async () => {
    const inv = await send('POST', `/api/admin/funders/${f2}/invitations`, { email: 'Nouvelle@Client.fr', role: 'funder_admin' }, cAdmin); expect(inv.status).toBe(200); const token = inv.body.link.split('/').pop();
    expect((await json(`/api/public/invitations/${token}`)).body).toMatchObject({ email: 'nouvelle@client.fr', organization: 'Financeur Discret', role: 'funder_admin' });
    expect((await send('POST', `/api/public/invitations/${token}/accept`, { password: 'court' }, '')).status).toBe(400);
    expect((await send('POST', `/api/public/invitations/${token}/accept`, { password: 'un-mot-de-passe-long', first_name: 'N' }, '')).status).toBe(200);
    expect((await json(`/api/public/invitations/${token}`)).status).toBe(404); // single use
    const login = await app.request('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'nouvelle@client.fr', password: 'un-mot-de-passe-long' }) });
    expect((await json('/api/funder/portfolio', { headers: { cookie: login.headers.get('set-cookie')!.split(';')[0] } })).body.organization.name).toBe('Financeur Discret');
    expect((await send('POST', `/api/admin/funders/${f2}/invitations`, { email: 'x@y.fr' }, cF1)).status).toBe(403);
    expect((await db.as(PUBLIC, q => q.query(`select * from invitations`))).rows).toHaveLength(0);
  });
});

const MASTER = 'inputs/carbone_farmers_data_Master_2026sept21.xlsx';
describe.skipIf(!existsSync(MASTER))('opening balances on the real Data Master', () => {
  it('historical sales total ≈ 126,361 tCO₂e and available volume stays consistent', async () => {
    const db = await openDb({ memory: true }); invalidate(); const d: any = await dryRun(db, readFileSync(MASTER), { filename: 'm.xlsx' }); await applyImport(db, d.id);
    const r = await openingBalances(db, { role: 'platform_admin' });
    console.log('opening balances', r);
    const s = (await db.owner.query(`select (select sum(vol_vendu) from farms) master, (select sum(l.volume_tco2e) from allocation_lines l) lines, (select sum(vol_dispo) from farms) dispo, (select sum(greatest(0, coalesce(f.vol_vendable,f.re_labelled,0) - coalesce((select sum(volume_tco2e) from allocation_lines l where l.farm_id=f.id),0))) from farms f) remaining`)).rows[0];
    console.log('totals', s);
    expect(Math.round(Number(s.master))).toBe(126361); expect(Math.abs(Number(s.lines) - Number(s.master))).toBeLessThan(Number(s.master) * 0.02);
    await db.close();
  });
});
