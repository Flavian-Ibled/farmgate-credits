// Data Master parser: columns are mapped by HEADER NAME (never by position); the header is 3 rows (group / unit / label).
import ExcelJS from 'exceljs';
import { MASTER_INDICATORS, gcLeverFamily, norm, slugify, REGIONS, STATUS_ALIASES, LBC_STATUSES } from '../../shared/catalogue.ts';

export type Val = string | number | boolean | null;
export interface Issue { level: 'error' | 'warning' | 'info'; code: string; sheet: string; row?: number; farm_id?: string; column?: string; message: string }
export interface LeverDef { code: string; family: string; name_fr: string; type: 'avoidance' | 'storage'; scope: 'GC' | 'EL'; sort: number }
export interface ParsedFarm { id: string; row: number; rec: Record<string, Val> }
export interface Parsed { scope: 'full' | 'project'; main_sheet: string; projects: string[]; farms: ParsedFarm[]; levers: LeverDef[]; porteurs: Record<string, string>; issues: Issue[]; stats: Record<string, any> }

const TEXT: Record<string, string> = {
  'nom de la ferme': 'name', 'adresse': 'address', 'ville': 'commune', 'code postal': 'postal_code', 'region': 'region', 'siret': 'siret',
  'statut': 'legal_status', 'farmer': 'farmer', 'projet': 'project', 'typologie': 'typology', 'productions': 'productions',
  'dates scenario reference': 'reference_period', 'dates projet': 'project_period', 'statut lbc': 'lbc_status', 'porteur': 'porteur',
  'date du dernier diagnostic': 'last_diag_date', 'date de verification': 'verified_at', 'verifie par': 'verified_by',
};
const NUM: Record<string, string> = {
  'sau': 'sau', 'latitude': 'lat', 'longitude': 'lng',
  'emissions initiales': 'em_init_ha', 'objectif emissions a 5 ans': 'em_target_ha', 'stockage initial': 'st_init_ha', 'objectif stockage a 5 ans': 'st_target_ha',
  're evitement / ha (sur 5 ans)': 're_evit_ha', 're evitement totales (sur 5 ans)': 're_evit_total',
  're stockage / ha (sur 5 ans)': 're_stock_ha', 're stockage totales (sur 5 ans)': 're_stock_total',
  're totales / ha (sur 5 ans)': 're_total_ha', 're totales / ha /an': 're_total_ha_yr', 're totales labellisees (sur 5 ans)': 're_labelled',
  'volume valorise en filieres': 'vol_filieres', 'volume vendable': 'vol_vendable', 'volume vendu': 'vol_vendu', 'volume disponible': 'vol_dispo',
};
// follow-up columns of project sheets (the project sheet wins over the Master List for these)
const FOLLOWUP: Record<string, string> = { 're evitement annee de suivi 1': 're_avoidance', 're stockage annee de suivi 1': 're_storage', 'emissions annee 1': 'emissions', 'stockage annee 1': 'storage' };
/** harvest year of "année de suivi 1" per project sheet */
export const FOLLOWUP_SHEETS: Record<string, number> = { CVL2: 2025 };
export const PRIVATE_FIELDS = ['name', 'farmer', 'address', 'commune', 'postal_code', 'siret', 'legal_status', 'lat', 'lng', 'diagnostic_referent'];

type Raw = { v: unknown; kind: 'empty' | 'value' | 'error' | 'formula_no_cache' };
function raw(cell: ExcelJS.Cell): Raw {
  let x: any = cell.value;
  if (x == null || x === '') return { v: null, kind: 'empty' };
  if (x instanceof Date) return { v: x.toISOString().slice(0, 10), kind: 'value' };
  if (typeof x === 'object') {
    if ('error' in x) return { v: x.error, kind: 'error' };
    if ('richText' in x) return { v: x.richText.map((t: any) => t.text).join(''), kind: 'value' };
    if ('formula' in x || 'sharedFormula' in x) {
      const r = x.result;
      if (r == null) return { v: null, kind: 'formula_no_cache' };
      if (typeof r === 'object' && 'error' in r) return { v: r.error, kind: 'error' };
      return { v: r instanceof Date ? r.toISOString().slice(0, 10) : r, kind: 'value' };
    }
    if ('text' in x) return { v: x.text, kind: 'value' };
    return { v: null, kind: 'empty' };
  }
  return { v: x, kind: 'value' };
}
/** Accepts French decimals ("12,5"), thin spaces and percentages ("45 %" → 0.45). Returns undefined when not numeric. */
export function toNumber(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v !== 'string') return undefined;
  const s = v.replace(/[\s  ]/g, '');
  const m = /^([+-]?\d+(?:[.,]\d+)?)(%?)$/.exec(s);
  if (!m) return undefined;
  const n = Number(m[1].replace(',', '.'));
  return m[2] ? n / 100 : n;
}
/** ISO date from an Excel date, "2025-03-12" or the French "12/03/2025". Anything else → null. */
export function toIsoDate(v: unknown): string | null {
  const s = v == null ? '' : String(v).trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})$/.exec(s); if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}
