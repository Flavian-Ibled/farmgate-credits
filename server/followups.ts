// Phase 3 — annual follow-up module: hub (per project and harvest year), re-importable follow-up sheet, status workflow.
import { Hono } from 'hono';
import ExcelJS from 'exceljs';
import { PUBLIC, type Db, type Ctx, type Q } from './db.ts';
import { invalidate } from './facts.ts';
import { toNumber, toIsoDate } from './importer/parse.ts';
import { norm } from '../shared/catalogue.ts';
import { endOfProjectEstimate, farmEndOfProjectEstimate } from '../shared/rating.ts';

type Env = { Variables: { ctx: (Ctx & { email: string }) | null } };
export const FU_STATUS = ['planned', 'diagnosed', 'verified', 'audited'] as const;
const STATUS_FR: Record<string, string> = { planned: 'prévu', diagnosed: 'diagnostiqué', verified: 'vérifié', audited: 'audité' };
const STATUS_IN: Record<string, string> = { prevu: 'planned', planned: 'planned', diagnostique: 'diagnosed', diagnosed: 'diagnosed', verifie: 'verified', verified: 'verified', audite: 'audited', audited: 'audited' };
// public columns live in annual_followups; payment and diagnostician are private (followup_private)
const COLS = [
  { f: 'farm_id', label: 'id', help: 'Identifiant de la ferme (obligatoire)' }, { f: 'harvest_year', label: 'Année de récolte', help: 'ex. 2025 pour R25 (obligatoire)' },
  { f: 'diagnostic_date', label: 'Date du diagnostic', help: 'JJ/MM/AAAA', type: 'date' }, { f: 'diagnostician', label: 'Diagnostiqueur', help: 'Agronome (donnée interne)', priv: true, type: 'text' },
  { f: 'status', label: 'Statut', help: 'prévu | diagnostiqué | vérifié | audité', type: 'status' },
  { f: 'em_baseline_ha', label: 'Émissions référence (tCO2e/ha)', help: 'Moyenne des années de référence' }, { f: 'em_year_ha', label: 'Émissions année (tCO2e/ha)', help: 'Émissions brutes de la campagne' }, { f: 'st_year_ha', label: 'Stockage année (tCO2e/ha)', help: 'Stockage de la campagne' },
  { f: 're_avoidance_year', label: 'RE évitement année (tCO2e)', help: 'Réductions d’émissions mesurées — évitement' }, { f: 're_storage_year', label: 'RE stockage année (tCO2e)', help: 'Réductions d’émissions mesurées — stockage' },
  { f: 'payment_to_farmer_eur', label: 'Paiement agriculteur (€)', help: 'Versement de l’année (donnée privée)', priv: true }, { f: 'payment_date', label: 'Date de paiement', help: 'JJ/MM/AAAA (privé)', priv: true, type: 'date' },
  { f: 'document_url', label: 'Lien du rapport', help: 'Lien vers le diagnostic de suivi signé', type: 'text' },
] as const;
const N = (x: any) => (x == null ? null : Number(x));
const D = (x: any) => (x ? new Date(x).toISOString().slice(0, 10) : null);

/** Per project and harvest year: planned vs measured vs end-of-project estimate, with verification status. */
export async function hub(q: Q) {
  const rows = (await q.query(`
    select p.slug, p.name, a.harvest_year, count(*)::int followed, sum(a.re_avoidance_year) e, sum(a.re_storage_year) s, sum(a.re_total_year) total, sum(f.re_labelled) labelled_followed,
      count(*) filter (where a.status='diagnosed')::int diagnosed, count(*) filter (where a.status='verified')::int verified, count(*) filter (where a.status='audited')::int audited,
      max(a.diagnostic_date) last_diag, count(a.document_url)::int documents,
      sum(case when f.sau > 0 then a.em_baseline_ha * f.sau end) em_base, sum(case when f.sau > 0 and a.em_baseline_ha is not null then a.em_year_ha * f.sau end) em_year
    from annual_followups a join farms f on f.id=a.farm_id join projects p on p.id=f.project_id
    where a.status <> 'planned' group by p.slug, p.name, a.harvest_year order by p.name, a.harvest_year`)).rows;
  const tot = new Map((await q.query(`select p.slug, count(*)::int farms, sum(f.re_labelled) labelled from farms f join projects p on p.id=f.project_id where not f.absent_from_last_import and coalesce(f.lbc_status,'') <> 'Désengagé' group by p.slug`)).rows.map(r => [r.slug, r]));
  return rows.map(r => {
    const e = N(r.e) ?? 0, s = N(r.s) ?? 0, lab = N(r.labelled_followed) ?? 0;
    return { slug: r.slug, project: r.name, harvest_year: r.harvest_year, farms_followed: r.followed, farms_total: tot.get(r.slug)?.farms ?? null, labelled_project: N(tot.get(r.slug)?.labelled),
      planned_year: lab / 5, measured: N(r.total), re_avoidance: e, re_storage: s, labelled_of_followed: lab, end_of_project_estimate: endOfProjectEstimate(e, s),
      gross_emissions_change: N(r.em_base) && N(r.em_year) != null ? N(r.em_year)! / N(r.em_base)! - 1 : null,
      status: { diagnosed: r.diagnosed, verified: r.verified, audited: r.audited }, last_diagnostic: D(r.last_diag), documents: r.documents };
  });
}

