import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import ExcelJS from 'exceljs';
import { openDb, type Db } from '../server/db.ts';
import { createApp } from '../server/app.ts';
import { invalidate } from '../server/facts.ts';
import { dryRun, applyImport } from '../server/importer/apply.ts';
import { createAllocation } from '../server/funders.ts';
import { createUser } from '../server/auth.ts';
import { workbook, COLS, farm } from './helpers.ts';

let db: Db, app: ReturnType<typeof createApp>, cAdmin = ''; let fNamed = 0, fPrivate = 0;
const req = async (method: string, p: string, cookie = '', b?: unknown) => { const r = await app.request(p, { method, headers: { 'content-type': 'application/json', cookie }, body: b === undefined ? undefined : JSON.stringify(b) }); const text = await r.text(); return { status: r.status, text, headers: r.headers, body: (() => { try { return JSON.parse(text); } catch { return null; } })() as any }; };
beforeAll(async () => {
  db = await openDb({ memory: true }); invalidate();
  const pc = [{ label: 'id' }, { label: 'Porteur' }, { label: 'Projet' }, { group: 'Données Carbone', unit: 'tCO2e', label: 'RE évitement année de suivi 1' }, { group: 'Données Carbone', unit: 'tCO2e', label: 'RE Stockage année de suivi 1' }];
  const wb = await workbook([...COLS, { group: 'Données Carbone', unit: 'tCO2e', label: 'Volume vendable' }], [farm('AAA-001', { Projet: 'Projet A', 'Volume vendable': 100, 'Volume Vendu': 0 }), farm('AAA-002', { Projet: 'Projet A', SAU: 300, 'Volume vendable': 100, 'Volume Vendu': 0, 'Lixiviation des nitrates \nScénario initial': 60, 'Lixiviation des nitrates\nScénario prospectif': 70 }), farm('BBB-001', { Projet: 'Projet B', 'Volume vendable': 100, 'Volume Vendu': 0 })],
    { CVL2: { cols: pc, rows: [{ id: 'AAA-001', Porteur: 'Coop A', Projet: 'Projet A', 'RE évitement année de suivi 1': 10, 'RE Stockage année de suivi 1': 4 }] } });
  const d: any = await dryRun(db, wb, { filename: 't.xlsx' }); await applyImport(db, d.id);
  fNamed = (await db.owner.query(`insert into organizations(type,name,public_name_policy) values('funder','Banque Exemple','named') returning id`)).rows[0].id; fPrivate = (await db.owner.query(`insert into organizations(type,name,public_name_policy) values('funder','Client Discret','private') returning id`)).rows[0].id;
  await createUser(db, { email: 'admin@test.local', password: 'correct-horse-battery', role: 'platform_admin' }); app = createApp(db);
  cAdmin = (await app.request('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'admin@test.local', password: 'correct-horse-battery' }) })).headers.get('set-cookie')!.split(';')[0];
});
afterAll(() => db.close());

describe('public dashboard', () => {
  it('aggregates the whole portfolio; no identity, no price', async () => {
    const r = await req('GET', '/api/public/impact'); expect(r.status).toBe(200); const j = r.body;
    expect(j.scale).toMatchObject({ farms: 3, projects: 2 }); expect(j.carbon).toMatchObject({ re_labelled: 300, sellable: 300, allocated: 0, available: 300 }); expect(j.carbon.followup).toMatchObject({ farms: 1, measured: 14, end_of_project_estimate: 110 });
    expect(j.projects.map((p: any) => p.name).sort()).toEqual(['Projet A', 'Projet B']); expect(j.source).toBe('Data Master Carbone Farmers'); expect(j.data_as_of).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(r.text).not.toMatch(/SECRET|DUPONT|VILLESECRETE|12345678900011|"price|amount_eur/); expect(j.cobenefits_count).toEqual({ tracked: 1, shown: 1 });
    await createAllocation(db, { role: 'platform_admin' }, { funder_org_id: fPrivate, target_type: 'project', target_id: 'projet-a', volume_tco2e: 100, price_per_tco2e: 33, status: 'reserved' });
    const j2 = (await req('GET', '/api/public/impact')).body; expect(j2.carbon).toMatchObject({ allocated: 100, available: 200 }); expect(j2.carbon.funded_pct).toBeCloseTo(1 / 3); expect(j2.projects.find((p: any) => p.name === 'Projet A').funded_pct).toBe(0.5);
    expect(j2.funders).toEqual([]); // private funders are never listed
  });
  it('the portfolio-level co-benefit choice is editorial, admin only, and the page says shown vs tracked', async () => {
    const v = (await req('GET', '/api/admin/portfolio-visibility', cAdmin)).body; expect(v.items[0]).toMatchObject({ code: 'nitrate_leaching', trend: 'worse' }); // 60 → 70 on the larger farm
    expect((await req('PUT', '/api/admin/portfolio-visibility', '', { hidden: ['nitrate_leaching'] })).status).toBe(401);
    expect((await req('PUT', '/api/admin/portfolio-visibility', cAdmin, { hidden: ['nitrate_leaching', 'nope'] })).body.hidden).toEqual(['nitrate_leaching']);
    const j = (await req('GET', '/api/public/impact')).body; expect(j.cobenefits).toEqual([]); expect(j.cobenefits_count).toEqual({ tracked: 1, shown: 0 });
    await req('PUT', '/api/admin/portfolio-visibility', cAdmin, { hidden: [] }); expect((await req('GET', '/api/public/impact')).body.cobenefits).toHaveLength(1);
  });
});

describe('methodology and open data', () => {
  it('methodology exposes the score settings (editable thresholds) and indicator thresholds', async () => {
    const m = (await req('GET', '/api/public/methodology')).body; expect(m.eau).toMatchObject({ version: 2, status: 'a_valider' }); expect(m.eau.config.level_basis).toBe('initial'); expect(m.bio.config.items).toHaveLength(28); expect(m.indicators.find((i: any) => i.code === 'nitrate_leaching')).toMatchObject({ threshold_red: 60, threshold_green: 38 });
  });
  it('downloads: dictionary, CSV and Excel, non-identifying, consistent with the pages', async () => {
    const list = (await req('GET', '/api/public/downloads')).body; expect(list.datasets.map((d: any) => [d.name, d.rows])).toEqual([['farms', 3], ['projects', 2], ['cobenefits', 2]]); expect(list.licence).toBeNull();
    const farms = await req('GET', '/api/public/downloads/farms.csv'); expect(farms.headers.get('content-type')).toContain('text/csv'); const lines = farms.text.replace(/^﻿/, '').split('\r\n'); expect(lines[0]).toBe('id;project;porteur;region;departement;typology;lbc_status;sau_ha;re_labelled_tco2e;funded_tco2e;available_tco2e;measured_r25_tco2e'); expect(lines).toHaveLength(4);
    const row = lines.find(l => l.startsWith('"AAA-001"'))!.split(';'); expect(row.slice(0, 7)).toEqual(['"AAA-001"', '"Projet A"', '"Coop A"', '"Centre-Val de Loire"', '"28"', '"Grandes cultures"', '"Labellisé"']); expect(row.slice(7)).toEqual(['100', '100', '50', '50', '14']); // funded / available follow the ledger
    expect(farms.text).not.toMatch(/SECRET|DUPONT|VILLESECRETE|Cachée|12345678900011|lat|lng/i);
    const proj = (await req('GET', '/api/public/downloads/projects.csv')).text; expect(proj).toContain('indicators_tracked;indicators_published'); expect((await req('GET', '/api/public/downloads/inconnu.csv')).status).toBe(404); expect((await req('GET', '/api/public/downloads/farms.exe')).status).toBe(404);
    const x = await app.request('/api/public/downloads/farmgate_data.xlsx'); const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await x.arrayBuffer()) as any); expect(wb.worksheets.map(w => w.name)).toEqual(['Fermes (non identifiantes)', 'Projets', 'Co-bénéfices par projet', 'Dictionnaire']); expect(wb.worksheets[0].rowCount).toBe(4);
    // hidden indicators are not published in the downloads either
    await req('PUT', '/api/admin/visibility/project/projet-a', cAdmin, { hidden: ['nitrate_leaching'] }); const c2 = (await req('GET', '/api/public/downloads/cobenefits.csv')).text; expect(c2.split('\r\n').filter(l => l.startsWith('"Projet A"'))).toHaveLength(0); expect(c2).toContain('"Projet B"');
    const p2 = (await req('GET', '/api/public/downloads/projects.csv')).text; expect(p2).toMatch(/"projet-a";.*;1;0(\r|$)/m); // the file says how many are tracked vs published
  });
});

describe('funder public page (opt-in)', () => {
  it('is closed until the funder is named AND the admin enables it; shows aggregates only', async () => {
    expect((await req('GET', '/api/public/funders/banque-exemple')).status).toBe(404);
    expect((await req('PUT', `/api/admin/funders/${fPrivate}/public-page`, cAdmin, { enabled: true })).status).toBe(400); // private funder cannot be shown by name
    expect((await req('PUT', `/api/admin/funders/${fNamed}/public-page`, '', { enabled: true })).status).toBe(401);
    expect((await req('PUT', `/api/admin/funders/${fNamed}/public-page`, cAdmin, { enabled: true })).body).toMatchObject({ public_page_enabled: true, public_slug: 'banque-exemple' });
    await createAllocation(db, { role: 'platform_admin' }, { funder_org_id: fNamed, target_type: 'farm', target_id: 'AAA-001', volume_tco2e: 50, price_per_tco2e: 99, status: 'contracted' });
    const r = await req('GET', '/api/public/funders/banque-exemple'); expect(r.body).toMatchObject({ name: 'Banque Exemple', farms: 1, volume_tco2e: 50, projects: ['Projet A'], regions: ['Centre-Val de Loire'], sau_attributed: 50, measured_attributed: 7, estimate_attributed: 35 });
    expect(r.text).not.toMatch(/99|amount|price|AAA-001|SECRET|DUPONT/); // no price, no farm id, no identity
    expect((await req('GET', '/api/public/impact')).body.funders).toEqual([{ name: 'Banque Exemple', public_slug: 'banque-exemple' }]);
    await req('PUT', `/api/admin/funders/${fNamed}/public-page`, cAdmin, { enabled: false }); expect((await req('GET', '/api/public/funders/banque-exemple')).status).toBe(404);
  });
});
