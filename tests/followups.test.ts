import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import ExcelJS from 'exceljs';
import { openDb, PUBLIC, type Db, type Ctx } from '../server/db.ts';
import { createApp } from '../server/app.ts';
import { invalidate } from '../server/facts.ts';
import { dryRun, applyImport } from '../server/importer/apply.ts';
import { hub, followupWorkbook, importFollowups } from '../server/followups.ts';
import { workbook, COLS, farm } from './helpers.ts';

let db: Db; const admin: Ctx = { role: 'platform_admin', uid: 1 };
beforeAll(async () => {
  db = await openDb({ memory: true }); invalidate();
  const pc = [{ label: 'id' }, { label: 'Projet' }, { group: 'Données Carbone', unit: 'tCO2e', label: 'RE évitement année de suivi 1' }, { group: 'Données Carbone', unit: 'tCO2e', label: 'RE Stockage année de suivi 1' }];
  const wb = await workbook(COLS, [farm('CVL2-001'), farm('CVL2-002', { 'RE totales labellisées  (sur 5 ans)': 200, 'RE Stockage totales\n(sur 5 ans)': 160 }), farm('CVL2-003', { 'Statut LBC': 'Désengagé' })],
    { CVL2: { cols: pc, rows: [{ id: 'CVL2-001', Projet: 'Projet Test', 'RE évitement année de suivi 1': 10, 'RE Stockage année de suivi 1': 4 }, { id: 'CVL2-002', Projet: 'Projet Test', 'RE évitement année de suivi 1': 20, 'RE Stockage année de suivi 1': 6 }] } });
  const d: any = await dryRun(db, wb, { filename: 't.xlsx' }); await applyImport(db, d.id);
});
afterAll(() => db.close());

describe('annual follow-up hub', () => {
  it('aggregates planned / measured / end-of-project per project and year', async () => {
    const h = await db.as(PUBLIC, hub);
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ slug: 'projet-test', harvest_year: 2025, farms_followed: 2, farms_total: 2, labelled_of_followed: 300, planned_year: 60, measured: 40, re_avoidance: 30, re_storage: 10, end_of_project_estimate: 5 * 30 + 15 * 10 });
    expect(h[0].status).toEqual({ diagnosed: 2, verified: 0, audited: 0 }); expect(h[0].labelled_project).toBe(300); // withdrawn farm excluded from the project total
  });
  it('follow-up sheet round-trips, then a completed sheet updates figures, dates and private payment', async () => {
    const sheet = await followupWorkbook(db.owner, 'projet-test', 2025); expect(sheet.farms).toBe(3);
    const same = await importFollowups(db, admin, sheet.buffer, false);
    expect(same).toMatchObject({ applied: false, created: 0, updated: 0, unchanged: 2 }); expect(same.errors).toHaveLength(0);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(sheet.buffer as any); const ws = wb.worksheets[0];
    const col = (l: string) => { let n = 0; ws.getRow(1).eachCell((c, i) => { if (c.value === l) n = i; }); return n; };
    const r1 = ws.getRow(2); // CVL2-001
    r1.getCell(col('Date du diagnostic')).value = '14/10/2025'; r1.getCell(col('Statut')).value = 'vérifié'; r1.getCell(col('Émissions référence (tCO2e/ha)')).value = 2.73; r1.getCell(col('Émissions année (tCO2e/ha)')).value = '1,92'; r1.getCell(col('Stockage année (tCO2e/ha)')).value = 1.1;
    r1.getCell(col('RE stockage année (tCO2e)')).value = 9; r1.getCell(col('Paiement agriculteur (€)')).value = 1500; r1.getCell(col('Diagnostiqueur')).value = 'Agronome Privé';
    ws.addRow(['ZZZ-404', 2025, null, null, null, null, null, null, 5]); ws.addRow(['CVL2-002', 'abc']);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const dry = await importFollowups(db, admin, buf, false);
    expect(dry).toMatchObject({ applied: false, updated: 1, unchanged: 1 }); expect(dry.errors.map(e => e.farm_id)).toEqual(expect.arrayContaining(['ZZZ-404', 'CVL2-002']));
    expect(Number((await db.owner.query(`select re_storage_year from annual_followups where farm_id='CVL2-001'`)).rows[0].re_storage_year)).toBe(4); // dry run wrote nothing
    await importFollowups(db, admin, buf, true);
    const a = (await db.owner.query(`select * from annual_followups where farm_id='CVL2-001'`)).rows[0];
    expect(a.status).toBe('verified'); expect(Number(a.re_total_year)).toBe(19); expect(Number(a.net_balance_ha)).toBeCloseTo(0.82); expect(Number(a.net_balance_change)).toBeCloseTo(0.82 / 2.73 - 1); // −70 %, as on the farm sheet example
    expect(new Date((await db.owner.query(`select last_diag_date d from farms where id='CVL2-001'`)).rows[0].d).toISOString().slice(0, 10)).toBe('2025-10-14');
    const h = (await db.as(PUBLIC, hub))[0]; expect(h.measured).toBe(45); expect(h.status).toEqual({ diagnosed: 1, verified: 1, audited: 0 }); expect(h.last_diagnostic).toBe('2025-10-14');
  });
  it('payment and diagnostician are never readable publicly or by funders', async () => {
    expect((await db.owner.query(`select count(*)::int n from followup_private`)).rows[0].n).toBe(1);
    for (const ctx of [PUBLIC, { role: 'funder_user', org: 99, uid: 9 }, { role: 'project_owner_user', org: 98, uid: 8 }] as Ctx[]) expect((await db.as(ctx, q => q.query(`select * from followup_private`))).rows).toHaveLength(0);
    const app = createApp(db); const text = await (await app.request('/api/public/followups/projet-test/2025')).text() + await (await app.request('/api/public/farms/CVL2-001')).text() + await (await app.request('/api/public/followups')).text();
    expect(text).not.toMatch(/payment|(^|[^\d.])1500([^\d]|$)/); expect(text).not.toContain('Agronome Privé'); expect(text).toContain('"status":"verified"');
    expect((await app.request('/api/admin/followups/projet-test/2025/sheet.xlsx')).status).toBe(401);
    expect((await app.request('/api/admin/followups/projet-test/2025/status', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{"status":"audited"}' })).status).toBe(401);
  });
});
