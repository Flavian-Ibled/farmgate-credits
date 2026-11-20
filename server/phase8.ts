// Phase 8 — public dashboard, methodology, open data downloads, funder public page (opt-in). Everything here is aggregated
// or non-identifying: no farm name, farmer, address, exact position, price or contract.
import { Hono } from 'hono';
import ExcelJS from 'exceljs';
import { PUBLIC, type Db, type Ctx } from './db.ts';
import { dataset } from './facts.ts';
import { aggregateSelection, type FarmFacts } from '../shared/aggregate.ts';
import { farmFunding } from './funders.ts';
import { configs } from './scores.ts';
import { slugify } from '../shared/catalogue.ts';
import { endOfProjectEstimate, farmEndOfProjectEstimate } from '../shared/rating.ts';
import { funderShare, FUNDED_STATUSES } from '../shared/allocation.ts';

type Env = { Variables: { ctx: (Ctx & { email: string }) | null } };
const FUNDED = `('${FUNDED_STATUSES.join("','")}')`;
const N = (x: any) => (x == null ? null : Number(x));
const r1 = (x: number | null | undefined, d = 0) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);
const trendOf = (evo: number | null, red: any, green: any) => (evo == null || red == null || green == null ? null : Math.abs(evo) < 0.0005 ? 'same' : (evo < 0) === (Number(red) > Number(green)) ? 'better' : 'worse');

export async function globalHidden(db: Db): Promise<string[]> { const r = (await db.as(PUBLIC, q => q.query(`select value from app_settings where key='public_hidden_indicators'`))).rows[0]; return Array.isArray(r?.value) ? r.value : []; }

export async function dashboard(db: Db) {
  const d = await dataset(db); const farms = d.farms; const hidden = await globalHidden(db);
  const sel = aggregateSelection(farms, d.indicators, d.portfolio, d.levers.map(l => l.code)); const fund = await farmFunding(db, farms.map(f => f.id));
  let sellable = 0, allocated = 0; for (const v of fund.values()) { sellable += v.sellable; allocated += v.allocated; }
  const slugs = new Map((await db.as(PUBLIC, q => q.query(`select p.name, p.slug, o.name porteur from projects p left join organizations o on o.id=p.porteur_org_id`))).rows.map(r => [r.name as string, r]));
  const byProject = new Map<string, FarmFacts[]>(); for (const f of farms) if (f.project) (byProject.get(f.project) ?? byProject.set(f.project, []).get(f.project)!).push(f);
  const projects = [...byProject].map(([name, fs]) => { let s = 0, a = 0; for (const f of fs) { const x = fund.get(f.id); s += x?.sellable ?? 0; a += x?.allocated ?? 0; } const fol = fs.filter(f => f.re_measured_r25 != null);
    return { slug: slugs.get(name)?.slug ?? null, name, porteur: slugs.get(name)?.porteur ?? null, farms: fs.length, sau: Math.round(fs.reduce((t, f) => t + (f.sau ?? 0), 0)), re_labelled: Math.round(fs.reduce((t, f) => t + (f.re_labelled ?? 0), 0)), measured: Math.round(fol.reduce((t, f) => t + (f.re_measured_r25 ?? 0), 0)), followed: fol.length, sellable: Math.round(s), allocated: Math.round(a), funded_pct: s > 0 ? a / s : null }; }).filter(p => p.farms > 0).sort((a, b) => b.re_labelled - a.re_labelled);
  const fol = farms.filter(f => f.re_measured_r25 != null); const E = fol.reduce((s, f) => s + (f.re_avoid_r25 ?? 0), 0), S = fol.reduce((s, f) => s + (f.re_stor_r25 ?? 0), 0);
  const defs = new Map(d.indicators.map((i: any) => [i.code, i])); const tracked = sel.cobenefits.filter(x => x.collected);
  const cobenefits = tracked.filter(x => !hidden.includes(x.code)).map(x => { const def: any = defs.get(x.code); return { code: x.code, category: def.category, label_fr: def.label_fr, label_en: def.label_en, unit: def.unit, initial: x.initial, prospectif: x.prospectif, evolution: x.evolution_prospectif, trend: trendOf(x.evolution_prospectif, def.threshold_red, def.threshold_green), n_with_data: x.n_with_data, n_applicable: x.n_applicable }; });
  const asOf = (await db.owner.query(`select max(applied_at) d from imports where status='applied'`)).rows[0]?.d /* only a date: safe to publish */;
  const funders = (await db.as(PUBLIC, q => q.query(`select name, public_slug from organizations where type='funder' and public_name_policy='named' and public_page_enabled and public_slug is not null order by name`))).rows;
  return { data_as_of: asOf ? new Date(asOf).toISOString().slice(0, 10) : null, source: 'Data Master Carbone Farmers',
    scale: { farms: sel.scale.farms, sau: Math.round(sel.scale.sau), projects: projects.length, regions: sel.scale.regions.filter(r => r.key !== '—').length, statuses: sel.scale.statuses, regions_list: sel.scale.regions.filter(r => r.key !== '—').slice(0, 12) },
    carbon: { re_labelled: Math.round(sel.carbon.re_labelled_5y), avoidance: sel.carbon.n_with_split ? Math.round(sel.carbon.re_avoidance_5y) : null, storage: sel.carbon.n_with_split ? Math.round(sel.carbon.re_storage_5y) : null, n_with_split: sel.carbon.n_with_split, sellable: Math.round(sellable), allocated: Math.round(allocated), available: Math.round(Math.max(0, sellable - allocated)), funded_pct: sellable > 0 ? allocated / sellable : null,
      followup: fol.length ? { year: 2025, farms: fol.length, measured: Math.round(E + S), labelled_of_followed: Math.round(fol.reduce((s, f) => s + (f.re_labelled ?? 0), 0)), end_of_project_estimate: Math.round(endOfProjectEstimate(E, S)) } : null },
    projects, cobenefits, cobenefits_count: { tracked: tracked.length, shown: cobenefits.length }, funders };
}

