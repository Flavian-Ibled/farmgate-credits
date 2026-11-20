// Reader for the team's "Sélection Carbone Farmers" workbook: tab "Sélection SG" (one row per farm, header on row 2) and
// tab "Paramètres Biodiv" (thresholds, weights, per-farm contributions, raw and displayed scores).
// Used (1) as the test oracle of the Biodiversité score and (2) to import the indicators that the Data Master does not hold.
import ExcelJS from 'exceljs';
import { norm } from '../shared/catalogue.ts';

const val = (c: ExcelJS.Cell): any => { let x: any = c.value; if (x && typeof x === 'object') { if ('result' in x) x = x.result; else if ('richText' in x) x = x.richText.map((t: any) => t.text).join(''); else if ('formula' in x || 'sharedFormula' in x) x = null; else if ('error' in x) x = null; } return x === '' ? null : x; };
const N = (x: any) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
/** workbook header (normalised) → [score key, state]. Evolutions are recomputed from the two states, never read. */
export const SEL_COLUMNS: Record<string, [string, 'initial' | 'prospectif']> = Object.fromEntries(([
  ['Lixiviation initiale (kgN/ha/an)', 'nitrate_leaching', 'initial'], ['Lixiviation prospective (kgN/ha/an)', 'nitrate_leaching', 'prospectif'],
  ['Irrigation initiale (mm/ha/an)', 'irrigated_volume', 'initial'], ['Irrigation prospective (mm/ha/an)', 'irrigated_volume', 'prospectif'],
  ['NH₃ - Ammoniac (kg N-NH₃/ha/an) initial', 'ammonia', 'initial'], ['NH₃ (kg N-NH₃/ha/an) prospectif', 'ammonia', 'prospectif'],
  ['Couverts initial (% SAU)', 'cover_share', 'initial'], ['Couverts prospectif (% SAU)', 'cover_share', 'prospectif'], ['Facteur érosion initial', 'erosion', 'initial'], ['Facteur érosion prospectif', 'erosion', 'prospectif'],
  ['Sans labour (% surface) initial', 'no_till', 'initial'], ['Sans labour (% surface) prospectif', 'no_till', 'prospectif'], ['Profondeur travail (cm) initial', 'tillage_depth', 'initial'], ['Profondeur travail (cm) prospectif', 'tillage_depth', 'prospectif'],
  ['C humifié (t C/ha/an) initial', 'humified_c', 'initial'], ['C humifié (t C/ha/an) prospectif', 'humified_c', 'prospectif'], ['MO (%) initial', 'organic_matter', 'initial'], ['MO (%) prospectif', 'organic_matter', 'prospectif'],
  ['IFT initial', 'ift_total', 'initial'], ['IFT prospectif', 'ift_total', 'prospectif'], ['Indice de Simpson initial', 'simpson', 'initial'], ['Indice de Simpson prospectif', 'simpson', 'prospectif'],
  ['Nb de cultures initial', 'crops_count', 'initial'], ['Nb de cultures prospectif', 'crops_count', 'prospectif'], ['P (kg P₂O₅/ha) initial', 'phosphorus', 'initial'], ['P (kg P₂O₅/ha) prospectif', 'phosphorus', 'prospectif'],
  ['Part N organique (%) initial', 'organic_n_share', 'initial'], ['Part N organique (%) prospectif', 'organic_n_share', 'prospectif'], ['Potentiel protéique (pers/ha/an) initial', 'protein_potential', 'initial'], ['Potentiel protéique (pers/ha/an) prospectif', 'protein_potential', 'prospectif'],
  // measured once (campaign of measure): stored as the initial state
  ['Durée de couverture du sol (j/an)', 'cover_duration', 'initial'], ['Taux de couverture du sol (%)', 'soil_cover_rate', 'initial'], ['Part de couvert (%)', 'cover_share_measured', 'initial'], ['IAE (% SAU)', 'iae', 'initial'],
  ['IFT herbicide', 'ift_herbicide', 'initial'], ['IFT hors herbicide', 'ift_non_herbicide', 'initial'], ['IFT biocontrôle', 'ift_biocontrol', 'initial'], ['EIQ/ha', 'eiq', 'initial'],
] as [string, string, 'initial' | 'prospectif'][]).map(([h, k, s]) => [norm(h), [k, s]]));
const BIO_LEVER_HEADERS = ['introduire des legumineuses', 'restituer les residus de culture', "augmenter l'apport en engrais organique", 'inserer / allonger les prairies temporaires', 'augmenter la biomasse des couverts'];

