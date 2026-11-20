// Phase 6 — composite scores computed on the platform's farms (Eau: absolute /100; Biodiversité: raw + relative 50–95),
// ranking / selection builder, versioned score settings.
import { Hono } from 'hono';
import ExcelJS from 'exceljs';
import { PUBLIC, type Db, type Ctx } from './db.ts';
import { dataset, applyFilters, type Filters } from './facts.ts';
import type { FarmFacts } from '../shared/aggregate.ts';
import { wmean } from '../shared/aggregate.ts';
import { waterScore, bioRawScore, relativeScore, assertWeights, type WaterInputs, type WaterConfig, BIO_CONFIG_V1 } from '../shared/scores.ts';
import { norm } from '../shared/catalogue.ts';

type Env = { Variables: { ctx: (Ctx & { email: string }) | null } };
type BioConfig = typeof BIO_CONFIG_V1;
export interface Configs { eau: WaterConfig; bio: BioConfig; eau_meta: any; bio_meta: any }
let cfgCache: Configs | null = null;
export async function configs(db: Db): Promise<Configs> {
  if (cfgCache) return cfgCache;
  const rows = (await db.as(PUBLIC, q => q.query(`select distinct on (score) score, version, config, status, author, created_at from score_configs order by score, version desc`))).rows;
  const get = (s: string) => rows.find(r => r.score === s)!; const meta = (r: any) => ({ version: r.version, status: r.status, author: r.author, created_at: r.created_at });
  return (cfgCache = { eau: get('eau').config, bio: get('biodiversite').config, eau_meta: meta(get('eau')), bio_meta: meta(get('biodiversite')) });
}
const v = (f: FarmFacts, code: string, s: 'initial' | 'prospectif') => f.ind[code]?.[s] ?? null;
const pct = (x: number | null) => (x == null ? null : x * 100);
const rel = (a: number | null, b: number | null) => (a != null && b != null && a !== 0 ? (b - a) / a : null), dif = (a: number | null, b: number | null) => (a != null && b != null ? b - a : null);

