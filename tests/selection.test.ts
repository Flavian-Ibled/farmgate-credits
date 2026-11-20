// Oracle test (brief 4C): the Biodiversité score must reproduce the team's workbook "Sélection Carbone Farmers" on its 20 farms.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { readSelectionWorkbook } from '../server/selectionWorkbook.ts';
import { BIO_CONFIG_V1, bioRawScore, bioDisplayed } from '../shared/scores.ts';
import { openDb } from '../server/db.ts';
import { createApp } from '../server/app.ts';
import { invalidate } from '../server/facts.ts';
import { dryRun, applyImport } from '../server/importer/apply.ts';
import { importSelectionIndicators } from '../server/scores.ts';

const FILE = 'inputs/Sélection_Carbone_Farmers.xlsx';
const rel = (a?: number | null, b?: number | null) => (a != null && b != null && a !== 0 ? (b - a) / a : null), dif = (a?: number | null, b?: number | null) => (a != null && b != null ? b - a : null);
/** the platform's score inputs, built from the workbook's initial / prospective columns (evolutions are recomputed) */
export function valuesFromWorkbook(f: { ind: Record<string, { initial?: number | null; prospectif?: number | null }>; bio_levers: number }) {
  const i = (k: string) => f.ind[k]?.initial ?? null, p = (k: string) => f.ind[k]?.prospectif ?? null;
  return {
    'nitrate_leaching:initial': i('nitrate_leaching'), 'cover_share_sau:initial': i('cover_share'), 'cover_duration:initial': i('cover_duration'), 'cover_share_measured:initial': i('cover_share_measured'), 'erosion:initial': i('erosion'), 'no_till:initial': i('no_till'),
    'tillage_depth:initial': i('tillage_depth'), 'organic_matter:initial': i('organic_matter'), 'humified_c:initial': i('humified_c'), 'ift_total:initial': i('ift_total'), 'eiq:initial': i('eiq'), 'simpson:initial': i('simpson'), 'crops_count:initial': i('crops_count'), 'phosphorus:initial': i('phosphorus'), 'iae:initial': i('iae'),
    'nitrate_leaching:evolution': rel(i('nitrate_leaching'), p('nitrate_leaching')), 'ammonia:evolution': rel(i('ammonia'), p('ammonia')), 'cover_share_sau:evolution': dif(i('cover_share'), p('cover_share')) == null ? null : dif(i('cover_share'), p('cover_share'))! * 100,
    'erosion:evolution': rel(i('erosion'), p('erosion')), 'no_till:evolution': dif(i('no_till'), p('no_till')), 'tillage_depth:evolution': dif(i('tillage_depth'), p('tillage_depth')), 'humified_c:evolution': dif(i('humified_c'), p('humified_c')), 'organic_matter:evolution': dif(i('organic_matter'), p('organic_matter')),
    'ift_total:evolution': dif(i('ift_total'), p('ift_total')), 'simpson:evolution': dif(i('simpson'), p('simpson')), 'crops_count:evolution': dif(i('crops_count'), p('crops_count')), 'phosphorus:evolution': dif(i('phosphorus'), p('phosphorus')), 'bio_levers:evolution': f.bio_levers,
  };
}

