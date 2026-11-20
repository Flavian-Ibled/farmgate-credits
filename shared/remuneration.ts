// Where the price of a tonne goes (brief 4.1 block 8, 4D cost_breakdown).
// Rule set by Carbone Farmers (2026-11-15): the farmer always receives at least 75 % of the price of a tonne.
// A contract may grant more, part of it as agronomic advice delivered to the farmer
// (e.g. SEDIF: 82 % = 75 % paid + 7 % agronomic advice). What is PAID to the farmer never goes below 75 %.
export const MIN_FARMER_PCT = 75;
export const REST_KEYS = ['mrv_pct', 'support_pct', 'cf_pct', 'partner_pct', 'label_pct'] as const;
export interface Remuneration { farmer_pct: number; advice_pct: number; mrv_pct?: number | null; support_pct?: number | null; cf_pct?: number | null; partner_pct?: number | null; label_pct?: number | null; note?: string | null }
export const DEFAULT_REMUNERATION: Remuneration = { farmer_pct: MIN_FARMER_PCT, advice_pct: 0 };
const n = (x: unknown, label: string): number | null => { if (x === '' || x == null) return null; const v = Number(String(x).replace(',', '.')); if (!Number.isFinite(v) || v < 0 || v > 100) throw new Error(`${label} : un pourcentage entre 0 et 100`); return Math.round(v * 100) / 100; };

/** Validates a remuneration model. Returns null when nothing is set (→ the default applies). */
export function validateRemuneration(b: any): Remuneration | null {
  if (!b || (b.farmer_pct === '' || b.farmer_pct == null) && REST_KEYS.every(k => b[k] === '' || b[k] == null)) return null;
  const farmer = n(b.farmer_pct, 'Part agriculteur') ?? MIN_FARMER_PCT, advice = n(b.advice_pct, 'Conseil agronomique') ?? 0;
  if (advice > farmer) throw new Error('Le conseil agronomique est inclus dans la part agriculteur : il ne peut pas la dépasser');
  if (farmer - advice < MIN_FARMER_PCT - 1e-9) throw new Error(`La part versée à l’agriculteur (${farmer} % − ${advice} % de conseil = ${Math.round((farmer - advice) * 100) / 100} %) ne peut pas être inférieure à ${MIN_FARMER_PCT} %`);
  const r: Remuneration = { farmer_pct: farmer, advice_pct: advice, note: b.note ? String(b.note).slice(0, 500) : null };
  let rest = 0, any = false; for (const k of REST_KEYS) { const v = n(b[k], k); r[k] = v; if (v != null) { rest += v; any = true; } }
  if (any && Math.abs(farmer + rest - 100) > 0.01) throw new Error(`La répartition doit faire 100 % (actuellement ${Math.round((farmer + rest) * 100) / 100} %)`);
  if (!any && farmer > 100) throw new Error('Part agriculteur supérieure à 100 %');
  return r;
}
/** contract (allocation) model > project model > default (75 %) */
export function resolveRemuneration(alloc?: Remuneration | null, project?: Remuneration | null): Remuneration & { source: 'contract' | 'project' | 'default' } {
  if (alloc) return { ...alloc, source: 'contract' }; if (project) return { ...project, source: 'project' }; return { ...DEFAULT_REMUNERATION, source: 'default' };
}
export interface Flow { key: string; pct: number; known: boolean }
/** flows of one tonne's price; the part of the remainder that is not documented stays one "to be provided" flow */
export function flows(r: Remuneration): Flow[] {
  const out: Flow[] = [{ key: 'farmer_paid', pct: r.farmer_pct - r.advice_pct, known: true }]; if (r.advice_pct > 0) out.push({ key: 'advice', pct: r.advice_pct, known: true });
  let rest = 100 - r.farmer_pct; for (const k of REST_KEYS) { const v = r[k]; if (v != null && v > 0) { out.push({ key: k.replace('_pct', ''), pct: v, known: true }); rest -= v; } }
  if (rest > 0.01) out.push({ key: 'undocumented', pct: Math.round(rest * 100) / 100, known: false });
  return out;
}
export const farmerAmount = (amountEur: number | null | undefined, r: Remuneration) => (amountEur == null ? null : Math.round(amountEur * r.farmer_pct) / 100);