export async function followupWorkbook(q: Q, slug: string, year: number) {
  const p = (await q.query(`select id,name from projects where slug=$1`, [slug])).rows[0]; if (!p) throw new Error('Projet introuvable');
  const rows = (await q.query(`select f.id farm_id, a.*, pr.diagnostician, pr.payment_to_farmer_eur, pr.payment_date from farms f left join annual_followups a on a.farm_id=f.id and a.harvest_year=$2 left join followup_private pr on pr.farm_id=f.id and pr.harvest_year=$2 where f.project_id=$1 order by f.id`, [p.id, year])).rows;
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet(`Suivi R${String(year).slice(2)}`);
  ws.addRow(COLS.map(c => c.label));
  for (const r of rows) ws.addRow(COLS.map(c => c.f === 'harvest_year' ? year : c.f === 'status' ? (r.status ? STATUS_FR[r.status] : null) : ('type' in c && c.type === 'date') ? (r[c.f] ? D(r[c.f])!.split('-').reverse().join('/') : null) : ('type' in c && c.type === 'text') || c.f === 'farm_id' ? r[c.f] ?? null : N(r[c.f])));
  ws.getRow(1).eachCell(c => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E4414' } }; c.alignment = { wrapText: true }; });
  ws.views = [{ state: 'frozen', xSplit: 1, ySplit: 1 }]; ws.columns.forEach(c => { c.width = 20; });
  const d = wb.addWorksheet('Dictionnaire'); d.addRow(['Colonne', 'Signification', 'Publié']); for (const c of COLS) d.addRow([c.label, c.help, 'priv' in c && c.priv ? 'non (interne)' : 'oui']);
  d.addRow([]); d.addRow(['Une ligne par ferme et par année de récolte. Une cellule vide laisse la valeur existante en place. Le bilan net et son évolution sont calculés par la plateforme.']); d.getColumn(1).width = 34; d.getColumn(2).width = 70;
  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), filename: `farmgate_suivi_${slug}_R${String(year).slice(2)}.xlsx`, farms: rows.length };
}

