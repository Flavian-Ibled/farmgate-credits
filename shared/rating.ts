// Red → green rating of an indicator from two admin-configurable thresholds, and category notes.
import { note } from './scores.ts';
export const RATING_COLORS = ['#9A3333', '#C8792B', '#DFAD0B', '#83B56E', '#377E25'] as const; // charter: carmin → jaune → vert
/** 0–100 (0 = at or beyond the "red" threshold, 100 = at or beyond the "green" one). null when not configured or no value. */
export function rating(value: number | null | undefined, red: number | null | undefined, green: number | null | undefined): number | null {
  if (red == null || green == null || red === green) return null;
  return note(value, Number(red), Number(green));
}
export const ratingClass = (r: number | null) => (r == null ? null : Math.min(4, Math.floor(r / 20)));
export const ratingColor = (r: number | null) => { const c = ratingClass(r); return c == null ? null : RATING_COLORS[c]; };
/** Category note /100 = weighted mean of the ratings that exist; completeness = share of the weights backed by data. */
export function categoryNote(items: { rating: number | null; weight: number | null | undefined }[]) {
  let s = 0, w = 0, all = 0;
  for (const i of items) { const k = i.weight == null ? 1 : Number(i.weight); all += k; if (i.rating != null) { s += i.rating * k; w += k; } }
  return { note: w > 0 ? s / w : null, completeness: all > 0 ? w / all : 0 };
}
/**
 * End-of-project estimates, as found in the team's documents (open point 15 — the two documents use different rules):
 * - PROJECT level (CVL2 trajectory page): avoidance constant (× 5), storage gain growing each year (1+2+3+4+5 = × 15).
 *   Reproduces 105,294 tCO₂e for the 109 CVL2 farms followed.
 * - FARM level (farm sheet "Suivi R25"): "tCO₂e générés au 1er suivi × 5 récoltes". Reproduces 1,103 for CVL2-062.
 * Always shown as "subject to annual monitoring and audit".
 */
export function endOfProjectEstimate(avoidanceYear1: number, storageYear1: number) { return 5 * avoidanceYear1 + 15 * storageYear1; }
export function farmEndOfProjectEstimate(avoidanceYear1: number, storageYear1: number) { return 5 * (avoidanceYear1 + storageYear1); }
