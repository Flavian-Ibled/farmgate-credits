// Phase 2: project page (8-block client reference sheet), farm page, admin configuration, PDF sheets.
import { Hono } from 'hono';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PUBLIC, type Db, type Ctx } from './db.ts';
import { dataset, invalidate } from './facts.ts';
import { aggregateSelection, evolution, type FarmFacts } from '../shared/aggregate.ts';
import { farmFunding } from './funders.ts';
import { farmScoreInPool, projectScores } from './scores.ts';
import { moneyView, farmLeverCosts, projectLeverCosts, SOCIAL_KEYS } from './money.ts';
import { funding as fundingOf } from '../shared/allocation.ts';
import { rating, categoryNote, endOfProjectEstimate, farmEndOfProjectEstimate } from '../shared/rating.ts';

type Env = { Variables: { ctx: (Ctx & { email: string }) | null } };
export const BLOCKS = ['geography', 'standard', 'baseline', 'volumes', 'cobenefits', 'mrv', 'contract', 'cost'] as const;
const num = (x: any) => (x === '' || x == null ? null : Number.isFinite(Number(x)) ? Number(x) : (() => { throw new Error(`Nombre invalide : ${x}`); })());
const str = (x: any) => (x == null || String(x).trim() === '' ? null : String(x).trim().slice(0, 4000));

type Vals = { initial: number | null; prospectif: number | null; evolution: number | null; n_with_data?: number; n_applicable?: number; collected: boolean };
/** better / worse / same, from the direction given by the thresholds (red > green = lower is better); null when no threshold */
const trendOf = (evo: number | null, red: any, green: any) => (evo == null || red == null || green == null ? null : Math.abs(evo) < 0.0005 ? 'same' : (evo < 0) === (Number(red) > Number(green)) ? 'better' : 'worse');
/** Applies the display choice: hidden indicators are removed from the page; the page says how many are tracked vs shown. */
function visible(cards: ReturnType<typeof scorecards>, hidden: string[]) {
  const all = cards.flatMap(c => c.items).filter(i => i.collected);
  const out = cards.map(c => ({ ...c, items: c.items.filter(i => !hidden.includes(i.code)) })).filter(c => c.items.length);
  return { scorecards: out, cobenefits: { tracked: all.length, shown: all.filter(i => !hidden.includes(i.code)).length } };
}
function scorecards(d: Awaited<ReturnType<typeof dataset>>, get: (code: string) => Vals | undefined, notes: Record<string, string> = {}) {
  const cats = [...new Set(d.indicators.map(i => i.category))];
  return cats.map(category => {
    const items = d.indicators.filter(i => i.category === category).map((def: any) => {
      const v = get(def.code) ?? { initial: null, prospectif: null, evolution: null, collected: false };
      return { code: def.code, label_fr: def.label_fr, label_en: def.label_en, unit: def.unit, weight: Number(def.weight), ...v,
        rating_initial: rating(v.initial, def.threshold_red, def.threshold_green), rating_prospectif: rating(v.prospectif, def.threshold_red, def.threshold_green),
        thresholds: def.threshold_red == null ? null : { red: Number(def.threshold_red), green: Number(def.threshold_green), status: def.config_status },
        trend: trendOf(v.evolution, def.threshold_red, def.threshold_green), why_fr: def.why_fr, why_en: def.why_en, farm_note: notes[def.code] ?? null,
        levers: (def.lever_codes ?? []).map((c: string) => d.levers.find(l => l.code === c)?.name_fr).filter(Boolean) };
    });
    return { category, initial: categoryNote(items.map(i => ({ rating: i.rating_initial, weight: i.weight }))), prospectif: categoryNote(items.map(i => ({ rating: i.rating_prospectif, weight: i.weight }))), items };
  });
}
function followup(farms: FarmFacts[], level: 'project' | 'farm' = 'project') {
  const fol = farms.filter(f => f.re_measured_r25 != null);
  if (!fol.length) return null;
  const E = fol.reduce((s, f) => s + (f.re_avoid_r25 ?? 0), 0), S = fol.reduce((s, f) => s + (f.re_stor_r25 ?? 0), 0);
  return { harvest_year: 2025, farms_followed: fol.length, farms_total: farms.length, re_avoidance: E, re_storage: S, re_total: E + S,
    labelled_of_followed: fol.reduce((s, f) => s + (f.re_labelled ?? 0), 0), end_of_project_estimate: level === 'farm' ? farmEndOfProjectEstimate(E, S) : endOfProjectEstimate(E, S),
    formula: level === 'farm' ? 'tCO₂e générés au 1er suivi × 5 récoltes' : '5 × évitement mesuré + 15 × stockage mesuré (gain de stockage croissant chaque année)', status: 'diagnosed' };
}
const TBD = (owner: string) => ({ value: null, owner });

