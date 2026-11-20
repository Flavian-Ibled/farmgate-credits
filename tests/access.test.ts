// One test per role proving what it can and cannot read (brief 4F). Permissions are enforced by Postgres RLS, not by the UI.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { openDb, PUBLIC, type Db, type Ctx } from '../server/db.ts';
import { createApp } from '../server/app.ts';
import { invalidate } from '../server/facts.ts';
import { dryRun, applyImport } from '../server/importer/apply.ts';
import { createUser } from '../server/auth.ts';
import { workbook, COLS, farm } from './helpers.ts';

let db: Db; let org: Record<string, number> = {}; let app: ReturnType<typeof createApp>;
const count = async (ctx: Ctx, sql: string) => (await db.as(ctx, q => q.query(`select count(*)::int n from (${sql}) x`))).rows[0].n as number;
const denied = async (ctx: Ctx, sql: string) => { try { const r = await db.as(ctx, q => q.query(sql + ' returning 1')); return r.rows.length === 0; } catch { return true; } };

beforeAll(async () => {
  db = await openDb({ memory: true }); invalidate();
  const pc = [{ label: 'id' }, { label: 'Porteur' }, { label: 'Projet' }];
  const wb = await workbook(COLS, [farm('AAA-001', { Projet: 'Projet A' }), farm('AAA-002', { Projet: 'Projet A' }), farm('BBB-001', { Projet: 'Projet B' })],
    { A: { cols: pc, rows: [{ id: 'AAA-001', Porteur: 'Coop A', Projet: 'Projet A' }] }, B: { cols: pc, rows: [{ id: 'BBB-001', Porteur: 'Coop B', Projet: 'Projet B' }] } });
  const d: any = await dryRun(db, wb, { filename: 't.xlsx' }); await applyImport(db, d.id);
  for (const r of (await db.owner.query(`select id,name from organizations`)).rows) org[r.name] = r.id;
  for (const n of ['Funder 1', 'Funder 2']) org[n] = (await db.owner.query(`insert into organizations(type,name) values('funder',$1) returning id`, [n])).rows[0].id;
  const alloc = async (o: number, farmId: string, status: string) => { const a = (await db.owner.query(`insert into allocations(funder_org_id,target_type,target_id,volume_tco2e,price_per_tco2e,status) values($1,'farm',$2,10,45,$3) returning id`, [o, farmId, status])).rows[0].id; await db.owner.query(`insert into allocation_lines(allocation_id,farm_id,volume_tco2e) values($1,$2,10)`, [a, farmId]); };
  await alloc(org['Funder 1'], 'AAA-001', 'contracted'); await alloc(org['Funder 2'], 'BBB-001', 'contracted'); await alloc(org['Funder 1'], 'AAA-002', 'quote');
  await createUser(db, { email: 'admin@test.local', password: 'correct-horse-battery', role: 'platform_admin' });
  await createUser(db, { email: 'f1@test.local', password: 'correct-horse-battery', role: 'funder_user', organization_id: org['Funder 1'] });
  app = createApp(db);
});
afterAll(() => db.close());

