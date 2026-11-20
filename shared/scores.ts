// Composite scores (brief 4C). Mechanics shared by Eau and Biodiversité:
//   note = 100 × clamp((value − t0) / (t100 − t0), 0, 1); contribution = note × weight
// A t100 lower than t0 means "lower is better".
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
export function note(value: number | null | undefined, t0: number, t100: number): number | null {
  if (!isNum(value)) return null;
  return 100 * Math.min(1, Math.max(0, (value - t0) / (t100 - t0)));
}
export const relativeScore = (score: number, min: number, max: number, floor = 50, ceiling = 95) =>
  max === min ? ceiling : floor + (ceiling - floor) * (score - min) / (max - min);

// ---------------- Score Eau (absolute, /100) ----------------
export interface WaterInputs {
  lix_init?: number | null; lix_pros?: number | null;     // kg N/ha/yr
  irr_init?: number | null; irr_pros?: number | null;     // mm/ha/yr
  ift_init?: number | null; ift_pros?: number | null;
  cover_init?: number | null; cover_pros?: number | null; // % of SAU (0–100)
  erosion_pros?: number | null; p_pros?: number | null;   // index ; kg P2O5/ha
  erosion_init?: number | null; p_init?: number | null;
}
export const WATER_CONFIG_V1 = {
  version: 1, status: 'a_valider' as const, irrigation_null_threshold: 0, floor: 50, ceiling: 95,
  /** which state feeds the "level" items: the end-of-project scenario (brief 4C) or the initial state (owner request, 2026-11-15) */
  level_basis: 'prospectif' as 'prospectif' | 'initial',
  items: {
    lix_level: { block: 'lixiviation', t0: 60, t100: 38, weight: 0.20 },
    lix_evol: { block: 'lixiviation', t0: 0, t100: -0.15, weight: 0.20 },
    irr_none: { block: 'consommation', t0: 0, t100: 1, weight: 0.20 },
    irr_volume: { block: 'consommation', t0: 120, t100: 0, weight: 0.10 },
    irr_evol: { block: 'consommation', t0: 0, t100: -0.5, weight: 0.10 },
    ift_level: { block: 'autres', t0: 5, t100: 0, weight: 0.04 },
    ift_evol: { block: 'autres', t0: 0, t100: -2, weight: 0.04 },
    cover_level: { block: 'autres', t0: 0, t100: 50, weight: 0.04 },
    cover_evol: { block: 'autres', t0: 0, t100: 30, weight: 0.04 },
    erosion_level: { block: 'autres', t0: 0.25, t100: 0.05, weight: 0.02 },
    p_level: { block: 'autres', t0: 60, t100: 0, weight: 0.02 },
  },
};
export type WaterConfig = typeof WATER_CONFIG_V1;
/** v2 (owner request): each theme is scored on its INITIAL state and on its estimated evolution — same items and weights as v1 */
export const WATER_CONFIG_V2: WaterConfig = { ...WATER_CONFIG_V1, version: 2, level_basis: 'initial' };
export function assertWeights(cfg: { items: Record<string, { weight: number }> }) {
  const s = Object.values(cfg.items).reduce((a, i) => a + i.weight, 0);
  if (Math.abs(s - 1) > 1e-9) throw new Error(`Weights must sum to 100 % (got ${(s * 100).toFixed(2)} %)`);
}
const rel = (a?: number | null, b?: number | null) => (isNum(a) && isNum(b) && a !== 0 ? (b - a) / a : null);
const diff = (a?: number | null, b?: number | null) => (isNum(a) && isNum(b) ? b - a : null);

export function waterScore(x: WaterInputs, cfg: WaterConfig = WATER_CONFIG_V1) {
  assertWeights(cfg);
  const it = cfg.items, n = (v: number | null | undefined, k: keyof typeof it) => note(v, it[k].t0, it[k].t100);
  // "already optimal" rule: a farm starting at the optimum gets 100 on the evolution indicator
  const L = (init: number | null | undefined, pros: number | null | undefined) => (cfg.level_basis === 'initial' ? init : pros);
  const notes: Record<keyof typeof it, number | null> = {
    lix_level: n(L(x.lix_init, x.lix_pros), 'lix_level'),
    lix_evol: isNum(x.lix_init) && x.lix_init <= it.lix_level.t100 ? 100 : n(rel(x.lix_init, x.lix_pros), 'lix_evol'),
    irr_none: isNum(L(x.irr_init, x.irr_pros)) ? (L(x.irr_init, x.irr_pros)! <= cfg.irrigation_null_threshold ? 100 : 0) : null,
    irr_volume: n(L(x.irr_init, x.irr_pros), 'irr_volume'),
    irr_evol: isNum(x.irr_init) && x.irr_init <= cfg.irrigation_null_threshold ? 100 : n(rel(x.irr_init, x.irr_pros), 'irr_evol'),
    ift_level: n(L(x.ift_init, x.ift_pros), 'ift_level'),
    ift_evol: x.ift_init === 0 ? 100 : n(diff(x.ift_init, x.ift_pros), 'ift_evol'),
    cover_level: n(L(x.cover_init, x.cover_pros), 'cover_level'),
    cover_evol: isNum(x.cover_init) && x.cover_init >= it.cover_level.t100 ? 100 : n(diff(x.cover_init, x.cover_pros), 'cover_evol'),
    erosion_level: n(L(x.erosion_init, x.erosion_pros), 'erosion_level'),
    p_level: n(L(x.p_init, x.p_pros), 'p_level'),
  };
  const blocks: Record<string, number> = { lixiviation: 0, consommation: 0, autres: 0 };
  let score = 0, backed = 0;
  const contributions = (Object.keys(it) as (keyof typeof it)[]).map(k => {
    const c = (notes[k] ?? 0) * it[k].weight; // missing value = 0 points (see completeness)
    score += c; blocks[it[k].block] += c; if (notes[k] !== null) backed += it[k].weight;
    return { key: k, block: it[k].block, note: notes[k], weight: it[k].weight, contribution: c };
  });
  return { score, blocks, contributions, completeness: backed, renormalised: backed > 0 ? score / backed : null, version: cfg.version };
}

