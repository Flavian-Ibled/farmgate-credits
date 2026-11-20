// Allocation rules (brief 4D). Pure functions, tested; the database transaction around them holds the row locks.
/** statuses counted as "funded" (open point 12: configurable; default = reserved and beyond) */
export const FUNDED_STATUSES = ['reserved', 'contracted', 'paid', 'delivered', 'retired'] as const;
export const ALLOCATION_STATUSES = ['quote', 'reserved', 'contracted', 'paid', 'delivered', 'retired', 'cancelled'] as const;
/** allowed status changes; "cancelled" frees the credits */
export const TRANSITIONS: Record<string, string[]> = { quote: ['reserved', 'contracted', 'cancelled'], reserved: ['contracted', 'cancelled'], contracted: ['paid', 'cancelled'], paid: ['delivered', 'cancelled'], delivered: ['retired'], retired: [], cancelled: [] };
const r2 = (x: number) => Math.round(x * 100) / 100;

export interface Spreadable { id: string; remaining: number; weight: number }
/**
 * Spreads a volume over farms pro rata of `weight` (labelled volume by default, or SAU), never above each farm's remaining
 * credits; what a capped farm cannot take is redistributed to the others. Throws when the volume exceeds what remains.
 */
export function spread(volume: number, farms: Spreadable[]): { farm_id: string; volume: number }[] {
  if (!(volume > 0)) throw new Error('Le volume doit être positif');
  const open = farms.filter(f => f.remaining > 0.005).map(f => ({ ...f, got: 0 }));
  const total = open.reduce((s, f) => s + f.remaining, 0);
  if (volume > total + 0.005) throw new Error(`Volume demandé (${r2(volume)} tCO₂e) supérieur aux crédits restants (${r2(total)} tCO₂e)`);
  let left = volume;
  for (let pass = 0; pass < 50 && left > 0.005; pass++) {
    const free = open.filter(f => f.remaining - f.got > 0.005); const w = free.reduce((s, f) => s + (f.weight > 0 ? f.weight : 0), 0);
    if (!free.length) break; let given = 0;
    for (const f of free) { const want = w > 0 ? (left * Math.max(0, f.weight)) / w : left / free.length; const take = Math.min(want, f.remaining - f.got); f.got += take; given += take; }
    left -= given; if (given < 1e-9) break;
  }
  const lines = open.filter(f => f.got > 0.005).map(f => ({ farm_id: f.id, volume: r2(f.got) }));
  // rounding: put the cents difference on the largest line so that the lines sum exactly to the volume
  const diff = r2(volume - lines.reduce((s, l) => s + l.volume, 0)); if (lines.length && diff !== 0) { const big = lines.reduce((a, b) => (b.volume > a.volume ? b : a)); big.volume = r2(big.volume + diff); }
  return lines;
}
/** funded % and remaining credits of a farm, project or portfolio */
export function funding(sellable: number | null, allocated: number) {
  const s = sellable ?? 0; return { sellable: s, allocated: r2(allocated), remaining: r2(Math.max(0, s - allocated)), funded_pct: s > 0 ? Math.min(1, allocated / s) : null };
}
/** a funder's share of a farm = its allocated volume / the farm's labelled volume; impact is attributed pro rata */
export const funderShare = (myVolume: number, labelled: number | null) => (labelled && labelled > 0 ? Math.min(1, myVolume / labelled) : null);
