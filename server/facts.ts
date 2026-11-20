// Public-safe farm facts, read THROUGH row-level security as the anonymous role, then cached until the next import.
import { PUBLIC, type Db } from './db.ts';
import type { FarmFacts } from '../shared/aggregate.ts';
import type { IndicatorDef } from '../shared/catalogue.ts';
import { norm } from '../shared/catalogue.ts';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
type Ring = [number, number][];
const geo = <T>(f: string): T => JSON.parse(readFileSync(join(root, f), 'utf8'));
let _bv: { nom: string; polys: Ring[][] }[] | null = null, _rivers: Map<string, Ring[]> | null = null, _cities: [string, string, number, number, string][] | null = null;
const basins = (): { nom: string; polys: Ring[][] }[] => (_bv ??= geo<any>('web/public/geo/bv_data.json').features.map((f: any) => ({ nom: f.properties.nom, polys: f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates })));
const rivers = (): Map<string, Ring[]> => (_rivers ??= new Map(geo<any>('web/public/geo/fleuves_data.json').features.map((f: any) => [f.properties.nom, f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates])));
export const riverNames = () => [...rivers().keys()].sort((a, b) => a.localeCompare(b, 'fr'));
export const basinNames = () => basins().map(b => b.nom);
export function basinOf(lng: number, lat: number): string | null {
  for (const b of basins()) for (const p of b.polys) if (inPolygon(lng, lat, p[0]) && !p.slice(1).some(h => inPolygon(lng, lat, h))) return b.nom;
  return null;
}
/** distance (km) from a point to a river polyline, local equirectangular approximation */
export function kmToRiver(name: string, lng: number, lat: number): number | null {
  const lines = rivers().get(name); if (!lines) return null;
  const kx = 111.32 * Math.cos((lat * Math.PI) / 180), ky = 110.57; let best = Infinity;
  for (const l of lines) for (let i = 0; i < l.length - 1; i++) {
    const ax = (l[i][0] - lng) * kx, ay = (l[i][1] - lat) * ky, bx = (l[i + 1][0] - lng) * kx, by = (l[i + 1][1] - lat) * ky;
    const dx = bx - ax, dy = by - ay, t = dx || dy ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy))) : 0;
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}
/** Commune autocomplete on the local 33,335-commune index (no external call). */
export function searchCommunes(q: string, limit = 8) {
  _cities ??= Object.values(geo<Record<string, [string, string, number, number]>>('geo/cities_index.json')).map(c => [c[0], c[1], c[2], c[3], norm(c[0]).replace(/[-']/g, ' ')]);
  const n = norm(q).replace(/[-']/g, ' '); if (n.length < 2) return [];
  const starts = _cities.filter(c => c[4].startsWith(n)), more = starts.length < limit ? _cities.filter(c => !c[4].startsWith(n) && c[4].includes(n)) : [];
  return [...starts.sort((a, b) => a[4].length - b[4].length), ...more].slice(0, limit).map(c => ({ name: c[0], departement: c[1], lat: c[2], lng: c[3] }));
}

export interface Dataset { farms: FarmFacts[]; indicators: (IndicatorDef & { collected: boolean; catalogue_source: string })[]; levers: { code: string; family: string; name_fr: string; type: string; scope: string; description_fr: string | null; impact_tco2e_ha_yr: string | null; impact_source: string | null }[]; portfolio: { farms: number; sau: number }; loaded_at: string; data_as_of: string | null }
let cache: Dataset | null = null;
export const invalidate = () => { cache = null; };
const N = (x: any) => (x == null ? null : Number(x));

export async function dataset(db: Db): Promise<Dataset> {
  if (cache) return cache;
  cache = await db.as(PUBLIC, async q => {
    const f = (await q.query(`select f.*, p.name as project, o.name as porteur from farms f left join projects p on p.id=f.project_id left join organizations o on o.id=p.porteur_org_id where not f.absent_from_last_import order by f.id`)).rows;
    const iv = (await q.query(`select farm_id, indicator_code, state, value from indicator_values where harvest_year=0`)).rows;
    const lv = (await q.query(`select farm_id, lever_code, active from farm_levers`)).rows;
    const fu = (await q.query(`select farm_id, re_total_year, re_avoidance_year, re_storage_year from annual_followups where harvest_year=2025`)).rows;
    const alloc = new Map((await q.query(`select farm_id, allocated from farm_allocated()`)).rows.map(r => [r.farm_id as string, Number(r.allocated)])); const ledger = alloc.size > 0;
    const ind = new Map<string, Record<string, any>>(), lev = new Map<string, string[]>(), fum = new Map(fu.map(r => [r.farm_id, N(r.re_total_year)])), fua = new Map(fu.map(r => [r.farm_id, r]));
    for (const r of iv) ((ind.get(r.farm_id) ?? ind.set(r.farm_id, {}).get(r.farm_id)!)[r.indicator_code] ??= {})[r.state] = Number(r.value);
    for (const r of lv) { const a = lev.get(r.farm_id) ?? lev.set(r.farm_id, []).get(r.farm_id)!; if (r.active) a.push(r.lever_code); }
    const farms: FarmFacts[] = f.map(r => ({
      id: r.id, project: r.project, porteur: r.porteur, region: r.region, departement: r.departement, typology: r.typology, lbc_status: r.lbc_status,
      sau: N(r.sau), lat: r.lat_blur, lng: r.lng_blur,
      em_init_ha: N(r.em_init_ha), em_target_ha: N(r.em_target_ha), st_init_ha: N(r.st_init_ha), st_target_ha: N(r.st_target_ha),
      re_evit_total: N(r.re_evit_total), re_stock_total: N(r.re_stock_total), re_labelled: N(r.re_labelled),
      vol_filieres: N(r.vol_filieres), vol_vendable: N(r.vol_vendable), vol_vendu: ledger ? alloc.get(r.id) ?? 0 : N(r.vol_vendu), vol_dispo: ledger ? Math.max(0, (N(r.vol_vendable) ?? 0) - (alloc.get(r.id) ?? 0)) : N(r.vol_dispo),
      re_measured_r25: fum.get(r.id) ?? null, re_avoid_r25: N(fua.get(r.id)?.re_avoidance_year), re_stor_r25: N(fua.get(r.id)?.re_storage_year), last_diag_date: r.last_diag_date ? new Date(r.last_diag_date).toISOString().slice(0, 10) : null, verified_at: r.verified_at ? new Date(r.verified_at).toISOString().slice(0, 10) : null,
      bassin: r.lat_blur != null ? basinOf(r.lng_blur, r.lat_blur) : null, ind: ind.get(r.id) ?? {}, levers: lev.has(r.id) ? lev.get(r.id)! : null,
    }));
    const indicators = (await q.query(`select * from indicators order by sort`)).rows as any;
    const levers = (await q.query(`select code,family,name_fr,type,scope,description_fr,impact_tco2e_ha_yr,impact_source from levers order by sort`)).rows as any;
    const last = (await q.query(`select max(last_import_id) id from farms`)).rows[0]?.id;
    return { farms, indicators, levers, portfolio: { farms: farms.length, sau: farms.reduce((s, x) => s + (x.sau ?? 0), 0) }, loaded_at: new Date().toISOString(), data_as_of: last ? String(last) : null };
  });
  return cache!;
}

export interface Filters {
  project?: string[]; porteur?: string[]; region?: string[]; departement?: string[]; typology?: string[]; status?: string[];
  levers?: string[]; sau_min?: number; sau_max?: number; available_min?: number; ids?: string[];
  bassin?: string[]; river?: { name: string; km: number };
  near?: { lat: number; lng: number; km: number }; polygon?: [number, number][]; // [lng, lat]
}
const km = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const R = 6371, dLa = ((b.lat - a.lat) * Math.PI) / 180, dLo = ((b.lng - a.lng) * Math.PI) / 180;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
export function inPolygon(lng: number, lat: number, poly: [number, number][]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
/** All filters combine with AND. Geographic filters use the BLURRED position (public callers must not be able to triangulate a farm). */
export function applyFilters(farms: FarmFacts[], f: Filters): FarmFacts[] {
  const inl = (list: string[] | undefined, v: string | null | undefined) => !list?.length || (v != null && list.includes(v));
  return farms.filter(x =>
    inl(f.project, x.project) && inl(f.porteur, x.porteur) && inl(f.region, x.region) && inl(f.departement, x.departement) && inl(f.typology, x.typology) && inl(f.status, x.lbc_status) &&
    (!f.ids?.length || f.ids.includes(x.id)) &&
    (!f.levers?.length || (x.levers !== null && f.levers.every(l => x.levers!.includes(l)))) &&
    (f.sau_min == null || (x.sau != null && x.sau >= f.sau_min)) && (f.sau_max == null || (x.sau != null && x.sau <= f.sau_max)) &&
    (f.available_min == null || (x.vol_dispo != null && x.vol_dispo >= f.available_min)) &&
    inl(f.bassin, x.bassin) &&
    (!f.river || (x.lat != null && x.lng != null && (kmToRiver(f.river.name, x.lng, x.lat) ?? Infinity) <= f.river.km)) &&
    (!f.near || (x.lat != null && x.lng != null && km(f.near, { lat: x.lat, lng: x.lng }) <= f.near.km)) &&
    (!f.polygon || (x.lat != null && x.lng != null && inPolygon(x.lng, x.lat, f.polygon))));
}
