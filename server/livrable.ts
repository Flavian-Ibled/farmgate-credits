// Reader for the "Grandes Cultures" livrables (PDF): "Rapport de diagnostic initial et prospectif" and
// "Rapport de diagnostic suivi — Bilan Carbone Récolte N". Extraction is anchored on printed labels; a value that is
// not found is left empty (never guessed). Everything goes through a preview before anything is written.
import { Hono } from 'hono';
import { createHash } from 'node:crypto';
import type { Db, Ctx } from './db.ts';
import { invalidate, searchCommunes } from './facts.ts';
import { norm, DEPT_REGION } from '../shared/catalogue.ts';
import { project } from './importer/apply.ts';
import { departementOf } from './importer/parse.ts';

export interface Cell { x: number; s: string }
export interface Line { y: number; cells: Cell[]; flat: string }
export interface Page { n: number; lines: Line[] }
type Env = { Variables: { ctx: (Ctx & { email: string }) | null } };

export async function readPdf(buf: Buffer | Uint8Array): Promise<Page[]> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await getDocument({ data: new Uint8Array(buf), useSystemFonts: true, verbosity: 0 }).promise;
  const pages: Page[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent(); const by = new Map<number, Cell[]>();
    for (const it of tc.items as any[]) { if (!it.str?.trim()) continue; const y = Math.round(it.transform[5] / 3) * 3; (by.get(y) ?? by.set(y, []).get(y)!).push({ x: it.transform[4], s: it.str.trim() }); }
    pages.push({ n: p, lines: [...by].sort((a, b) => b[0] - a[0]).map(([y, c]) => { c.sort((a, b) => a.x - b.x); return { y, cells: c, flat: c.map(i => i.s).join(' ') }; }) });
  }
  return pages;
}

const NUM = /^[-−–]?\s?\d[\d\s ]*(?:[.,]\d+)?$/;
export const fr = (s: string | undefined | null): number | null => { if (s == null) return null; const t = s.replace(/[−–]/g, '-').replace(/[\s *]/g, ''); if (!/^[-+]?\d+(?:[.,]\d+)?$/.test(t)) return null; return Number(t.replace(',', '.').replace(/^\+/, '')); };
const lead = (s: string) => fr(/^([-−–+]?\s?[\d\s ]*\d(?:[.,]\d+)?)/.exec(s)?.[1] ?? null);
const MONTHS = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'];
export function frDate(s: string | null): string | null { const m = /(\d{1,2})\s*(?:er)?\s+([a-zéûô]+)\s+(\d{4})/i.exec(s ?? ''); if (!m) return null; const i = MONTHS.indexOf(norm(m[2])); return i < 0 ? null : `${m[3]}-${String(i + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`; }

export interface Found<T> { value: T; page: number }
export interface LivrableExtract {
  family: 'grandes_cultures'; kind: 'initial' | 'suivi'; harvest_year: number | null;
  private: { farm_name: string | null; advisor: string | null; postal_code: string | null; commune?: string | null };
  sau: Found<number> | null; production_mode: Found<string> | null; diagnostic_date: Found<string> | null;
  emissions_ha: { initial: Found<number> | null; year: Found<number> | null; prospectif: Found<number> | null };
  /** positive = carbon stored in soils (the livrable prints stored carbon as a negative number; the sign is flipped here) */
  storage_ha: { initial: Found<number> | null; year: Found<number> | null; prospectif: Found<number> | null };
  net_ha: { initial: Found<number> | null; prospectif: Found<number> | null };
  credits: { estimated_5y: Found<number> | null; reevaluated_5y: Found<number> | null; price_eur: Found<number> | null; total_eur: Found<number> | null; schedule_pct: number[] | null };
  crops: { scenario: 'initial' | 'prospectif' | number; crop: string; hectares: number; yield_text: string | null; page: number }[];
  lever_costs: { name: string; cost_eur_ha: number | null; saving_eur_ha: number | null; page: number }[];
  levers_activated_count: Found<number> | null; practice_cost_total_eur_ha?: Found<number> | null; warnings: string[];
}