export function waterInputs(f: FarmFacts): WaterInputs {
  return { lix_init: v(f, 'nitrate_leaching', 'initial'), lix_pros: v(f, 'nitrate_leaching', 'prospectif'), irr_init: v(f, 'irrigated_volume', 'initial'), irr_pros: v(f, 'irrigated_volume', 'prospectif'),
    ift_init: v(f, 'ift_total', 'initial'), ift_pros: v(f, 'ift_total', 'prospectif'), cover_init: pct(v(f, 'cover_share', 'initial')), cover_pros: pct(v(f, 'cover_share', 'prospectif')),
    erosion_init: v(f, 'erosion', 'initial'), erosion_pros: v(f, 'erosion', 'prospectif'), p_init: v(f, 'phosphorus', 'initial'), p_pros: v(f, 'phosphorus', 'prospectif') };
}
/** levers that count for biodiversity (brief 4C): legumes / longer rotation, residues, organic fertiliser, temporary grassland, cover biomass */
export const bioLeverCodes = (levers: { code: string; name_fr: string }[]) => levers.filter(l => /legumineuses|allonger la rotation|residus de culture|engrais organique|prairies temporaires|biomasse des couverts/.test(norm(l.name_fr))).map(l => l.code);
export function bioValues(f: FarmFacts, bioLevers: string[]): Record<string, number | null> {
  const i = (c: string) => v(f, c, 'initial'), p = (c: string) => v(f, c, 'prospectif');
  return {
    'nitrate_leaching:initial': i('nitrate_leaching'), 'nitrate_leaching:evolution': rel(i('nitrate_leaching'), p('nitrate_leaching')), 'ammonia:evolution': rel(i('ammonia'), p('ammonia')),
    'cover_share_sau:initial': i('cover_share'), 'cover_share_sau:evolution': dif(pct(i('cover_share')), pct(p('cover_share'))), 'erosion:initial': i('erosion'), 'erosion:evolution': rel(i('erosion'), p('erosion')),
    'tillage_depth:initial': i('tillage_depth'), 'tillage_depth:evolution': dif(i('tillage_depth'), p('tillage_depth')), 'organic_matter:initial': i('organic_matter'), 'organic_matter:evolution': dif(i('organic_matter'), p('organic_matter')),
    'ift_total:initial': i('ift_total'), 'ift_total:evolution': dif(i('ift_total'), p('ift_total')), 'bio_levers:evolution': f.levers === null ? null : f.levers.filter(c => bioLevers.includes(c)).length,
    // not collected on the platform yet: Simpson, number of crops, EIQ, humified carbon, no-till, phosphorus, IAE, cover duration
    'simpson:initial': i('simpson'), 'simpson:evolution': dif(i('simpson'), p('simpson')), 'crops_count:initial': i('crops_count'), 'crops_count:evolution': dif(i('crops_count'), p('crops_count')), 'eiq:initial': i('eiq'),
    'humified_c:initial': i('humified_c'), 'humified_c:evolution': dif(i('humified_c'), p('humified_c')), 'no_till:initial': i('no_till'), 'no_till:evolution': dif(i('no_till'), p('no_till')),
    'phosphorus:initial': i('phosphorus'), 'phosphorus:evolution': dif(i('phosphorus'), p('phosphorus')), 'iae:initial': i('iae'), 'cover_duration:initial': i('cover_duration'), 'cover_share_measured:initial': i('cover_share_measured'),
  };
}
export interface FarmScore { id: string; eau: number | null; eau_blocks: Record<string, number> | null; eau_completeness: number; bio_raw: number | null; bio: number | null; bio_completeness: number }
/** scores of a set of farms; the biodiversity score displayed is RELATIVE to this set (floor–ceiling), as in the team's method */
export function scoreFarms(farms: FarmFacts[], c: Configs, bioLevers: string[]): FarmScore[] {
  const rows = farms.map(f => { const w = waterScore(waterInputs(f), c.eau), b = bioRawScore(bioValues(f, bioLevers), c.bio);
    return { id: f.id, eau: w.completeness > 0 ? w.score : null, eau_blocks: w.completeness > 0 ? w.blocks : null, eau_completeness: w.completeness, bio_raw: b.completeness > 0 ? b.raw : null, bio: null as number | null, bio_completeness: b.completeness }; });
  const raws = rows.filter(r => r.bio_raw != null).map(r => r.bio_raw!); if (raws.length) { const mn = Math.min(...raws), mx = Math.max(...raws); for (const r of rows) if (r.bio_raw != null) r.bio = raws.length === 1 ? null : relativeScore(r.bio_raw, mn, mx, c.bio.floor, c.bio.ceiling); }
  return rows;
}
export async function farmScoreInPool(db: Db, farm: FarmFacts) { const d = await dataset(db), c = await configs(db); const pool = d.farms.filter(f => f.project === farm.project); const s = scoreFarms(pool, c, bioLeverCodes(d.levers)); const me = s.find(x => x.id === farm.id)!;
  const ranked = s.filter(x => x.eau != null).sort((a, b) => b.eau! - a.eau!);
  return { eau: me.eau == null ? null : { score: me.eau, blocks: me.eau_blocks, completeness: me.eau_completeness, rank: ranked.findIndex(x => x.id === farm.id) + 1, pool: ranked.length, version: c.eau_meta.version, status: c.eau_meta.status, level_basis: c.eau.level_basis },
    bio: me.bio_raw == null ? null : { raw: me.bio_raw, displayed: me.bio, completeness: me.bio_completeness, pool: s.filter(x => x.bio_raw != null).length, floor: c.bio.floor, ceiling: c.bio.ceiling, version: c.bio_meta.version, status: c.bio_meta.status } }; }
export async function projectScores(db: Db, farms: FarmFacts[]) { const d = await dataset(db), c = await configs(db); const s = scoreFarms(farms, c, bioLeverCodes(d.levers)); const sau = new Map(farms.map(f => [f.id, f.sau]));
  const e = s.filter(x => x.eau != null), b = s.filter(x => x.bio_raw != null);
  return { eau: e.length ? { mean: wmean(e.map(x => ({ v: x.eau, w: sau.get(x.id) }))), farms: e.length, completeness: wmean(e.map(x => ({ v: x.eau_completeness, w: sau.get(x.id) }))), version: c.eau_meta.version, status: c.eau_meta.status } : null,
    bio: b.length ? { raw_mean: wmean(b.map(x => ({ v: x.bio_raw, w: sau.get(x.id) }))), farms: b.length, completeness: wmean(b.map(x => ({ v: x.bio_completeness, w: sau.get(x.id) }))), version: c.bio_meta.version, status: c.bio_meta.status } : null }; }