const text = (v: unknown) => (v == null ? null : String(v).replace(/\s+/g, ' ').trim() || null);

interface Col { idx: number; group: string; unit: string; label: string; field?: string; type?: 'text' | 'num' | 'bool' }

function readHeader(ws: ExcelJS.Worksheet) {
  for (let r = 1; r <= Math.min(8, ws.rowCount); r++) {
    for (let c = 1; c <= ws.columnCount; c++) {
      if (norm(raw(ws.getRow(r).getCell(c)).v) === 'id') return { headerRow: r, idCol: c };
    }
  }
  return null;
}

function mapColumns(ws: ExcelJS.Worksheet, headerRow: number, levers: LeverDef[] | null, followupYear?: number): Col[] {
  const cols: Col[] = []; const used = new Set<string>();
  for (let c = 1; c <= ws.columnCount; c++) {
    const g = (r: number) => (r >= 1 ? norm(raw(ws.getRow(r).getCell(c)).v) : '');
    const col: Col = { idx: c, group: g(headerRow - 2), unit: g(headerRow - 1), label: g(headerRow) };
    const rawLabel = text(raw(ws.getRow(headerRow).getCell(c)).v) ?? '';
    const L = col.label;
    if (!L) continue;
    const set = (field: string, type: Col['type']) => { if (!used.has(field)) { used.add(field); col.field = field; col.type = type; } };
    if (L === 'id') set('id', 'text');
    else if (TEXT[L]) set(TEXT[L], 'text');
    else if (L.startsWith('referent carbone farmers')) set('diagnostic_referent', 'text');
    else if (L === 'rabais') set('rabais', 'text');
    else if (NUM[L] && (!/objectif|initial/.test(L) || col.unit.startsWith('tco2e/ha'))) set(NUM[L], 'num');
    else if (L.startsWith('emissions initiales / ha') && col.unit.startsWith('tco2e/ha')) set('em_init_ha', 'num');
    else if (L === 'stockage initial/ha') set('st_init_ha', 'num');
    else if (followupYear && FOLLOWUP[L]) set(`fu:${followupYear}:${FOLLOWUP[L]}`, 'num');
    else if (col.unit === 'vrai/faux' && levers) {
      const code = slugify(rawLabel).slice(0, 60);
      const gc = col.group.startsWith('leviers actives');
      const fam = gc ? gcLeverFamily(L) : { family: (text(raw(ws.getRow(headerRow - 2).getCell(c)).v) ?? 'Élevage'), type: /stockage/.test(col.group) ? 'storage' as const : 'avoidance' as const };
      if (!levers.some(l => l.code === code)) levers.push({ code, family: fam.family, name_fr: rawLabel, type: fam.type, scope: gc ? 'GC' : 'EL', sort: levers.length });
      set(`lever:${code}`, 'bool');
    } else if (!L.startsWith('evolution')) {
      const state = /initial/.test(L) ? 'initial' : /prospec/.test(L) ? 'prospectif' : null;
      const def = state && MASTER_INDICATORS.find(d => (d.code === 'ift_total' ? L.startsWith('ift') : L.includes(d.match)) && (!d.matchUnit || col.unit.includes(d.matchUnit)));
      if (def && state) set(`ind:${def.code}:${state}`, 'num');
    }
    cols.push(col);
  }
  return cols;
}

