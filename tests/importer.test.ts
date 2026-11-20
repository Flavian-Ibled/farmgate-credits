import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { openDb, PUBLIC } from '../server/db.ts';
import { parseDataMaster, toNumber, departementOf } from '../server/importer/parse.ts';
import { dryRun, applyImport, rollbackImport, blur } from '../server/importer/apply.ts';
import { workbook, COLS, farm } from './helpers.ts';

describe('cell parsing', () => {
  it('accepts French decimals and percentages, rejects text', () => {
    expect(toNumber('12,5')).toBe(12.5); expect(toNumber('1 234,5')).toBe(1234.5); expect(toNumber('45 %')).toBeCloseTo(0.45); expect(toNumber(3)).toBe(3);
    expect(toNumber('NSP')).toBeUndefined(); expect(toNumber('-')).toBeUndefined(); expect(toNumber('#DIV/0!')).toBeUndefined();
  });
  it('derives the département from the postal code', () => { expect(departementOf(28320)).toBe('28'); expect(departementOf('02100')).toBe('02'); expect(departementOf(2100)).toBe('02'); expect(departementOf('20000')).toBe('2A'); expect(departementOf('97400')).toBe('974'); expect(departementOf(null)).toBeNull(); });
});

describe('Data Master parser', () => {
  it('maps columns by header name whatever their order, with the 3-row header', async () => {
    const p = await parseDataMaster(await workbook([...COLS].reverse(), [farm('TST-001')]));
    const r = p.farms[0].rec;
    expect(r.sau).toBe(100); expect(r.re_labelled).toBe(100); expect(r['ind:nitrate_leaching:initial']).toBe(50); expect(r['ind:nitrate_leaching:prospectif']).toBe(40);
    expect(r.region).toBe('Centre-Val de Loire'); expect(r.departement).toBe('28'); expect(r.siret).toBe('12345678900011');
    expect(p.levers.map(l => [l.scope, l.family])).toEqual(expect.arrayContaining([['GC', 'Fertilisation'], ['EL', 'Stockage de carbone dans le sol (L3)']]));
    expect(Object.keys(r).some(k => k.includes('evolution'))).toBe(false); // evolution columns are recomputed, never imported
  });
  it('coerces #DIV/0!, text and empty cells in numeric columns to null and reports them', async () => {
    const p = await parseDataMaster(await workbook(COLS, [farm('TST-001', { SAU: 'EARL DU TEXTE', 'Volume Vendu': 'NSP', 'Lixiviation des nitrates \nScénario initial': { error: '#DIV/0!' }, 'Volume Disponible': '12,5' })]));
    const r = p.farms[0].rec;
    expect(r.sau).toBeNull(); expect(r.vol_vendu).toBeNull(); expect(r['ind:nitrate_leaching:initial']).toBeNull(); expect(r.vol_dispo).toBe(12.5);
    expect(p.issues.filter(i => i.code === 'text_in_numeric')).toHaveLength(2); expect(p.issues.filter(i => i.code === 'excel_error')).toHaveLength(1);
    expect(p.issues.find(i => i.code === 'text_in_numeric')).toMatchObject({ sheet: 'Master List', row: 4, farm_id: 'TST-001' });
  });
  it('treats duplicate ids as an error and excludes both rows (never guesses)', async () => {
    const p = await parseDataMaster(await workbook(COLS, [farm('ADA-002'), farm('ADA-002', { SAU: 5 }), farm('ADA-003')]));
    expect(p.farms.map(f => f.id)).toEqual(['ADA-003']); expect(p.issues.some(i => i.code === 'duplicate_id' && i.level === 'error')).toBe(true);
  });
  it('validates coordinates, SAU, statuses and volumes', async () => {
    const p = await parseDataMaster(await workbook(COLS, [
      farm('TST-001', { Latitude: 1.75, Longitude: 48.5 }), farm('TST-002', { Latitude: 10, Longitude: 100 }), farm('TST-003', { SAU: -4 }),
      farm('TST-004', { 'Statut LBC': 'En construction' }), farm('TST-005', { 'Statut LBC': 'Inconnu' }), farm('TST-006', { 'Volume Vendu': 500 }), farm('TST-007', { Projet: null }), farm('TST-008', { 'RE Stockage totales\n(sur 5 ans)': 600 }),
    ]));
    const codes = (id: string) => p.issues.filter(i => i.farm_id === id).map(i => i.code);
    expect(codes('TST-001')).toContain('coordinates_swapped'); expect(codes('TST-002')).toContain('coordinates_outside_france'); expect(p.farms[0].rec.lat).toBeNull();
    expect(codes('TST-003')).toContain('invalid_sau'); expect(codes('TST-004')).toContain('status_mapped'); expect(p.farms[3].rec.lbc_status).toBe('Diags en cours');
    expect(codes('TST-005')).toContain('unknown_status'); expect(codes('TST-006')).toContain('sold_above_labelled'); expect(codes('TST-007')).toContain('missing_project'); expect(codes('TST-008')).toContain('split_mismatch');
  });
  it('project sheets: summary rows are ignored, unknown ids reported, follow-up columns win', async () => {
    const pc = [{ label: 'id' }, { label: 'Porteur' }, { label: 'Projet' }, { group: 'Données Carbone', unit: 'tCO2e', label: 'RE évitement année de suivi 1' }, { group: 'Données Carbone', unit: 'tCO2e', label: 'RE Stockage année de suivi 1' }, { group: 'Données Carbone', unit: 'tCO2e', label: 'RE totales labellisées  (sur 5 ans)' }];
    const p = await parseDataMaster(await workbook(COLS, [farm('CVL2-001'), farm('CVL2-002')], { CVL2: { cols: pc, rows: [
      { id: 'CVL2-001', Porteur: 'Coop X', Projet: 'Projet Test', 'RE évitement année de suivi 1': 12, 'RE Stockage année de suivi 1': 8, 'RE totales labellisées  (sur 5 ans)': 100 },
      { id: 'CVL2-099', Projet: 'Projet Test' }, { id: 'Total', 'RE totales labellisées  (sur 5 ans)': 100 }, { id: 'Moyenne' }] } }));
    expect(p.farms[0].rec['fu:2025:re_avoidance']).toBe(12); expect(p.farms[0].rec['fu:2025:re_storage']).toBe(8); expect(p.porteurs['Projet Test']).toBe('Coop X');
    expect(p.issues.filter(i => i.code === 'id_not_in_master').map(i => i.farm_id)).toEqual(['CVL2-099']);
    expect(p.stats.sheets.CVL2).toMatchObject({ farms: 2, followed: 1, re_labelled: 100 });
  });
});