export interface SelFarm { id: string; ind: Record<string, { initial?: number | null; prospectif?: number | null }>; bio_levers: number; sheet_bio: number | null; sheet_eau: number | null; row: Record<string, any> }
export interface SelParam { basis: 'initial' | 'evolution'; label: string; t0: number; t100: number; weight: number; source: string; contributions: Record<string, number | null> }
export async function readSelectionWorkbook(buf: Buffer | ArrayBuffer) {
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf as any);
  const ws = wb.worksheets.find(w => /^s[ée]lection/i.test(w.name)); if (!ws) throw new Error('Onglet « Sélection … » introuvable');
  let hr = 0; for (let r = 1; r <= 6 && !hr; r++) for (let c = 1; c <= 3; c++) if (norm(val(ws.getRow(r).getCell(c))) === 'id ferme') hr = r; if (!hr) throw new Error('En-tête « ID Ferme » introuvable');
  const heads: string[] = []; for (let c = 1; c <= ws.columnCount; c++) heads[c] = norm(val(ws.getRow(hr).getCell(c)));
  const farms: SelFarm[] = []; const unknown = heads.filter((h, c) => c > 11 && h && !SEL_COLUMNS[h] && !/^evolution|azote evite|eau economisee|consommation d'eau|rabais|credits|evitement|sequestration|volume|energie|potentiel calorique|campagne/.test(h) && !ws.getRow(hr - 1 || 1).getCell(c).text.startsWith('Leviers'));
  for (let r = hr + 1; r <= ws.rowCount; r++) {
    const id = String(val(ws.getRow(r).getCell(1)) ?? '').trim(); if (!/^[A-Z][A-Z0-9]{1,5}-\d{2,4}$/.test(id)) continue;
    const f: SelFarm = { id, ind: {}, bio_levers: 0, sheet_bio: null, sheet_eau: null, row: {} };
    for (let c = 2; c <= ws.columnCount; c++) { const h = heads[c]; if (!h) continue; const x = val(ws.getRow(r).getCell(c)); f.row[h] = x;
      if (SEL_COLUMNS[h]) { const [k, s] = SEL_COLUMNS[h]; (f.ind[k] ??= {})[s] = N(x); }
      else if (h === 'score biodiversite /100') f.sheet_bio = N(x); else if (h === 'score eau /100') f.sheet_eau = N(x);
      else if (BIO_LEVER_HEADERS.some(b => h.startsWith(b)) && x != null && String(x).trim()) f.bio_levers++; }
    farms.push(f);
  }
  const pw = wb.worksheets.find(w => /param.*biodiv/i.test(w.name)); const params: SelParam[] = []; let raw: Record<string, number | null> = {}, shown: Record<string, number | null> = {}, floor: number | null = null, ceiling: number | null = null;
  if (pw) {
    let h3 = 0; for (let r = 1; r <= 8 && !h3; r++) if (/^valeur donnant 0/i.test(String(val(pw.getRow(r).getCell(3)) ?? ''))) h3 = r;
    const ids: [number, string][] = []; for (let c = 8; c <= pw.columnCount; c++) { const x = String(val(pw.getRow(h3).getCell(c)) ?? ''); if (/^[A-Z][A-Z0-9]{1,5}-\d/.test(x)) ids.push([c, x]); }
    const line = (r: number) => Object.fromEntries(ids.map(([c, id]) => [id, N(val(pw.getRow(r).getCell(c)))]));
    for (let r = h3 + 1; r <= pw.rowCount; r++) { const a = String(val(pw.getRow(r).getCell(1)) ?? ''), t0 = N(val(pw.getRow(r).getCell(3))), t100 = N(val(pw.getRow(r).getCell(4))), w = N(val(pw.getRow(r).getCell(5)));
      if (/^score brut/i.test(a)) raw = line(r); else if (/^score affich/i.test(a)) shown = line(r); else if (/^plancher/i.test(a)) floor = t0; else if (/^plafond/i.test(a)) ceiling = t0;
      else if (t0 != null && t100 != null && w != null && /^(état|etat|évolution|evolution)/i.test(a)) params.push({ basis: /^[ée]tat/i.test(a) ? 'initial' : 'evolution', label: String(val(pw.getRow(r).getCell(2)) ?? ''), t0, t100, weight: w, source: String(val(pw.getRow(r).getCell(7)) ?? ''), contributions: line(r) }); }
  }
  return { farms, params, raw, shown, floor, ceiling, unknown_columns: unknown };
}