describe('public (anonymous)', () => {
  it('reads public farm facts but no identifying data, allocation, user or import', async () => {
    expect(await count(PUBLIC, 'select * from farms')).toBe(3);
    for (const t of ['farm_private', 'allocations', 'allocation_lines', 'users', 'sessions', 'imports', 'import_changes', 'audit_log']) expect(await count(PUBLIC, `select * from ${t}`), t).toBe(0);
    expect(await count(PUBLIC, `select * from organizations where type='funder'`)).toBe(0); // funders are private unless they opt in
  });
  it('cannot write anything', async () => {
    expect(await denied(PUBLIC, `update farms set sau=1`)).toBe(true); expect(await denied(PUBLIC, `delete from farms`)).toBe(true);
    expect(await denied(PUBLIC, `insert into allocations(target_type,volume_tco2e,status) values('farm',1,'quote')`)).toBe(true);
    expect((await db.owner.query(`select count(*)::int n from farms where sau=100`)).rows[0].n).toBe(3);
  });
  it('public API responses never contain names, farmers, addresses, communes, SIRET or exact coordinates', async () => {
    const post = async (p: string, b: any) => (await app.request(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })).text();
    const all = [await (await app.request('/api/public/summary')).text(), await (await app.request('/api/public/meta')).text(), await post('/api/public/selection', {}), await post('/api/public/map', { zoom: 12, bbox: [-6, 41, 10, 52] }), await post('/api/public/farms', { size: 100 })].join('\n');
    for (const secret of ['SECRET', 'DUPONT', 'Cachée', 'VILLESECRETE', '12345678900011', '28320', '"lat":48.5,', '"lng":1.75']) expect(all, secret).not.toContain(secret);
    expect(all).toContain('AAA-001'); // the farm id is public ("Ferme AAA-001")
    const pts = JSON.parse(await post('/api/public/map', { zoom: 12, bbox: [-6, 41, 10, 52] })).points;
    expect(pts).toHaveLength(3); for (const p of pts) expect(Math.hypot((p.lat - 48.5) * 111.32, (p.lng - 1.75) * 73.7)).toBeGreaterThan(1.9);
  });
  it('admin API is closed to anonymous visitors and to funders', async () => {
    expect((await app.request('/api/admin/imports')).status).toBe(401); expect((await app.request('/api/admin/farms/AAA-001')).status).toBe(401);
    const login = await app.request('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'f1@test.local', password: 'correct-horse-battery' }) });
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    expect((await app.request('/api/admin/imports', { headers: { cookie } })).status).toBe(403);
    expect((await app.request('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'f1@test.local', password: 'wrong-password-123' }) })).status).toBe(401);
  });
});
describe('funder_user', () => {
  const f1 = (): Ctx => ({ role: 'funder_user', org: org['Funder 1'], uid: 2 });
  it('reads its own allocations only — never another funder\'s volumes, prices or contracts', async () => {
    expect(await count(f1(), 'select * from allocations')).toBe(2); expect(await count(f1(), `select * from allocations where funder_org_id<>${org['Funder 1']}`)).toBe(0);
    expect(await count(f1(), 'select * from allocation_lines')).toBe(2); expect(await count(f1(), `select * from organizations where type='funder'`)).toBe(1);
  });
  it('sees identifying data only for farms it funds under a signed contract (not a quote)', async () => {
    expect((await db.as(f1(), q => q.query(`select farm_id from farm_private order by 1`))).rows.map(r => r.farm_id)).toEqual(['AAA-001']);
  });
  it('cannot write allocations or read users, imports, audit log', async () => {
    expect(await denied(f1(), `update allocations set volume_tco2e=999`)).toBe(true);
    for (const t of ['imports', 'audit_log']) expect(await count(f1(), `select * from ${t}`)).toBe(0);
    expect(await count(f1(), 'select * from users')).toBe(1); // itself
  });
});
describe('funder_admin', () => {
  it('sees the users of its own organisation only', async () => {
    const ctx: Ctx = { role: 'funder_admin', org: org['Funder 1'], uid: 99 };
    expect((await db.as(ctx, q => q.query(`select email from users`))).rows.map(r => r.email)).toEqual(['f1@test.local']);
  });
});
describe('project_owner_user (porteur)', () => {
  it('sees farm identities of its own projects only, and no allocation', async () => {
    const a: Ctx = { role: 'project_owner_user', org: org['Coop A'], uid: 50 };
    expect((await db.as(a, q => q.query(`select farm_id from farm_private order by 1`))).rows.map(r => r.farm_id)).toEqual(['AAA-001', 'AAA-002']);
    expect(await count({ role: 'project_owner_user', org: org['Coop B'], uid: 51 }, 'select * from farm_private')).toBe(1);
    expect(await count(a, 'select * from allocations')).toBe(0); expect(await denied(a, `update farm_private set name='x'`)).toBe(true);
  });
});
describe('staff', () => {
  const s: Ctx = { role: 'staff', uid: 60 };
  it('reads and edits farms and imports, but has no user administration', async () => {
    expect(await count(s, 'select * from farm_private')).toBe(3); expect(await count(s, 'select * from imports')).toBe(1);
    expect(await denied(s, `update farms set story_status='draft' where id='AAA-001'`)).toBe(false);
    expect(await count(s, 'select * from users')).toBe(0); expect(await denied(s, `update users set role='platform_admin'`)).toBe(true);
  });
});
describe('platform_admin', () => {
  it('reads everything', async () => {
    const a: Ctx = { role: 'platform_admin', uid: 1 };
    expect(await count(a, 'select * from farm_private')).toBe(3); expect(await count(a, 'select * from allocations')).toBe(3); expect(await count(a, 'select * from users')).toBe(2);
  });
});