// ---------------- Score Biodiversité (raw = Σ note × weight; displayed = relative 50–95) ----------------
export interface BioItem { key: string; basis: 'initial' | 'evolution'; t0: number; t100: number; weight: number; why?: string }
export const BIO_CONFIG_V1: { version: number; status: 'a_valider'; floor: number; ceiling: number; items: BioItem[] } = {
  version: 1, status: 'a_valider', floor: 50, ceiling: 95,
  items: [
    { key: 'nitrate_leaching', basis: 'initial', t0: 60, t100: 38, weight: .08 }, { key: 'cover_share_sau', basis: 'initial', t0: 0, t100: 0.5, weight: .04 },
    { key: 'cover_duration', basis: 'initial', t0: 150, t100: 365, weight: .04 }, { key: 'cover_share_measured', basis: 'initial', t0: 0, t100: 50, weight: .02 },
    { key: 'erosion', basis: 'initial', t0: 0.25, t100: 0.05, weight: .04 }, { key: 'no_till', basis: 'initial', t0: 0, t100: 80, weight: .03 },
    { key: 'tillage_depth', basis: 'initial', t0: 25, t100: 15, weight: .01 }, { key: 'organic_matter', basis: 'initial', t0: 1, t100: 4, weight: .04 },
    { key: 'humified_c', basis: 'initial', t0: 0.5, t100: 1.5, weight: .02 }, { key: 'ift_total', basis: 'initial', t0: 5, t100: 0, weight: .04 },
    { key: 'eiq', basis: 'initial', t0: 150, t100: 0, weight: .03 }, { key: 'simpson', basis: 'initial', t0: 0.4, t100: 0.9, weight: .03 },
    { key: 'crops_count', basis: 'initial', t0: 2, t100: 10, weight: .03 }, { key: 'phosphorus', basis: 'initial', t0: 60, t100: 0, weight: .02 },
    { key: 'iae', basis: 'initial', t0: 0, t100: 15, weight: .03 },
    { key: 'nitrate_leaching', basis: 'evolution', t0: 0, t100: -0.15, weight: .02 }, { key: 'ammonia', basis: 'evolution', t0: 0, t100: -0.40, weight: .02 },
    { key: 'cover_share_sau', basis: 'evolution', t0: 0, t100: 30, weight: .06 }, { key: 'erosion', basis: 'evolution', t0: 0, t100: -0.20, weight: .05 },
    { key: 'no_till', basis: 'evolution', t0: 0, t100: 30, weight: .04 }, { key: 'tillage_depth', basis: 'evolution', t0: 0, t100: -4, weight: .02 },
    { key: 'humified_c', basis: 'evolution', t0: 0, t100: 0.3, weight: .03 }, { key: 'organic_matter', basis: 'evolution', t0: 0, t100: 0.4, weight: .06 },
    { key: 'ift_total', basis: 'evolution', t0: 0, t100: -2, weight: .06 }, { key: 'simpson', basis: 'evolution', t0: 0, t100: 0.1, weight: .03 },
    { key: 'crops_count', basis: 'evolution', t0: 0, t100: 3, weight: .04 }, { key: 'phosphorus', basis: 'evolution', t0: 0, t100: -20, weight: .02 },
    { key: 'bio_levers', basis: 'evolution', t0: 0, t100: 4, weight: .05, why: 'Nombre de leviers favorables à la biodiversité activés (max 4)' },
  ],
};
/** values: `${key}:initial` → starting value, `${key}:evolution` → evolution already expressed in the unit of the thresholds. */
export function bioRawScore(values: Record<string, number | null | undefined>, cfg = BIO_CONFIG_V1, opts: { renormalise?: boolean } = {}) {
  const s = cfg.items.reduce((a, i) => a + i.weight, 0);
  if (Math.abs(s - 1) > 1e-9) throw new Error(`Weights must sum to 100 % (got ${(s * 100).toFixed(2)} %)`);
  let raw = 0, backed = 0;
  const contributions = cfg.items.map(i => {
    const nt = note(values[`${i.key}:${i.basis}`], i.t0, i.t100);
    const c = (nt ?? 0) * i.weight; raw += c; if (nt !== null) backed += i.weight;
    return { key: i.key, basis: i.basis, note: nt, weight: i.weight, contribution: c };
  });
  return { raw: opts.renormalise && backed > 0 ? raw / backed : raw, contributions, completeness: backed, version: cfg.version };
}
/** Displayed score is relative to the compared pool (floor 50, ceiling 95): a rank, not an absolute grade. */
export function bioDisplayed(raws: number[], cfg = BIO_CONFIG_V1) {
  const min = Math.min(...raws), max = Math.max(...raws);
  return raws.map(r => relativeScore(r, min, max, cfg.floor, cfg.ceiling));
}
