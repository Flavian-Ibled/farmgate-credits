// Phase 5 — remuneration model (per project, per contract), lever costs (manual entry + aggregates), social & territorial co-benefits.
import { Hono } from 'hono';
import type { Db, Ctx, Q } from './db.ts';
import { validateRemuneration, resolveRemuneration, flows, type Remuneration } from '../shared/remuneration.ts';

type Env = { Variables: { ctx: (Ctx & { email: string }) | null } };
export const SOCIAL_KEYS = ['jobs', 'income_resilience', 'local_supply_chain', 'training', 'partner_engagement'] as const;
const N = (x: any) => (x == null ? null : Number(x));
const numOrNull = (x: any, label: string) => { if (x === '' || x == null) return null; const v = Number(String(x).replace(',', '.')); if (!Number.isFinite(v) || v < 0) throw new Error(`${label} : nombre positif attendu`); return v; };

export function moneyView(alloc?: Remuneration | null, project?: Remuneration | null) { const r = resolveRemuneration(alloc, project); return { ...r, flows: flows(r) }; }

/** practice costs of one farm (from livrables or manual entry) */
export async function farmLeverCosts(q: Q, farmId: string) {
  const rows = (await q.query(`select l.name_fr, l.family, fl.cost_annual_eur_ha, fl.cost_one_off_eur_ha, fl.saving_eur_ha, fl.cost_source from farm_levers fl join levers l on l.code=fl.lever_code where fl.farm_id=$1 and fl.active and (fl.cost_annual_eur_ha is not null or fl.saving_eur_ha is not null or fl.cost_one_off_eur_ha is not null) order by l.sort`, [farmId])).rows;
  if (!rows.length) return null; const s = (k: string) => rows.reduce((a, r) => a + (N(r[k]) ?? 0), 0);
  return { items: rows.map(r => ({ name: r.name_fr, family: r.family, cost_annual_eur_ha: N(r.cost_annual_eur_ha), cost_one_off_eur_ha: N(r.cost_one_off_eur_ha), saving_eur_ha: N(r.saving_eur_ha), source: r.cost_source })), cost_annual_eur_ha: s('cost_annual_eur_ha'), saving_eur_ha: s('saving_eur_ha'), net_eur_ha: s('cost_annual_eur_ha') - s('saving_eur_ha') };
}
/** practice costs of a project: SAU-weighted mean over the farms that have cost data, with the coverage */
export async function projectLeverCosts(q: Q, projectId: number) {
  const r = (await q.query(`with c as (select f.id, f.sau, sum(coalesce(fl.cost_annual_eur_ha,0)) cost, sum(coalesce(fl.saving_eur_ha,0)) saving from farms f join farm_levers fl on fl.farm_id=f.id where f.project_id=$1 and fl.active and (fl.cost_annual_eur_ha is not null or fl.saving_eur_ha is not null) group by f.id, f.sau)
    select count(*)::int n, sum(cost*sau)/nullif(sum(sau),0) cost, sum(saving*sau)/nullif(sum(sau),0) saving, (select count(*)::int from farms where project_id=$1 and not absent_from_last_import) total from c where sau > 0`, [projectId])).rows[0];
  return { farms_with_data: r.n as number, farms_total: r.total as number, cost_annual_eur_ha: r.n ? N(r.cost) : null, saving_eur_ha: r.n ? N(r.saving) : null };
}