describe('import pipeline', () => {
  it('dry run → apply → idempotent re-import → update diff → locked fields → absent flag → rollback', async () => {
    const db = await openDb({ memory: true });
    const v1 = await workbook(COLS, [farm('TST-001'), farm('TST-002'), farm('TST-003')]);
    const d1: any = await dryRun(db, v1, { filename: 'v1.xlsx' });
    expect(d1.counts).toMatchObject({ created: 3, updated: 0, unchanged: 0 });
    expect((await db.owner.query(`select count(*)::int n from farms`)).rows[0].n).toBe(0); // a dry run writes nothing
    await applyImport(db, d1.id);
    expect((await db.owner.query(`select count(*)::int n from farms`)).rows[0].n).toBe(3);
    await expect(applyImport(db, d1.id)).rejects.toThrow();

    const d2: any = await dryRun(db, v1, { filename: 'v1-again.xlsx' });
    expect(d2.counts).toMatchObject({ created: 0, updated: 0, unchanged: 3, absent: 0 }); // importing the same file twice changes nothing
    await applyImport(db, d2.id);

    await db.owner.query(`update farm_private set locked_fields='{sau}' where farm_id='TST-002'`);
    await db.owner.query(`update farms set consent_public_name=true, public_name='Ferme des Tests' where id='TST-001'`); // platform-owned
    const v2 = await workbook(COLS, [farm('TST-001', { SAU: 150, 'Volume Vendu': 20 }), farm('TST-002', { SAU: 999 }), farm('TST-004')]);
    const d3: any = await dryRun(db, v2, { filename: 'v2.xlsx' });
    expect(d3.counts).toMatchObject({ created: 1, updated: 1, unchanged: 1, absent: 1, locked_skipped: 1 });
    const rep = (await db.owner.query(`select report from imports where id=$1`, [d3.id])).rows[0].report;
    expect(rep.diff.updated[0]).toMatchObject({ id: 'TST-001' }); expect(rep.diff.updated[0].changes).toEqual(expect.arrayContaining([{ field: 'sau', old: 100, new: 150 }, { field: 'vol_vendu', old: 10, new: 20 }]));
    await applyImport(db, d3.id);
    const f = async (id: string) => (await db.owner.query(`select * from farms where id=$1`, [id])).rows[0];
    expect(Number((await f('TST-001')).sau)).toBe(150); expect((await f('TST-001')).public_name).toBe('Ferme des Tests'); // never overwritten
    expect(Number((await f('TST-002')).sau)).toBe(100); // locked
    expect((await f('TST-003')).absent_from_last_import).toBe(true); // never deleted
    expect((await db.owner.query(`select count(*)::int n from import_changes where import_id=$1 and farm_id='TST-001'`, [d3.id])).rows[0].n).toBe(2);

    await expect(rollbackImport(db, d2.id)).rejects.toThrow(/plus récents/);
    await rollbackImport(db, d3.id);
    expect(Number((await f('TST-001')).sau)).toBe(100); expect(await f('TST-004')).toBeUndefined(); expect((await f('TST-001')).public_name).toBe('Ferme des Tests');
    expect((await db.owner.query(`select count(*)::int n from audit_log where action like 'import.%'`)).rows[0].n).toBe(4);
    await db.close();
  });
  it('blur is deterministic, between 2 and 5 km, and never returns the exact position', () => {
    const km = (a: any, b: any) => Math.hypot((a.lat - b.lat) * 111.32, (a.lng - b.lng) * 111.32 * Math.cos((a.lat * Math.PI) / 180));
    for (const id of ['A-001', 'B-002', 'CVL2-062']) { const p = { lat: 48.5, lng: 1.75 }, b = blur(id, p.lat, p.lng, 's'); expect(blur(id, p.lat, p.lng, 's')).toEqual(b); expect(km(p, b)).toBeGreaterThanOrEqual(1.99); expect(km(p, b)).toBeLessThanOrEqual(5.01); }
    expect(blur('A-001', 48.5, 1.75, 's')).not.toEqual(blur('A-001', 48.5, 1.75, 'other-secret'));
  });
});

