// Excel outputs: per-project data sheet (re-importable, with its data dictionary), import report, selection export.
import ExcelJS from 'exceljs';
import type { Q } from './db.ts';
import { MASTER_INDICATORS, LBC_STATUSES } from '../shared/catalogue.ts';
import type { SelectionResult, FarmFacts } from '../shared/aggregate.ts';

interface TCol { field: string; group?: string; unit?: string; label: string; help: string; required?: boolean; allowed?: string }
const C = 'Données Carbone';
const CORE: TCol[] = [
  { field: 'id', label: 'id', help: 'Identifiant stable de la ferme (clé de l’import). Ne jamais le modifier.', required: true },
  { field: 'name', label: 'Nom de la ferme', help: 'Raison sociale (donnée privée, jamais publiée sans consentement)' },
  { field: 'address', label: 'Adresse', help: 'Adresse (privée)' }, { field: 'commune', label: 'Ville', help: 'Commune (privée)' },
  { field: 'postal_code', label: 'Code postal', help: 'Sert à déduire le département' }, { field: 'region', label: 'Région', help: 'Région administrative' },
  { field: 'siret', label: 'SIRET', help: '14 chiffres (privé)' }, { field: 'legal_status', label: 'Statut', help: 'Forme juridique (EARL, GAEC, SCEA…)' },
  { field: 'farmer', label: 'Farmer', help: 'Nom de l’agriculteur (privé)' }, { field: 'sau', unit: 'ha', label: 'SAU', help: 'Surface agricole utile, > 0' },
  { field: 'lat', label: 'Latitude', help: 'Degrés décimaux, en France (floutée côté public)' }, { field: 'lng', label: 'Longitude', help: 'Degrés décimaux' },
  { field: 'project', label: 'Projet', help: 'Nom exact du projet collectif', required: true }, { field: 'typology', label: 'Typologie', help: 'Type d’exploitation', allowed: 'Grandes cultures | Élevage bovins' },
  { field: 'reference_period', label: 'Dates scénario référence', help: 'ex. 21/22/23' }, { field: 'project_period', label: 'Dates projet', help: 'ex. 01/09/2024 - 01/09/2029' },
  { field: 'lbc_status', label: 'Statut LBC', help: 'Statut Label Bas Carbone. Une ferme sortie du projet passe en « Désengagé » (ne pas supprimer la ligne).', allowed: LBC_STATUSES.join(' | ') },
  { field: 'diagnostic_referent', label: 'Référent Carbone Farmers (qui a fait les diags)', help: 'Agronome référent' },
  { field: 'last_diag_date', label: 'Date du dernier diagnostic', help: 'JJ/MM/AAAA — date du dernier diagnostic (initial ou suivi)' },
  { field: 'verified_at', label: 'Date de vérification', help: 'JJ/MM/AAAA — date de vérification des données à la ferme par le chef de projet' },
  { field: 'verified_by', label: 'Vérifié par', help: 'Agronome ayant vérifié les données' },
  { field: 'em_init_ha', group: C, unit: 'tCO2e/ha', label: 'Émissions initiales', help: 'Scénario de référence' }, { field: 'em_target_ha', group: C, unit: 'tCO2e/ha', label: 'Objectif émissions à 5 ans', help: 'Scénario prospectif' },
  { field: 'st_init_ha', group: C, unit: 'tCO2e/ha', label: 'Stockage initial', help: 'Scénario de référence' }, { field: 'st_target_ha', group: C, unit: 'tCO2e/ha', label: 'Objectif Stockage à 5 ans', help: 'Scénario prospectif' },
  { field: 'rabais', group: C, unit: '%', label: 'Rabais', help: 'Rabais appliqué (nombre entre 0 et 1, ou texte)' },
  { field: 're_evit_ha', group: C, unit: 'tCO2e/ha', label: 'RE évitement / ha (sur 5 ans)', help: '' }, { field: 're_evit_total', group: C, unit: 'tCO2e', label: 'RE évitement totales (sur 5 ans)', help: '' },
  { field: 're_stock_ha', group: C, unit: 'tCO2e/ha', label: 'RE Stockage / ha (sur 5 ans)', help: '' }, { field: 're_stock_total', group: C, unit: 'tCO2e', label: 'RE Stockage totales (sur 5 ans)', help: '' },
  { field: 're_total_ha', group: C, unit: 'tCO2e/ha', label: 'RE totales / ha (sur 5 ans)', help: '' }, { field: 're_total_ha_yr', group: C, unit: 'tCO2e/ha/an', label: 'RE totales / ha /an', help: '' },
  { field: 're_labelled', group: C, unit: 'tCO2e', label: 'RE totales labellisées (sur 5 ans)', help: 'Volume labellisé net après rabais : valeur de référence affichée par défaut' },
  { field: 'vol_filieres', group: C, unit: 'tCO2e', label: 'Volume valorisé en filières', help: '' }, { field: 'vol_vendable', group: C, unit: 'tCO2e', label: 'Volume vendable', help: '' },
  { field: 'vol_vendu', group: C, unit: 'tCO2e', label: 'Volume Vendu', help: '≤ volume labellisé' }, { field: 'vol_dispo', group: C, unit: 'tCO2e', label: 'Volume Disponible', help: '' },
];
const GROUPS: Record<string, string> = { Eau: 'Co-bénefices EAU', Sol: 'Co-bénéfices sol', Air: 'Co-bénéfice air', 'Biodiversité': 'Co-bénéfice biodiversité', 'Pression sur les ressources': 'Co-bénéfice Energie non renouvelable', 'Potentiel nourricier': 'Potentiel Nourricier' };
// labels are written so that the importer recognises them (see MASTER_INDICATORS[].match)
const IND_LABEL: Record<string, string> = { nitrate_leaching: 'Lixiviation des nitrates', water_consumption: "Consommation d'eau", irrigated_volume: "Volume d'eau irrigué", untreated_share: 'Part de surface non-traitée par des phytosanitaires', treatments_count: 'Nombre de traitements phytosanitaires', erosion: 'Erosion des sols', cover_share: 'Part des surfaces avec couvert végétal', cover_area: 'Surface de sols couverts', organic_matter: 'Pourcentage de matière organique (MO) dans les sols', tillage_depth: 'Profondeur moyenne de travail du sol', ammonia: "Émissions d'ammoniac", ift_total: 'IFT', cover_species: "Nombre d'espèces en couvert", non_renewable_energy: "Consommation d'éngerie non renouvelable", food_potential: 'Potentiel Nourricier' };

