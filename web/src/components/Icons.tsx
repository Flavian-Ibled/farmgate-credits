// Co-benefit icons: the team's category pictograms (water, soil, air, biodiversity, socio-economic) for categories,
// and a small consistent set of line icons for each indicator.
const PATHS: Record<string, string> = {
  drop: 'M12 3s-6 7-6 11a6 6 0 0 0 12 0c0-4-6-11-6-11z',
  sprinkler: 'M12 4v3M5 9h14M7 12v6M12 12v6M17 12v6',
  mountain: 'M3 19l6-9 4 5 3-4 5 8z',
  sprout: 'M12 21v-8M12 13c0-4-3-6-7-6 0 4 3 6 7 6zM12 13c0-3 2-5 6-5 0 3-2 5-6 5z',
  layers: 'M3 7c3-2 6 2 9 0s6 2 9 0M3 13c3-2 6 2 9 0s6 2 9 0M3 19c3-2 6 2 9 0s6 2 9 0',
  plough: 'M3 8h18M12 8v11M8 15l4 4 4-4',
  noTill: 'M3 8h18M12 8v11M8 15l4 4 4-4M4 4l16 16',
  cloud: 'M7 18a4 4 0 0 1 0-8 5 5 0 0 1 9.6-1A4.5 4.5 0 0 1 17 18z',
  flask: 'M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3',
  wheat: 'M12 21V9M12 9c-2-1-3-3-3-5 2 0 3 2 3 5zM12 9c2-1 3-3 3-5-2 0-3 2-3 5zM12 14c-2-1-4-1-5-3 2-.5 4 .5 5 3zM12 14c2-1 4-1 5-3-2-.5-4 .5-5 3z',
  tree: 'M12 21v-7M12 14a5 5 0 1 1 0-10 5 5 0 0 1 0 10z',
  bolt: 'M13 2L4 14h7l-1 8 9-12h-7z',
  hex: 'M12 3l7 4v8l-7 4-7-4V7z',
  person: 'M12 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM5 21v-3a7 7 0 0 1 14 0v3',
  dot: 'M12 12m-2 0a2 2 0 1 0 4 0 2 2 0 1 0-4 0',
};
const BY_CODE: Record<string, string> = {
  nitrate_leaching: 'drop', water_consumption: 'sprinkler', irrigated_volume: 'sprinkler', erosion: 'mountain',
  cover_share: 'sprout', cover_area: 'sprout', cover_duration: 'sprout', cover_share_measured: 'sprout', soil_cover_rate: 'sprout', cover_species: 'sprout',
  organic_matter: 'layers', humified_c: 'layers', tillage_depth: 'plough', no_till: 'noTill', ammonia: 'cloud',
  ift_total: 'flask', ift_herbicide: 'flask', ift_non_herbicide: 'flask', ift_biocontrol: 'flask', treatments_count: 'flask', untreated_share: 'flask', eiq: 'flask',
  simpson: 'wheat', crops_count: 'wheat', iae: 'tree', non_renewable_energy: 'bolt', phosphorus: 'hex', organic_n_share: 'hex', food_potential: 'person', protein_potential: 'person',
};
const PNG: Record<string, string> = { Eau: 'water', Sol: 'soil', Air: 'air', 'Biodiversité': 'biodiversity', 'Potentiel nourricier': 'socio' };
const Svg = ({ d, size, className = '' }: { d: string; size: number; className?: string }) => <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={className}><path d={d} /></svg>;

/** Pictogram of a category (team artwork where it exists, line icon otherwise). Decorative: the text next to it carries the meaning. */
export function CatIcon({ cat, size = 28 }: { cat: string; size?: number }) {
  if (PNG[cat]) return <img src={`/brand/icons/${PNG[cat]}.png`} alt="" width={size} height={size} className="shrink-0" style={{ width: size, height: size }} />;
  return <span className="inline-flex items-center justify-center rounded-full bg-mist text-leaf-dark shrink-0" style={{ width: size, height: size }}><Svg d={PATHS.bolt} size={Math.round(size * 0.58)} /></span>;
}
/** Small round icon for one indicator. */
export function IndIcon({ code, size = 22 }: { code: string; size?: number }) {
  return <span className="inline-flex items-center justify-center rounded-full bg-mist text-leaf-dark shrink-0 align-middle" style={{ width: size, height: size }}><Svg d={PATHS[BY_CODE[code] ?? 'dot']} size={Math.round(size * 0.64)} /></span>;
}
