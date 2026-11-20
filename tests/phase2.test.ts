import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { rating, ratingClass, categoryNote, endOfProjectEstimate, farmEndOfProjectEstimate } from '../shared/rating.ts';
import { openDb, type Db } from '../server/db.ts';
import { createApp } from '../server/app.ts';
import { invalidate } from '../server/facts.ts';
import { dryRun, applyImport } from '../server/importer/apply.ts';
import { createUser } from '../server/auth.ts';
import { workbook, COLS, farm } from './helpers.ts';

describe('rating red → green', () => {
  it('works in both directions and is null without thresholds or value', () => {
    expect(rating(49, 60, 38)).toBeCloseTo(50); expect(rating(70, 60, 38)).toBe(0); expect(rating(30, 60, 38)).toBe(100); // lower is better
    expect(rating(0.25, 0, 0.5)).toBeCloseTo(50); // higher is better
    expect(rating(5, null, null)).toBeNull(); expect(rating(null, 0, 1)).toBeNull(); expect(rating(5, 2, 2)).toBeNull();
    expect([0, 19.9, 20, 59, 80, 100].map(ratingClass)).toEqual([0, 0, 1, 2, 4, 4]); expect(ratingClass(null)).toBeNull();
  });
  it('category note = weighted mean of available ratings, with completeness', () => {
    const n = categoryNote([{ rating: 100, weight: 3 }, { rating: 0, weight: 1 }, { rating: null, weight: 4 }]);
    expect(n.note).toBeCloseTo(75); expect(n.completeness).toBeCloseTo(0.5);
    expect(categoryNote([{ rating: null, weight: 1 }])).toEqual({ note: null, completeness: 0 });
  });
});
describe('end-of-project estimate', () => {
  it('project: avoidance × 5 + storage × 15; farm: first follow-up × 5', () => {
    expect(endOfProjectEstimate(100, 10)).toBe(650); expect(endOfProjectEstimate(100, 0)).toBe(500); expect(farmEndOfProjectEstimate(100, 10)).toBe(550);
    expect(Math.round(farmEndOfProjectEstimate(272.98, -52.39))).toBe(1103); // farm sheet CVL2-062: 221 measured → 1,103
  });
  it.skipIf(!existsSync('inputs/carbone_farmers_data_Master_2026sept21.xlsx'))('reproduces the CVL2 trajectory page: 7,388 generated → 105,294 estimated', async () => {
    const { parseDataMaster } = await import('../server/importer/parse.ts');
    const p = await parseDataMaster(readFileSync('inputs/carbone_farmers_data_Master_2026sept21.xlsx'));
    let E = 0, S = 0; for (const f of p.farms) { E += (f.rec['fu:2025:re_avoidance'] as number) || 0; S += (f.rec['fu:2025:re_storage'] as number) || 0; }
    expect(Math.round(E + S)).toBe(7388); expect(Math.round(endOfProjectEstimate(E, S))).toBe(105294);
  });
});