async function ranking(db: Db, b: { filters?: Filters; sort?: string; min_eau?: number; min_bio?: number; volume_target?: number }) {
  const d = await dataset(db), c = await configs(db); const farms = applyFilters(d.farms, b.filters ?? {}); const sc = new Map(scoreFarms(farms, c, bioLeverCodes(d.levers)).map(s => [s.id, s]));
  let rows = farms.map(f => { const s = sc.get(f.id)!; return { id: f.id, project: f.project, departement: f.departement, region: f.region, sau: f.sau == null ? null : Math.round(f.sau), re_labelled: f.re_labelled == null ? null : Math.round(f.re_labelled), dispo: f.vol_dispo == null ? null : Math.round(f.vol_dispo), levers: f.levers?.length ?? null,
    eau: s.eau, eau_completeness: s.eau_completeness, bio: s.bio, bio_raw: s.bio_raw, bio_completeness: s.bio_completeness, lix: [v(f, 'nitrate_leaching', 'initial'), v(f, 'nitrate_leaching', 'prospectif')], irrigation: [v(f, 'irrigated_volume', 'initial'), v(f, 'irrigated_volume', 'prospectif')], ift: [v(f, 'ift_total', 'initial'), v(f, 'ift_total', 'prospectif')], cover: [v(f, 'cover_share', 'initial'), v(f, 'cover_share', 'prospectif')] }; })
    .filter(r => (b.min_eau == null || (r.eau != null && r.eau >= b.min_eau)) && (b.min_bio == null || (r.bio != null && r.bio >= b.min_bio)));
  const key = b.sort === 'bio' ? 'bio' : b.sort === 'dispo' ? 'dispo' : 'eau'; rows.sort((x: any, y: any) => (y[key] ?? -1) - (x[key] ?? -1));
  if (b.volume_target && b.volume_target > 0) { let acc = 0; rows = rows.filter(r => { if (acc >= b.volume_target!) return false; acc += r.dispo ?? 0; return (r.dispo ?? 0) > 0; }); }
  const sau = (r: any) => r.sau;
  return { rows: rows.map((r, i) => ({ rank: i + 1, ...r })), total: { farms: rows.length, sau: rows.reduce((s, r) => s + (r.sau ?? 0), 0), dispo: rows.reduce((s, r) => s + (r.dispo ?? 0), 0), re_labelled: rows.reduce((s, r) => s + (r.re_labelled ?? 0), 0), eau_mean: wmean(rows.map(r => ({ v: r.eau, w: sau(r) }))), bio_raw_mean: wmean(rows.map(r => ({ v: r.bio_raw, w: sau(r) }))) },
    method: { eau: { ...c.eau_meta, level_basis: c.eau.level_basis }, bio: { ...c.bio_meta, floor: c.bio.floor, ceiling: c.bio.ceiling } } };
}

/** Imports from a "Sélection" workbook the indicators the Data Master does not hold (dry run unless apply). Data Master indicators are never overwritten. */
export async function importSelectionIndicators(db: Db, ctx: Ctx, buf: Buffer, apply: boolean) {
  const { readSelectionWorkbook } = await import('./selectionWorkbook.ts'); const { EXTRA_INDICATORS } = await import('../shared/catalogue.ts'); const { invalidate } = await import('./facts.ts');
  const wb = await readSelectionWorkbook(buf); const extra = new Set(EXTRA_INDICATORS.map(e => e.code));
  const known = new Set((await db.owner.query(`select id from farms where id = any($1::text[])`, [wb.farms.map(f => f.id)])).rows.map(r => r.id as string));
  const rows: [string, string, string, number][] = []; for (const f of wb.farms) if (known.has(f.id)) for (const [code, v] of Object.entries(f.ind)) if (extra.has(code)) for (const s of ['initial', 'prospectif'] as const) if (typeof v[s] === 'number') rows.push([f.id, code, s, v[s] as number]);
  if (apply) { await db.as(ctx, async q => { for (const [id, code, s, v] of rows) await q.query(`insert into indicator_values(farm_id,indicator_code,state,value) values($1,$2,$3,$4) on conflict(farm_id,indicator_code,state,harvest_year) do update set value=excluded.value`, [id, code, s, v]); });
    await db.owner.query(`insert into audit_log(user_id,action,entity,detail) values($1,'indicators.import_selection','indicator',$2::jsonb)`, [ctx.uid ?? null, JSON.stringify({ farms: known.size, values: rows.length })]); invalidate(); }
  return { applied: apply, farms_in_file: wb.farms.length, farms_matched: known.size, unknown_farms: wb.farms.filter(f => !known.has(f.id)).map(f => f.id), values: rows.length, indicators: [...new Set(rows.map(r => r[1]))].length, unread_columns: wb.unknown_columns };
}

