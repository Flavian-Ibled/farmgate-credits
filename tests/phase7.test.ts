import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import ExcelJS from 'exceljs';
import { openDb, type Db, type Ctx } from '../server/db.ts';
import { createApp } from '../server/app.ts';
import { invalidate } from '../server/facts.ts';
import { dryRun, applyImport } from '../server/importer/apply.ts';
import { createAllocation, updateAllocation } from '../server/funders.ts';
import { importCrops, importLeverCosts } from '../server/phase7.ts';
import { createUser } from '../server/auth.ts';
import { workbook, COLS, farm } from './helpers.ts';

let db: Db, app: ReturnType<typeof createApp>; const c: Record<string, string> = {}; const org: Record<string, number> = {}; const admin: Ctx = { role: 'platform_admin', uid: 1 };
const json = async (p: string, init?: RequestInit) => { const r = await app.request(p, init); const text = await r.text(); return { status: r.status, text, body: (() => { try { return JSON.parse(text); } catch { return null; } })() as any }; };
const xlsx = async (rows: any[][]) => { const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Données'); rows.forEach(r => ws.addRow(r)); return Buffer.from(await wb.xlsx.writeBuffer()); };
beforeAll(async () => {
  db = await openDb({ memory: true }); invalidate(); const pc = [{ label: 'id' }, { label: 'Porteur' }, { label: 'Projet' }];
  const wb = await workbook([...COLS, { group: 'Données Carbone', unit: 'tCO2e', label: 'Volume vendable' }], [farm('AAA-001', { Projet: 'Projet A', 'Volume Vendu': 0, 'Volume vendable': 100 }), farm('AAA-002', { Projet: 'Projet A', 'Volume Vendu': 0, 'Volume vendable': 100 }), farm('BBB-001', { Projet: 'Projet B', 'Volume Vendu': 0, 'Volume vendable': 100 })],
    { A: { cols: pc, rows: [{ id: 'AAA-001', Porteur: 'Coop A', Projet: 'Projet A' }] }, B: { cols: pc, rows: [{ id: 'BBB-001', Porteur: 'Coop B', Projet: 'Projet B' }] } });
  const d: any = await dryRun(db, wb, { filename: 't.xlsx' }); await applyImport(db, d.id);
  for (const r of (await db.owner.query(`select id,name from organizations`)).rows) org[r.name] = r.id;
  for (const n of ['Financeur 1', 'Financeur 2']) org[n] = (await db.owner.query(`insert into organizations(type,name) values('funder',$1) returning id`, [n])).rows[0].id;
  const users: [string, string, number | null][] = [['admin', 'platform_admin', null], ['f1', 'funder_user', org['Financeur 1']], ['f2', 'funder_user', org['Financeur 2']], ['pa', 'project_owner_user', org['Coop A']], ['pb', 'project_owner_user', org['Coop B']]];
  for (const [n, role, o] of users) await createUser(db, { email: `${n}@test.local`, password: 'correct-horse-battery', role, organization_id: o });
  app = createApp(db);
  for (const [n] of users) c[n] = (await app.request('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: `${n}@test.local`, password: 'correct-horse-battery' }) })).headers.get('set-cookie')!.split(';')[0];
});
afterAll(() => db.close());

describe('project-owner (porteur) portal', () => {
  it('a porteur sees its own projects and the identity of its own farms only', async () => {
    const a = await json('/api/owner/portfolio', { headers: { cookie: c.pa } }); expect(a.body.organization.name).toBe('Coop A'); expect(a.body.projects.map((p: any) => p.name)).toEqual(['Projet A']);
    expect(a.body.farms.map((f: any) => [f.id, f.name])).toEqual([['AAA-001', 'EARL SECRET AAA-001'], ['AAA-002', 'EARL SECRET AAA-002']]); expect(a.text).not.toContain('BBB-001');
    const b = await json('/api/owner/portfolio', { headers: { cookie: c.pb } }); expect(b.body.farms.map((f: any) => f.id)).toEqual(['BBB-001']); expect(b.text).not.toContain('AAA-00');
    expect(a.text).not.toMatch(/DUPONT|12345678900011|price|amount_eur/); // no farmer name, SIRET or contract price
    expect((await json('/api/owner/portfolio')).status).toBe(401); expect((await json('/api/owner/portfolio', { headers: { cookie: c.f1 } })).status).toBe(403); expect((await json('/api/funder/portfolio', { headers: { cookie: c.pa } })).status).toBe(403);
  });
  it('shows funding status of its projects without naming funders or prices', async () => {
    await createAllocation(db, admin, { funder_org_id: org['Financeur 1'], target_type: 'project', target_id: 'projet-a', volume_tco2e: 50, price_per_tco2e: 44, status: 'reserved' });
    const a = await json('/api/owner/portfolio', { headers: { cookie: c.pa } }); expect(a.body.projects[0]).toMatchObject({ sellable: 200, allocated: 50, funded_pct: 0.25 }); expect(a.body.farms[0].funded_pct).toBe(0.25); expect(a.text).not.toMatch(/Financeur 1|"44"|2200/);
  });
  it('an invitation to a porteur organisation creates a project_owner_user', async () => {
    const inv = await json(`/api/admin/funders/${org['Coop A']}/invitations`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: c.admin }, body: JSON.stringify({ email: 'tech@coopa.fr', role: 'funder_admin' }) });
    expect((await json(`/api/public/invitations/${inv.body.link.split('/').pop()}`)).body).toMatchObject({ organization: 'Coop A', role: 'project_owner_user' });
    expect((await json('/api/admin/owners', { headers: { cookie: c.admin } })).body.map((o: any) => o.name)).toEqual(['Coop A', 'Coop B']);
  });
});

describe('notifications', () => {
  const list = async (who: string) => (await json('/api/me/notifications', { headers: { cookie: c[who] } })).body;
  it('each audience only sees its own; reading clears the counter for that user', async () => {
    expect((await list('f1')).items.map((n: any) => n.kind)).toEqual(['allocation']); expect((await list('f2')).items).toEqual([]); expect((await list('pa')).items).toEqual([]);
    await json('/api/funder/quotes', { method: 'POST', headers: { 'content-type': 'application/json', cookie: c.f2 }, body: JSON.stringify({ target_type: 'farm', target_id: 'BBB-001', volume_tco2e: 10 }) });
    const a = await list('admin'); expect(a.unread).toBe(1); expect(a.items[0]).toMatchObject({ kind: 'quote', read: false }); expect(a.items[0].title).toMatch(/demande de proposition/);
    expect((await list('f1')).items).toHaveLength(1); expect((await list('f2')).items).toEqual([]); // a quote notifies Carbone Farmers, not other funders
    await json('/api/me/notifications/read', { method: 'POST', headers: { cookie: c.admin } }); expect((await list('admin')).unread).toBe(0); expect((await list('f1')).unread).toBe(1);
    expect((await json('/api/me/notifications')).status).toBe(401);
  });
  it('status changes notify the funder; follow-up status notifies the porteur and the funders of that project only', async () => {
    const al = (await db.owner.query(`select id from allocations where funder_org_id=$1 and status='reserved'`, [org['Financeur 1']])).rows[0].id; await updateAllocation(db, admin, al, { status: 'contracted' });
    const f1 = await list('f1'); expect(f1.items[0].title).toMatch(/contracted/); expect(f1.items[0].link).toMatch(/^\/certificat\/FG-/);
    await db.owner.query(`insert into annual_followups(farm_id,harvest_year,status,re_total_year) values('AAA-001',2025,'diagnosed',12)`);
    expect((await json('/api/admin/followups/projet-a/2025/status', { method: 'PUT', headers: { 'content-type': 'application/json', cookie: c.admin }, body: JSON.stringify({ status: 'verified' }) })).body.updated).toBe(1);
    expect((await list('pa')).items[0]).toMatchObject({ kind: 'followup' }); expect((await list('f1')).items[0].kind).toBe('followup'); expect((await list('pb')).items).toEqual([]); expect((await list('f2')).items).toEqual([]);
  });
});

describe('Excel imports: crops and lever costs', () => {
  it('crops: dry run writes nothing; apply replaces the farm-years in the file and reports bad rows', async () => {
    const buf = await xlsx([['id', 'Année', 'Culture', 'Surface (ha)'], ['AAA-001', 'initial', 'Blé tendre', '60,5'], ['AAA-001', 'initial', 'Colza', 39.5], ['AAA-001', 2025, 'Orge', 100], ['ZZZ-999', 2025, 'Blé', 10], ['AAA-002', 'bientôt', 'Blé', 10], ['AAA-002', 2025, '', 10]]);
    const dry = await importCrops(db, admin, buf, false); expect(dry).toMatchObject({ applied: false, rows: 3, farm_years: 2, farms: 1 }); expect(dry.errors.map(e => e.row)).toEqual([5, 6, 7]);
    expect((await db.owner.query(`select count(*)::int n from farm_crops`)).rows[0].n).toBe(0);
    await importCrops(db, admin, buf, true); const rows = (await db.owner.query(`select harvest_year, crop, hectares, share from farm_crops where farm_id='AAA-001' order by 1, 3 desc`)).rows;
    expect(rows.map(r => [r.harvest_year, r.crop, Number(r.hectares)])).toEqual([[0, 'Blé tendre', 60.5], [0, 'Colza', 39.5], [2025, 'Orge', 100]]); expect(Number(rows[0].share)).toBeCloseTo(0.605);
    await importCrops(db, admin, await xlsx([['id', 'Année', 'Culture', 'Surface'], ['AAA-001', 'initial', 'Maïs', 100]]), true);
    expect((await db.owner.query(`select crop from farm_crops where farm_id='AAA-001' and harvest_year=0`)).rows.map(r => r.crop)).toEqual(['Maïs']); expect((await db.owner.query(`select count(*)::int n from farm_crops where farm_id='AAA-001' and harvest_year=2025`)).rows[0].n).toBe(1);
    const page = (await json('/api/public/farms/AAA-001')).body; expect(page.crops.length).toBe(2);
    await expect(importCrops(db, admin, await xlsx([['id', 'Culture'], ['AAA-001', 'Blé']]), false)).rejects.toThrow(/Colonne obligatoire/);
  });
  it('lever costs: levers recognised by name, unknown ones reported, template round-trips', async () => {
    const r = await importLeverCosts(db, admin, await xlsx([['id', 'Levier', 'Coût annuel (€/ha)', 'Coût ponctuel (€/ha)', 'Économie (€/ha)'], ['AAA-001', 'Utiliser des outils de pilotage', 35, null, '5,5'], ['AAA-001', 'Levier imaginaire', 10], ['AAA-002', 'Utiliser des outils de pilotage', null, null, null], ['AAA-002', 'utiliser des outils de pilotage', -4]]), true);
    expect(r).toMatchObject({ applied: true, rows: 1, farms: 1 }); expect(r.errors.map(e => e.message)).toEqual(['Levier non reconnu : « Levier imaginaire »', 'Montant négatif']);
    expect((await json('/api/public/farms/AAA-001')).body.lever_costs).toMatchObject({ cost_annual_eur_ha: 35, saving_eur_ha: 5.5 });
    const tpl = await app.request('/api/admin/templates/lever-costs/projet-a', { headers: { cookie: c.admin } }); expect(tpl.status).toBe(200);
    const again = await importLeverCosts(db, admin, Buffer.from(await tpl.arrayBuffer()), false); expect(again).toMatchObject({ rows: 1 }); expect(again.errors).toEqual([]);
    expect((await app.request('/api/admin/templates/crops/projet-a', { headers: { cookie: c.admin } })).status).toBe(200); expect((await app.request('/api/admin/templates/crops/projet-a', { headers: { cookie: c.pa } })).status).toBe(403);
  });
});
