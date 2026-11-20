// Indicators that exist as columns in the Data Master "Master List" (seen in the 2026-09-21 file).
// The full 64-indicator catalogue is seeded from inputs/cobenefit_catalogue.csv when that file is provided;
// until then this list is the PROVISIONAL catalogue (catalogue_source = 'master_columns').
export type Aggregation = 'sum' | 'wmean' | 'area_share';
export type Scope = 'GC' | 'EL' | 'both';
export interface IndicatorDef {
  code: string; category: string; label_fr: string; label_en: string; unit: string;
  aggregation: Aggregation; area_code?: string; scope: Scope;
  /** normalised header fragment used to find the column in the Data Master */
  match: string; matchUnit?: string;
  /** default rating thresholds (from the score method of the brief, "à valider"); undefined = to configure in the admin */
  red?: number; green?: number; why_fr?: string;
}

export const MASTER_INDICATORS: IndicatorDef[] = [
  { code: 'nitrate_leaching', category: 'Eau', label_fr: 'Lixiviation des nitrates', label_en: 'Nitrate leaching', unit: 'kg N-NO3/ha/an', aggregation: 'wmean', scope: 'both', match: 'lixiviation des nitrates', matchUnit: '/ha', red: 60, green: 38, why_fr: 'Moins de nitrates lessivés, c’est une eau de nappe et de rivière de meilleure qualité.' },
  { code: 'water_consumption', category: 'Eau', label_fr: "Consommation d'eau", label_en: 'Water consumption', unit: 'm³/an', aggregation: 'sum', scope: 'both', match: "consommation d'eau" },
  { code: 'irrigated_volume', category: 'Eau', label_fr: "Volume d'eau irrigué", label_en: 'Irrigated volume', unit: 'mm/ha/an', aggregation: 'wmean', scope: 'both', match: "volume d'eau irrigue", red: 120, green: 0, why_fr: 'Moins d’irrigation, c’est moins de pression sur la ressource en eau du territoire.' },
  { code: 'untreated_share', category: 'Biodiversité', label_fr: 'Part de surface non traitée (phytosanitaires)', label_en: 'Share of area without pesticide treatment', unit: 'part de SAU', aggregation: 'wmean', scope: 'both', match: 'part de surface non-traitee' },
  { code: 'treatments_count', category: 'Biodiversité', label_fr: 'Nombre de traitements phytosanitaires', label_en: 'Number of pesticide treatments', unit: 'nb', aggregation: 'wmean', scope: 'both', match: 'nombre de traitements phytosanitaires' },
  { code: 'erosion', category: 'Sol', label_fr: 'Érosion des sols (indice)', label_en: 'Soil erosion index', unit: 'indice', aggregation: 'wmean', scope: 'GC', match: 'erosion des sols', red: 0.25, green: 0.05, why_fr: 'Un sol qui ne part pas avec la pluie garde sa fertilité et ne trouble pas les cours d’eau.' },
  { code: 'cover_share', category: 'Sol', label_fr: 'Part des surfaces avec couvert végétal', label_en: 'Share of area with cover crops', unit: 'part de SAU', aggregation: 'area_share', area_code: 'cover_area', scope: 'both', match: 'part des surfaces avec couvert vegetal', red: 0, green: 0.5, why_fr: 'Abri et ressources alimentaires pour la faune hors période de culture ; le sol reste protégé.' },
  { code: 'cover_area', category: 'Sol', label_fr: 'Surface de sols couverts', label_en: 'Covered soil area', unit: 'ha', aggregation: 'sum', scope: 'both', match: 'surface de sols couverts' },
  { code: 'organic_matter', category: 'Sol', label_fr: 'Matière organique des sols', label_en: 'Soil organic matter', unit: '% MO', aggregation: 'wmean', scope: 'GC', match: 'pourcentage de matiere organique', red: 1, green: 4, why_fr: 'La matière organique stocke du carbone, retient l’eau et nourrit la vie du sol.' },
  { code: 'tillage_depth', category: 'Sol', label_fr: 'Profondeur moyenne de travail du sol', label_en: 'Mean tillage depth', unit: 'cm', aggregation: 'wmean', scope: 'GC', match: 'profondeur moyenne de travail du sol', red: 25, green: 15, why_fr: 'Un travail du sol moins profond préserve sa structure et ses habitants.' },
  { code: 'ammonia', category: 'Air', label_fr: "Émissions d'ammoniac (NH3 + NOx)", label_en: 'Ammonia emissions (NH3 + NOx)', unit: 'kg N/ha/an', aggregation: 'wmean', scope: 'both', match: "emissions d'ammoniac" },
  { code: 'ift_total', category: 'Biodiversité', label_fr: 'IFT total', label_en: 'Treatment frequency index (IFT)', unit: 'IFT', aggregation: 'wmean', scope: 'both', match: 'ift', red: 5, green: 0, why_fr: 'Moins de traitements phytosanitaires, c’est moins de pression sur la biodiversité et l’eau.' },
  { code: 'cover_species', category: 'Biodiversité', label_fr: "Nombre d'espèces en couvert", label_en: 'Number of cover-crop species', unit: 'nb', aggregation: 'wmean', scope: 'both', match: "nombre d'especes en couvert" },
  { code: 'non_renewable_energy', category: 'Pression sur les ressources', label_fr: "Consommation d'énergie non renouvelable", label_en: 'Non-renewable energy use', unit: 'MJ/ha/an', aggregation: 'wmean', scope: 'both', match: "consommation d'engerie non renouvelable" },
  { code: 'food_potential', category: 'Potentiel nourricier', label_fr: 'Potentiel nourricier (calorique)', label_en: 'Food potential (caloric)', unit: 'pers./ha/an', aggregation: 'wmean', scope: 'both', match: 'potentiel nourricier' },
];