const REAL = 'inputs/carbone_farmers_data_Master_2026sept21.xlsx';
describe.skipIf(!existsSync(REAL))('real Data Master (2026-09-21)', () => {
  it('parses 1,113 unique farms and reproduces the workbook totals', async () => {
    const p = await parseDataMaster(readFileSync(REAL));
    const s = (k: string) => p.farms.reduce((a, f) => a + (typeof f.rec[k] === 'number' ? (f.rec[k] as number) : 0), 0);
    expect(p.farms).toHaveLength(1113); expect(new Set(p.farms.map(f => f.id)).size).toBe(1113);
    expect(s('sau')).toBeCloseTo(199509.7, 0); expect(s('re_labelled')).toBeCloseTo(620479.3, 0); expect(s('vol_vendu')).toBeCloseTo(126361, 0);
    expect(p.levers).toHaveLength(47);
    expect(p.stats.cvl2_gap.master).toMatchObject({ farms: 111 }); expect(Math.round(p.stats.cvl2_gap.master.re_labelled)).toBe(67948);
    expect(p.stats.cvl2_gap.sheet).toMatchObject({ farms: 112, followed: 109 }); expect(Math.round(p.stats.cvl2_gap.sheet.re_labelled)).toBe(68339);
    expect(Math.round(s('fu:2025:re_avoidance') + s('fu:2025:re_storage'))).toBe(7388); // R25 generated, as on the CVL2 trajectory page
    expect(p.issues.filter(i => i.code === 'duplicate_id')).toHaveLength(0); expect(p.issues.filter(i => i.code === 'missing_coordinates')).toHaveLength(1);
  });
});

