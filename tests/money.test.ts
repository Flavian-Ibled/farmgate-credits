import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { validateRemuneration, resolveRemuneration, flows, farmerAmount, DEFAULT_REMUNERATION, MIN_FARMER_PCT } from '../shared/remuneration.ts';
import { openDb, type Db, type Ctx } from '../server/db.ts';
import { createApp } from '../server/app.ts';
import { invalidate } from '../server/facts.ts';
import { dryRun, applyImport } from '../server/importer/apply.ts';
import { createAllocation } from '../server/funders.ts';
import { createUser } from '../server/auth.ts';
import { workbook, COLS, farm } from './helpers.ts';

describe('remuneration rules', () => {
  it('default: the farmer receives at least 75 % of the price of a tonne', () => {
    expect(MIN_FARMER_PCT).toBe(75); expect(resolveRemuneration()).toMatchObject({ farmer_pct: 75, advice_pct: 0, source: 'default' }); expect(validateRemuneration({})).toBeNull(); expect(validateRemuneration(null)).toBeNull();
    expect(flows(DEFAULT_REMUNERATION)).toEqual([{ key: 'farmer_paid', pct: 75, known: true }, { key: 'undocumented', pct: 25, known: false }]); // the remaining 25 % is never invented
  });
  it('a contract can grant more, part of it as agronomic advice (SEDIF: 82 % of which 7 %)', () => {
    const r = validateRemuneration({ farmer_pct: '82', advice_pct: '7' })!; expect(r).toMatchObject({ farmer_pct: 82, advice_pct: 7 });
    expect(flows(r)).toEqual([{ key: 'farmer_paid', pct: 75, known: true }, { key: 'advice', pct: 7, known: true }, { key: 'undocumented', pct: 18, known: false }]);
    expect(farmerAmount(10000, r)).toBe(8200); expect(farmerAmount(null, r)).toBeNull();
  });
  it('what is paid to the farmer can never go below 75 %', () => {
    expect(() => validateRemuneration({ farmer_pct: 70 })).toThrow(/inférieure à 75/); expect(() => validateRemuneration({ farmer_pct: 80, advice_pct: 10 })).toThrow(/inférieure à 75/);
    expect(() => validateRemuneration({ farmer_pct: 76, advice_pct: 80 })).toThrow(/ne peut pas la dépasser/); expect(() => validateRemuneration({ farmer_pct: 140 })).toThrow();
  });
  it('a detailed breakdown must sum to 100 %', () => {
    expect(() => validateRemuneration({ farmer_pct: 75, mrv_pct: 10, cf_pct: 10 })).toThrow(/100 %/);
    const r = validateRemuneration({ farmer_pct: '75', mrv_pct: '8', support_pct: 5, cf_pct: '7,5', partner_pct: 3, label_pct: 1.5 })!;
    expect(flows(r).map(f => [f.key, f.pct])).toEqual([['farmer_paid', 75], ['mrv', 8], ['support', 5], ['cf', 7.5], ['partner', 3], ['label', 1.5]]); expect(flows(r).every(f => f.known)).toBe(true);
  });
  it('contract model wins over the project model, which wins over the default', () => {
    const proj = validateRemuneration({ farmer_pct: 78 })!, con = validateRemuneration({ farmer_pct: 82, advice_pct: 7 })!;
    expect(resolveRemuneration(con, proj)).toMatchObject({ farmer_pct: 82, source: 'contract' }); expect(resolveRemuneration(null, proj)).toMatchObject({ farmer_pct: 78, source: 'project' });
  });
});

