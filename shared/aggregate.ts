// Selection analytics engine (brief 4B). Pure functions: the server calls them, the browser never does.
import type { IndicatorDef } from './catalogue.ts';

export interface IndValue { initial?: number | null; prospectif?: number | null; suivi?: number | null }
export interface FarmFacts {
  id: string; project: string | null; porteur?: string | null; region: string | null; departement: string | null;
  typology: string | null; lbc_status: string | null; sau: number | null;
  lat: number | null; lng: number | null; // blurred for public callers
  em_init_ha: number | null; em_target_ha: number | null; st_init_ha: number | null; st_target_ha: number | null;
  re_evit_total: number | null; re_stock_total: number | null; re_labelled: number | null;
  vol_filieres: number | null; vol_vendable: number | null; vol_vendu: number | null; vol_dispo: number | null;
  re_measured_r25?: number | null; re_avoid_r25?: number | null; re_stor_r25?: number | null; last_diag_date?: string | null; verified_at?: string | null;
  /** water-agency basin, derived from the (blurred) position */
  bassin?: string | null;
  ind: Record<string, IndValue>;
  /** null = no lever data for this farm (≠ "no lever active") */
  levers: string[] | null;
}

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
export const sum = (xs: (number | null | undefined)[]) => xs.reduce<number>((s, x) => (isNum(x) ? s + x : s), 0);
export const count = (xs: unknown[]) => xs.filter(isNum).length;

/** SAU-weighted mean over the farms that have BOTH the value and a SAU. Returns null when no farm qualifies. */
export function wmean(pairs: { v: number | null | undefined; w: number | null | undefined }[]): number | null {
  let sv = 0, sw = 0;
  for (const { v, w } of pairs) if (isNum(v) && isNum(w) && w > 0) { sv += v * w; sw += w; }
  return sw > 0 ? sv / sw : null;
}

/** Evolution of an aggregate: computed from aggregated values, never as a mean of farm-level percentages. */
export function evolution(initial: number | null, after: number | null): number | null {
  if (!isNum(initial) || !isNum(after) || initial === 0) return null;
  return (after - initial) / Math.abs(initial);
}

const applies = (def: IndicatorDef, f: FarmFacts) =>
  def.scope === 'both' || (def.scope === 'GC' && f.typology === 'Grandes cultures') || (def.scope === 'EL' && f.typology === 'Élevage bovins');

export interface IndicatorAgg {
  code: string; initial: number | null; prospectif: number | null; suivi: number | null;
  evolution_prospectif: number | null; evolution_suivi: number | null;
  n_applicable: number; n_with_data: number; n_paired: number; collected: boolean;
}

function aggState(def: IndicatorDef, farms: FarmFacts[], state: keyof IndValue, all: Map<string, IndicatorDef>): number | null {
  const vals = farms.map(f => ({ v: f.ind[def.code]?.[state], w: f.sau, f }));
  if (def.aggregation === 'sum') return count(vals.map(x => x.v)) ? sum(vals.map(x => x.v)) : null;
  if (def.aggregation === 'area_share' && def.area_code && all.has(def.area_code)) {
    // share recomputed from areas when areas exist: total covered ha / total SAU of the farms that have the area
    const withArea = farms.filter(f => isNum(f.ind[def.area_code!]?.[state]) && isNum(f.sau) && f.sau! > 0);
    if (withArea.length) return sum(withArea.map(f => f.ind[def.area_code!]![state])) / sum(withArea.map(f => f.sau));
  }
  return wmean(vals);
}

export function aggregateIndicator(def: IndicatorDef, farms: FarmFacts[], all: Map<string, IndicatorDef>): IndicatorAgg {
  const app = farms.filter(f => applies(def, f));
  const has = (f: FarmFacts, s: keyof IndValue) => isNum(f.ind[def.code]?.[s]);
  const withData = app.filter(f => has(f, 'initial') || has(f, 'prospectif') || has(f, 'suivi'));
  // evolution uses the farms that have both ends, so that both aggregates describe the same population
  const paired = app.filter(f => has(f, 'initial') && has(f, 'prospectif'));
  const pairedS = app.filter(f => has(f, 'initial') && has(f, 'suivi'));
  return {
    code: def.code,
    initial: aggState(def, app, 'initial', all), prospectif: aggState(def, app, 'prospectif', all), suivi: aggState(def, app, 'suivi', all),
    evolution_prospectif: evolution(aggState(def, paired, 'initial', all), aggState(def, paired, 'prospectif', all)),
    evolution_suivi: evolution(aggState(def, pairedS, 'initial', all), aggState(def, pairedS, 'suivi', all)),
    n_applicable: app.length, n_with_data: withData.length, n_paired: paired.length, collected: withData.length > 0,
  };
}

