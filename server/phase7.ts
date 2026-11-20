// Phase 7 — notifications, project-owner (porteur) portal, Excel imports for crops and lever costs.
import { Hono } from 'hono';
import ExcelJS from 'exceljs';
import type { Db, Ctx, Q } from './db.ts';
import { dataset, invalidate } from './facts.ts';
import { farmFunding } from './funders.ts';
import { toNumber } from './importer/parse.ts';
import { norm } from '../shared/catalogue.ts';
import { similarity } from './livrable.ts';

type Env = { Variables: { ctx: (Ctx & { email: string }) | null } };
const FUNDED = `('reserved','contracted','paid','delivered','retired')`;

// ---------- notifications (in-app; e-mail sending is left to the production auth / mail provider) ----------
export async function notify(db: Db, n: { audience: 'cf' | 'org'; organization_id?: number | null; kind: string; title: string; link?: string | null }) {
  if (n.audience === 'org' && !n.organization_id) return;
  await db.owner.query(`insert into notifications(audience,organization_id,kind,title,link) values($1,$2,$3,$4,$5)`, [n.audience, n.organization_id ?? null, n.kind, n.title.slice(0, 300), n.link ?? null]);
}
/** porteur + funders with credits on the project's farms */
export async function notifyProject(db: Db, slug: string, kind: string, title: string, link: string) {
  const orgs = (await db.owner.query(`select distinct x.org from (select p.porteur_org_id org from projects p where p.slug=$1 union select a.funder_org_id from allocations a join allocation_lines l on l.allocation_id=a.id join farms f on f.id=l.farm_id join projects p on p.id=f.project_id where p.slug=$1 and a.status in ${FUNDED}) x where x.org is not null`, [slug])).rows;
  for (const o of orgs) await notify(db, { audience: 'org', organization_id: o.org, kind, title, link });
}

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const head = (ws: ExcelJS.Worksheet) => { ws.getRow(1).eachCell(c => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E4414' } }; }); ws.columns.forEach(c => { c.width = 24; }); ws.views = [{ state: 'frozen', ySplit: 1 }]; };
const cell = (c: ExcelJS.Cell): any => { let x: any = c.value; if (x && typeof x === 'object') x = 'result' in x ? x.result : 'text' in x ? x.text : 'richText' in x ? x.richText.map((t: any) => t.text).join('') : null; return x === '' ? null : x; };
async function sheetRows(buf: Buffer, required: string[]) {
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf as any); const ws = wb.worksheets.find(w => w.name !== 'Dictionnaire'); if (!ws) throw new Error('Aucune feuille de données');
  const cols = new Map<string, number>(); ws.getRow(1).eachCell((c, i) => cols.set(norm(c.text).replace(/\s*\(.*$/, ''), i)); for (const r of required) if (!cols.has(norm(r))) throw new Error(`Colonne obligatoire introuvable : « ${r} »`);
  const rows: { row: number; get: (h: string) => any }[] = []; for (let r = 2; r <= ws.rowCount; r++) { const row = ws.getRow(r); const get = (h: string) => { const i = cols.get(norm(h)); return i ? cell(row.getCell(i)) : null; }; if (get(required[0]) != null) rows.push({ row: r, get }); }
  return rows;
}
const SCEN = (x: any): number | null => { const s = norm(x); if (s === 'initial' || s === 'scenario initial') return 0; if (s.startsWith('prospectif') || s === 'scenario prospectif') return 9999; const n = Number(x); return Number.isInteger(n) && n >= 2015 && n <= 2045 ? n : null; };

/** Assolement: one row per farm, year (or "initial" / "prospectif") and crop. A farm-year present in the file replaces that farm-year. */
export async function importCrops(db: Db, ctx: Ctx, buf: Buffer, apply: boolean) {
  const rows = await sheetRows(buf, ['id', 'Année', 'Culture', 'Surface']); const errors: { row: number; message: string }[] = []; const ok: { id: string; year: number; crop: string; ha: number }[] = [];
  const known = new Set((await db.owner.query(`select id from farms`)).rows.map(r => r.id as string));
  for (const r of rows) { const id = String(r.get('id')).trim().toUpperCase(), y = SCEN(r.get('Année')), crop = String(r.get('Culture') ?? '').trim(), ha = toNumber(r.get('Surface'));
    if (!known.has(id)) errors.push({ row: r.row, message: `Ferme inconnue : ${id}` }); else if (y == null) errors.push({ row: r.row, message: 'Année illisible (attendu : 2025, « initial » ou « prospectif »)' }); else if (!crop) errors.push({ row: r.row, message: 'Culture manquante' }); else if (ha == null || ha < 0) errors.push({ row: r.row, message: 'Surface illisible' }); else ok.push({ id, year: y, crop, ha }); }
  const groups = new Map<string, typeof ok>(); for (const o of ok) (groups.get(`${o.id}|${o.year}`) ?? groups.set(`${o.id}|${o.year}`, []).get(`${o.id}|${o.year}`)!).push(o);
  if (apply) { await db.as(ctx, async q => { for (const g of groups.values()) { const tot = g.reduce((s, x) => s + x.ha, 0); await q.query(`delete from farm_crops where farm_id=$1 and harvest_year=$2`, [g[0].id, g[0].year]); for (const x of g) await q.query(`insert into farm_crops(farm_id,harvest_year,crop,hectares,share) values($1,$2,$3,$4,$5) on conflict(farm_id,harvest_year,crop) do update set hectares=farm_crops.hectares+excluded.hectares`, [x.id, x.year, x.crop, x.ha, tot ? x.ha / tot : null]); } });
    await db.owner.query(`insert into audit_log(user_id,action,entity,detail) values($1,'crops.import','farm_crops',$2::jsonb)`, [ctx.uid ?? null, JSON.stringify({ rows: ok.length, farm_years: groups.size })]); invalidate(); }
  return { applied: apply, rows: ok.length, farm_years: groups.size, farms: new Set(ok.map(o => o.id)).size, errors };
}
/** Lever costs: one row per farm and lever (lever recognised by its name). */
export async function importLeverCosts(db: Db, ctx: Ctx, buf: Buffer, apply: boolean) {
  const rows = await sheetRows(buf, ['id', 'Levier']); const errors: { row: number; message: string }[] = []; const ok: any[] = [];
  const farms = new Map((await db.owner.query(`select id, typology from farms`)).rows.map(r => [r.id as string, r.typology])), levers = (await db.owner.query(`select code, name_fr, scope from levers`)).rows;
  for (const r of rows) { const id = String(r.get('id')).trim().toUpperCase(), name = String(r.get('Levier') ?? '').trim(); const a = toNumber(r.get('Coût annuel')), o = toNumber(r.get('Coût ponctuel')), s = toNumber(r.get('Économie'));
    if (!farms.has(id)) { errors.push({ row: r.row, message: `Ferme inconnue : ${id}` }); continue; } if (a == null && o == null && s == null) continue;
    const scope = farms.get(id) === 'Élevage bovins' ? 'EL' : 'GC'; const best = levers.filter(l => l.scope === scope).map(l => ({ code: l.code, s: norm(l.name_fr) === norm(name) ? 1 : similarity(l.name_fr, name) })).sort((x, y) => y.s - x.s)[0];
    if (!best || best.s < 0.6) { errors.push({ row: r.row, message: `Levier non reconnu : « ${name} »` }); continue; } if ([a, o, s].some(x => x != null && x < 0)) { errors.push({ row: r.row, message: 'Montant négatif' }); continue; }
    ok.push({ id, code: best.code, a: a ?? null, o: o ?? null, s: s ?? null }); }
  if (apply) { await db.as(ctx, async q => { for (const x of ok) await q.query(`insert into farm_levers(farm_id,lever_code,active,cost_annual_eur_ha,cost_one_off_eur_ha,saving_eur_ha,cost_source) values($1,$2,true,$3,$4,$5,'import Excel') on conflict(farm_id,lever_code) do update set active=true, cost_annual_eur_ha=excluded.cost_annual_eur_ha, cost_one_off_eur_ha=excluded.cost_one_off_eur_ha, saving_eur_ha=excluded.saving_eur_ha, cost_source='import Excel'`, [x.id, x.code, x.a, x.o, x.s]); });
    await db.owner.query(`insert into audit_log(user_id,action,entity,detail) values($1,'lever_costs.import','farm_levers',$2::jsonb)`, [ctx.uid ?? null, JSON.stringify({ rows: ok.length })]); invalidate(); }
  return { applied: apply, rows: ok.length, farms: new Set(ok.map(o => o.id)).size, errors };
}
async function template(q: Q, kind: 'crops' | 'lever-costs', slug: string) {
  const p = (await q.query(`select id,name from projects where slug=$1`, [slug])).rows[0]; if (!p) throw new Error('Projet introuvable'); const wb = new ExcelJS.Workbook(); const d = wb.addWorksheet('Dictionnaire');
  if (kind === 'crops') { const ws = wb.addWorksheet('Assolement', { state: 'visible' }); ws.addRow(['id', 'Année', 'Culture', 'Surface (ha)']);
    const ex = (await q.query(`select c.farm_id, c.harvest_year, c.crop, c.hectares from farm_crops c join farms f on f.id=c.farm_id where f.project_id=$1 order by 1,2,4 desc`, [p.id])).rows; const have = new Set(ex.map(r => r.farm_id));
    for (const r of ex) ws.addRow([r.farm_id, r.harvest_year === 0 ? 'initial' : r.harvest_year === 9999 ? 'prospectif' : r.harvest_year, r.crop, Number(r.hectares)]);
    for (const f of (await q.query(`select id from farms where project_id=$1 order by id`, [p.id])).rows) if (!have.has(f.id)) ws.addRow([f.id, null, null, null]); head(ws);
    for (const r of [['Colonne', 'Signification'], ['id', 'Identifiant de la ferme'], ['Année', 'Année de récolte (2025…), ou « initial » / « prospectif » pour les scénarios'], ['Culture', 'Nom de la culture'], ['Surface (ha)', 'Surface de la culture'], [], ['Une ferme-année présente dans le fichier remplace toute cette ferme-année. Plusieurs lignes par ferme et par année.']]) d.addRow(r);
  } else { const ws = wb.addWorksheet('Coûts des leviers'); ws.addRow(['id', 'Levier', 'Coût annuel (€/ha)', 'Coût ponctuel (€/ha)', 'Économie (€/ha)']);
    for (const r of (await q.query(`select fl.farm_id, l.name_fr, fl.cost_annual_eur_ha, fl.cost_one_off_eur_ha, fl.saving_eur_ha from farm_levers fl join levers l on l.code=fl.lever_code join farms f on f.id=fl.farm_id where f.project_id=$1 and fl.active order by fl.farm_id, l.sort`, [p.id])).rows) ws.addRow([r.farm_id, r.name_fr, r.cost_annual_eur_ha == null ? null : Number(r.cost_annual_eur_ha), r.cost_one_off_eur_ha == null ? null : Number(r.cost_one_off_eur_ha), r.saving_eur_ha == null ? null : Number(r.saving_eur_ha)]); head(ws); ws.getColumn(2).width = 60;
    for (const r of [['Colonne', 'Signification'], ['id', 'Identifiant de la ferme'], ['Levier', 'Nom du levier, tel qu’il figure dans le Data Master'], ['Coût annuel (€/ha)', 'Coût récurrent de la pratique'], ['Coût ponctuel (€/ha)', 'Investissement de départ'], ['Économie (€/ha)', 'Économie annuelle permise par la pratique'], [], ['Le fichier liste les leviers activés de chaque ferme. Une ligne sans montant est ignorée.']]) d.addRow(r); }
  head(d); d.getColumn(2).width = 80; wb.views = [{ activeTab: 1 } as any];
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function phase7Routes(db: Db) {
  const me = new Hono<Env>(), adm = new Hono<Env>(), own = new Hono<Env>();
  // ---------- notifications ----------
  me.use('*', async (c, next) => { if (!c.get('ctx')) return c.json({ error: 'Connexion requise' }, 401); await next(); });
  me.get('/notifications', async c => { const ctx = c.get('ctx')!; const rows = (await db.as(ctx, q => q.query(`select id,kind,title,link,created_at, ($1::int = any(read_by)) as read from notifications order by id desc limit 60`, [ctx.uid]))).rows; return c.json({ unread: rows.filter(r => !r.read).length, items: rows }); });
  me.post('/notifications/read', async c => { const ctx = c.get('ctx')!; await db.as(ctx, q => q.query(`update notifications set read_by = array_append(read_by, $1::int) where not ($1::int = any(read_by))`, [ctx.uid])); return c.json({ ok: true }); });

  // ---------- project-owner portal: own projects and farms only, with farm identities (row-level security) ----------
  own.use('*', async (c, next) => { const x = c.get('ctx'); if (!x || x.role !== 'project_owner_user' || x.org == null) return c.json({ error: 'Espace réservé aux porteurs de projet' }, x ? 403 : 401); await next(); });
  own.get('/portfolio', async c => {
    const ctx = c.get('ctx')!; const d = await dataset(db);
    const { org, projects, ids } = await db.as(ctx, async q => ({ org: (await q.query(`select name from organizations where id=$1`, [ctx.org])).rows[0], projects: (await q.query(`select p.id,p.slug,p.name from projects p where p.porteur_org_id=$1 or exists (select 1 from project_memberships m where m.project_id=p.id and m.organization_id=$1) order by p.name`, [ctx.org])).rows,
      ids: (await q.query(`select pr.farm_id, pr.name, pr.commune, pr.postal_code from farm_private pr`)).rows })); // RLS returns only the farms of this porteur's projects
    const idMap = new Map(ids.map(r => [r.farm_id as string, r])); const names = new Set(projects.map(p => p.name)); const farms = d.farms.filter(f => f.project && names.has(f.project)); const fund = await farmFunding(db, farms.map(f => f.id));
    const fu = (await db.as(ctx, q => q.query(`select farm_id, harvest_year, status from annual_followups where farm_id = any($1::text[]) and status <> 'planned'`, [farms.map(f => f.id)]))).rows;
    return c.json({ organization: org, projects: projects.map(p => { const fs = farms.filter(f => f.project === p.name); let s = 0, a = 0; for (const f of fs) { const x = fund.get(f.id); s += x?.sellable ?? 0; a += x?.allocated ?? 0; }
        return { slug: p.slug, name: p.name, farms: fs.length, sau: fs.reduce((t, f) => t + (f.sau ?? 0), 0), re_labelled: fs.reduce((t, f) => t + (f.re_labelled ?? 0), 0), followed: fs.filter(f => f.re_measured_r25 != null).length, measured: fs.reduce((t, f) => t + (f.re_measured_r25 ?? 0), 0), sellable: s, allocated: a, funded_pct: s > 0 ? a / s : null, withdrawn: fs.filter(f => f.lbc_status === 'Désengagé').length }; }),
      farms: farms.map(f => { const i = idMap.get(f.id), x = fund.get(f.id); return { id: f.id, project: f.project, name: i?.name ?? null, commune: i?.commune ?? null, postal_code: i?.postal_code ?? null, sau: f.sau == null ? null : Math.round(f.sau), lbc_status: f.lbc_status, re_labelled: f.re_labelled, measured: f.re_measured_r25 ?? null, last_diag_date: f.last_diag_date ?? null, followup_status: fu.find(u => u.farm_id === f.id)?.status ?? null, funded_pct: x?.funded_pct ?? null, remaining: x?.remaining ?? null }; }) });
  });

  // ---------- admin: porteurs, templates and Excel imports ----------
  adm.get('/owners', async c => c.json((await db.as(c.get('ctx')!, q => q.query(`select o.id,o.name,(select count(*)::int from users u where u.organization_id=o.id) users,(select string_agg(p.name, ' · ') from projects p where p.porteur_org_id=o.id) projects from organizations o where o.type='project_owner' order by o.name`))).rows));
  adm.get('/templates/:kind/:slug', async c => { const kind = c.req.param('kind'); if (kind !== 'crops' && kind !== 'lever-costs') return c.json({ error: 'Modèle inconnu' }, 404); const buf = await db.as(c.get('ctx')!, q => template(q, kind, c.req.param('slug'))); return c.body(buf as any, 200, { 'content-type': XLSX, 'content-disposition': `attachment; filename="farmgate_${kind}_${c.req.param('slug')}.xlsx"` }); });
  adm.post('/imports/:kind', async c => { const kind = c.req.param('kind'); const form = await c.req.parseBody(); const file = form.file as File | undefined; if (!file || typeof file === 'string') return c.json({ error: 'Fichier manquant' }, 400); const buf = Buffer.from(await file.arrayBuffer()), apply = form.apply === '1';
    if (kind === 'crops') return c.json(await importCrops(db, c.get('ctx')!, buf, apply)); if (kind === 'lever-costs') return c.json(await importLeverCosts(db, c.get('ctx')!, buf, apply)); return c.json({ error: 'Import inconnu' }, 404); });
  return { me, adm, own };
}