export async function methodology(db: Db) {
  const d = await dataset(db); const c = await configs(db);
  return { eau: { ...c.eau_meta, config: c.eau }, bio: { ...c.bio_meta, config: c.bio },
    indicators: d.indicators.filter((i: any) => i.collected).map((i: any) => ({ code: i.code, category: i.category, label_fr: i.label_fr, label_en: i.label_en, unit: i.unit, threshold_red: N(i.threshold_red), threshold_green: N(i.threshold_green), status: i.config_status, why_fr: i.why_fr })) };
}

// ---------- open data ----------
const DICT = {
  farms: { title: 'Fermes (non identifiantes)', cols: [['id', 'Identifiant public de la ferme'], ['project', 'Projet collectif'], ['porteur', 'Porteur du projet'], ['region', 'Région'], ['departement', 'Département'], ['typology', 'Typologie'], ['lbc_status', 'Statut Label Bas Carbone'], ['sau_ha', 'Surface agricole utile arrondie (ha)'], ['re_labelled_tco2e', 'Crédits labellisés sur 5 ans, rabais inclus (tCO₂e, estimation)'], ['funded_tco2e', 'Crédits déjà financés (tCO₂e)'], ['available_tco2e', 'Crédits encore disponibles (tCO₂e)'], ['measured_r25_tco2e', 'Réductions mesurées au suivi récolte 2025 (tCO₂e)']] },
  projects: { title: 'Projets', cols: [['slug', 'Identifiant du projet'], ['name', 'Nom'], ['porteur', 'Porteur'], ['farms', 'Nombre de fermes'], ['sau_ha', 'SAU totale (ha)'], ['re_labelled_tco2e', 'Crédits labellisés sur 5 ans (tCO₂e, estimation)'], ['funded_pct', 'Part financée des crédits vendables (0 à 1)'], ['measured_r25_tco2e', 'Mesuré récolte 2025 (tCO₂e)'], ['farms_followed', 'Fermes suivies'], ['end_of_project_estimate_tco2e', 'Estimation de fin de projet (tCO₂e, projection)'], ['indicators_tracked', 'Co-bénéfices suivis'], ['indicators_published', 'Co-bénéfices publiés']] },
  cobenefits: { title: 'Co-bénéfices par projet', cols: [['project', 'Projet'], ['category', 'Catégorie'], ['indicator', 'Indicateur'], ['unit', 'Unité'], ['initial', 'Valeur initiale (moyenne pondérée par la SAU)'], ['prospectif', 'Valeur à 5 ans (objectif)'], ['evolution', 'Évolution calculée sur les valeurs agrégées'], ['farms_with_data', 'Fermes avec donnée'], ['farms_applicable', 'Fermes concernées']] },
} as const;
export type DatasetName = keyof typeof DICT;