export function pagesRoutes(db: Db) {
  const pub = new Hono<Env>(), adm = new Hono<Env>();
  const projects = () => db.as(PUBLIC, q => q.query(`select p.*, o.name porteur from projects p left join organizations o on o.id=p.porteur_org_id order by p.name`)).then(r => r.rows);

  pub.get('/projects', async c => {
    const d = await dataset(db);
    return c.json((await projects()).map(p => { const fs = d.farms.filter(f => f.project === p.name); return { slug: p.slug, name: p.name, porteur: p.porteur, farms: fs.length, sau: fs.reduce((s, f) => s + (f.sau ?? 0), 0), re_labelled: fs.reduce((s, f) => s + (f.re_labelled ?? 0), 0), vol_dispo: fs.reduce((s, f) => s + (f.vol_dispo ?? 0), 0), followed: fs.filter(f => f.re_measured_r25 != null).length }; }).filter(p => p.farms > 0));
  });

  pub.get('/projects/:slug', async c => {
    const d = await dataset(db); const p = (await projects()).find(x => x.slug === c.req.param('slug'));
    if (!p) return c.json({ error: 'Projet introuvable' }, 404);
    const farms = d.farms.filter(f => f.project === p.name);
    const sel = aggregateSelection(farms, d.indicators, d.portfolio, d.levers.map(l => l.code));
    const cb = new Map(sel.cobenefits.map(x => [x.code, x]));
    const rows = (await db.as(PUBLIC, q => q.query(`select reference_period, project_period, count(*)::int n from farms where project_id=$1 group by 1,2 order by 3 desc`, [p.id]))).rows;
    const communes = (await db.owner.query(`select count(distinct pr.commune)::int n from farm_private pr join farms f on f.id=pr.farm_id where f.project_id=$1`, [p.id])).rows[0].n; // a count only
    const typ = sel.scale.typologies.map(t => t.key);
    const method = [typ.includes('Grandes cultures') && 'Label Bas Carbone — méthode Grandes Cultures', typ.includes('Élevage bovins') && 'Label Bas Carbone — méthode CARBON AGRI (bovins)'].filter(Boolean);
    const fu = followup(farms);
    const auto: Record<string, any> = {
      geography: { regions: sel.scale.regions.filter(r => r.key !== '—'), departements: sel.scale.departements.filter(r => r.key !== '—'), communes_count: communes, farms_on_map: farms.filter(f => f.lat != null).length },
      standard: { label: 'Label Bas Carbone', methodologies: method, methodology_version: TBD('Carbone Farmers'), dossier_number: TBD('Carbone Farmers'), labelling_date: TBD('Carbone Farmers'), validity: TBD('Carbone Farmers') },
      baseline: { reference_periods: rows.filter(r => r.reference_period).map(r => ({ value: r.reference_period, farms: r.n })), em_init_ha: sel.carbon.em_init_ha, st_init_ha: sel.carbon.st_init_ha, tool: TBD('Équipe agronomie'), hypotheses: TBD('Équipe agronomie') },
      volumes: { planned_5y: sel.carbon.re_labelled_5y, measured: fu ? [{ harvest_year: fu.harvest_year, measured: fu.re_total, farms_followed: fu.farms_followed }] : [], end_of_project_estimate: fu?.end_of_project_estimate ?? null, sold: sel.carbon.vol_vendu, available: sel.carbon.vol_dispo, verified: TBD('Auditeur'), issued: TBD('Carbone Farmers'), retired: TBD('Carbone Farmers') },
      cobenefits: { environmental: 'voir les fiches co-bénéfices ci-dessous', social_territorial: TBD('Carbone Farmers') },
      mrv: { data_collected: TBD('Équipe agronomie'), tools: TBD('Équipe agronomie'), frequency: TBD('Équipe agronomie'), verification_body: TBD('Carbone Farmers'), uncertainty: TBD('Équipe agronomie'), rabais: TBD('Équipe agronomie') },
      contract: { project_periods: rows.filter(r => r.project_period).map(r => ({ value: r.project_period, farms: r.n })), mandatary: 'Carbone Farmers (mandataire)', contract_type: TBD('Carbone Farmers / juridique'), pricing: TBD('Équipe commerciale'), payment_schedule: TBD('Équipe commerciale'), non_delivery: TBD('Carbone Farmers / juridique') },
      cost: { total_eur: TBD('Équipe commerciale'), farmer_share: (() => { const m = moneyView(null, p.remuneration); return `${m.farmer_pct} % du prix de la tonne${m.advice_pct ? ` (dont ${m.advice_pct} % de conseil agronomique)` : ''}${m.source === 'default' ? ' — minimum garanti' : ''}`; })(), breakdown: moneyView(null, p.remuneration).flows.some(f => !f.known) ? TBD('Carbone Farmers') : 'voir « Où va l’argent »' },
    };
    return c.json({
      project: { slug: p.slug, name: p.name, porteur: p.porteur, partner_type: p.partner_type },
      scores: await projectScores(db, farms),
      remuneration: moneyView(null, p.remuneration), lever_costs: await db.as(PUBLIC, q => projectLeverCosts(q, p.id)),
      social: SOCIAL_KEYS.map(k => ({ key: k, value: p.social?.[k] ?? null })), social_meta: p.social ? { source: p.social.source ?? null, verified_by: p.social.verified_by ?? null, updated_at: p.social.updated_at ?? null } : null,
      funding: await (async () => { const m = await farmFunding(db, farms.map(f => f.id)); let s = 0, a = 0, un = 0; const names = new Set<string>(); for (const v of m.values()) { s += v.sellable; a += v.allocated; un += v.unassigned; v.funders.forEach(n => names.add(n)); } return { ...fundingOf(s, a), funders: [...names].sort(), unassigned: Math.round(un) }; })(),
      selection: sel, followup: fu,
      blocks: BLOCKS.map(k => ({ key: k, auto: auto[k], text: p[`block_${k}`] ?? null })),
      ...visible(scorecards(d, code => { const x = cb.get(code); return x && { initial: x.initial, prospectif: x.prospectif, evolution: x.evolution_prospectif, n_with_data: x.n_with_data, n_applicable: x.n_applicable, collected: x.collected }; }), p.hidden_indicators ?? []),
      levers: d.levers, data_source: `Data Master — import n° ${d.data_as_of ?? '—'}`,
    });
  });

  pub.get('/farms/:id', async c => {
    const d = await dataset(db); const id = c.req.param('id'); const f = d.farms.find(x => x.id === id);
    if (!f) return c.json({ error: 'Ferme introuvable' }, 404);
    const { row, notes, media, stories, crops, fus, sheet, costs } = await db.as(PUBLIC, async q => ({
      row: (await q.query(`select f.public_name, f.consent_public_name, f.reference_period, f.project_period, f.lbc_dossier_number, f.rabais, f.rabais_text, f.re_total_ha_yr, f.re_evit_total, f.re_stock_total, f.last_diag_date, f.verified_at, f.verified_by, f.hidden_indicators, p.hidden_indicators project_hidden, p.remuneration project_remuneration, p.slug project_slug from farms f left join projects p on p.id=f.project_id where f.id=$1`, [id])).rows[0],
      notes: (await q.query(`select indicator_code, note_fr from farm_indicator_notes where farm_id=$1`, [id])).rows,
      media: (await q.query(`select kind, file_url, alt_fr, caption_fr, credit from media where farm_id=$1 order by sort`, [id])).rows, // RLS: public + consent only
      stories: (await q.query(`select locale, context, motivations, stakes from stories where farm_id=$1`, [id])).rows, // RLS: published only
      costs: (await q.query(`select lever_code, cost_annual_eur_ha, saving_eur_ha from farm_levers where farm_id=$1 and (cost_annual_eur_ha is not null or saving_eur_ha is not null)`, [id])).rows,
      fus: (await q.query(`select harvest_year, status, diagnostic_date, em_baseline_ha, em_year_ha, st_year_ha, emissions_year, storage_year, re_avoidance_year, re_storage_year, re_total_year, net_balance_ha, net_balance_change, document_url from annual_followups where farm_id=$1 order by harvest_year`, [id])).rows,
      sheet: (await q.query(`select content from farm_sheets where farm_id=$1`, [id])).rows[0]?.content ?? null, // RLS: published only
      crops: (await q.query(`select harvest_year, crop, hectares, share from farm_crops where farm_id=$1 order by harvest_year, hectares desc`, [id])).rows,
    }));
    const fu = followup([f], 'farm');
    const start = /(\d{4})/.exec(row.project_period ?? '')?.[1];
    const roadmap = start ? [1, 2, 3, 4, 5].map(i => { const y = Number(start) + i; return { harvest_year: y, label: `R${String(y).slice(2)}`, status: fus.find(x => x.harvest_year === y)?.status ?? 'planned' }; }) : null;
    const fam = [...new Set(d.levers.map(l => l.family))];
    return c.json({
      id, name: row.consent_public_name && row.public_name ? row.public_name : null,
      project: f.project, project_slug: row.project_slug, porteur: f.porteur, region: f.region, departement: f.departement, typology: f.typology, lbc_status: f.lbc_status, sau: f.sau == null ? null : Math.round(f.sau),
      lat: f.lat, lng: f.lng, reference_period: row.reference_period, project_period: row.project_period, lbc_dossier_number: row.lbc_dossier_number,
      last_diag_date: f.last_diag_date, verified_at: f.verified_at, verified_by: row.verified_by, rabais: row.rabais == null ? row.rabais_text : Number(row.rabais),
      carbon: { re_labelled: f.re_labelled, re_ha_yr: row.re_total_ha_yr == null ? null : Number(row.re_total_ha_yr), re_avoidance: f.re_evit_total, re_storage: f.re_stock_total, em_init_ha: f.em_init_ha, em_target_ha: f.em_target_ha, st_init_ha: f.st_init_ha, st_target_ha: f.st_target_ha, vol_vendu: f.vol_vendu, vol_dispo: f.vol_dispo },
      funding: (await farmFunding(db, [id])).get(id) ?? null,
      scores: await farmScoreInPool(db, f),
      remuneration: moneyView(null, row.project_remuneration), lever_costs: await db.as(PUBLIC, q => farmLeverCosts(q, id)),
      followup: fu, roadmap, bassin: f.bassin ?? null, has_followup: fus.some(x => x.status !== 'planned'),
      followups: fus.map(x => ({ harvest_year: x.harvest_year, status: x.status, diagnostic_date: x.diagnostic_date ? new Date(x.diagnostic_date).toISOString().slice(0, 10) : null, em_baseline_ha: x.em_baseline_ha == null ? null : Number(x.em_baseline_ha), em_year_ha: x.em_year_ha != null ? Number(x.em_year_ha) : x.emissions_year != null && f.sau ? Number(x.emissions_year) / f.sau : null, st_year_ha: x.st_year_ha != null ? Number(x.st_year_ha) : x.storage_year != null && f.sau ? Number(x.storage_year) / f.sau : null, re_avoidance: x.re_avoidance_year == null ? null : Number(x.re_avoidance_year), re_storage: x.re_storage_year == null ? null : Number(x.re_storage_year), measured: x.re_total_year == null ? null : Number(x.re_total_year), net_balance_ha: x.net_balance_ha == null ? null : Number(x.net_balance_ha), net_balance_change: x.net_balance_change == null ? null : Number(x.net_balance_change), document_url: x.document_url })),
      levers: f.levers === null ? null : fam.map(family => ({ family, items: d.levers.filter(l => l.family === family && f.levers!.includes(l.code)).map(l => ({ ...l, ...(costs.find(c => c.lever_code === l.code) ?? {}) })) })).filter(x => x.items.length),
      ...visible(scorecards(d, code => { const v = f.ind[code]; if (!v) return undefined; const i = v.initial ?? null, p2 = v.prospectif ?? null; return { initial: i, prospectif: p2, evolution: evolution(i, p2), collected: i != null || p2 != null }; }, Object.fromEntries(notes.filter(n => n.note_fr).map(n => [n.indicator_code, n.note_fr]))), [...(row.hidden_indicators ?? []), ...(row.project_hidden ?? [])]),
      crops, media, story: stories[0] ?? null, sheet, data_source: `Data Master — import n° ${d.data_as_of ?? '—'}`,
    });
  });

  // Server-side PDF of the print layout (headless Chrome), so the sheet is identical on every device.
  pub.get('/pdf', async c => {
    const path = c.req.query('path') ?? '';
    if (!/^\/(fermes|projets|certificat)\/[A-Za-z0-9_-]{1,80}$/.test(path)) return c.json({ error: 'Chemin non autorisé' }, 400);
    const chrome = process.env.FG_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    if (!existsSync(chrome)) return c.json({ error: 'Moteur PDF (Chrome) indisponible sur ce serveur : utilisez « Imprimer » du navigateur' }, 501);
    const dir = mkdtempSync(join(tmpdir(), 'fg-pdf-')); const out = join(dir, 'sheet.pdf');
    const lang = c.req.query('lang') === 'en' ? 'en' : 'fr';
    try {
      await new Promise<void>((res, rej) => execFile(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', `--user-data-dir=${join(dir, 'profile')}`, '--no-pdf-header-footer', '--virtual-time-budget=12000', '--run-all-compositor-stages-before-draw', `--print-to-pdf=${out}`, `${process.env.FG_WEB_URL ?? 'http://localhost:5173'}${path}?print=1&lang=${lang}`], { timeout: 45000 }, e => (e && !existsSync(out) ? rej(e) : res())));
      return c.body(readFileSync(out) as any, 200, { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="farmgate_${path.split('/').pop()}_${new Date().toISOString().slice(0, 10)}.pdf"` });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  // ---------- admin configuration (every change is audited; RLS restricts writes to Carbone Farmers roles) ----------
  const audit = (c: any, action: string, entity: string, id: string, detail: unknown) => db.owner.query(`insert into audit_log(user_id,action,entity,entity_id,detail) values($1,$2,$3,$4,$5::jsonb)`, [c.get('ctx').uid, action, entity, id, JSON.stringify(detail)]);
  adm.get('/config', async c => c.json(await db.as(c.get('ctx')!, async q => ({ indicators: (await q.query(`select * from indicators order by sort`)).rows, levers: (await q.query(`select * from levers order by sort`)).rows, projects: (await q.query(`select id,slug,name,${BLOCKS.map(b => 'block_' + b).join(',')} from projects order by name`)).rows }))));
  adm.put('/indicators/:code', async c => {
    const b = await c.req.json(); const red = num(b.threshold_red), green = num(b.threshold_green), weight = num(b.weight) ?? 1;
    if ((red == null) !== (green == null)) throw new Error('Renseignez les deux seuils (rouge et vert), ou aucun');
    if (red != null && red === green) throw new Error('Les seuils rouge et vert doivent être différents');
    if (weight < 0) throw new Error('Le poids doit être positif');
    const levers = Array.isArray(b.lever_codes) ? b.lever_codes.map(String) : [];
    const r = await db.as(c.get('ctx')!, q => q.query(`update indicators set threshold_red=$2, threshold_green=$3, weight=$4, why_fr=$5, why_en=$6, lever_codes=$7::text[], config_status=$8, config_updated_at=now(), config_updated_by=$9 where code=$1 returning *`, [c.req.param('code'), red, green, weight, str(b.why_fr), str(b.why_en), levers, b.config_status === 'valide' ? 'valide' : 'a_valider', c.get('ctx')!.email]));
    if (!r.rows[0]) return c.json({ error: 'Indicateur introuvable ou accès refusé' }, 404);
    await audit(c, 'config.indicator', 'indicator', c.req.param('code'), { red, green, weight, levers }); invalidate(); return c.json(r.rows[0]);
  });
  adm.put('/levers/:code', async c => {
    const b = await c.req.json();
    const r = await db.as(c.get('ctx')!, q => q.query(`update levers set description_fr=$2, impact_tco2e_ha_yr=$3, impact_source=$4 where code=$1 returning *`, [c.req.param('code'), str(b.description_fr), num(b.impact_tco2e_ha_yr), str(b.impact_source)]));
    if (!r.rows[0]) return c.json({ error: 'Levier introuvable ou accès refusé' }, 404);
    await audit(c, 'config.lever', 'lever', c.req.param('code'), b); invalidate(); return c.json(r.rows[0]);
  });
  adm.put('/projects/:slug/blocks/:block', async c => {
    const block = c.req.param('block'); if (!(BLOCKS as readonly string[]).includes(block)) throw new Error('Bloc inconnu');
    const b = await c.req.json(); const content = str(b.content);
    const val = content ? { content, source: str(b.source), verified_by: str(b.verified_by), updated_at: new Date().toISOString().slice(0, 10), updated_by: c.get('ctx')!.email } : null;
    const r = await db.as(c.get('ctx')!, q => q.query(`update projects set block_${block}=$2::jsonb where slug=$1 returning slug`, [c.req.param('slug'), val ? JSON.stringify(val) : null]));
    if (!r.rows[0]) return c.json({ error: 'Projet introuvable ou accès refusé' }, 404);
    await audit(c, 'project.block', 'project', c.req.param('slug'), { block, val }); return c.json(val);
  });
  // manual content of the farm sheet (everything the files do not provide); published = visible on the public page
  adm.get('/farms/:id/sheet', async c => c.json((await db.as(c.get('ctx')!, q => q.query(`select f.id, s.content, s.published, s.updated_at, s.updated_by from farms f left join farm_sheets s on s.farm_id=f.id where f.id=$1`, [c.req.param('id')]))).rows[0] ?? null));
  adm.put('/farms/:id/sheet', async c => {
    const b = await c.req.json(); const t = (x: any, n = 2000) => str(x)?.slice(0, n) ?? undefined;
    const content = {
      intro: t(b.intro), dossier_lbc: t(b.dossier_lbc, 60), payout_share: num(b.payout_share) ?? undefined,
      levers: (Array.isArray(b.levers) ? b.levers : []).map((l: any) => ({ name: t(l.name, 120), desc: t(l.desc, 400), change: t(l.change, 400), credits: num(l.credits) ?? undefined, nature: l.nature === 'storage' ? 'storage' : 'avoidance' })).filter((l: any) => l.name).slice(0, 12),
      agronomist: { name: t(b.agronomist?.name, 80), role: t(b.agronomist?.role, 120), text: t(b.agronomist?.text, 400) }, contact: { name: t(b.contact?.name, 80), role: t(b.contact?.role, 120), phone: t(b.contact?.phone, 40), email: t(b.contact?.email, 120) },
      story: { context: t(b.story?.context), motivations: t(b.story?.motivations), stakes: t(b.story?.stakes) },
    };
    if (content.payout_share != null && (content.payout_share < 0 || content.payout_share > 100)) throw new Error('Part reversée : un pourcentage entre 0 et 100');
    const r = await db.as(c.get('ctx')!, q => q.query(`insert into farm_sheets(farm_id,content,published,updated_by) values($1,$2::jsonb,$3,$4) on conflict(farm_id) do update set content=excluded.content, published=excluded.published, updated_at=now(), updated_by=excluded.updated_by returning farm_id`, [c.req.param('id'), JSON.stringify(content), b.published === true, c.get('ctx')!.email]));
    if (!r.rows[0]) return c.json({ error: 'Accès refusé' }, 403);
    await audit(c, 'farm.sheet', 'farm', c.req.param('id'), { published: b.published === true }); return c.json({ ok: true, content });
  });
  // which co-benefits are displayed on a farm or project page
  adm.get('/visibility/:kind/:id', async c => {
    const d = await dataset(db); const kind = c.req.param('kind'), id = c.req.param('id');
    const row = (await db.as(c.get('ctx')!, q => kind === 'project' ? q.query(`select name, hidden_indicators, '{}'::text[] inherited from projects where slug=$1`, [id]) : q.query(`select f.id as name, f.hidden_indicators, coalesce(p.hidden_indicators,'{}') inherited from farms f left join projects p on p.id=f.project_id where f.id=$1`, [id.toUpperCase()]))).rows[0];
    if (!row) return c.json({ error: kind === 'project' ? 'Projet introuvable' : 'Ferme introuvable' }, 404);
    let cards;
    if (kind === 'project') { const sel = aggregateSelection(d.farms.filter(f => f.project === row.name), d.indicators, d.portfolio, []); const cb = new Map(sel.cobenefits.map(x => [x.code, x])); cards = scorecards(d, code => { const x = cb.get(code); return x && { initial: x.initial, prospectif: x.prospectif, evolution: x.evolution_prospectif, n_with_data: x.n_with_data, n_applicable: x.n_applicable, collected: x.collected }; }); }
    else { const f = d.farms.find(x => x.id === row.name)!; cards = scorecards(d, code => { const v = f.ind[code]; if (!v) return undefined; const i = v.initial ?? null, p2 = v.prospectif ?? null; return { initial: i, prospectif: p2, evolution: evolution(i, p2), collected: i != null || p2 != null }; }); }
    return c.json({ kind, id: kind === 'project' ? id : row.name, name: row.name, hidden: row.hidden_indicators, inherited: row.inherited,
      items: cards.flatMap(k => k.items.filter(i => i.collected).map(i => ({ code: i.code, category: k.category, label_fr: i.label_fr, unit: i.unit, initial: i.initial, prospectif: i.prospectif, evolution: i.evolution, trend: i.trend, has_threshold: i.thresholds != null }))) });
  });
  adm.put('/visibility/:kind/:id', async c => {
    const b = await c.req.json(); const kind = c.req.param('kind'), id = c.req.param('id'); const known = new Set((await dataset(db)).indicators.map(i => i.code));
    const hidden = [...new Set((Array.isArray(b.hidden) ? b.hidden : []).map(String).filter((x: string) => known.has(x)))];
    const r = await db.as(c.get('ctx')!, q => kind === 'project' ? q.query(`update projects set hidden_indicators=$2::text[] where slug=$1 returning slug`, [id, hidden]) : q.query(`update farms set hidden_indicators=$2::text[] where id=$1 returning id`, [id.toUpperCase(), hidden]));
    if (!r.rows[0]) return c.json({ error: 'Introuvable ou accès refusé' }, 404);
    await audit(c, 'cobenefits.visibility', kind, id, { hidden }); return c.json({ ok: true, hidden });
  });
  adm.put('/farms/:id/notes/:code', async c => {
    const b = await c.req.json(); const note = str(b.note_fr);
    await db.as(c.get('ctx')!, q => note ? q.query(`insert into farm_indicator_notes(farm_id,indicator_code,note_fr) values($1,$2,$3) on conflict(farm_id,indicator_code) do update set note_fr=excluded.note_fr, updated_at=now()`, [c.req.param('id'), c.req.param('code'), note]) : q.query(`delete from farm_indicator_notes where farm_id=$1 and indicator_code=$2`, [c.req.param('id'), c.req.param('code')]));
    await audit(c, 'farm.note', 'farm', c.req.param('id'), { code: c.req.param('code') }); return c.json({ ok: true });
  });
  return { pub, adm };
}