function readRows(ws: ExcelJS.Worksheet, cols: Col[], headerRow: number, issues: Issue[], opts: { reportCells: boolean }) {
  const out: ParsedFarm[] = []; const mapped = cols.filter(c => c.field);
  const idCol = mapped.find(c => c.field === 'id')!;
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const id = text(raw(row.getCell(idCol.idx)).v);
    const rec: Record<string, Val> = {}; let filled = 0;
    for (const c of mapped) {
      if (c.field === 'id') continue;
      const x = raw(row.getCell(c.idx));
      const issue = (code: string, message: string, level: Issue['level'] = 'warning') => { if (opts.reportCells && id) issues.push({ level, code, sheet: ws.name, row: r, farm_id: id, column: c.label, message }); };
      let v: Val = null;
      if (x.kind === 'error') issue('excel_error', `Erreur Excel ${x.v} → valeur ignorée (null)`);
      else if (x.kind === 'formula_no_cache') issue('formula_without_value', 'Formule sans valeur enregistrée → null', 'info');
      else if (x.kind === 'value') {
        if (c.type === 'num') { const n = toNumber(x.v); if (n === undefined) issue('text_in_numeric', `Texte « ${String(x.v).slice(0, 30)} » dans une colonne numérique → null`); else v = n; }
        else if (c.type === 'bool') { v = typeof x.v === 'boolean' ? x.v : /^(vrai|true|oui|1)$/i.test(String(x.v)) ? true : /^(faux|false|non|0)$/i.test(String(x.v)) ? false : null; }
        else if (c.field === 'rabais') { v = text(x.v); }
        else if (c.field === 'last_diag_date' || c.field === 'verified_at') { v = toIsoDate(x.v); if (v === null) issue('invalid_date', `Date illisible « ${String(x.v).slice(0, 20)} » → null (format attendu JJ/MM/AAAA)`); }
        else v = text(x.v);
      }
      if (v !== null) filled++;
      rec[c.field!] = v;
      if (c.field === 'rabais') rec.rabais_num = toNumber(v) ?? null;
    }
    if (!id) { if (filled >= 3) issues.push({ level: 'error', code: 'row_without_id', sheet: ws.name, row: r, message: `Ligne avec ${filled} valeurs mais sans id : ignorée` }); continue; }
    out.push({ id, row: r, rec });
  }
  return out;
}

export function departementOf(cp: Val): string | null {
  const s = cp == null ? '' : String(cp).replace(/\D/g, '').padStart(5, '0');
  if (s.length !== 5 || s === '00000') return null;
  if (s.startsWith('97') || s.startsWith('98')) return s.slice(0, 3);
  if (s.startsWith('20')) return Number(s) < 20200 ? '2A' : '2B';
  return s.slice(0, 2);
}

/**
 * Full import: workbook with a "Master List" sheet (all farms). Project import: a workbook holding ONE project sheet
 * (same headers), or `opts.sheet` naming the sheet to use. A project import only concerns the farms of its project(s).
 */