describe('project and farm pages API', () => {
  let db: Db, app: ReturnType<typeof createApp>, admin = '', funder = '';
  const json = async (p: string, init?: RequestInit) => { const r = await app.request(p, init); return { status: r.status, body: await r.json() as any, text: '' }; };
  const put = (p: string, b: unknown, cookie: string) => json(p, { method: 'PUT', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(b) });
  beforeAll(async () => {
    db = await openDb({ memory: true }); invalidate();
    const pc = [{ label: 'id' }, { label: 'Porteur' }, { label: 'Projet' }, { label: 'Dates projet' }, { group: 'Données Carbone', unit: 'tCO2e', label: 'RE évitement année de suivi 1' }, { group: 'Données Carbone', unit: 'tCO2e', label: 'RE Stockage année de suivi 1' }];
    const wb = await workbook([...COLS, { label: 'Dates projet' }], [farm('CVL2-001', { 'Dates projet': '01/09/2024 - 01/09/2029' }), farm('CVL2-002', { SAU: 300, 'Lixiviation des nitrates \nScénario initial': 60, 'Lixiviation des nitrates\nScénario prospectif': 38 })],
      { CVL2: { cols: pc, rows: [{ id: 'CVL2-001', Porteur: 'Coop X', Projet: 'Projet Test', 'RE évitement année de suivi 1': 10, 'RE Stockage année de suivi 1': 4 }] } });
    const d: any = await dryRun(db, wb, { filename: 't.xlsx' }); await applyImport(db, d.id);
    const org = (await db.owner.query(`insert into organizations(type,name) values('funder','F') returning id`)).rows[0].id;
    await createUser(db, { email: 'admin@test.local', password: 'correct-horse-battery', role: 'platform_admin' });
    await createUser(db, { email: 'f@test.local', password: 'correct-horse-battery', role: 'funder_user', organization_id: org });
    app = createApp(db);
    const login = async (email: string) => (await app.request('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'correct-horse-battery' }) })).headers.get('set-cookie')!.split(';')[0];
    admin = await login('admin@test.local'); funder = await login('f@test.local');
  });
  afterAll(() => db.close());

  it('project page: three numbers, 8 blocks, scorecards, nothing identifying', async () => {
    const r = await app.request('/api/public/projects/projet-test'); const text = await r.text(); const p = JSON.parse(text);
    expect(p.project).toMatchObject({ name: 'Projet Test', porteur: 'Coop X' });
    expect(p.followup).toMatchObject({ farms_followed: 1, farms_total: 2, re_total: 14, labelled_of_followed: 100, end_of_project_estimate: 110 });
    expect(p.blocks.map((b: any) => b.key)).toEqual(['geography', 'standard', 'baseline', 'volumes', 'cobenefits', 'mrv', 'contract', 'cost']);
    expect(p.blocks[0].auto.communes_count).toBe(1); expect(p.blocks[7].auto.total_eur).toEqual({ value: null, owner: 'Équipe commerciale' }); // "à fournir", never a number
    const lix = p.scorecards.find((c: any) => c.category === 'Eau').items.find((i: any) => i.code === 'nitrate_leaching');
    expect(lix.initial).toBeCloseTo((50 * 100 + 60 * 300) / 400); expect(lix.rating_prospectif).toBeCloseTo(100 * (60 - 38.5) / 22); expect(lix.n_with_data).toBe(2);
    for (const s of ['SECRET', 'DUPONT', 'VILLESECRETE', 'Cachée', '12345678900011']) expect(text).not.toContain(s);
    expect((await app.request('/api/public/projects/nope')).status).toBe(404);
  });
  it('farm page: public facts, roadmap, follow-up, placeholders — and no identity without consent', async () => {
    const r = await app.request('/api/public/farms/CVL2-001'); const text = await r.text(); const f = JSON.parse(text);
    expect(f.name).toBeNull(); expect(f.carbon.re_labelled).toBe(100); expect(f.followup).toMatchObject({ re_total: 14, end_of_project_estimate: 70 });
    expect(f.roadmap.map((x: any) => x.label)).toEqual(['R25', 'R26', 'R27', 'R28', 'R29']); expect(f.roadmap[0].status).toBe('diagnosed'); expect(f.roadmap[1].status).toBe('planned');
    expect(f.crops).toEqual([]); expect(f.story).toBeNull(); expect(f.media).toEqual([]);
    expect(f.levers[0].items[0].name_fr).toBe('Utiliser des outils de pilotage');
    for (const s of ['SECRET', 'DUPONT', 'VILLESECRETE', 'Cachée', '12345678900011', '"lat":48.5,']) expect(text).not.toContain(s);
    await db.owner.query(`update farms set consent_public_name=true, public_name='Ferme du Test' where id='CVL2-001'`);
    expect((await json('/api/public/farms/CVL2-001')).body.name).toBe('Ferme du Test');
    expect((await app.request('/api/public/farms/ZZZ-999')).status).toBe(404);
  });
  it('admin can adjust thresholds, weights, levers and notes; the pages follow; changes are audited', async () => {
    const lever = (await json('/api/admin/config', { headers: { cookie: admin } })).body.levers[0].code;
    expect((await put('/api/admin/indicators/nitrate_leaching', { threshold_red: 100, threshold_green: 0, weight: 2, why_fr: 'Parce que.', lever_codes: [lever], config_status: 'valide' }, admin)).status).toBe(200);
    expect((await put(`/api/admin/levers/${lever}`, { description_fr: 'On pilote mieux.', impact_tco2e_ha_yr: '0.12', impact_source: 'test' }, admin)).status).toBe(200);
    expect((await put('/api/admin/farms/CVL2-001/notes/nitrate_leaching', { note_fr: 'Note propre à la ferme.' }, admin)).status).toBe(200);
    expect((await put('/api/admin/projects/projet-test/blocks/mrv', { content: 'Suivi annuel par un agronome.', source: 'Équipe agronomie', verified_by: 'A. Test' }, admin)).status).toBe(200);
    const f = (await json('/api/public/farms/CVL2-001')).body; const lix = f.scorecards.find((c: any) => c.category === 'Eau').items.find((i: any) => i.code === 'nitrate_leaching');
    expect(lix.rating_initial).toBeCloseTo(50); expect(lix.thresholds).toEqual({ red: 100, green: 0, status: 'valide' }); expect(lix.farm_note).toBe('Note propre à la ferme.'); expect(lix.levers).toHaveLength(1);
    expect(f.levers[0].items[0]).toMatchObject({ description_fr: 'On pilote mieux.' });
    const p = (await json('/api/public/projects/projet-test')).body; expect(p.blocks[5].text).toMatchObject({ content: 'Suivi annuel par un agronome.', verified_by: 'A. Test' });
    expect((await db.owner.query(`select count(*)::int n from audit_log where action in ('config.indicator','config.lever','farm.note','project.block')`)).rows[0].n).toBe(4);
  });
  it('manual farm-sheet content stays private until published', async () => {
    const body = { intro: 'Texte saisi à la main.', payout_share: 75, levers: [{ name: 'Fertilisation azotée', change: 'Engrais enfouis', credits: '564', nature: 'avoidance' }, { name: '' }], contact: { name: 'Contact Test' } };
    expect((await put('/api/admin/farms/CVL2-002/sheet', body, admin)).status).toBe(200);
    expect((await json('/api/public/farms/CVL2-002')).body.sheet).toBeNull();
    expect((await put('/api/admin/farms/CVL2-002/sheet', { ...body, published: true }, admin)).status).toBe(200);
    const s = (await json('/api/public/farms/CVL2-002')).body.sheet;
    expect(s).toMatchObject({ intro: 'Texte saisi à la main.', payout_share: 75 }); expect(s.levers).toEqual([{ name: 'Fertilisation azotée', change: 'Engrais enfouis', credits: 564, nature: 'avoidance' }]);
    expect((await put('/api/admin/farms/CVL2-002/sheet', { payout_share: 140 }, admin)).status).toBe(400);
    expect((await put('/api/admin/farms/CVL2-002/sheet', body, funder)).status).toBe(403); expect((await json('/api/admin/farms/CVL2-002/sheet')).status).toBe(401);
  });
  it('displayed co-benefits can be chosen per project and per farm; the page states shown vs tracked', async () => {
    const before = (await json('/api/public/farms/CVL2-001')).body; expect(before.cobenefits).toEqual({ tracked: 1, shown: 1 });
    const v = (await json('/api/admin/visibility/farm/cvl2-001', { headers: { cookie: admin } })).body; expect(v.items[0]).toMatchObject({ code: 'nitrate_leaching', trend: 'better' }); expect(v.hidden).toEqual([]);
    expect((await put('/api/admin/visibility/farm/CVL2-001', { hidden: ['nitrate_leaching', 'not_an_indicator'] }, admin)).body.hidden).toEqual(['nitrate_leaching']);
    const f = (await json('/api/public/farms/CVL2-001')).body; expect(f.cobenefits).toEqual({ tracked: 1, shown: 0 }); expect(JSON.stringify(f.scorecards)).not.toContain('nitrate_leaching');
    expect((await json('/api/public/farms/CVL2-002')).body.cobenefits.shown).toBe(1); // other farms unaffected
    await put('/api/admin/visibility/farm/CVL2-001', { hidden: [] }, admin); await put('/api/admin/visibility/project/projet-test', { hidden: ['nitrate_leaching'] }, admin);
    expect((await json('/api/public/projects/projet-test')).body.cobenefits).toEqual({ tracked: 1, shown: 0 }); expect((await json('/api/public/farms/CVL2-002')).body.cobenefits.shown).toBe(0); // inherited by the project's farms
    expect((await json('/api/admin/visibility/farm/CVL2-002', { headers: { cookie: admin } })).body.inherited).toEqual(['nitrate_leaching']);
    await put('/api/admin/visibility/project/projet-test', { hidden: [] }, admin);
    expect((await put('/api/admin/visibility/project/projet-test', { hidden: ['nitrate_leaching'] }, funder)).status).toBe(403); expect((await json('/api/admin/visibility/farm/CVL2-001')).status).toBe(401);
  });
  it('rejects invalid configuration and non-admin users', async () => {
    expect((await put('/api/admin/indicators/nitrate_leaching', { threshold_red: 5, threshold_green: '' }, admin)).status).toBe(400);
    expect((await put('/api/admin/indicators/nitrate_leaching', { threshold_red: 5, threshold_green: 5 }, admin)).status).toBe(400);
    expect((await put('/api/admin/indicators/nitrate_leaching', { threshold_red: 1, threshold_green: 2 }, funder)).status).toBe(403);
    expect((await put('/api/admin/indicators/nitrate_leaching', { threshold_red: 1, threshold_green: 2 }, '')).status).toBe(401);
    expect((await app.request('/api/public/pdf?path=/admin')).status).toBe(400); expect((await app.request('/api/public/pdf?path=http://evil.example/x')).status).toBe(400);
  });
});