describe('per-project import and project data sheet', () => {
  it('round-trips: download a project sheet → re-import it unchanged; edits only touch that project', async () => {
    const { projectWorkbook } = await import('../server/excel.ts');
    const { parseDataMaster: parse } = await import('../server/importer/parse.ts');
    const db = await openDb({ memory: true });
    const d1: any = await dryRun(db, await workbook(COLS, [farm('AAA-001', { Projet: 'Projet A' }), farm('AAA-002', { Projet: 'Projet A' }), farm('BBB-001', { Projet: 'Projet B' })]), { filename: 'master.xlsx' });
    await applyImport(db, d1.id);
    const pid = (await db.owner.query(`select id from projects where name='Projet A'`)).rows[0].id;
    const sheet = await projectWorkbook(db.owner, pid);
    expect(sheet.farms).toBe(2);
    const d2: any = await dryRun(db, sheet.buffer, { filename: sheet.filename });
    expect(d2.scope).toBe('project'); expect(d2.projects).toEqual(['Projet A']);
    expect(d2.counts).toMatchObject({ created: 0, updated: 0, unchanged: 2, absent: 0 }); // exported sheet re-imports with zero difference

    // the agronomist verifies one farm, one farm leaves the file, a new farm joins the project; one column is deleted from the file
    const ExcelJS = (await import('exceljs')).default; const wb = new ExcelJS.Workbook(); await wb.xlsx.load(sheet.buffer as any);
    const ws = wb.worksheets[0]; const col = (label: string) => { let n = 0; ws.getRow(3).eachCell((c, i) => { if (c.value === label) n = i; }); return n; };
    ws.getRow(4).getCell(col('SAU')).value = 123; ws.getRow(4).getCell(col('Date du dernier diagnostic')).value = '12/03/2026'; ws.getRow(4).getCell(col('Date de vérification')).value = '2026-04-02'; ws.getRow(4).getCell(col('Vérifié par')).value = 'Agronome Test';
    ws.getRow(5).getCell(1).value = 'AAA-003'; // AAA-002 replaced by a new farm
    ws.spliceColumns(col('Farmer'), 1); // a deleted column must not blank existing values
    const edited = Buffer.from(await wb.xlsx.writeBuffer());
    const p = await parse(edited); expect(p.scope).toBe('project'); expect(p.issues.filter(i => i.level === 'error')).toHaveLength(0);
    const d3: any = await dryRun(db, edited, { filename: 'projet-a-verifie.xlsx' });
    expect(d3.counts).toMatchObject({ created: 1, updated: 1, unchanged: 0, absent: 1 }); // BBB-001 (other project) is NOT counted absent
    await applyImport(db, d3.id);
    const f = async (id: string) => (await db.owner.query(`select f.*, p.farmer from farms f join farm_private p on p.farm_id=f.id where f.id=$1`, [id])).rows[0];
    const a1 = await f('AAA-001');
    expect(Number(a1.sau)).toBe(123); expect(new Date(a1.last_diag_date).toISOString().slice(0, 10)).toBe('2026-03-12'); expect(new Date(a1.verified_at).toISOString().slice(0, 10)).toBe('2026-04-02'); expect(a1.verified_by).toBe('Agronome Test');
    expect(a1.farmer).toBe('DUPONT-PRIVE AAA-001'); // column removed from the file → value kept
    expect((await f('AAA-002')).absent_from_last_import).toBe(true); expect((await f('BBB-001')).absent_from_last_import).toBe(false); expect(await f('AAA-003')).toBeTruthy();
    await db.close();
  });
  it('geography helpers: basin of a point, distance to a river, local commune search', async () => {
    const { basinOf, kmToRiver, searchCommunes } = await import('../server/facts.ts');
    expect(basinOf(0.69, 47.39)).toBe('Loire-Bretagne'); expect(basinOf(2.35, 48.85)).toBe('Seine-Normandie'); expect(basinOf(-30, 10)).toBeNull();
    expect(kmToRiver('Loire', 1.9, 47.9)!).toBeLessThan(8); expect(kmToRiver('Loire', 2.35, 48.85)!).toBeGreaterThan(80); expect(kmToRiver('Inconnu', 1, 47)).toBeNull();
    const r = searchCommunes('ecrosn'); expect(r[0]).toMatchObject({ name: 'ECROSNES', departement: '28' }); expect(searchCommunes('x')).toEqual([]);
  });
});