export async function buildDatasets(db: Db): Promise<Record<DatasetName, Record<string, any>[]>> {
  const d = await dataset(db); const farms = d.farms; const fund = await farmFunding(db, farms.map(f => f.id)); const dash = await dashboard(db);
  const projRows = (await db.as(PUBLIC, q => q.query(`select p.name, p.slug, p.hidden_indicators hidden from projects p`))).rows; const meta = new Map(projRows.map(r => [r.name as string, r]));
  const fRows = farms.map(f => { const x = fund.get(f.id); return { id: f.id, project: f.project, porteur: f.porteur ?? null, region: f.region, departement: f.departement, typology: f.typology, lbc_status: f.lbc_status, sau_ha: r1(f.sau), re_labelled_tco2e: r1(f.re_labelled), funded_tco2e: r1(x?.allocated ?? 0), available_tco2e: r1(x?.remaining ?? 0), measured_r25_tco2e: r1(f.re_measured_r25) }; });
  const byProject = new Map<string, FarmFacts[]>(); for (const f of farms) if (f.project) (byProject.get(f.project) ?? byProject.set(f.project, []).get(f.project)!).push(f);
  const pRows: Record<string, any>[] = [], cRows: Record<string, any>[] = []; const defs = new Map(d.indicators.map((i: any) => [i.code, i]));
  for (const [name, fs] of byProject) {
    const dp = dash.projects.find(p => p.name === name)!; const m = meta.get(name); const hidden: string[] = m?.hidden ?? []; const sel = aggregateSelection(fs, d.indicators, { farms: fs.length, sau: 0 }, []); const tracked = sel.cobenefits.filter(x => x.collected);
    const fol = fs.filter(f => f.re_measured_r25 != null); const E = fol.reduce((s, f) => s + (f.re_avoid_r25 ?? 0), 0), S = fol.reduce((s, f) => s + (f.re_stor_r25 ?? 0), 0);
    pRows.push({ slug: m?.slug ?? null, name, porteur: dp.porteur, farms: fs.length, sau_ha: dp.sau, re_labelled_tco2e: dp.re_labelled, funded_pct: r1(dp.funded_pct, 3), measured_r25_tco2e: fol.length ? dp.measured : null, farms_followed: fol.length, end_of_project_estimate_tco2e: fol.length ? Math.round(endOfProjectEstimate(E, S)) : null, indicators_tracked: tracked.length, indicators_published: tracked.filter(x => !hidden.includes(x.code)).length });
    for (const x of tracked) if (!hidden.includes(x.code)) { const def: any = defs.get(x.code); cRows.push({ project: name, category: def.category, indicator: def.label_fr, unit: def.unit, initial: r1(x.initial, 3), prospectif: r1(x.prospectif, 3), evolution: r1(x.evolution_prospectif, 4), farms_with_data: x.n_with_data, farms_applicable: x.n_applicable }); }
  }
  return { farms: fRows, projects: pRows, cobenefits: cRows };
}
const csv = (rows: Record<string, any>[], cols: readonly (readonly [string, string])[]) => '﻿' + [cols.map(c => c[0]).join(';'), ...rows.map(r => cols.map(([k]) => { const v = r[k]; return v == null ? '' : typeof v === 'number' ? String(v) : `"${String(v).replace(/"/g, '""')}"`; }).join(';'))].join('\r\n');
async function xlsx(sets: Record<DatasetName, Record<string, any>[]>, asOf: string | null) {
  const wb = new ExcelJS.Workbook(); for (const [k, rows] of Object.entries(sets) as [DatasetName, Record<string, any>[]][]) { const ws = wb.addWorksheet(DICT[k].title.slice(0, 31)); ws.addRow(DICT[k].cols.map(c => c[0])); for (const r of rows) ws.addRow(DICT[k].cols.map(([c]) => r[c] ?? null)); ws.getRow(1).font = { bold: true }; ws.views = [{ state: 'frozen', ySplit: 1 }]; ws.columns.forEach(c => { c.width = 22; }); }
  const dd = wb.addWorksheet('Dictionnaire'); dd.addRow(['Jeu', 'Colonne', 'Signification']); for (const [k, v] of Object.entries(DICT)) for (const [c, m] of v.cols) dd.addRow([v.title, c, m]); dd.addRow([]); dd.addRow(['Source', 'Data Master Carbone Farmers', asOf ?? '']); dd.addRow(['Statut', 'Crédits labellisés et estimations de fin de projet : estimations sous réserve du suivi annuel et de l’audit.']); dd.addRow(['Licence', 'à définir par Carbone Farmers']); dd.getColumn(2).width = 40; dd.getColumn(3).width = 90;
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function phase8Routes(db: Db) {
  const pub = new Hono<Env>(), adm = new Hono<Env>();
  pub.get('/impact', async c => c.json(await dashboard(db)));
  pub.get('/methodology', async c => c.json(await methodology(db)));
  pub.get('/downloads', async c => { const s = await buildDatasets(db); const asOf = (await dashboard(db)).data_as_of; return c.json({ data_as_of: asOf, licence: null, datasets: (Object.keys(DICT) as DatasetName[]).map(k => ({ name: k, title: DICT[k].title, rows: s[k].length, columns: DICT[k].cols.map(([c, m]) => ({ name: c, description: m })) })) }); });
  pub.get('/downloads/:file', async c => {
    const m = /^([a-z_]+)\.(csv|xlsx)$/.exec(c.req.param('file')); if (!m) return c.json({ error: 'Fichier inconnu' }, 404); const sets = await buildDatasets(db); const today = new Date().toISOString().slice(0, 10);
    if (m[1] === 'farmgate_data' && m[2] === 'xlsx') return c.body(await xlsx(sets, (await dashboard(db)).data_as_of) as any, 200, { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'content-disposition': `attachment; filename="farmgate_donnees_${today}.xlsx"` });
    if (m[2] === 'csv' && m[1] in DICT) return c.body(csv(sets[m[1] as DatasetName], DICT[m[1] as DatasetName].cols) as any, 200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="farmgate_${m[1]}_${today}.csv"` });
    return c.json({ error: 'Fichier inconnu' }, 404);
  });
  // funder public page (opt-in): aggregated contribution, never amounts or prices
  pub.get('/funders/:slug', async c => {
    const o = (await db.owner.query(`select id, name from organizations where public_slug=$1 and type='funder' and public_name_policy='named' and public_page_enabled`, [c.req.param('slug')])).rows[0]; if (!o) return c.json({ error: 'Page introuvable' }, 404);
    const d = await dataset(db); const byId = new Map(d.farms.map(f => [f.id, f]));
    const lines = (await db.owner.query(`select l.farm_id, sum(l.volume_tco2e) v from allocation_lines l join allocations a on a.id=l.allocation_id where a.funder_org_id=$1 and a.status in ${FUNDED} group by 1`, [o.id])).rows;
    let volume = 0, sau = 0, measured = 0, estimate = 0, anyMeasured = false; const projects = new Set<string>(), regions = new Set<string>(); const used: string[] = [];
    for (const l of lines) { const f = byId.get(l.farm_id); if (!f) continue; const v = Number(l.v), sh = funderShare(v, f.re_labelled) ?? 0; volume += v; sau += (f.sau ?? 0) * sh; used.push(f.id); if (f.project) projects.add(f.project); if (f.region) regions.add(f.region); if (f.re_measured_r25 != null) { anyMeasured = true; measured += f.re_measured_r25 * sh; estimate += farmEndOfProjectEstimate(f.re_avoid_r25 ?? 0, f.re_stor_r25 ?? 0) * sh; } }
    const sel = aggregateSelection(used.map(i => byId.get(i)!), d.indicators, d.portfolio, []); const hidden = await globalHidden(db); const defs = new Map(d.indicators.map((i: any) => [i.code, i]));
    const good = sel.cobenefits.filter(x => x.collected && !hidden.includes(x.code)).map(x => { const def: any = defs.get(x.code); return { label_fr: def.label_fr, label_en: def.label_en, unit: def.unit, evolution: x.evolution_prospectif, trend: trendOf(x.evolution_prospectif, def.threshold_red, def.threshold_green), n: x.n_with_data }; }).filter(x => x.trend === 'better').slice(0, 6);
    return c.json({ name: o.name, slug: c.req.param('slug'), farms: used.length, projects: [...projects].sort(), regions: [...regions].sort(), volume_tco2e: Math.round(volume), sau_attributed: Math.round(sau), measured_attributed: anyMeasured ? Math.round(measured) : null, estimate_attributed: anyMeasured ? Math.round(estimate) : null, cobenefits: good, data_as_of: (await dashboard(db)).data_as_of });
  });

  adm.put('/funders/:id/public-page', async c => {
    const id = Number(c.req.param('id')); const enabled = (await c.req.json()).enabled === true; const o = (await db.owner.query(`select name, public_name_policy, public_slug from organizations where id=$1 and type='funder'`, [id])).rows[0]; if (!o) return c.json({ error: 'Financeur introuvable' }, 404);
    if (enabled && o.public_name_policy !== 'named') return c.json({ error: 'Passez d’abord la visibilité publique sur « nommé » : la page affiche le nom du financeur' }, 400);
    let slug = o.public_slug; if (enabled && !slug) { slug = slugify(o.name) || `financeur-${id}`; if ((await db.owner.query(`select 1 from organizations where public_slug=$1 and id<>$2`, [slug, id])).rows[0]) slug = `${slug}-${id}`; }
    const r = await db.as(c.get('ctx')!, q => q.query(`update organizations set public_page_enabled=$2, public_slug=$3 where id=$1 returning public_page_enabled, public_slug`, [id, enabled, slug])); if (!r.rows[0]) return c.json({ error: 'Accès refusé' }, 403);
    await db.owner.query(`insert into audit_log(user_id,action,entity,entity_id,detail) values($1,'funder.public_page','organization',$2,$3::jsonb)`, [c.get('ctx')!.uid, String(id), JSON.stringify({ enabled })]); return c.json(r.rows[0]);
  });
  // which co-benefits the public dashboard (portfolio level) shows
  adm.get('/portfolio-visibility', async c => { const d = await dashboard(db); const hidden = await globalHidden(db); const sel = aggregateSelection((await dataset(db)).farms, (await dataset(db)).indicators, (await dataset(db)).portfolio, []); const defs = new Map((await dataset(db)).indicators.map((i: any) => [i.code, i]));
    return c.json({ kind: 'global', id: 'all', name: 'Tableau de bord public', hidden, inherited: [], items: sel.cobenefits.filter(x => x.collected).map(x => { const def: any = defs.get(x.code); return { code: x.code, category: def.category, label_fr: def.label_fr, unit: def.unit, initial: x.initial, prospectif: x.prospectif, evolution: x.evolution_prospectif, trend: trendOf(x.evolution_prospectif, def.threshold_red, def.threshold_green), has_threshold: def.threshold_red != null }; }), shown: d.cobenefits_count.shown }); });
  adm.put('/portfolio-visibility', async c => { const known = new Set((await dataset(db)).indicators.map(i => i.code)); const hidden = [...new Set(((await c.req.json()).hidden ?? []).map(String).filter((x: string) => known.has(x)))];
    const r = await db.as(c.get('ctx')!, q => q.query(`insert into app_settings(key,value) values('public_hidden_indicators',$1::jsonb) on conflict(key) do update set value=excluded.value returning key`, [JSON.stringify(hidden)])); if (!r.rows[0]) return c.json({ error: 'Accès refusé' }, 403);
    await db.owner.query(`insert into audit_log(user_id,action,entity,entity_id,detail) values($1,'cobenefits.visibility','portfolio','all',$2::jsonb)`, [c.get('ctx')!.uid, JSON.stringify({ hidden })]); return c.json({ ok: true, hidden }); });
  return { pub, adm };
}