export function parseLivrableGC(pages: Page[]): LivrableExtract {
  const p1 = pages[0]?.lines.map(l => l.flat).join('\n') ?? '';
  if (!/grandes\s+cultures/i.test(p1) && !pages.slice(0, 3).some(p => p.lines.some(l => /grandes\s+cultures/i.test(l.flat)))) throw new Error('Ce PDF n’est pas un livrable « Grandes Cultures » reconnu (mention absente de la première page).');
  const kind: LivrableExtract['kind'] = /diagnostic\s+initial/i.test(p1) ? 'initial' : 'suivi';
  const w: string[] = [];
  /** value printed after a label: rest of the same cell after ":", else the next cell on the line */
  const after = (re: RegExp, only?: Page[]): Found<string> | null => {
    for (const p of only ?? pages) for (const l of p.lines) for (let i = 0; i < l.cells.length; i++) {
      const m = re.exec(l.cells[i].s); if (!m) continue;
      const rest = l.cells[i].s.slice(m.index + m[0].length).replace(/^\s*:\s*/, '').trim();
      const v = rest || (l.cells[i + 1]?.s === ':' ? l.cells[i + 2]?.s : l.cells[i + 1]?.s) || '';
      if (v && v !== ':') return { value: v.replace(/^:\s*/, ''), page: p.n };
    }
    return null;
  };
  /** 2026 template: the value is printed alone on the line just above its label */
  const above = (re: RegExp, only?: Page[]): Found<string> | null => { for (const p of only ?? pages) for (let i = 1; i < p.lines.length; i++) if (re.test(p.lines[i].cells[0]?.s ?? '') && p.lines[i].cells.length === 1 && p.lines[i - 1].cells.length === 1 && !/:\s*$/.test(p.lines[i - 1].flat)) return { value: p.lines[i - 1].flat, page: p.n }; return null; };
  const numAfter = (re: RegExp, only?: Page[]): Found<number> | null => { const f = after(re, only); const v = f && lead(f.value); return v == null ? null : { value: v, page: f!.page }; };
  const pageOf = (re: RegExp) => pages.filter(p => p.lines.slice(0, 4).some(l => re.test(l.flat)));
  /** the number printed alone just above a standalone "tCO2e/ha/an" line (gauge value of the year) */
  const gauge = (ps: Page[]): Found<number> | null => { for (const p of ps) for (let i = 1; i < p.lines.length; i++) if (/^tCO2e\/ha\/an$/i.test(p.lines[i].flat)) { const c = p.lines[i - 1].cells; const v = c.length === 1 ? fr(c[0].s) : null; if (v != null) return { value: v, page: p.n }; } return null; };
  const flip = (f: Found<number> | null): Found<number> | null => (f ? { value: f.value === 0 ? 0 : -f.value, page: f.page } : null);

  const farmName = after(/^Structure\s*:/i) ?? after(/^Exploitation\s*:/i) ?? after(/^Nom de la ferme/i) ?? after(/^Nom de l.exploitation/i) ?? above(/^Nom de la ferme/i);
  let advisor = after(/^Conseiller(?:\/conseillère)?\s*:?/i) ?? above(/^Conseiller/i);
  if (!advisor) for (const p of pages) { const i = p.lines.findIndex(l => /^Conseiller/i.test(l.flat)); if (i >= 0 && p.lines[i + 1]) { advisor = { value: p.lines[i + 1].flat, page: p.n }; break; } }
  const postal = pages.slice(0, 4).flatMap(p => p.lines).map(l => /\((\d{5})\)/.exec(l.flat)?.[1]).find(Boolean) ?? null;
  const hy = /R[ée]colte\s+(20\d\d)/i.exec(p1)?.[1];
  const date = after(/^Date du diagnostic/i); const iso = frDate(date?.value ?? null);
  const mode = after(/^Mode de production/i);

  const ex: LivrableExtract = {
    family: 'grandes_cultures', kind, harvest_year: kind === 'suivi' && hy ? Number(hy) : null,
    private: { farm_name: farmName?.value ?? null, advisor: advisor?.value ?? null, postal_code: postal, commune: pages.slice(0, 4).flatMap(p => p.lines).flatMap(l => l.cells).map(c => /^(?:Adresse\s*:\s*)?([A-Za-zÀ-ÿ' -]{2,})\s*\(\d{5}\)/.exec(c.s)?.[1]?.trim()).find(Boolean) ?? null },
    sau: numAfter(/^SAU totale/i) ?? (() => { for (const p of pages) for (let i = 1; i < p.lines.length; i++) if (/^SAU totale/i.test(p.lines[i].flat)) { const m = /^(\d+(?:,\d+)?)\s?ha$/.exec(p.lines[i - 1].flat); if (m) return { value: fr(m[1])!, page: p.n }; } return null; })() ?? (() => { const a = above(/^SAU totale/i); const v = a && lead(a.value); return v == null ? null : { value: v, page: a!.page }; })(), production_mode: mode, diagnostic_date: iso && date ? { value: iso, page: date.page } : null,
    emissions_ha: { initial: null, year: null, prospectif: null }, storage_ha: { initial: null, year: null, prospectif: null }, net_ha: { initial: null, prospectif: null },
    credits: { estimated_5y: null, reevaluated_5y: null, price_eur: null, total_eur: null, schedule_pct: null }, crops: [], lever_costs: [], levers_activated_count: null, warnings: w,
  };
  const schedule = () => {
    for (const p of pages) for (const l of p.lines) { const pc = l.cells.map(c => /^(\d{1,2})\s?%$/.exec(c.s)?.[1]).filter(Boolean).map(Number); if (pc.length >= 5 && pc.reduce((a, b) => a + b, 0) === 100) return pc; }
    // percentages split over two lines: accept only if the page total is exactly 100 % (yearly shares first, certification last)
    for (const p of pages) if (p.lines.some(l => /Certification/i.test(l.flat))) { const pc = allPct(p); if (pc.length === 6 && pc.reduce((a, b) => a + b, 0) === 100) return pc.sort((a, b) => a - b); }
    return null;
  };
  // standalone integers of a page, footer (page number) excluded
  const intsOn = (p: Page) => p.lines.slice(0, -1).filter(l => l.cells.length === 1 && /^\d{2,6}$/.test(l.flat)).map(l => Number(l.flat));
  const allPct = (p: Page) => p.lines.flatMap(l => l.cells).map(c => /^(\d{1,2})\s?%$/.exec(c.s)?.[1]).filter(Boolean).map(Number);

  if (kind === 'suivi') {
    const em = pageOf(/[ÉE]missions de GES de la ferme/i), sq = pageOf(/S[ée]questration carbone/i);
    ex.emissions_ha = { initial: numAfter(/Sc[ée]nario Initial\s*:/i, em), prospectif: numAfter(/Sc[ée]nario Prospectif\s*:/i, em), year: gauge(em) };
    ex.storage_ha = { initial: flip(numAfter(/Sc[ée]nario Initial\s*:/i, sq)), prospectif: flip(numAfter(/Sc[ée]nario Prospectif\s*:/i, sq)), year: flip(gauge(sq)) };
    const cr = pages.find(p => p.lines.some(l => /r[ée][ée]valu[ée]s/i.test(l.flat)));
    if (cr) { const n = intsOn(cr); if (n.length === 2) { ex.credits.estimated_5y = { value: n[0], page: cr.n }; ex.credits.reevaluated_5y = { value: n[1], page: cr.n }; } else w.push(`Page ${cr.n} : crédits estimés / réévalués non lus avec certitude (${n.length} nombres trouvés)`); }
    for (const p of pages) for (const l of p.lines) { const m = /valorisation\s+des cr[ée]dits carbone [àa]|[àa]\s*(\d{2})\s?€\/CC/i.exec(l.flat); const v = /(\d{2})\s?€\/CC/.exec(l.flat); if (m && v && !ex.credits.price_eur) ex.credits.price_eur = { value: Number(v[1]), page: p.n }; const tt = /^(\d[\d\s ]{2,})\s?€\*?$/.exec(l.flat); if (tt && !ex.credits.total_eur) ex.credits.total_eur = { value: fr(tt[1])!, page: p.n }; }
    // surfaces per crop: 8 fixed columns (Sc. Initial, 2024 … 2029, Sc. Prospectif) located from the x position of "2024" and "2025"
    const cp = pages.find(p => p.lines.some(l => /^Surfaces \[ha\]/i.test(l.flat)));
    if (cp) {
      const a = cp.lines.findIndex(l => /^Surfaces \[ha\]/i.test(l.flat)), b = cp.lines.findIndex(l => /^Rendements/i.test(l.flat)); const reg = cp.lines.slice(a + 1, b < 0 ? undefined : b);
      const hx = (s: string) => reg.flatMap(l => l.cells).find(c => c.s === s)?.x; const x24 = hx('2024'), x25 = hx('2025'), x29 = hx('2029'), xP = hx('Prospectif'), xI = hx('Initial');
      if (x24 != null && x25 != null && x25 > x24 && xP != null) {
        const dx = x25 - x24, left = (xI ?? x24 - dx) - dx / 2; const last = x29 ?? xP - dx; const step = (last - x25) / 4;
        // header anchors: Sc. Initial, 2024, 2025, (2026–2028 interpolated), 2029, Sc. Prospectif
        const anchors: [number, 'initial' | 'prospectif' | number][] = [[xI ?? x24 - dx, 'initial'], [x24, 2024], [x25, 2025], [x25 + step, 2026], [x25 + 2 * step, 2027], [x25 + 3 * step, 2028], [last, 2029], [xP + 10, 'prospectif']];
        const isVal = (c: Cell) => c.x >= left && /^\d+,\d$/.test(c.s), names = (l: Line) => l.cells.filter(c => c.x < left && !NUM.test(c.s)).map(c => c.s).join(' ');
        const hasVal = reg.map(l => l.cells.some(isVal)); const used = new Set<number>();
        reg.forEach((l, i) => {
          if (!hasVal[i]) return; let name = names(l);
          if (!name) { const pre = i > 0 && !hasVal[i - 1] && !used.has(i - 1) ? names(reg[i - 1]) : '', suf = i + 1 < reg.length && !hasVal[i + 1] ? names(reg[i + 1]) : ''; if (pre) used.add(i - 1); if (suf) used.add(i + 1); name = `${pre} ${suf}`.trim(); }
          if (!name || /^(Culture|Sc\.|Initial|Prospectif)$/i.test(name)) return;
          for (const c of l.cells.filter(isVal)) { const a = anchors.reduce((b, x) => (Math.abs(x[0] - c.x) < Math.abs(b[0] - c.x) ? x : b)); ex.crops.push({ scenario: a[1], crop: name, hectares: fr(c.s)!, yield_text: null, page: cp.n }); }
        });
      } else w.push(`Page ${cp.n} : tableau des surfaces non lu (colonnes d’années introuvables)`);
    }
  } else {
    ex.net_ha = { initial: numAfter(/Bilan net initial\s*:/i), prospectif: numAfter(/Bilan net prospectif\s*:/i) };
    const lv = /activ[ée]\s+(\d+)\s+des\s+\d+\s+leviers/i; for (const p of pages) for (const l of p.lines) { const m = lv.exec(l.flat); if (m) ex.levers_activated_count = { value: Number(m[1]), page: p.n }; }
    const fin = pages.find(p => p.lines.slice(0, 3).some(l => /Financement de la transition/i.test(l.flat)));
    if (fin) {
      const i = fin.lines.findIndex(l => /^Cr[ée]dits Carbone$/i.test(l.flat)); const n = i >= 0 ? fin.lines.slice(i + 1, i + 4).map(l => (l.cells.length === 1 && /^-?\d{1,6}$/.test(l.flat) ? Number(l.flat) : null)).find(v => v != null) : null;
      if (n != null) ex.credits.estimated_5y = { value: n, page: fin.n }; else w.push(`Page ${fin.n} : nombre de crédits non lu`);
      fin.lines.forEach((l, k) => { if (/^€\/tCO2e$/i.test(l.flat) && !ex.credits.price_eur) { const v = [1, 2, 3].map(j => fin.lines[k - j]).filter(x => x?.cells.length === 1).map(x => fr(x.flat)).find(x => x != null); if (v != null) ex.credits.price_eur = { value: v, page: fin.n }; } const tt = /^(\d[\d\s ]{2,})\s?€$/.exec(l.flat); if (tt && !ex.credits.total_eur) ex.credits.total_eur = { value: fr(tt[1])!, page: fin.n }; });
    }
    // 2026 template: "4.2 – Crédits carbone" prints the yearly credits ("22 x 5 ans x 20 - 35 €/tCO2e")
    const cr2 = pages.find(p => p.lines.some(l => /Cr[ée]dits carbone\s*=\s*\(bilan net/i.test(l.flat)));
    if (cr2 && !ex.credits.estimated_5y) { const l = cr2.lines.find(l => /^-?\d{1,5}$/.test(l.cells[0]?.s ?? '') && l.cells.some(c => /\d+\s*-\s*\d+/.test(c.s))); if (l) { ex.credits.estimated_5y = { value: Number(l.cells[0].s) * 5, page: cr2.n }; w.push(`Page ${cr2.n} : crédits sur 5 ans calculés comme ${l.cells[0].s} tCO₂e/an × 5`); } else w.push(`Page ${cr2.n} : nombre de crédits non lu`); }
    // 2026 template: "2.2 - Cultures" (name ¦ surface ¦ yield ¦ …)
    for (const ap of pageOf(/^2\.2\s*-\s*Cultures/i)) {
      let scen: 'initial' | 'prospectif' | null = null; const L = ap.lines; const yl = (l: Line) => l.cells.findIndex(c => /q\/ha$|MS\/ha$/i.test(c.s));
      L.forEach((l, i) => {
        if (/^Sc[ée]nario initial/i.test(l.flat)) { scen = 'initial'; return; } if (/^Sc[ée]nario prospectif/i.test(l.flat)) { scen = 'prospectif'; return; }
        const k = yl(l); if (!scen || k < 1) return; const ha = fr(l.cells[k - 1].s); if (ha == null) return;
        let name = l.cells.slice(0, k - 1).map(c => c.s).join(' ').trim();
        if (!name) { const ok = (x?: Line) => x && yl(x) < 0 && !/\d/.test(x.flat.replace(/\(> ?\d+ ans\)/, '')) || (x && yl(x) < 0 && /\(>/.test(x.flat)); const pre = ok(L[i - 1]) && !/Surface|Restitution|pailles|Sc[ée]nario/i.test(L[i - 1].flat) ? L[i - 1].flat : '', suf = ok(L[i + 1]) && !/Surface|Restitution|pailles|Sc[ée]nario|Rapport de/i.test(L[i + 1].flat) ? L[i + 1].flat : ''; name = `${pre} ${suf}`.trim(); }
        if (name) ex.crops.push({ scenario: scen, crop: name, hectares: ha, yield_text: l.cells[k].s, page: ap.n });
      });
    }
    for (const ap of pageOf(/^Assolement$/i)) {
      let scen: 'initial' | 'prospectif' | null = null; const L = ap.lines; const used = new Set<number>();
      const surf = (l: Line) => l.cells.find(c => /^\d+(?:,\d+)?\s?ha$/.test(c.s)), nm = (l: Line) => { const k = l.cells.findIndex(c => /q\/ha$|MS\/ha$/i.test(c.s)); return (k < 0 ? l.cells.filter(c => !/\d/.test(c.s)) : l.cells.slice(0, k)).map(c => c.s).join(' ').trim(); };
      L.forEach((l, i) => {
        if (/^Scenario initial/i.test(l.flat)) { scen = 'initial'; return; } if (/^Scenario prospectif/i.test(l.flat)) { scen = 'prospectif'; return; }
        const s = surf(l); if (!scen || !s) return; let name = nm(l);
        if (!name) { const pre = i > 0 && !surf(L[i - 1]) && !used.has(i - 1) && !/Scenario|Rendement|pailles|Restitution|moyenne/i.test(L[i - 1].flat) ? L[i - 1].flat : '', suf = L[i + 1] && !surf(L[i + 1]) && !/Scenario|Rendement|pailles|Restitution|Rapport de/i.test(L[i + 1].flat) && !/\d/.test(L[i + 1].flat) ? L[i + 1].flat : ''; if (pre) used.add(i - 1); name = `${pre} ${suf}`.trim(); }
        if (name) ex.crops.push({ scenario: scen, crop: name, hectares: lead(s.s)!, yield_text: l.cells.find(c => /q\/ha$|MS\/ha$/i.test(c.s))?.s ?? null, page: ap.n });
      });
    }
    for (const cp of pageOf(/Co[ûu]ts des pratiques/i)) { const tt = cp.lines.find(l => /^Total\s*:/i.test(l.flat)); const v = tt && tt.cells.map(c => lead(c.s)).find(x => x != null); if (v != null) ex.practice_cost_total_eur_ha = { value: v, page: cp.n }; }
    // per-lever costs exist only in the template that lists the 18 levers (the 2026 template gives totals per category)
    for (const cp of pageOf(/Co[ûu]ts des pratiques/i).filter(p => !p.lines.some(l => /^Total\s*:|Sous-total/i.test(l.flat)))) cp.lines.forEach((l, i) => {
      const e = l.cells.map((c, k) => (c.s === '€/ha' ? k : -1)).filter(k => k > 0); if (e.length !== 2) return;
      const cost = fr(l.cells[e[0] - 1].s), saving = fr(l.cells[e[1] - 1].s); if (cost == null && saving == null) return;
      let name = l.cells.slice(0, e[0] - 1).map(c => c.s).join(' ').trim(); if (!name && cp.lines[i - 1] && !cp.lines[i - 1].cells.some(c => c.s === '€/ha')) name = cp.lines[i - 1].flat;
      if (name) ex.lever_costs.push({ name, cost_eur_ha: cost, saving_eur_ha: saving, page: cp.n });
    });
  }
  ex.credits.schedule_pct = schedule();
  if (!ex.private.farm_name) w.push('Nom de la ferme introuvable'); if (!ex.sau) w.push('SAU introuvable');
  return ex;
}

const tokens = (s: string) => new Set(norm(s).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(t => t.length > 2 && !['des', 'les', 'aux', 'par', 'pour', 'selon', 'sur'].includes(t)));
export const similarity = (a: string, b: string) => { const A = tokens(a), B = tokens(b); if (!A.size || !B.size) return 0; let n = 0; for (const t of A) if (B.has(t)) n++; return n / Math.min(A.size, B.size); };
const CROP_YEAR = (s: 'initial' | 'prospectif' | number) => (s === 'initial' ? 0 : s === 'prospectif' ? 9999 : s);

async function build(db: Db, ctx: Ctx, ex: LivrableExtract, farmIdIn?: string) {
  return db.as(ctx, async q => {
    const all = (await q.query(`select p.farm_id, p.name, p.postal_code, f.sau, f.re_labelled from farm_private p join farms f on f.id=p.farm_id`)).rows;
    const scored = all.map(r => ({ id: r.farm_id as string, sau: r.sau == null ? null : Number(r.sau), re_labelled: r.re_labelled == null ? null : Number(r.re_labelled), score: ex.private.farm_name && r.name ? (norm(r.name).replace(/[^a-z0-9]/g, '') === norm(ex.private.farm_name).replace(/[^a-z0-9]/g, '') ? 1 : similarity(r.name, ex.private.farm_name) * 0.9) + (ex.private.postal_code && String(r.postal_code ?? '').padStart(5, '0') === ex.private.postal_code ? 0.05 : 0) : 0 })).sort((a, b) => b.score - a.score);
    const candidates = scored.filter(s => s.score >= 0.6).slice(0, 5).map(s => ({ id: s.id, score: Math.round(s.score * 100) / 100, sau: s.sau }));
    const farmId = farmIdIn?.trim().toUpperCase() || (candidates[0] && candidates[0].score >= 0.95 && (candidates[1]?.score ?? 0) < 0.95 ? candidates[0].id : null);
    const farm = farmId ? scored.find(s => s.id === farmId) ?? null : null; const warnings = [...ex.warnings];
    if (farmIdIn && !farm) throw new Error(`Ferme inconnue : ${farmIdIn}`);
    if (!farm) warnings.push('Ferme non identifiée avec certitude : choisissez l’identifiant ci-dessous.');
    if (farm && ex.sau && farm.sau && Math.abs(ex.sau.value - farm.sau) / farm.sau > 0.03) warnings.push(`SAU du livrable (${ex.sau.value} ha) différente de la plateforme (${farm.sau.toFixed(1)} ha)`);
    const credRef = ex.credits.estimated_5y?.value; if (farm && credRef != null && farm.re_labelled != null && Math.abs(credRef - farm.re_labelled) > Math.max(2, 0.02 * farm.re_labelled)) warnings.push(`Crédits estimés du livrable (${credRef}) différents du volume labellisé de la plateforme (${Math.round(farm.re_labelled)}) : non modifié`);
    const levers = (await q.query(`select code, name_fr from levers where scope='GC'`)).rows;
    const costs = ex.lever_costs.map(c => { const best = levers.map(l => ({ code: l.code as string, name: l.name_fr as string, s: similarity(l.name_fr, c.name) })).sort((a, b) => b.s - a.s)[0]; return { ...c, lever_code: best && best.s >= 0.6 ? best.code : null, lever_name: best && best.s >= 0.6 ? best.name : null }; });
    for (const c of costs) if (!c.lever_code) warnings.push(`Levier non reconnu, coût non importé : « ${c.name} »`);
    let followup: { field: string; label: string; current: any; next: any; page: number | null }[] = [];
    if (ex.kind === 'suivi' && farm && ex.harvest_year) {
      const cur = (await q.query(`select a.*, pr.diagnostician from annual_followups a left join followup_private pr on pr.farm_id=a.farm_id and pr.harvest_year=a.harvest_year where a.farm_id=$1 and a.harvest_year=$2`, [farm.id, ex.harvest_year])).rows[0] ?? {};
      const n = (x: any) => (x == null ? null : Math.round(Number(x) * 1000) / 1000), d = (x: any) => (x ? new Date(x).toISOString().slice(0, 10) : null);
      const emI = ex.emissions_ha.initial, emY = ex.emissions_ha.year, stY = ex.storage_ha.year, stI = ex.storage_ha.initial;
      followup = ([
        ['diagnostic_date', 'Date du diagnostic', d(cur.diagnostic_date), ex.diagnostic_date?.value ?? null, ex.diagnostic_date?.page],
        ['em_baseline_ha', 'Émissions de référence (tCO₂e/ha/an)', n(cur.em_baseline_ha), emI?.value ?? null, emI?.page],
        ['em_year_ha', `Émissions récolte ${ex.harvest_year} (tCO₂e/ha/an)`, n(cur.em_year_ha), emY?.value ?? null, emY?.page],
        ['st_year_ha', `Stockage récolte ${ex.harvest_year} (tCO₂e/ha/an, positif = stocké)`, n(cur.st_year_ha), stY?.value ?? null, stY?.page],
        ['net_balance_ha', 'Bilan net de l’année (calculé : émissions − stockage)', n(cur.net_balance_ha), emY ? n(emY.value - (stY?.value ?? 0)) : null, null],
        ['net_balance_change', 'Évolution du bilan net vs référence (calculée)', n(cur.net_balance_change), emY && emI && emI.value - (stI?.value ?? 0) !== 0 ? n((emY.value - (stY?.value ?? 0)) / (emI.value - (stI?.value ?? 0)) - 1) : null, null],
        ['end_of_project_extrapolation', 'Crédits réévalués sur 5 ans (tCO₂e)', n(cur.end_of_project_extrapolation), ex.credits.reevaluated_5y?.value ?? null, ex.credits.reevaluated_5y?.page],
        ['diagnostician', 'Conseiller (interne)', cur.diagnostician ?? null, ex.private.advisor, null],
      ] as [string, string, any, any, number | undefined][]).filter(r => r[3] != null).map(([field, label, current, next, page]) => ({ field, label, current, next, page: page ?? null }));
    }
    const cropSum: Record<string, number> = {}; for (const c of ex.crops) cropSum[String(c.scenario)] = Math.round(((cropSum[String(c.scenario)] ?? 0) + c.hectares) * 10) / 10;
    if (farm?.sau) for (const [k, v] of Object.entries(cropSum)) if (v > farm.sau * 1.05) warnings.push(`Assolement « ${k} » : ${v} ha lus, supérieur à la SAU (${farm.sau.toFixed(1)} ha) — à vérifier`);
    return { farm_id: farm?.id ?? null, can_create: !farm, candidates, followup, crops: ex.crops, crop_totals: cropSum, costs, warnings };
  });
}

export async function previewLivrable(db: Db, ctx: Ctx, buf: Buffer, farmId?: string) { const ex = parseLivrableGC(await readPdf(buf)); return { extract: ex, ...(await build(db, ctx, ex, farmId)) }; }

/**
 * Creates a farm from a livrable when it is not in the Data Master yet. Only what the livrable states is stored:
 * status "Diags en cours", credits = the livrable's estimate (not a labelled volume), position = centre of the commune.
 * The farm is not open for sale (no sellable volume) until the Data Master provides it.
 */
export async function createFarmFromLivrable(db: Db, ctx: Ctx, ex: LivrableExtract, newId: string, projectName: string) {
  const id = newId.trim().toUpperCase(); if (!/^[A-Z][A-Z0-9]{1,5}-\d{2,4}$/.test(id)) throw new Error('Identifiant invalide : format attendu du type CVL4-012');
  if (!projectName.trim()) throw new Error('Choisissez le projet de la ferme');
  if ((await db.owner.query(`select 1 from farms where id=$1`, [id])).rows[0]) throw new Error(`La ferme ${id} existe déjà`);
  const dep = departementOf(ex.private.postal_code); const same = (a: string) => norm(a).replace(/[-']/g, ' ') === norm(ex.private.commune).replace(/[-']/g, ' ');
  let com: { lat: number; lng: number } | null | undefined = ex.private.commune ? searchCommunes(ex.private.commune, 20).find(c => same(c.name) && (!dep || c.departement === dep)) : null;
  // the local commune index keeps one commune per name (homonyms are missing): fall back to the official geo.api.gouv.fr, by postal code
  if (!com && ex.private.postal_code && ex.private.commune) try {
    const r = await fetch(`https://geo.api.gouv.fr/communes?codePostal=${ex.private.postal_code}&fields=nom,centre`, { signal: AbortSignal.timeout(4000) }); const hit = ((await r.json()) as any[]).find(x => x.centre && same(x.nom));
    if (hit) com = { lat: hit.centre.coordinates[1], lng: hit.centre.coordinates[0] };
  } catch { /* offline: the farm is created without a position */ }
  const est = ex.credits.estimated_5y?.value ?? null, sau = ex.sau?.value ?? null;
  const rec: Record<string, any> = { name: ex.private.farm_name, commune: ex.private.commune ?? null, postal_code: ex.private.postal_code, departement: dep, region: dep ? DEPT_REGION[dep] ?? null : null, sau, lat: com?.lat ?? null, lng: com?.lng ?? null,
    project: projectName.trim(), typology: 'Grandes cultures', lbc_status: 'Diags en cours', re_labelled: est, re_total_ha_yr: est != null && sau ? est / 5 / sau : null, rabais: 'Estimation du livrable (non labellisé)', diagnostic_referent: ex.private.advisor, last_diag_date: ex.kind === 'initial' ? ex.diagnostic_date?.value ?? null : null };
  await db.as(ctx, async q => { await project(q, id, rec, 0, db.blurSecret, new Map(), {}); await q.query(`update farms set created_from='livrable', last_import_id=null where id=$1`, [id]); });
  await db.owner.query(`insert into audit_log(user_id,action,entity,entity_id,detail) values($1,'farm.create_from_livrable','farm',$2,$3::jsonb)`, [ctx.uid ?? null, id, JSON.stringify({ project: projectName, located: !!com })]);
  invalidate(); return { id, located: !!com };
}

export async function applyLivrable(db: Db, ctx: Ctx & { email?: string }, buf: Buffer, filename: string, farmId: string | undefined, groups: { followup?: boolean; crops?: boolean; costs?: boolean }, create?: { id: string; project: string }) {
  const ex = parseLivrableGC(await readPdf(buf)); let created: { id: string; located: boolean } | null = null;
  if (create?.id) { created = await createFarmFromLivrable(db, ctx, ex, create.id, create.project); farmId = created.id; }
  const pv = await build(db, ctx, ex, farmId);
  if (!pv.farm_id) throw new Error('Ferme non identifiée : indiquez son identifiant avant d’appliquer.');
  const id = pv.farm_id; const done = { followup: 0, crops: 0, costs: 0 };
  await db.as(ctx, async q => {
    if (groups.followup && pv.followup.length && ex.harvest_year) {
      const v = Object.fromEntries(pv.followup.map(f => [f.field, f.next])); const y = ex.harvest_year;
      await q.query(`insert into annual_followups(farm_id,harvest_year,status,source) values($1,$2,'diagnosed','livrable') on conflict(farm_id,harvest_year) do nothing`, [id, y]);
      await q.query(`update annual_followups set diagnostic_date=coalesce($3::date,diagnostic_date), em_baseline_ha=coalesce($4,em_baseline_ha), em_year_ha=coalesce($5,em_year_ha), st_year_ha=coalesce($6,st_year_ha), net_balance_ha=coalesce($7,net_balance_ha), net_balance_change=coalesce($8,net_balance_change), end_of_project_extrapolation=coalesce($9,end_of_project_extrapolation), status=case when status='planned' then 'diagnosed' else status end where farm_id=$1 and harvest_year=$2`,
        [id, y, v.diagnostic_date ?? null, v.em_baseline_ha ?? null, v.em_year_ha ?? null, v.st_year_ha ?? null, v.net_balance_ha ?? null, v.net_balance_change ?? null, v.end_of_project_extrapolation ?? null]);
      if (v.diagnostician) await q.query(`insert into followup_private(farm_id,harvest_year,diagnostician) values($1,$2,$3) on conflict(farm_id,harvest_year) do update set diagnostician=excluded.diagnostician`, [id, y, v.diagnostician]);
      if (v.diagnostic_date) await q.query(`update farms set last_diag_date=greatest(coalesce(last_diag_date,'1900-01-01'), $2::date) where id=$1`, [id, v.diagnostic_date]);
      done.followup = pv.followup.length;
    }
    if (groups.crops && ex.crops.length) {
      const years = [...new Set(ex.crops.map(c => CROP_YEAR(c.scenario)))]; await q.query(`delete from farm_crops where farm_id=$1 and harvest_year = any($2::int[])`, [id, years]);
      for (const c of ex.crops) { const tot = pv.crop_totals[String(c.scenario)]; await q.query(`insert into farm_crops(farm_id,harvest_year,crop,hectares,share) values($1,$2,$3,$4,$5) on conflict(farm_id,harvest_year,crop) do update set hectares=farm_crops.hectares+excluded.hectares`, [id, CROP_YEAR(c.scenario), c.crop, c.hectares, tot ? c.hectares / tot : null]); done.crops++; }
    }
    if (groups.costs) for (const c of pv.costs) if (c.lever_code) { await q.query(`insert into farm_levers(farm_id,lever_code,active,cost_annual_eur_ha,saving_eur_ha,cost_source) values($1,$2,true,$3,$4,$5) on conflict(farm_id,lever_code) do update set active=true, cost_annual_eur_ha=excluded.cost_annual_eur_ha, saving_eur_ha=excluded.saving_eur_ha, cost_source=excluded.cost_source`, [id, c.lever_code, c.cost_eur_ha, c.saving_eur_ha, `livrable ${filename}`.slice(0, 200)]); done.costs++; }
    await q.query(`insert into livrables(farm_id,harvest_year,kind,filename,file_sha256,extracted,applied,imported_by) values($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8)`, [id, ex.harvest_year, ex.kind, filename, createHash('sha256').update(buf).digest('hex'), JSON.stringify(ex), JSON.stringify(done), ctx.email ?? null]);
  });
  await db.owner.query(`insert into audit_log(user_id,action,entity,entity_id,detail) values($1,'livrable.import','farm',$2,$3::jsonb)`, [ctx.uid ?? null, id, JSON.stringify({ filename, kind: ex.kind, ...done })]);
  invalidate(); return { farm_id: id, applied: done, created };
}

export function livrableRoutes(db: Db) {
  const adm = new Hono<Env>();
  adm.post('/livrables', async c => {
    const form = await c.req.parseBody(); const file = form.file as File | undefined; if (!file || typeof file === 'string') return c.json({ error: 'Fichier manquant' }, 400);
    const buf = Buffer.from(await file.arrayBuffer()), farmId = typeof form.farm_id === 'string' && form.farm_id.trim() ? form.farm_id : undefined;
    if (form.apply === '1') return c.json(await applyLivrable(db, c.get('ctx')!, buf, file.name, farmId, { followup: form.followup === '1', crops: form.crops === '1', costs: form.costs === '1' }, typeof form.create_id === 'string' && form.create_id.trim() ? { id: form.create_id, project: String(form.create_project ?? '') } : undefined));
    return c.json(await previewLivrable(db, c.get('ctx')!, buf, farmId));
  });
  adm.get('/livrables', async c => c.json((await db.as(c.get('ctx')!, q => q.query(`select id,farm_id,harvest_year,kind,filename,applied,imported_by,imported_at from livrables order by id desc limit 100`))).rows));
  return { adm };
}