describe.skipIf(!existsSync(FILE))('Score Biodiversité vs the reference workbook (20 farms)', () => {
  it('the platform method has the same thresholds and weights as the "Paramètres Biodiv" tab', async () => {
    const wb = await readSelectionWorkbook(readFileSync(FILE));
    expect(wb.farms).toHaveLength(20); expect(wb.params).toHaveLength(28); expect(wb.floor).toBe(BIO_CONFIG_V1.floor); expect(wb.ceiling).toBe(BIO_CONFIG_V1.ceiling);
    const order = ['nitrate_leaching', 'cover_share_sau', 'cover_duration', 'cover_share_measured', 'erosion', 'no_till', 'tillage_depth', 'organic_matter', 'humified_c', 'ift_total', 'eiq', 'simpson', 'crops_count', 'phosphorus', 'iae',
      'nitrate_leaching', 'ammonia', 'cover_share_sau', 'erosion', 'no_till', 'tillage_depth', 'humified_c', 'organic_matter', 'ift_total', 'simpson', 'crops_count', 'phosphorus', 'bio_levers'];
    wb.params.forEach((p, k) => { const it = BIO_CONFIG_V1.items.find(x => x.key === order[k] && x.basis === p.basis)!; expect(it, `${p.label}`).toBeTruthy();
      const scale = order[k] === 'cover_share_sau' && p.basis === 'evolution' ? 100 : 1; // the workbook writes +30 points of SAU as 0.3
      expect(it.t0, p.label).toBeCloseTo(p.t0 * scale, 9); expect(it.t100, p.label).toBeCloseTo(p.t100 * scale, 9); expect(it.weight, p.label).toBeCloseTo(p.weight, 9); });
  });
  it('raw score and displayed score (50–95) match the workbook for every farm', async () => {
    const wb = await readSelectionWorkbook(readFileSync(FILE));
    const raws = wb.farms.map(f => bioRawScore(valuesFromWorkbook(f)).raw);
    wb.farms.forEach((f, k) => expect(raws[k], `brut ${f.id}`).toBeCloseTo(wb.raw[f.id]!, 6));
    const shown = bioDisplayed(raws); wb.farms.forEach((f, k) => { expect(shown[k], `affiché ${f.id}`).toBeCloseTo(wb.shown[f.id]!, 6); expect(shown[k]).toBeCloseTo(f.sheet_bio!, 6); });
    expect(Math.max(...shown)).toBeCloseTo(95); expect(Math.min(...shown)).toBeCloseTo(50);
    console.log('Biodiversité — écart max vs classeur :', Math.max(...wb.farms.map((f, k) => Math.abs(shown[k] - wb.shown[f.id]!))).toExponential(2), '| scores :', wb.farms.map((f, k) => `${f.id}=${shown[k].toFixed(1)}`).join(' '));
  });
  it('every contribution printed in the workbook is reproduced', async () => {
    const wb = await readSelectionWorkbook(readFileSync(FILE)); let checked = 0;
    for (const f of wb.farms) { const c = bioRawScore(valuesFromWorkbook(f)).contributions; wb.params.forEach((p, k) => { const s = p.contributions[f.id]; if (s == null) return; expect(c[k].contribution, `${f.id} · ${p.label}`).toBeCloseTo(s, 6); checked++; }); }
    expect(checked).toBeGreaterThan(450);
  });
});

const MASTER = 'inputs/carbone_farmers_data_Master_2026sept21.xlsx';
describe.skipIf(!existsSync(FILE) || !existsSync(MASTER))('scores on the platform after importing the workbook indicators', () => {
  it('imports the indicators the Data Master lacks, then ranks the 20 farms close to the workbook', async () => {
    const db = await openDb({ memory: true }); invalidate(); const d: any = await dryRun(db, readFileSync(MASTER), { filename: 'm.xlsx' }); await applyImport(db, d.id);
    const admin = { role: 'platform_admin' }; const dry = await importSelectionIndicators(db, admin, readFileSync(FILE), false);
    expect(dry).toMatchObject({ applied: false, farms_in_file: 20, farms_matched: 20 }); expect((await db.owner.query(`select count(*)::int n from indicator_values where indicator_code='simpson'`)).rows[0].n).toBe(0);
    const r = await importSelectionIndicators(db, admin, readFileSync(FILE), true); expect(r.values).toBeGreaterThan(300); invalidate();
    const wb = await readSelectionWorkbook(readFileSync(FILE)); const app = createApp(db);
    const rk = await (await app.request('/api/public/ranking', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ filters: { ids: wb.farms.map(f => f.id) }, sort: 'bio' }) })).json() as any;
    expect(rk.rows).toHaveLength(20); const diffs = rk.rows.map((x: any) => Math.abs(x.bio - wb.shown[x.id]!)); const complete = rk.rows.map((x: any) => x.bio_completeness);
    console.log('Plateforme vs classeur — écart max du score Biodiv. affiché :', Math.max(...diffs).toFixed(2), '| moyen :', (diffs.reduce((a: number, b: number) => a + b, 0) / 20).toFixed(2), '| données disponibles min :', Math.min(...complete).toFixed(2), '| 1er :', rk.rows[0].id, rk.rows[0].bio.toFixed(1), '| eau moy. :', rk.total.eau_mean.toFixed(1));
    // Known gap (open point 20): for these farms the Data Master and the workbook agree on leaching, irrigation and covers, but differ on
    // erosion, organic matter, tillage depth and ammonia, and the Data Master has no IFT. The platform uses the Data Master values.
    expect(Math.min(...complete)).toBeGreaterThanOrEqual(0.9); expect(rk.rows[0].id).toBe('CVL3-195'); expect(diffs.reduce((a: number, b: number) => a + b, 0) / 20).toBeLessThan(8);
    // a Data Master re-import keeps the imported indicators
    const d2: any = await dryRun(db, readFileSync(MASTER), { filename: 'm2.xlsx' }); await applyImport(db, d2.id); expect((await db.owner.query(`select count(*)::int n from indicator_values where indicator_code='simpson'`)).rows[0].n).toBeGreaterThan(30);
    await db.close();
  });
});