export async function parseDataMaster(buf: Buffer | ArrayBuffer, opts: { sheet?: string } = {}): Promise<Parsed> {
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf as any);
  const issues: Issue[] = []; const levers: LeverDef[] = []; const porteurs: Record<string, string> = {}; const stats: Record<string, any> = { sheets: {} };
  const candidates = wb.worksheets.filter(w => w.name !== 'Dictionnaire' && readHeader(w));
  const master = opts.sheet ? wb.getWorksheet(opts.sheet) : wb.getWorksheet('Master List') ?? (candidates.length === 1 ? candidates[0] : undefined);
  if (!master) throw new Error(opts.sheet ? `Feuille « ${opts.sheet} » introuvable` : `Feuille « Master List » introuvable. Pour un import par projet, le fichier doit contenir une seule feuille de données, ou précisez la feuille : ${candidates.map(w => w.name).join(', ')}`);
  const scope: Parsed['scope'] = master.name === 'Master List' ? 'full' : 'project';
  const h = readHeader(master); if (!h) throw new Error(`En-tête « id » introuvable dans ${master.name}`);
  const cols = mapColumns(master, h.headerRow, levers, scope === 'project' ? FOLLOWUP_SHEETS[master.name] : undefined);
  const need = scope === 'full' ? ['id', 'sau', 'lat', 'lng', 'project', 're_labelled', 'lbc_status'] : ['id', 'project'];
  for (const f of need) if (!cols.some(c => c.field === f)) issues.push({ level: 'error', code: 'missing_column', sheet: master.name, message: `Colonne obligatoire introuvable : ${f}` });
  stats.columns_mapped = cols.filter(c => c.field).length; stats.columns_ignored = cols.filter(c => !c.field).map(c => c.label);
  const rows = readRows(master, cols, h.headerRow, issues, { reportCells: true }).filter(f => scope === 'full' || /^[A-Za-z]+[A-Za-z0-9]*-?\d/.test(f.id));

  // duplicates inside the file are an error: never guess which one is right
  const seen = new Map<string, number>(); const farms: ParsedFarm[] = [];
  for (const f of rows) {
    if (seen.has(f.id)) { issues.push({ level: 'error', code: 'duplicate_id', sheet: master.name, row: f.row, farm_id: f.id, message: `Identifiant en double (déjà ligne ${seen.get(f.id)}) : les deux lignes sont exclues de l'import` }); continue; }
    seen.set(f.id, f.row); farms.push(f);
  }
  const dupIds = new Set(issues.filter(i => i.code === 'duplicate_id').map(i => i.farm_id));
  const kept = farms.filter(f => !dupIds.has(f.id));

  for (const f of kept) validateFarm(f, master.name, issues);

  // project sheets: cross-checks, porteur, follow-up columns
  const byId = new Map(kept.map(f => [f.id, f]));
  for (const ws of scope === 'full' ? wb.worksheets : []) {
    if (ws.name === master.name) continue;
    const hh = readHeader(ws); if (!hh) { stats.sheets[ws.name] = { skipped: 'pas de colonne id' }; continue; }
    const fy = FOLLOWUP_SHEETS[ws.name];
    const pc = mapColumns(ws, hh.headerRow, null, fy);
    // project sheets end with summary rows ("Total", "Moyenne", "Évolution moyenne…") in the id column: not farms
    const prow = readRows(ws, pc, hh.headerRow, issues, { reportCells: false }).filter(p => /^[A-Za-z]+[A-Za-z0-9]*-?\d/.test(p.id));
    const unknown = prow.filter(p => !byId.has(p.id));
    for (const p of unknown) issues.push({ level: 'warning', code: 'id_not_in_master', sheet: ws.name, row: p.row, farm_id: p.id, message: 'Identifiant présent dans la feuille projet mais absent de la Master List' });
    const st: any = { farms: prow.length, not_in_master: unknown.length, re_labelled: prow.reduce((s, p) => s + (typeof p.rec.re_labelled === 'number' ? p.rec.re_labelled : 0), 0) };
    for (const p of prow) {
      if (p.rec.porteur && p.rec.project) porteurs[String(p.rec.project)] = String(p.rec.porteur);
      const m = byId.get(p.id);
      if (m && fy) for (const [k, v] of Object.entries(p.rec)) if (k.startsWith('fu:')) m.rec[k] = v;
      // A value missing in the Master List but present in the project sheet is taken from the project sheet (never the reverse),
      // for co-benefit indicators and per-farm carbon figures only. Counted in the report.
      if (m) for (const [k, v] of Object.entries(p.rec)) {
        if (typeof v !== 'number' || m.rec[k] != null || !(k.startsWith('ind:') || /^(em_|st_|re_)/.test(k))) continue;
        if (/^ind:(untreated_share|cover_share):/.test(k) && (v < 0 || v > 1)) continue;
        m.rec[k] = v; st.filled_from_sheet = (st.filled_from_sheet ?? 0) + 1;
      }
    }
    if (st.filled_from_sheet) issues.push({ level: 'info', code: 'filled_from_project_sheet', sheet: ws.name, message: `${st.filled_from_sheet} valeurs absentes de la Master List reprises de la feuille « ${ws.name} »` });
    if (fy) { st.followup_year = fy; st.followed = prow.filter(p => typeof p.rec[`fu:${fy}:re_avoidance`] === 'number' || typeof p.rec[`fu:${fy}:re_storage`] === 'number').length; }
    stats.sheets[ws.name] = st;
  }
  // known gap to show, not hide (brief 7 / open point 1)
  const cvl2 = stats.sheets['CVL2'];
  if (cvl2) {
    const mf = kept.filter(f => norm(f.rec.project).includes('2nd projet collectif'));
    const sheetIds = new Set<string>(); wb.getWorksheet('CVL2')!.eachRow(r => { const v = text(raw(r.getCell(1)).v); if (v) sheetIds.add(v); });
    const orphan = kept.filter(f => sheetIds.has(f.id) && !mf.includes(f)).map(f => f.id);
    if (orphan.length) issues.push({ level: 'warning', code: 'cvl2_gap_cause', sheet: 'Master List', message: `Fermes présentes dans la feuille CVL2 mais sans projet « 2nd projet collectif » dans la Master List : ${orphan.join(', ')}` });
    const mv = mf.reduce((s, f) => s + (typeof f.rec.re_labelled === 'number' ? f.rec.re_labelled : 0), 0);
    stats.cvl2_gap = { master: { farms: mf.length, re_labelled: mv }, sheet: { farms: cvl2.farms, re_labelled: cvl2.re_labelled, followed: cvl2.followed }, project_document: { farms: 112, re_labelled: 68339, followed: 109, source: 'CVL2_trajectoire_projet.pdf (valeur citée dans le brief, fichier non fourni)' } };
    issues.push({ level: 'warning', code: 'cvl2_gap', sheet: 'CVL2', message: `CVL2 : Master List ${mf.length} fermes / ${Math.round(mv)} tCO₂e ; feuille CVL2 ${cvl2.farms} lignes / ${Math.round(cvl2.re_labelled)} tCO₂e, ${cvl2.followed} suivies ; fiche projet 112 fermes / 68 339 tCO₂e / 109 suivies` });
  }
  if (scope === 'project') for (const f of kept) if (f.rec.porteur && f.rec.project) porteurs[String(f.rec.project)] = String(f.rec.porteur);
  const projects = [...new Set(kept.map(f => f.rec.project).filter(Boolean).map(String))];
  return { scope, main_sheet: master.name, projects, farms: kept, levers, porteurs, issues, stats };
}