/** Follow-up import: dry run by default (nothing written), apply on request. Empty cells never blank existing values. */
export async function importFollowups(db: Db, ctx: Ctx, buf: Buffer, apply: boolean) {
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf as any);
  const ws = wb.worksheets.find(w => w.name !== 'Dictionnaire'); if (!ws) throw new Error('Aucune feuille de données');
  const head = new Map<string, number>(); ws.getRow(1).eachCell((c, i) => head.set(norm(c.text), i));
  const col = new Map(COLS.map(c => [c.f, head.get(norm(c.label))] as const));
  if (!col.get('farm_id') || !col.get('harvest_year')) throw new Error('Colonnes obligatoires introuvables : « id » et « Année de récolte »');
  const errors: { row: number; farm_id?: string; message: string }[] = []; const recs: Record<string, any>[] = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const cell = (f: string) => { const i = col.get(f as any); if (!i) return undefined; const v: any = ws.getRow(r).getCell(i).value; return v == null || v === '' ? undefined : v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === 'object' ? ('result' in v ? v.result : 'text' in v ? v.text : undefined) : v; };
    const id = cell('farm_id'); if (id === undefined) continue;
    const rec: Record<string, any> = { farm_id: String(id).trim(), row: r }; let bad = false, filled = 0;
    for (const c of COLS) {
      if (c.f === 'farm_id') continue; const v = cell(c.f); if (v === undefined) continue;
      const t = 'type' in c ? c.type : 'num'; let out: any;
      if (t === 'date') out = toIsoDate(v); else if (t === 'text') out = String(v).trim().slice(0, 500); else if (t === 'status') out = STATUS_IN[norm(v)] ?? null; else out = toNumber(v) ?? null;
      if (out === null) { errors.push({ row: r, farm_id: rec.farm_id, message: `« ${c.label} » illisible : ${String(v).slice(0, 30)}` }); bad = true; } else { rec[c.f] = out; if (c.f !== 'harvest_year') filled++; }
    }
    if (!Number.isInteger(rec.harvest_year) || rec.harvest_year < 2020 || rec.harvest_year > 2045) { errors.push({ row: r, farm_id: rec.farm_id, message: 'Année de récolte manquante ou invalide' }); bad = true; }
    if (!bad && filled) recs.push(rec);
  }
  const known = new Set((await db.owner.query(`select id from farms where id = any($1::text[])`, [recs.map(r => r.farm_id)])).rows.map(r => r.id));
  const seen = new Set<string>(); const ok = recs.filter(r => {
    if (!known.has(r.farm_id)) { errors.push({ row: r.row, farm_id: r.farm_id, message: 'Ferme inconnue : ligne ignorée' }); return false; }
    const k = r.farm_id + '|' + r.harvest_year; if (seen.has(k)) { errors.push({ row: r.row, farm_id: r.farm_id, message: 'Doublon ferme / année dans le fichier : ligne ignorée' }); return false; } seen.add(k); return true;
  });
  const result = await db.as(ctx, async q => {
    let created = 0, updated = 0, unchanged = 0;
    for (const r of ok) {
      const cur = (await q.query(`select a.*, pr.diagnostician, pr.payment_to_farmer_eur, pr.payment_date from annual_followups a left join followup_private pr on pr.farm_id=a.farm_id and pr.harvest_year=a.harvest_year where a.farm_id=$1 and a.harvest_year=$2`, [r.farm_id, r.harvest_year])).rows[0];
      const m: Record<string, any> = { ...(cur ?? {}), ...r };
      const same = cur && COLS.every(c => r[c.f] === undefined || String(('type' in c && c.type === 'date') ? D(cur[c.f]) : cur[c.f] ?? '') === String(r[c.f]) || (typeof r[c.f] === 'number' && cur[c.f] != null && Math.abs(Number(cur[c.f]) - r[c.f]) < 1e-9));
      if (same) { unchanged++; continue; } cur ? updated++ : created++;
      if (!apply) continue;
      const ea = N(m.re_avoidance_year), es = N(m.re_storage_year), total = ea != null || es != null ? (ea ?? 0) + (es ?? 0) : null;
      const eb = N(m.em_baseline_ha), ey = N(m.em_year_ha), sy = N(m.st_year_ha); const net = ey != null ? ey - (sy ?? 0) : null;
      const status = r.status ?? cur?.status ?? (total != null || ey != null ? 'diagnosed' : 'planned');
      await q.query(`insert into annual_followups(farm_id,harvest_year,diagnostic_date,status,em_baseline_ha,em_year_ha,st_year_ha,net_balance_ha,net_balance_change,re_avoidance_year,re_storage_year,re_total_year,document_url,source)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'fiche de suivi')
        on conflict(farm_id,harvest_year) do update set diagnostic_date=excluded.diagnostic_date,status=excluded.status,em_baseline_ha=excluded.em_baseline_ha,em_year_ha=excluded.em_year_ha,st_year_ha=excluded.st_year_ha,net_balance_ha=excluded.net_balance_ha,net_balance_change=excluded.net_balance_change,re_avoidance_year=excluded.re_avoidance_year,re_storage_year=excluded.re_storage_year,re_total_year=excluded.re_total_year,document_url=excluded.document_url,source=excluded.source`,
        [r.farm_id, r.harvest_year, D(m.diagnostic_date), status, eb, ey, sy, net, net != null && eb ? net / eb - 1 : null, ea, es, total, m.document_url ?? null]);
      if (m.diagnostician != null || m.payment_to_farmer_eur != null || m.payment_date != null)
        await q.query(`insert into followup_private(farm_id,harvest_year,diagnostician,payment_to_farmer_eur,payment_date) values($1,$2,$3,$4,$5) on conflict(farm_id,harvest_year) do update set diagnostician=excluded.diagnostician,payment_to_farmer_eur=excluded.payment_to_farmer_eur,payment_date=excluded.payment_date`, [r.farm_id, r.harvest_year, m.diagnostician ?? null, N(m.payment_to_farmer_eur), D(m.payment_date)]);
      if (m.diagnostic_date) await q.query(`update farms set last_diag_date=greatest(coalesce(last_diag_date,'1900-01-01'), $2::date) where id=$1`, [r.farm_id, D(m.diagnostic_date)]);
    }
    return { created, updated, unchanged };
  });
  if (apply) { await db.owner.query(`insert into audit_log(user_id,action,entity,detail) values($1,'followup.import','followup',$2::jsonb)`, [ctx.uid ?? null, JSON.stringify({ ...result, errors: errors.length })]); invalidate(); }
  return { applied: apply, rows: ok.length, ...result, errors };
}