/** Indicators that the Data Master does not hold; they come from the team's selection workbooks (Demetrics measurements). */
export const EXTRA_INDICATORS: { code: string; category: string; label_fr: string; label_en: string; unit: string; red?: number; green?: number; why_fr?: string }[] = [
  { code: 'no_till', category: 'Sol', label_fr: 'Surface sans labour', label_en: 'No-till area', unit: '% surface', red: 0, green: 80, why_fr: 'Moins de perturbation du sol : vers de terre, champignons, carabes.' },
  { code: 'humified_c', category: 'Sol', label_fr: 'Carbone humifié restitué', label_en: 'Humified carbon returned', unit: 't C/ha/an', red: 0.5, green: 1.5, why_fr: 'Apports de carbone stable, indicateur d’activité biologique.' },
  { code: 'cover_duration', category: 'Sol', label_fr: 'Durée de couverture du sol', label_en: 'Soil cover duration', unit: 'j/an', red: 150, green: 365, why_fr: 'Un sol couvert longtemps protège la faune du sol et limite l’érosion.' },
  { code: 'soil_cover_rate', category: 'Sol', label_fr: 'Taux de couverture du sol', label_en: 'Soil cover rate', unit: '%' },
  { code: 'cover_share_measured', category: 'Sol', label_fr: 'Part de couvert dans l’assolement (mesurée)', label_en: 'Cover share of the crop mix (measured)', unit: '%', red: 0, green: 50 },
  { code: 'simpson', category: 'Biodiversité', label_fr: 'Indice de Simpson (diversité des cultures)', label_en: 'Simpson index (crop diversity)', unit: 'indice', red: 0.4, green: 0.9, why_fr: 'Diversité des cultures de l’assolement.' },
  { code: 'crops_count', category: 'Biodiversité', label_fr: 'Nombre de cultures', label_en: 'Number of crops', unit: 'nb', red: 2, green: 10, why_fr: 'Diversité des habitats et des ressources.' },
  { code: 'iae', category: 'Biodiversité', label_fr: 'Infrastructures agroécologiques (IAE)', label_en: 'Ecological focus areas', unit: '% SAU', red: 0, green: 15, why_fr: 'Haies, bandes enherbées, mares : habitats et corridors écologiques.' },
  { code: 'eiq', category: 'Biodiversité', label_fr: 'EIQ (écotoxicité des produits)', label_en: 'EIQ (product ecotoxicity)', unit: 'EIQ/ha', red: 150, green: 0, why_fr: 'Écotoxicité des produits utilisés.' },
  { code: 'ift_herbicide', category: 'Biodiversité', label_fr: 'IFT herbicide', label_en: 'Herbicide IFT', unit: 'IFT' }, { code: 'ift_non_herbicide', category: 'Biodiversité', label_fr: 'IFT hors herbicide', label_en: 'Non-herbicide IFT', unit: 'IFT' }, { code: 'ift_biocontrol', category: 'Biodiversité', label_fr: 'IFT biocontrôle', label_en: 'Biocontrol IFT', unit: 'IFT' },
  { code: 'phosphorus', category: 'Pression sur les ressources', label_fr: 'Phosphore', label_en: 'Phosphorus', unit: 'kg P₂O₅/ha', red: 60, green: 0, why_fr: 'L’excès de phosphore provoque l’eutrophisation des milieux aquatiques.' },
  { code: 'organic_n_share', category: 'Pression sur les ressources', label_fr: 'Part d’azote organique', label_en: 'Organic nitrogen share', unit: '%' },
  { code: 'protein_potential', category: 'Potentiel nourricier', label_fr: 'Potentiel nourricier (protéines)', label_en: 'Food potential (protein)', unit: 'pers./ha/an' },
];