function columns(levers: { code: string; family: string; name_fr: string; scope: string }[]): TCol[] {
  const ind: TCol[] = MASTER_INDICATORS.flatMap(d => (['initial', 'prospectif'] as const).map(s => ({ field: `ind:${d.code}:${s}`, group: GROUPS[d.category] ?? d.category, unit: d.unit === 'part de SAU' ? '%' : d.unit.replace('m³', 'm3'), label: `${IND_LABEL[d.code]} (${s})`, help: `${d.label_fr} — scénario ${s}${d.unit === 'part de SAU' ? ' (fraction entre 0 et 1)' : ''}` })));
  const lev: TCol[] = levers.map(l => ({ field: `lever:${l.code}`, group: l.scope === 'GC' ? 'Leviers activés par exploitation' : l.family, unit: 'VRAI/FAUX', label: l.name_fr, help: 'Levier activé sur la ferme', allowed: 'VRAI | FAUX' }));
  return [...CORE, ...ind, ...lev];
}
const NAVY = 'FF1E4414';
function style(ws: ExcelJS.Worksheet, headerRows: number) {
  for (let r = 1; r <= headerRows; r++) ws.getRow(r).eachCell(c => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } }; c.alignment = { wrapText: true, vertical: 'middle' }; });
  ws.views = [{ state: 'frozen', xSplit: 1, ySplit: headerRows }]; ws.columns.forEach(c => { c.width = 18; });
}

/** One re-importable data sheet per project (or "Master List" for everything) + its data dictionary. `q` must run under an admin RLS context. */
export async function projectWorkbook(q: Q, projectId: number | null) {
  const levers = (await q.query(`select code,family,name_fr,scope from levers order by sort`)).rows;
  const proj = projectId ? (await q.query(`select name,slug from projects where id=$1`, [projectId])).rows[0] : null;
  if (projectId && !proj) throw new Error('Projet introuvable');
  const rows = (await q.query(`select p.farm_id, p.imported from farm_private p join farms f on f.id=p.farm_id where ($1::int is null or f.project_id=$1) order by p.farm_id`, [projectId])).rows;
  const cols = columns(levers as any); const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(proj ? proj.slug.slice(0, 31) : 'Master List');
  ws.addRow(cols.map(c => c.group ?? null)); ws.addRow(cols.map(c => c.unit ?? null)); ws.addRow(cols.map(c => c.label));
  for (const r of rows) ws.addRow(cols.map(c => (c.field === 'id' ? r.farm_id : r.imported[c.field] ?? null)));
  style(ws, 3);
  const d = wb.addWorksheet('Dictionnaire');
  d.addRow(['Colonne', 'Groupe', 'Unité', 'Signification', 'Valeurs autorisées', 'Obligatoire']);
  for (const c of cols) d.addRow([c.label, c.group ?? '', c.unit ?? '', c.help, c.allowed ?? '', c.required ? 'oui' : 'non']);
  d.addRow([]); d.addRow(['Règles : la clé est la colonne « id ». Une cellule vide efface la valeur ; une colonne supprimée du fichier laisse la valeur en place. Une ferme retirée du fichier n’est jamais supprimée : elle est signalée « absente ». Pour une ferme sortie du projet, mettre le Statut LBC à « Désengagé ».']);
  style(d, 1); d.getColumn(1).width = 50; d.getColumn(4).width = 70; d.getColumn(5).width = 40;
  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), filename: `farmgate_${proj ? proj.slug : 'master-list'}_${new Date().toISOString().slice(0, 10)}.xlsx`, farms: rows.length };
}