function validateFarm(f: ParsedFarm, sheet: string, issues: Issue[]) {
  const r = f.rec; const add = (level: Issue['level'], code: string, message: string) => issues.push({ level, code, sheet, row: f.row, farm_id: f.id, message });
  const n = (k: string) => (typeof r[k] === 'number' ? (r[k] as number) : null);
  if (!/^[A-Z][A-Z0-9]{1,5}-\d{2,4}$/.test(f.id)) add('warning', 'id_format', `Format d'identifiant inhabituel : ${f.id}`);
  const has = (k: string) => k in r; // a column absent from a partial (project) file is not "missing data"
  if (!r.project) add('error', 'missing_project', 'Projet manquant');
  // normalise vocabularies
  if (r.region) { const k = norm(r.region).replace(/-/g, ' '); if (REGIONS[k]) r.region = REGIONS[k]; else add('warning', 'unknown_region', `Région inconnue : ${r.region}`); }
  if (r.lbc_status) { const k = norm(r.lbc_status); if (STATUS_ALIASES[k]) { if (k === 'en construction') add('info', 'status_mapped', '« En construction » → « Diags en cours »'); r.lbc_status = STATUS_ALIASES[k]; } else if (!(LBC_STATUSES as readonly string[]).includes(String(r.lbc_status))) { add('error', 'unknown_status', `Statut LBC hors vocabulaire : ${r.lbc_status}`); r.lbc_status = null; } }
  else if (has('lbc_status')) add('warning', 'missing_status', 'Statut LBC manquant');
  if (has('postal_code')) r.departement = departementOf(r.postal_code);
  if (r.siret != null) r.siret = String(r.siret).replace(/\D/g, '') || null;
  let lat = n('lat'), lng = n('lng');
  if (!has('lat') || !has('lng')) { /* column not in file */ }
  else if (lat === null || lng === null) add('warning', 'missing_coordinates', 'Coordonnées manquantes : ferme absente de la carte');
  else {
    const inFr = (a: number, b: number) => a >= 41 && a <= 51.5 && b >= -5.5 && b <= 10;
    if (!inFr(lat, lng)) { if (inFr(lng, lat)) add('error', 'coordinates_swapped', 'Latitude / longitude inversées : coordonnées ignorées'); else add('error', 'coordinates_outside_france', 'Coordonnées hors de France métropolitaine : ignorées'); r.lat = null; r.lng = null; }
  }
  const sau = n('sau'); if (sau === null) { if (has('sau')) add('warning', 'missing_sau', 'SAU manquante'); } else if (sau <= 0) { add('error', 'invalid_sau', `SAU ≤ 0 (${sau}) : ignorée`); r.sau = null; }
  for (const k of Object.keys(r)) if (/^ind:(untreated_share|cover_share):/.test(k)) { const v = n(k); if (v !== null && (v < 0 || v > 1)) { add('warning', 'share_out_of_range', `${k} = ${v} hors de [0 ; 1] → null`); r[k] = null; } }
  const ev = n('re_evit_total'), stv = n('re_stock_total'), lab = n('re_labelled');
  if (ev !== null && stv !== null && lab !== null && Math.abs(ev + stv - lab) > Math.max(1, 0.01 * Math.abs(lab))) add('warning', 'split_mismatch', `Évitement (${ev.toFixed(0)}) + stockage (${stv.toFixed(0)}) ≠ RE labellisées (${lab.toFixed(0)})`);
  const sold = n('vol_vendu'); if (sold !== null && lab !== null && sold > lab + 0.5) add('error', 'sold_above_labelled', `Volume vendu (${sold.toFixed(0)}) > volume labellisé (${lab.toFixed(0)})`);
  if (lab === null && has('re_labelled')) add('warning', 'missing_labelled_volume', 'RE totales labellisées manquantes');
}