/** GC lever families (brief 4.5). Livestock levers take their family from the group header (L1…L12). */
const GC_FAMILIES: [RegExp, string, 'avoidance' | 'storage'][] = [
  [/legumineuses|prairies temporaires|biomasse des couverts|cultures intermediaires/, 'Rotation & couverts', 'storage'],
  [/energie|sechage|humidite/, 'Énergie', 'avoidance'],
  [/passages des engins|residus de culture/, 'Sol', 'avoidance'],
  [/./, 'Fertilisation', 'avoidance'],
];
export function gcLeverFamily(nameNorm: string): { family: string; type: 'avoidance' | 'storage' } {
  for (const [re, family, type] of GC_FAMILIES) if (re.test(nameNorm)) return { family, type: /residus|engrais organique/.test(nameNorm) ? 'storage' : type };
  return { family: 'Fertilisation', type: 'avoidance' };
}

export const LBC_STATUSES = ['Diags en cours', 'En instruction', 'Labellisé', 'Sold Out', 'Désengagé'] as const;
/** Explicit mapping of statuses seen in other files (current Leaflet map uses "En construction"). Open point 8. */
export const STATUS_ALIASES: Record<string, string> = { 'en construction': 'Diags en cours', 'labellise': 'Labellisé', 'sold out': 'Sold Out', 'desengage': 'Désengagé', 'en instruction': 'En instruction', 'diags en cours': 'Diags en cours' };

export const REGIONS: Record<string, string> = {
  'ile de france': 'Île-de-France', 'centre val de loire': 'Centre-Val de Loire', 'hauts de france': 'Hauts-de-France',
  'bourgogne franche comte': 'Bourgogne-Franche-Comté', 'grand est': 'Grand Est', 'pays de la loire': 'Pays de la Loire',
  'normandie': 'Normandie', 'bretagne': 'Bretagne', 'auvergne rhone alpes': 'Auvergne-Rhône-Alpes',
  'nouvelle aquitaine': 'Nouvelle-Aquitaine', 'occitanie': 'Occitanie', "provence alpes cote d'azur": "Provence-Alpes-Côte d'Azur", 'corse': 'Corse',
};

/** département → région (metropolitan France) */
const R: [string, string][] = [['Auvergne-Rhône-Alpes', '01 03 07 15 26 38 42 43 63 69 73 74'], ['Bourgogne-Franche-Comté', '21 25 39 58 70 71 89 90'], ['Bretagne', '22 29 35 56'], ['Centre-Val de Loire', '18 28 36 37 41 45'], ['Corse', '2A 2B'], ['Grand Est', '08 10 51 52 54 55 57 67 68 88'], ['Hauts-de-France', '02 59 60 62 80'], ['Île-de-France', '75 77 78 91 92 93 94 95'], ['Normandie', '14 27 50 61 76'], ['Nouvelle-Aquitaine', '16 17 19 23 24 33 40 47 64 79 86 87'], ['Occitanie', '09 11 12 30 31 32 34 46 48 65 66 81 82'], ['Pays de la Loire', '44 49 53 72 85'], ["Provence-Alpes-Côte d'Azur", '04 05 06 13 83 84']];
export const DEPT_REGION: Record<string, string> = Object.fromEntries(R.flatMap(([r, ds]) => ds.split(' ').map(d => [d, r])));

export const norm = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’`]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();
export const slugify = (s: string) => norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