export async function issuesWorkbook(issues: any[]) {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Rapport');
  ws.addRow(['Niveau', 'Code', 'Feuille', 'Ligne', 'Ferme', 'Colonne', 'Message']);
  for (const i of issues) ws.addRow([i.level, i.code, i.sheet, i.row ?? null, i.farm_id ?? null, i.column ?? null, i.message]);
  style(ws, 1); ws.getColumn(7).width = 90; ws.autoFilter = 'A1:G1';
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Selection export: aggregate sheets + farm-level rows limited to PUBLIC, non-identifying fields. */
export async function selectionWorkbook(sel: SelectionResult, farms: FarmFacts[], meta: { indicators: any[]; levers: any[]; filters: unknown }) {
  const wb = new ExcelJS.Workbook(); const c = sel.carbon;
  const s = wb.addWorksheet('Synthèse'); s.addRow(['Indicateur', 'Valeur', 'Unité', 'Fermes avec donnée', 'Statut']);
  const rows: any[][] = [
    ['Fermes', sel.scale.farms, 'nb', sel.scale.farms, ''], ['SAU', sel.scale.sau, 'ha', sel.scale.n_with_sau, ''],
    ['RE totales labellisées (5 ans)', c.re_labelled_5y, 'tCO2e', c.n_with_labelled, 'Estimé — sous réserve du suivi annuel et de l’audit'],
    ['RE évitement (5 ans)', c.n_with_split ? c.re_avoidance_5y : null, 'tCO2e', c.n_with_split, 'Estimé'], ['RE stockage (5 ans)', c.n_with_split ? c.re_storage_5y : null, 'tCO2e', c.n_with_split, 'Estimé'],
    ['Émissions initiales', c.em_init_ha.value, 'tCO2e/ha', c.em_init_ha.n_with_data, 'Moyenne pondérée SAU'], ['Objectif émissions à 5 ans', c.em_target_ha.value, 'tCO2e/ha', c.em_target_ha.n_with_data, 'Moyenne pondérée SAU'],
    ['Stockage initial', c.st_init_ha.value, 'tCO2e/ha', c.st_init_ha.n_with_data, 'Moyenne pondérée SAU'], ['Objectif stockage à 5 ans', c.st_target_ha.value, 'tCO2e/ha', c.st_target_ha.n_with_data, 'Moyenne pondérée SAU'],
    ['Volume vendu', c.vol_vendu, 'tCO2e', '', ''], ['Volume disponible', c.vol_dispo, 'tCO2e', '', ''],
    ['Mesuré au suivi R25', c.followup_r25.farms_followed ? c.followup_r25.measured : null, 'tCO2e', c.followup_r25.farms_followed, 'Mesuré'],
  ]; rows.forEach(r => s.addRow(r)); s.addRow([]); s.addRow(['Filtres', JSON.stringify(meta.filters)]); s.addRow(['Export du', new Date().toISOString().slice(0, 10)]); style(s, 1); s.getColumn(1).width = 34; s.getColumn(5).width = 48;
  const cb = wb.addWorksheet('Co-bénéfices'); cb.addRow(['Catégorie', 'Indicateur', 'Unité', 'Initial', 'Prospectif (5 ans)', 'Évolution', 'Fermes avec donnée', 'Fermes concernées']);
  const byCode = new Map(sel.cobenefits.map(x => [x.code, x]));
  for (const d of meta.indicators) { const x = byCode.get(d.code)!; cb.addRow([d.category, d.label_fr, d.unit, x.collected ? x.initial : 'pas encore collecté', x.prospectif, x.evolution_prospectif, x.n_with_data, x.n_applicable]); }
  style(cb, 1); cb.getColumn(2).width = 44; cb.getColumn(6).numFmt = '0.0%';
  const lv = wb.addWorksheet('Leviers'); lv.addRow(['Famille', 'Levier', 'Fermes', '% des fermes', 'ha', '% des ha', `Base : ${sel.levers.n_with_data} fermes avec données leviers`]);
  const li = new Map(sel.levers.items.map(x => [x.code, x])); for (const l of meta.levers) { const x = li.get(l.code)!; lv.addRow([l.family, l.name_fr, x.farms, x.share_farms, x.sau, x.share_sau]); }
  style(lv, 1); lv.getColumn(2).width = 60; lv.getColumn(4).numFmt = '0%'; lv.getColumn(6).numFmt = '0%';
  const f = wb.addWorksheet('Fermes'); f.addRow(['id', 'Projet', 'Région', 'Département', 'Typologie', 'Statut LBC', 'SAU (ha)', 'RE labellisées (tCO2e, 5 ans)', 'Volume disponible (tCO2e)', 'Mesuré R25 (tCO2e)']);
  for (const x of farms) f.addRow([x.id, x.project, x.region, x.departement, x.typology, x.lbc_status, x.sau == null ? null : Math.round(x.sau), x.re_labelled == null ? null : Math.round(x.re_labelled), x.vol_dispo == null ? null : Math.round(x.vol_dispo), x.re_measured_r25 == null ? null : Math.round(x.re_measured_r25)]);
  style(f, 1); f.getColumn(2).width = 44;
  return Buffer.from(await wb.xlsx.writeBuffer());
}