export function aggregateSelection(farms: FarmFacts[], defs: IndicatorDef[], portfolio: { farms: number; sau: number }, leverCodes: string[]) {
  const sau = sum(farms.map(f => f.sau));
  const perHa = (k: 'em_init_ha' | 'em_target_ha' | 'st_init_ha' | 'st_target_ha') =>
    ({ value: wmean(farms.map(f => ({ v: f[k], w: f.sau }))), n_with_data: farms.filter(f => isNum(f[k]) && isNum(f.sau)).length });
  const evit = sum(farms.map(f => f.re_evit_total)), stock = sum(farms.map(f => f.re_stock_total));
  const nSplit = farms.filter(f => isNum(f.re_evit_total) || isNum(f.re_stock_total)).length;
  const labelled = sum(farms.map(f => f.re_labelled));
  const followed = farms.filter(f => isNum(f.re_measured_r25));
  const all = new Map(defs.map(d => [d.code, d]));
  const withLevers = farms.filter(f => f.levers !== null);
  const sauLevers = sum(withLevers.map(f => f.sau));
  const tally = (k: 'project' | 'region' | 'departement' | 'typology' | 'lbc_status') => {
    const m = new Map<string, { farms: number; sau: number }>();
    for (const f of farms) { const key = f[k] ?? '—'; const e = m.get(key) ?? { farms: 0, sau: 0 }; e.farms++; e.sau += isNum(f.sau) ? f.sau : 0; m.set(key, e); }
    return [...m].map(([key, v]) => ({ key, ...v })).sort((a, b) => b.farms - a.farms);
  };
  return {
    scale: {
      farms: farms.length, sau, n_with_sau: count(farms.map(f => f.sau)),
      share_of_portfolio_farms: portfolio.farms ? farms.length / portfolio.farms : null,
      share_of_portfolio_sau: portfolio.sau ? sau / portfolio.sau : null,
      projects: tally('project'), regions: tally('region'), departements: tally('departement'), typologies: tally('typology'), statuses: tally('lbc_status'),
    },
    carbon: {
      em_init_ha: perHa('em_init_ha'), em_target_ha: perHa('em_target_ha'), st_init_ha: perHa('st_init_ha'), st_target_ha: perHa('st_target_ha'),
      re_avoidance_5y: evit, re_storage_5y: stock, n_with_split: nSplit,
      share_avoidance: evit + stock !== 0 ? evit / (evit + stock) : null, share_storage: evit + stock !== 0 ? stock / (evit + stock) : null,
      re_labelled_5y: labelled, n_with_labelled: count(farms.map(f => f.re_labelled)),
      re_labelled_ha_yr: sau > 0 ? labelled / sau / 5 : null,
      vol_filieres: sum(farms.map(f => f.vol_filieres)), vol_vendable: sum(farms.map(f => f.vol_vendable)),
      vol_vendu: sum(farms.map(f => f.vol_vendu)), vol_dispo: sum(farms.map(f => f.vol_dispo)),
      diagnostics: { n_with_date: farms.filter(f => f.last_diag_date).length, latest: farms.map(f => f.last_diag_date).filter(Boolean).sort().pop() ?? null, n_verified: farms.filter(f => f.verified_at).length },
      followup_r25: { farms_followed: followed.length, measured: sum(followed.map(f => f.re_measured_r25)), labelled_of_followed: sum(followed.map(f => f.re_labelled)) },
    },
    levers: {
      n_with_data: withLevers.length, sau_with_data: sauLevers,
      items: leverCodes.map(code => {
        const on = withLevers.filter(f => f.levers!.includes(code));
        return { code, farms: on.length, sau: sum(on.map(f => f.sau)), share_farms: withLevers.length ? on.length / withLevers.length : null, share_sau: sauLevers ? sum(on.map(f => f.sau)) / sauLevers : null };
      }),
    },
    cobenefits: defs.map(d => aggregateIndicator(d, farms, all)),
  };
}
export type SelectionResult = ReturnType<typeof aggregateSelection>;