export function scoreRoutes(db: Db) {
  const pub = new Hono<Env>(), adm = new Hono<Env>();
  pub.post('/ranking', async c => c.json(await ranking(db, await c.req.json().catch(() => ({})))));
  pub.post('/ranking.xlsx', async c => {
    const r = await ranking(db, await c.req.json().catch(() => ({}))); const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Sélection');
    ws.addRow(['Rang', 'Ferme', 'Projet', 'Département', 'SAU (ha)', 'Crédits labellisés (tCO2e)', 'Disponible (tCO2e)', 'Score Eau /100', 'Données Eau (%)', 'Score Biodiv. (relatif à la sélection)', 'Score Biodiv. brut', 'Données Biodiv. (%)', 'Lixiviation initiale', 'Lixiviation prospective', 'Irrigation initiale (mm/ha)', 'Irrigation prospective', 'IFT initial', 'IFT prospectif', 'Couverts initial (part SAU)', 'Couverts prospectif', 'Leviers activés']);
    const rd = (x: number | null, d = 1) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);
    for (const x of r.rows) ws.addRow([x.rank, x.id, x.project, x.departement, x.sau, x.re_labelled, x.dispo, rd(x.eau), rd(x.eau_completeness * 100, 0), rd(x.bio), rd(x.bio_raw), rd(x.bio_completeness * 100, 0), rd(x.lix[0]), rd(x.lix[1]), rd(x.irrigation[0]), rd(x.irrigation[1]), rd(x.ift[0], 2), rd(x.ift[1], 2), rd(x.cover[0], 3), rd(x.cover[1], 3), x.levers]);
    ws.addRow(['', `Total / moyenne pondérée SAU · ${r.total.farms} fermes`, '', '', r.total.sau, r.total.re_labelled, r.total.dispo, rd(r.total.eau_mean), '', '', rd(r.total.bio_raw_mean)]);
    ws.addRow([]); ws.addRow([`Score Eau : méthode v${r.method.eau.version} (${r.method.eau.status}), absolu sur 100. Score Biodiversité : méthode v${r.method.bio.version} (${r.method.bio.status}), relatif à cette sélection, échelle ${r.method.bio.floor}–${r.method.bio.ceiling}. Une donnée manquante vaut 0 point : voir les colonnes « Données (%) ».`]);
    ws.getRow(1).eachCell(cl => { cl.font = { bold: true, color: { argb: 'FFFFFFFF' } }; cl.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E4414' } }; cl.alignment = { wrapText: true }; }); ws.columns.forEach(cl => { cl.width = 15; }); ws.views = [{ state: 'frozen', xSplit: 2, ySplit: 1 }];
    return c.body(Buffer.from(await wb.xlsx.writeBuffer()) as any, 200, { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'content-disposition': 'attachment; filename="farmgate_selection_scores.xlsx"' });
  });
  adm.post('/scores/selection-workbook', async c => { const form = await c.req.parseBody(); const file = form.file as File | undefined; if (!file || typeof file === 'string') return c.json({ error: 'Fichier manquant' }, 400); return c.json(await importSelectionIndicators(db, c.get('ctx')!, Buffer.from(await file.arrayBuffer()), form.apply === '1')); });
  adm.get('/scores', async c => c.json((await db.as(c.get('ctx')!, q => q.query(`select distinct on (score) score, version, config, status, author, created_at from score_configs order by score, version desc`))).rows));
  // every change creates a new version (date + author); weights must sum to 100 %
  adm.put('/scores/:score', async c => {
    const score = c.req.param('score'); if (!['eau', 'biodiversite'].includes(score)) throw new Error('Score inconnu'); const b = await c.req.json(); const cfg = b.config;
    if (!cfg || !cfg.items) throw new Error('Configuration manquante');
    const items = Array.isArray(cfg.items) ? cfg.items : Object.values(cfg.items); for (const i of items as any[]) for (const k of ['t0', 't100', 'weight']) if (!Number.isFinite(Number(i[k]))) throw new Error('Seuils et poids : nombres attendus'); else i[k] = Number(i[k]);
    if ((items as any[]).some(i => i.t0 === i.t100)) throw new Error('Les deux seuils d’un critère doivent être différents');
    assertWeights({ items: Array.isArray(cfg.items) ? Object.fromEntries(cfg.items.map((i: any, k: number) => [k, i])) : cfg.items });
    for (const k of ['floor', 'ceiling']) cfg[k] = Number(cfg[k]); if (!(cfg.floor >= 0 && cfg.ceiling <= 100 && cfg.floor < cfg.ceiling)) throw new Error('Plancher et plafond invalides');
    if (score === 'eau') { cfg.level_basis = cfg.level_basis === 'prospectif' ? 'prospectif' : 'initial'; cfg.irrigation_null_threshold = Number(cfg.irrigation_null_threshold) || 0; }
    const r = await db.as(c.get('ctx')!, async q => { const n = (await q.query(`select coalesce(max(version),0)+1 v from score_configs where score=$1`, [score])).rows[0].v; cfg.version = n; cfg.status = b.status === 'valide' ? 'valide' : 'a_valider';
      return (await q.query(`insert into score_configs(score,version,config,status,author) values($1,$2,$3::jsonb,$4,$5) returning score,version,status`, [score, n, JSON.stringify(cfg), cfg.status, c.get('ctx')!.email])).rows[0]; });
    await db.owner.query(`insert into audit_log(user_id,action,entity,entity_id,detail) values($1,'score.config','score',$2,$3::jsonb)`, [c.get('ctx')!.uid, score, JSON.stringify({ version: r.version })]); cfgCache = null; return c.json(r);
  });
  return { pub, adm };
}
export const resetScoreCache = () => { cfgCache = null; };
