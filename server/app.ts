import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { Db, Ctx } from './db.ts';
import { dataset, applyFilters, invalidate, searchCommunes, riverNames, basinNames, type Filters } from './facts.ts';
import { projectWorkbook, issuesWorkbook, selectionWorkbook } from './excel.ts';
import { aggregateSelection } from '../shared/aggregate.ts';
import { dryRun, applyImport, rollbackImport } from './importer/apply.ts';
import { login, logout, sessionCtx } from './auth.ts';
import { pagesRoutes } from './pages.ts';
import { followupRoutes } from './followups.ts';
import { livrableRoutes } from './livrable.ts';
import { funderRoutes } from './funders.ts';
import { moneyRoutes } from './money.ts';
import { scoreRoutes } from './scores.ts';
import { phase7Routes } from './phase7.ts';
import { mediaRoutes } from './media.ts';
import { shopRoutes } from './shop.ts';
import { funderAdminRoutes } from './funderAdmin.ts';
import { phase8Routes } from './phase8.ts';

type Env = { Variables: { ctx: (Ctx & { email: string }) | null } };
const COOKIE = 'fg_session';

export function createApp(db: Db) {
  const app = new Hono<Env>();
  app.use('/api/*', async (c, next) => { c.set('ctx', await sessionCtx(db, getCookie(c, COOKIE))); await next(); });
  app.onError((e, c) => { console.error(e); return c.json({ error: e.message }, 400); });

  // ---------- public (anonymous): aggregates, blurred positions, non-identifying fields only ----------
  app.get('/api/public/summary', async c => {
    const d = await dataset(db); const a = aggregateSelection(d.farms, [], d.portfolio, []);
    return c.json({ farms: a.scale.farms, sau: a.scale.sau, re_labelled_5y: a.carbon.re_labelled_5y, vol_vendu: a.carbon.vol_vendu, vol_dispo: a.carbon.vol_dispo, projects: a.scale.projects.length, regions: a.scale.regions.filter(r => r.key !== '—').length, followup_r25: a.carbon.followup_r25, source: 'Data Master', status: 'Estimé', import_id: d.data_as_of });
  });
  app.get('/api/public/meta', async c => {
    const d = await dataset(db); const a = aggregateSelection(d.farms, [], d.portfolio, []);
    const porteurs = [...new Set(d.farms.map(f => f.porteur).filter(Boolean))].sort();
    return c.json({ projects: a.scale.projects, regions: a.scale.regions, departements: a.scale.departements.sort((x, y) => x.key.localeCompare(y.key)), typologies: a.scale.typologies, statuses: a.scale.statuses, porteurs, rivers: riverNames(), bassins: basinNames(), levers: d.levers, indicators: d.indicators });
  });
  const body = async (c: any) => ((await c.req.json().catch(() => ({}))) ?? {}) as { filters?: Filters; bbox?: number[]; zoom?: number; page?: number; size?: number; cluster?: boolean };
  app.post('/api/public/selection', async c => {
    const d = await dataset(db); const { filters = {} } = await body(c);
    return c.json(aggregateSelection(applyFilters(d.farms, filters), d.indicators, d.portfolio, d.levers.map(l => l.code)));
  });
  // server-side clustering: the browser never receives the whole farm list
  // ids of the farms matching filters (and an optional rectangle on the blurred positions): used to build a selection
  app.post('/api/public/farm-ids', async c => { const d = await dataset(db); const { filters = {}, bbox } = await body(c); let sel = applyFilters(d.farms, filters);
    if (Array.isArray(bbox) && bbox.length === 4) { const [w, s, e, n] = bbox.map(Number); sel = sel.filter(f => f.lat != null && f.lng != null && f.lng >= w && f.lng <= e && f.lat >= s && f.lat <= n); }
    return c.json({ ids: sel.slice(0, 3000).map(f => f.id), total: sel.length }); });
  app.post('/api/public/map', async c => {
    const d = await dataset(db); const { filters = {}, bbox = [-6, 41, 10, 52], zoom = 6, cluster } = await body(c);
    const [w, s, e, n] = bbox; const z = Math.max(3, Math.min(14, Math.round(zoom)));
    const sel = applyFilters(d.farms, filters).filter(f => f.lat != null && f.lng != null);
    const vis = sel.filter(f => f.lng! >= w && f.lng! <= e && f.lat! >= s && f.lat! <= n);
    const pt = (f: (typeof vis)[number]) => ({ id: f.id, lat: +f.lat!.toFixed(4), lng: +f.lng!.toFixed(4), status: f.lbc_status, typology: f.typology, project: f.project, sau: f.sau == null ? null : Math.round(f.sau), dispo: f.vol_dispo == null ? null : Math.round(f.vol_dispo) });
    // cluster:false = every farm of the view as its own point (capped to keep the page fast)
    if (cluster === false || z >= 10 || vis.length <= 60) return c.json({ clusters: [], points: vis.slice(0, 2500).map(pt), total: sel.length, visible: vis.length, capped: vis.length > 2500 });
    const cell = 360 / 2 ** z / 1.6; const g = new Map<string, { lat: number; lng: number; n: number; sau: number; dispo: number; one: any }>();
    for (const f of vis) {
      const k = Math.floor(f.lat! / cell) + ':' + Math.floor(f.lng! / cell); const e2 = g.get(k) ?? g.set(k, { lat: 0, lng: 0, n: 0, sau: 0, dispo: 0, one: f }).get(k)!;
      e2.lat += f.lat!; e2.lng += f.lng!; e2.n++; e2.sau += f.sau ?? 0; e2.dispo += f.vol_dispo ?? 0;
    }
    const clusters = [], points = [];
    for (const v of g.values()) v.n === 1 ? points.push(pt(v.one)) : clusters.push({ lat: +(v.lat / v.n).toFixed(4), lng: +(v.lng / v.n).toFixed(4), n: v.n, sau: Math.round(v.sau), dispo: Math.round(v.dispo) });
    return c.json({ clusters, points, total: sel.length, visible: vis.length });
  });
  app.post('/api/public/farms', async c => {
    const d = await dataset(db); const { filters = {}, page = 1, size = 25 } = await body(c);
    const sel = applyFilters(d.farms, filters); const sz = Math.min(100, Math.max(1, size));
    return c.json({ total: sel.length, page, size: sz, rows: sel.slice((page - 1) * sz, page * sz).map(f => ({ id: f.id, project: f.project, region: f.region, departement: f.departement, typology: f.typology, status: f.lbc_status, sau: f.sau == null ? null : Math.round(f.sau), re_labelled: f.re_labelled == null ? null : Math.round(f.re_labelled), dispo: f.vol_dispo == null ? null : Math.round(f.vol_dispo) })) });
  });
  const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  app.post('/api/public/selection.xlsx', async c => {
    const d = await dataset(db); const { filters = {} } = await body(c); const farms = applyFilters(d.farms, filters);
    const buf = await selectionWorkbook(aggregateSelection(farms, d.indicators, d.portfolio, d.levers.map(l => l.code)), farms, { indicators: d.indicators, levers: d.levers, filters });
    return c.body(buf as any, 200, { 'content-type': XLSX, 'content-disposition': 'attachment; filename="farmgate_selection.xlsx"' });
  });
  app.get('/api/public/communes', c => c.json(searchCommunes(c.req.query('q') ?? '')));
  // (former external lookup kept below for reference, unreachable)
  app.get('/api/public/communes-gouv', async c => {
    const q = (c.req.query('q') ?? '').trim(); if (q.length < 2) return c.json([]);
    try {
      const r = await fetch(`https://geo.api.gouv.fr/communes?nom=${encodeURIComponent(q)}&fields=nom,codeDepartement,centre&boost=population&limit=8`, { signal: AbortSignal.timeout(4000) });
      const j = (await r.json()) as any[];
      return c.json(j.filter(x => x.centre).map(x => ({ name: x.nom, departement: x.codeDepartement, lat: x.centre.coordinates[1], lng: x.centre.coordinates[0] })));
    } catch { return c.json({ error: 'Service de recherche de communes indisponible' }, 502); }
  });

  // ---------- auth ----------
  app.post('/api/auth/login', async c => {
    const { email, password } = await c.req.json(); const r = await login(db, String(email ?? ''), String(password ?? ''));
    if ('error' in r) return c.json(r, 401);
    setCookie(c, COOKIE, r.token, { httpOnly: true, sameSite: 'Lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 8 * 3600 });
    return c.json({ ok: true });
  });
  app.post('/api/auth/logout', async c => { const t = getCookie(c, COOKIE); if (t) await logout(db, t); deleteCookie(c, COOKIE, { path: '/' }); return c.json({ ok: true }); });
  app.get('/api/auth/me', c => { const x = c.get('ctx'); return c.json(x ? { email: x.email, role: x.role, org: x.org ?? null } : null); });

  // ---------- admin (Carbone Farmers) ----------
  const admin = new Hono<Env>();
  admin.use('*', async (c, next) => { const x = c.get('ctx'); if (!x || !['platform_admin', 'staff'].includes(x.role)) return c.json({ error: 'Accès réservé' }, x ? 403 : 401); await next(); });
  admin.get('/imports', async c => c.json((await db.as(c.get('ctx')!, q => q.query(`select id,kind,filename,created_at,status,applied_at,counts from imports order by id desc limit 50`))).rows));
  admin.get('/imports/:id', async c => {
    const r = (await db.as(c.get('ctx')!, q => q.query(`select id,kind,filename,file_sha256,created_at,status,applied_at,counts,report from imports where id=$1`, [Number(c.req.param('id'))]))).rows[0];
    if (!r) return c.json({ error: 'Introuvable' }, 404);
    const rep = r.report ?? {}; const diff = rep.diff;
    return c.json({ ...r, report: { fatal: rep.fatal, by_code: rep.by_code, stats: rep.stats, issues: (rep.issues ?? []).slice(0, 500), issues_total: (rep.issues ?? []).length, diff: diff && { created: diff.created.slice(0, 200), created_total: diff.created.length, updated: diff.updated.slice(0, 100), updated_total: diff.updated.length, unchanged: diff.unchanged, absent: diff.absent, locked_skipped: diff.locked_skipped } } });
  });
  admin.get('/imports/:id/issues.csv', async c => {
    const r = (await db.as(c.get('ctx')!, q => q.query(`select report from imports where id=$1`, [Number(c.req.param('id'))]))).rows[0];
    const esc = (s: any) => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const csv = ['niveau;code;feuille;ligne;ferme;colonne;message', ...((r?.report?.issues ?? []) as any[]).map(i => [i.level, i.code, i.sheet, i.row, i.farm_id, i.column, i.message].map(esc).join(';'))].join('\n');
    return c.body('﻿' + csv, 200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="import-${c.req.param('id')}-rapport.csv"` });
  });
  admin.post('/imports', async c => {
    const form = await c.req.parseBody(); const file = form.file as File | undefined;
    if (!file || typeof file === 'string') return c.json({ error: 'Fichier manquant' }, 400);
    return c.json(await dryRun(db, Buffer.from(await file.arrayBuffer()), { filename: file.name, userId: c.get('ctx')!.uid, sheet: typeof form.sheet === 'string' && form.sheet ? form.sheet : undefined }));
  });
  admin.post('/imports/:id/apply', async c => { const r = await applyImport(db, Number(c.req.param('id')), c.get('ctx')!.uid); invalidate(); return c.json(r); });
  admin.post('/imports/:id/rollback', async c => { const r = await rollbackImport(db, Number(c.req.param('id')), c.get('ctx')!.uid); invalidate(); return c.json(r); });
  admin.get('/imports/:id/issues.xlsx', async c => {
    const r = (await db.as(c.get('ctx')!, q => q.query(`select report from imports where id=$1`, [Number(c.req.param('id'))]))).rows[0];
    return c.body((await issuesWorkbook(r?.report?.issues ?? [])) as any, 200, { 'content-type': XLSX, 'content-disposition': `attachment; filename="import-${c.req.param('id')}-rapport.xlsx"` });
  });
  admin.get('/projects', async c => c.json((await db.as(c.get('ctx')!, q => q.query(`select p.id,p.name,p.slug,o.name porteur,count(f.id)::int farms,count(f.id) filter (where f.lbc_status='Désengagé')::int withdrawn,count(f.id) filter (where f.absent_from_last_import)::int absent,max(f.last_diag_date) last_diag,count(f.verified_at)::int verified from projects p left join organizations o on o.id=p.porteur_org_id left join farms f on f.project_id=p.id group by p.id,o.name order by p.name`))).rows));
  // one re-importable data sheet per project (id "all" = whole Master List)
  admin.get('/projects/:id/sheet.xlsx', async c => {
    const id = c.req.param('id'); const w = await db.as(c.get('ctx')!, q => projectWorkbook(q, id === 'all' ? null : Number(id)));
    await db.owner.query(`insert into audit_log(user_id,action,entity,entity_id,detail) values($1,'export.project_sheet','project',$2,$3::jsonb)`, [c.get('ctx')!.uid, id, JSON.stringify({ farms: w.farms })]);
    return c.body(w.buffer as any, 200, { 'content-type': XLSX, 'content-disposition': `attachment; filename="${w.filename}"` });
  });
  // public name of the farm (shown instead of "Ferme <id>") — only with the farmer's consent
  admin.put('/farms/:id/identity', async c => { const b = await c.req.json(); const name = String(b.public_name ?? '').trim().slice(0, 120) || null; const consent = b.consent_public_name === true && !!name;
    const r = await db.as(c.get('ctx')!, q => q.query(`update farms set public_name=$2, consent_public_name=$3 where id=$1 returning id, public_name, consent_public_name`, [c.req.param('id').toUpperCase(), name, consent])); if (!r.rows[0]) return c.json({ error: 'Introuvable ou accès refusé' }, 404);
    await db.owner.query(`insert into audit_log(user_id,action,entity,entity_id,detail) values($1,'farm.identity','farm',$2,$3::jsonb)`, [c.get('ctx')!.uid, r.rows[0].id, JSON.stringify({ consent })]); return c.json(r.rows[0]); });
  admin.get('/open-points', async c => c.json((await db.as(c.get('ctx')!, q => q.query(`select * from open_points order by id`))).rows));
  admin.get('/audit', async c => c.json((await db.as(c.get('ctx')!, q => q.query(`select a.id,a.at,a.action,a.entity,a.entity_id,u.email from audit_log a left join users u on u.id=a.user_id order by a.id desc limit 100`))).rows));
  admin.get('/farms/:id', async c => c.json((await db.as(c.get('ctx')!, q => q.query(`select f.id,p.name,p.farmer,p.address,p.commune,p.postal_code,p.siret,p.legal_status,p.diagnostic_referent,f.sau,f.lbc_status,f.public_name,f.consent_public_name from farms f join farm_private p on p.farm_id=f.id where f.id=$1`, [c.req.param('id')]))).rows[0] ?? null));
  admin.get('/farms/:id/history', async c => c.json((await db.as(c.get('ctx')!, q => q.query(`select import_id,change,field,old_value,new_value from import_changes where farm_id=$1 order by id desc limit 200`, [c.req.param('id')]))).rows));
  const pages = pagesRoutes(db);
  admin.route('/', livrableRoutes(db).adm);
  const p8 = phase8Routes(db); app.route('/api/public', p8.pub); admin.route('/', p8.adm);
  const fa = funderAdminRoutes(db); admin.route('/', fa.adm); app.route('/api/funder', fa.fun);
  const shop = shopRoutes(db); app.route('/api/public', shop.pub); app.route('/api/shop', shop.buy); admin.route('/', shop.adm);
  const med = mediaRoutes(db); app.route('/api/media', med.pub); admin.route('/', med.adm);
  const p7 = phase7Routes(db); app.route('/api/me', p7.me); app.route('/api/owner', p7.own); admin.route('/', p7.adm);
  admin.route('/', moneyRoutes(db).adm);
  const sco = scoreRoutes(db); app.route('/api/public', sco.pub); admin.route('/', sco.adm);
  const fund = funderRoutes(db); app.route('/api/public', fund.pub); admin.route('/', fund.adm); app.route('/api/funder', fund.fun);
  const fus = followupRoutes(db);
  app.route('/api/public', fus.pub); admin.route('/', fus.adm);
  app.route('/api/public', pages.pub); admin.route('/', pages.adm);
  app.route('/api/admin', admin);
  return app;
}