export function moneyRoutes(db: Db) {
  const adm = new Hono<Env>();
  const audit = (c: any, action: string, entity: string, id: string, detail: unknown) => db.owner.query(`insert into audit_log(user_id,action,entity,entity_id,detail) values($1,$2,$3,$4,$5::jsonb)`, [c.get('ctx').uid, action, entity, id, JSON.stringify(detail)]);
  adm.get('/projects/:slug/money', async c => { const p = (await db.as(c.get('ctx')!, q => q.query(`select slug,name,remuneration,social,list_price_eur from projects where slug=$1`, [c.req.param('slug')]))).rows[0]; return p ? c.json({ ...p, effective: moneyView(null, p.remuneration) }) : c.json({ error: 'Projet introuvable' }, 404); });
  adm.put('/projects/:slug/remuneration', async c => { const r = validateRemuneration(await c.req.json()); const u = await db.as(c.get('ctx')!, q => q.query(`update projects set remuneration=$2::jsonb where slug=$1 returning slug`, [c.req.param('slug'), r ? JSON.stringify(r) : null])); if (!u.rows[0]) return c.json({ error: 'Projet introuvable ou accès refusé' }, 404); await audit(c, 'project.remuneration', 'project', c.req.param('slug'), r); return c.json(moneyView(null, r)); });
  adm.put('/projects/:slug/social', async c => { const b = await c.req.json(); const v: Record<string, any> = {}; for (const k of SOCIAL_KEYS) { const t = String(b[k] ?? '').trim().slice(0, 1000); if (t) v[k] = t; } for (const k of ['source', 'verified_by']) { const t = String(b[k] ?? '').trim().slice(0, 200); if (t) v[k] = t; } if (Object.keys(v).length) v.updated_at = new Date().toISOString().slice(0, 10);
    const u = await db.as(c.get('ctx')!, q => q.query(`update projects set social=$2::jsonb where slug=$1 returning slug`, [c.req.param('slug'), Object.keys(v).length ? JSON.stringify(v) : null])); if (!u.rows[0]) return c.json({ error: 'Projet introuvable ou accès refusé' }, 404); await audit(c, 'project.social', 'project', c.req.param('slug'), v); return c.json(v); });
  // contract-level model (e.g. SEDIF 82 % of which 7 % agronomic advice)
  adm.put('/allocations/:id/remuneration', async c => { const r = validateRemuneration(await c.req.json()); const id = Number(c.req.param('id'));
    const u = await db.as(c.get('ctx')!, q => q.query(`update allocations set cost_breakdown = coalesce(cost_breakdown,'{}'::jsonb) || jsonb_build_object('remuneration', $2::jsonb) where id=$1 returning reference`, [id, JSON.stringify(r)])); if (!u.rows[0]) return c.json({ error: 'Allocation introuvable ou accès refusé' }, 404); await audit(c, 'allocation.remuneration', 'allocation', u.rows[0].reference, r); return c.json(moneyView(r, null)); });
  // lever costs of a farm: list + manual entry
  adm.get('/farms/:id/levers', async c => c.json((await db.as(c.get('ctx')!, q => q.query(`select l.code, l.name_fr, l.family, coalesce(fl.active,false) active, fl.cost_annual_eur_ha, fl.cost_one_off_eur_ha, fl.saving_eur_ha, fl.cost_source from levers l join farms f on f.id=$1 left join farm_levers fl on fl.lever_code=l.code and fl.farm_id=f.id where l.scope = case when f.typology='Élevage bovins' then 'EL' else 'GC' end order by l.sort`, [c.req.param('id').toUpperCase()]))).rows));
  adm.put('/farms/:id/levers/:code', async c => { const b = await c.req.json(); const id = c.req.param('id').toUpperCase(); const a = numOrNull(b.cost_annual_eur_ha, 'Coût annuel'), o = numOrNull(b.cost_one_off_eur_ha, 'Coût ponctuel'), s = numOrNull(b.saving_eur_ha, 'Économie');
    const u = await db.as(c.get('ctx')!, q => q.query(`insert into farm_levers(farm_id,lever_code,active,cost_annual_eur_ha,cost_one_off_eur_ha,saving_eur_ha,cost_source) values($1,$2,$3,$4,$5,$6,'saisie manuelle') on conflict(farm_id,lever_code) do update set active=excluded.active, cost_annual_eur_ha=excluded.cost_annual_eur_ha, cost_one_off_eur_ha=excluded.cost_one_off_eur_ha, saving_eur_ha=excluded.saving_eur_ha, cost_source='saisie manuelle' returning farm_id`, [id, c.req.param('code'), b.active !== false, a, o, s]));
    if (!u.rows[0]) return c.json({ error: 'Accès refusé' }, 403); await audit(c, 'farm.lever_cost', 'farm', id, { lever: c.req.param('code'), a, o, s }); const { invalidate } = await import('./facts.ts'); invalidate(); return c.json({ ok: true }); });
  return { adm };
}