describe('money, lever costs and social co-benefits through the API', () => {
  let db: Db, app: ReturnType<typeof createApp>, cAdmin = '', cFunder = '', org = 0; const admin: Ctx = { role: 'platform_admin', uid: 1 };
  const json = async (p: string, init?: RequestInit) => { const r = await app.request(p, init); const text = await r.text(); return { status: r.status, text, body: (() => { try { return JSON.parse(text); } catch { return null; } })() as any }; };
  const put = (p: string, b: unknown, cookie: string) => json(p, { method: 'PUT', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(b) });
  beforeAll(async () => {
    db = await openDb({ memory: true }); invalidate();
    const wb = await workbook([...COLS, { group: 'Données Carbone', unit: 'tCO2e', label: 'Volume vendable' }], [farm('AAA-001', { Projet: 'Projet A', SAU: 100, 'Volume Vendu': 0, 'Volume vendable': 100 }), farm('AAA-002', { Projet: 'Projet A', SAU: 300, 'Volume Vendu': 0, 'Volume vendable': 100 })]);
    const d: any = await dryRun(db, wb, { filename: 't.xlsx' }); await applyImport(db, d.id);
    org = (await db.owner.query(`insert into organizations(type,name,public_name_policy) values('funder','SEDIF test','named') returning id`)).rows[0].id;
    await createUser(db, { email: 'admin@test.local', password: 'correct-horse-battery', role: 'platform_admin' }); await createUser(db, { email: 'f@test.local', password: 'correct-horse-battery', role: 'funder_user', organization_id: org });
    app = createApp(db); const login = async (email: string) => (await app.request('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'correct-horse-battery' }) })).headers.get('set-cookie')!.split(';')[0];
    cAdmin = await login('admin@test.local'); cFunder = await login('f@test.local');
  });
  afterAll(() => db.close());

  it('project and farm pages show 75 % by default and never invent the rest', async () => {
    const p = (await json('/api/public/projects/projet-a')).body; expect(p.remuneration).toMatchObject({ farmer_pct: 75, source: 'default' }); expect(p.remuneration.flows[1]).toEqual({ key: 'undocumented', pct: 25, known: false });
    expect(p.blocks[7].auto.farmer_share).toBe('75 % du prix de la tonne — minimum garanti'); expect(p.blocks[7].auto.breakdown).toEqual({ value: null, owner: 'Carbone Farmers' });
    expect((await json('/api/public/farms/AAA-001')).body.remuneration.farmer_pct).toBe(75); expect(p.social.every((s: any) => s.value === null)).toBe(true); expect(p.lever_costs).toMatchObject({ farms_with_data: 0, cost_annual_eur_ha: null });
  });
  it('admin sets the project model; invalid models are refused', async () => {
    expect((await put('/api/admin/projects/projet-a/remuneration', { farmer_pct: 70 }, cAdmin)).status).toBe(400);
    expect((await put('/api/admin/projects/projet-a/remuneration', { farmer_pct: 76, mrv_pct: 9, support_pct: 5, cf_pct: 7, partner_pct: 2, label_pct: 1 }, cAdmin)).status).toBe(200);
    const p = (await json('/api/public/projects/projet-a')).body; expect(p.remuneration).toMatchObject({ farmer_pct: 76, source: 'project' }); expect(p.remuneration.flows.every((f: any) => f.known)).toBe(true); expect(p.blocks[7].auto.breakdown).toBe('voir « Où va l’argent »');
    expect((await put('/api/admin/projects/projet-a/remuneration', { farmer_pct: 80 }, cFunder)).status).toBe(403);
  });
  it('a contract (SEDIF) carries its own model: 82 % of which 7 % advice; the funder sees what reaches farmers', async () => {
    const a = await createAllocation(db, admin, { funder_org_id: org, target_type: 'project', target_id: 'projet-a', volume_tco2e: 100, price_per_tco2e: 50, status: 'contracted' });
    let pf = (await json('/api/funder/portfolio', { headers: { cookie: cFunder } })).body; expect(pf.allocations[0]).toMatchObject({ farmer_pct: 76, farmer_amount_eur: 3800 }); // project model
    expect((await put(`/api/admin/allocations/${a.id}/remuneration`, { farmer_pct: 82, advice_pct: 7 }, cAdmin)).body).toMatchObject({ farmer_pct: 82, advice_pct: 7, source: 'contract' });
    expect((await put(`/api/admin/allocations/${a.id}/remuneration`, { farmer_pct: 82, advice_pct: 10 }, cAdmin)).status).toBe(400);
    pf = (await json('/api/funder/portfolio', { headers: { cookie: cFunder } })).body; expect(pf.allocations[0]).toMatchObject({ farmer_pct: 82, advice_pct: 7, amount_eur: 5000, farmer_amount_eur: 4100 }); expect(pf.totals.farmer_amount_eur).toBe(4100);
    expect((await json(`/api/public/ledger/${a.reference}`)).body.farmer_pct).toBe(82);
    const pub = await json('/api/public/projects/projet-a'); expect(pub.body.remuneration.farmer_pct).toBe(76); expect(pub.text).not.toMatch(/"price|amount_eur|(^|[^\d.])(5000|4100)([^\d]|$)/); // a contract's price never reaches public pages
    expect((await db.owner.query(`select cost_breakdown->>'spread_by' s from allocations where id=$1`, [a.id])).rows[0].s).toBe('labelled'); // other contract data kept
  });
  it('lever costs: manual entry per farm, totals per farm and SAU-weighted mean per project with coverage', async () => {
    const levers = (await json('/api/admin/farms/aaa-001/levers', { headers: { cookie: cAdmin } })).body; const code = levers.find((l: any) => l.active).code; expect(levers.every((l: any) => l.cost_annual_eur_ha == null)).toBe(true);
    expect((await put(`/api/admin/farms/AAA-001/levers/${code}`, { cost_annual_eur_ha: '40', saving_eur_ha: '10' }, cAdmin)).status).toBe(200); expect((await put(`/api/admin/farms/AAA-002/levers/${code}`, { cost_annual_eur_ha: 20 }, cAdmin)).status).toBe(200);
    expect((await put(`/api/admin/farms/AAA-001/levers/${code}`, { cost_annual_eur_ha: -5 }, cAdmin)).status).toBe(400); expect((await put(`/api/admin/farms/AAA-001/levers/${code}`, { cost_annual_eur_ha: 1 }, cFunder)).status).toBe(403);
    const f = (await json('/api/public/farms/AAA-001')).body.lever_costs; expect(f).toMatchObject({ cost_annual_eur_ha: 40, saving_eur_ha: 10, net_eur_ha: 30 }); expect(f.items[0].source).toBe('saisie manuelle');
    const p = (await json('/api/public/projects/projet-a')).body.lever_costs; expect(p).toMatchObject({ farms_with_data: 2, farms_total: 2 }); expect(p.cost_annual_eur_ha).toBeCloseTo((40 * 100 + 20 * 300) / 400); expect(p.saving_eur_ha).toBeCloseTo(2.5);
    // a Data Master re-import must keep the costs
    const wb = await workbook([...COLS, { group: 'Données Carbone', unit: 'tCO2e', label: 'Volume vendable' }], [farm('AAA-001', { Projet: 'Projet A', SAU: 101, 'Volume Vendu': 0, 'Volume vendable': 100 }), farm('AAA-002', { Projet: 'Projet A', SAU: 300, 'Volume Vendu': 0, 'Volume vendable': 100 })]);
    const d: any = await dryRun(db, wb, { filename: 't2.xlsx' }); await applyImport(db, d.id); invalidate(); expect((await json('/api/public/farms/AAA-001')).body.lever_costs.cost_annual_eur_ha).toBe(40);
  });
  it('social and territorial co-benefits: optional project fields, "à fournir" until filled', async () => {
    expect((await put('/api/admin/projects/projet-a/social', { jobs: '3 emplois agricoles maintenus', training: '  ', source: 'Enquête 2026', hacker: 'x' }, cAdmin)).status).toBe(200);
    const p = (await json('/api/public/projects/projet-a')).body; expect(p.social.find((s: any) => s.key === 'jobs').value).toBe('3 emplois agricoles maintenus'); expect(p.social.find((s: any) => s.key === 'training').value).toBeNull(); expect(p.social_meta.source).toBe('Enquête 2026'); expect(JSON.stringify(p)).not.toContain('hacker');
    expect((await put('/api/admin/projects/projet-a/social', { jobs: 'x' }, '')).status).toBe(401);
  });
});