export function followupRoutes(db: Db) {
  const pub = new Hono<Env>(), adm = new Hono<Env>();
  pub.get('/followups', async c => c.json(await db.as(PUBLIC, hub)));
  pub.get('/followups/:slug/:year', async c => {
    const rows = (await db.as(PUBLIC, q => q.query(`select f.id, f.sau, f.re_labelled, f.lbc_status, a.status, a.diagnostic_date, a.re_avoidance_year, a.re_storage_year, a.re_total_year, a.net_balance_ha, a.net_balance_change, a.document_url
      from farms f join projects p on p.id=f.project_id left join annual_followups a on a.farm_id=f.id and a.harvest_year=$2 where p.slug=$1 order by f.id`, [c.req.param('slug'), Number(c.req.param('year'))]))).rows;
    return c.json(rows.map(r => ({ id: r.id, lbc_status: r.lbc_status, sau: r.sau == null ? null : Math.round(Number(r.sau)), planned_year: r.re_labelled == null ? null : Number(r.re_labelled) / 5, status: r.status ?? 'planned', diagnostic_date: D(r.diagnostic_date), re_avoidance: N(r.re_avoidance_year), re_storage: N(r.re_storage_year), measured: N(r.re_total_year), net_balance_ha: N(r.net_balance_ha), net_balance_change: N(r.net_balance_change), end_of_project_estimate: r.re_total_year == null ? null : farmEndOfProjectEstimate(N(r.re_avoidance_year) ?? 0, N(r.re_storage_year) ?? 0), document_url: r.document_url })));
  });
  const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  adm.get('/followups/:slug/:year/sheet.xlsx', async c => { const w = await db.as(c.get('ctx')!, q => followupWorkbook(q, c.req.param('slug'), Number(c.req.param('year')))); return c.body(w.buffer as any, 200, { 'content-type': XLSX, 'content-disposition': `attachment; filename="${w.filename}"` }); });
  adm.post('/followups/import', async c => { const form = await c.req.parseBody(); const file = form.file as File | undefined; if (!file || typeof file === 'string') return c.json({ error: 'Fichier manquant' }, 400); return c.json(await importFollowups(db, c.get('ctx')!, Buffer.from(await file.arrayBuffer()), form.apply === '1')); });
  // status workflow for a whole project-year: diagnosed → verified → audited (only rows that already have a follow-up)
  adm.put('/followups/:slug/:year/status', async c => {
    const { status } = await c.req.json(); if (!['diagnosed', 'verified', 'audited'].includes(status)) throw new Error('Statut invalide');
    const r = await db.as(c.get('ctx')!, q => q.query(`update annual_followups a set status=$3 from farms f join projects p on p.id=f.project_id where a.farm_id=f.id and p.slug=$1 and a.harvest_year=$2 and a.status <> 'planned' returning a.farm_id`, [c.req.param('slug'), Number(c.req.param('year')), status]));
    await db.owner.query(`insert into audit_log(user_id,action,entity,entity_id,detail) values($1,'followup.status','project',$2,$3::jsonb)`, [c.get('ctx')!.uid, c.req.param('slug'), JSON.stringify({ year: c.req.param('year'), status, farms: r.rows.length })]);
    if (r.rows.length) await (await import('./phase7.ts')).notifyProject(db, c.req.param('slug'), 'followup', `Suivi R${String(c.req.param('year')).slice(2)} : ${r.rows.length} fermes passées au statut « ${status} »`, '/suivis');
    return c.json({ updated: r.rows.length });
  });
  return { pub, adm };
}
