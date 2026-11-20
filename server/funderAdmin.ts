// Admin management of funders: details, users, attribution of farms by financing percentage, shared selections.
import { Hono } from 'hono';
import type { Db, Ctx } from './db.ts';
import { dataset } from './facts.ts';
import { createPercentAllocation, farmFunding } from './funders.ts';
import { notify } from './phase7.ts';

type Env = { Variables: { ctx: (Ctx & { email: string }) | null } };
const N = (x: any) => (x == null ? null : Number(x));
const num = (x: any, label: string) => { if (x === '' || x == null) return null; const v = Number(String(x).replace(',', '.')); if (!Number.isFinite(v) || v < 0) throw new Error(`${label} : nombre positif attendu`); return v; };
const ids = (x: unknown): string[] => (Array.isArray(x) ? x : String(x ?? '').split(/[\s,;]+/)).map(s => String(s).trim().toUpperCase()).filter(Boolean);

export function funderAdminRoutes(db: Db) {
  const adm = new Hono<Env>(), fun = new Hono<Env>();
  const audit = (c: any, action: string, entity: string, id: string, detail: unknown) => db.owner.query(`insert into audit_log(user_id,action,entity,entity_id,detail) values($1,$2,$3,$4,$5::jsonb)`, [c.get('ctx').uid, action, entity, id, JSON.stringify(detail)]);

  adm.get('/funders/:id', async c => {
    const id = Number(c.req.param('id')); const ctx = c.get('ctx')!;
    const out = await db.as(ctx, async q => {
      const org = (await q.query(`select id,name,sector,public_name_policy,seat_limit,status,type,public_slug,public_page_enabled from organizations where id=$1`, [id])).rows[0]; if (!org) return null;
      return { org, users: (await q.query(`select id,email,first_name,last_name,role,status,last_login from users where organization_id=$1 order by email`, [id])).rows,
        allocations: (await q.query(`select a.id,a.reference,a.kind,a.status,a.target_type,a.target_id,a.volume_tco2e,a.price_per_tco2e,a.amount_eur,a.created_at,a.cost_breakdown->'pct' pct,(select count(*)::int from allocation_lines l where l.allocation_id=a.id) farms from allocations a where a.funder_org_id=$1 order by a.id desc`, [id])).rows,
        selections: (await q.query(`select id,name,note,cardinality(farm_ids) farms,created_at from funder_selections where organization_id=$1 order by id desc`, [id])).rows };
    });
    return out ? c.json(out) : c.json({ error: 'Financeur introuvable' }, 404);
  });
  adm.put('/funders/:id', async c => {
    const id = Number(c.req.param('id')); const b = await c.req.json(); const name = String(b.name ?? '').trim(); if (!name) throw new Error('Le nom est obligatoire');
    const pol = ['named', 'anonymised', 'private'].includes(b.public_name_policy) ? b.public_name_policy : 'private'; const status = b.status === 'disabled' ? 'disabled' : 'active'; const seats = num(b.seat_limit, 'Sièges');
    const r = await db.as(c.get('ctx')!, q => q.query(`update organizations set name=$2, sector=$3, public_name_policy=$4, seat_limit=$5, status=$6 where id=$1 and type='funder' returning id,name`, [id, name, String(b.sector ?? '').trim() || null, pol, seats, status]));
    if (!r.rows[0]) return c.json({ error: 'Financeur introuvable ou accès refusé' }, 404); await audit(c, 'funder.update', 'organization', String(id), { name, pol, status, seats }); return c.json(r.rows[0]);
  });
  adm.put('/users/:id/status', async c => {
    const ctx = c.get('ctx')!; if (ctx.role !== 'platform_admin') return c.json({ error: 'Réservé aux administrateurs de la plateforme' }, 403); const uid = Number(c.req.param('id')); if (uid === ctx.uid) throw new Error('Vous ne pouvez pas désactiver votre propre compte');
    const status = (await c.req.json()).status === 'disabled' ? 'disabled' : 'active'; const r = await db.owner.query(`update users set status=$2 where id=$1 and role in ('funder_admin','funder_user','project_owner_user') returning id,email,status`, [uid, status]);
    if (!r.rows[0]) return c.json({ error: 'Utilisateur introuvable' }, 404); if (status === 'disabled') await db.owner.query(`delete from sessions where user_id=$1`, [uid]); await audit(c, 'user.status', 'user', String(uid), { status }); return c.json(r.rows[0]);
  });
  // attribute farms to a funder with a financing percentage (preview with dry_run)
  adm.post('/funders/:id/attribute', async c => {
    const b = await c.req.json(); const fid = Number(c.req.param('id')); const org = (await db.owner.query(`select 1 from organizations where id=$1 and type='funder'`, [fid])).rows[0]; if (!org) return c.json({ error: 'Financeur introuvable' }, 404);
    return c.json(await createPercentAllocation(db, c.get('ctx')!, { funder_org_id: fid, farm_ids: ids(b.farm_ids), pct: num(b.pct, 'Pourcentage') ?? 0, price_per_tco2e: num(b.price_per_tco2e, 'Prix'), status: b.status, notes: b.notes ? String(b.notes).slice(0, 500) : null, dry_run: b.dry_run === true }));
  });
  // selections shared with a funder
  adm.post('/funders/:id/selections', async c => {
    const b = await c.req.json(); const fid = Number(c.req.param('id')); const name = String(b.name ?? '').trim().slice(0, 120); if (!name) throw new Error('Donnez un nom à la sélection'); const list = [...new Set(ids(b.farm_ids))]; if (!list.length) throw new Error('Aucune ferme indiquée'); if (list.length > 1500) throw new Error('1 500 fermes au maximum');
    const known = new Set((await db.owner.query(`select id from farms where id = any($1::text[])`, [list])).rows.map(r => r.id)); const unknown = list.filter(i => !known.has(i)); if (unknown.length) throw new Error(`Fermes inconnues : ${unknown.slice(0, 8).join(', ')}`);
    const r = await db.as(c.get('ctx')!, q => q.query(`insert into funder_selections(organization_id,name,note,farm_ids,created_by) values($1,$2,$3,$4::text[],$5) returning id,name`, [fid, name, String(b.note ?? '').trim().slice(0, 500) || null, list, c.get('ctx')!.uid ?? null])); if (!r.rows[0]) return c.json({ error: 'Accès refusé' }, 403);
    await audit(c, 'funder.selection', 'organization', String(fid), { name, farms: list.length }); await notify(db, { audience: 'org', organization_id: fid, kind: 'selection', title: `Nouvelle sélection de fermes pour vous : « ${name} » (${list.length} fermes)`, link: '/financeur' }); return c.json(r.rows[0]);
  });
  adm.delete('/selections/:id', async c => { const r = await db.as(c.get('ctx')!, q => q.query(`delete from funder_selections where id=$1 returning id`, [Number(c.req.param('id'))])); return r.rows[0] ? c.json({ ok: true }) : c.json({ error: 'Introuvable ou accès refusé' }, 404); });

  // funder side: the selections shared with me (public farm facts only — no identities)
  fun.use('*', async (c, next) => { const x = c.get('ctx'); if (!x || !['funder_admin', 'funder_user'].includes(x.role) || x.org == null) return c.json({ error: 'Espace réservé aux financeurs' }, x ? 403 : 401); await next(); });
  fun.get('/selections', async c => {
    const rows = (await db.as(c.get('ctx')!, q => q.query(`select id,name,note,farm_ids,created_at from funder_selections order by id desc`))).rows; const d = await dataset(db); const byId = new Map(d.farms.map(f => [f.id, f]));
    const fund = await farmFunding(db, [...new Set(rows.flatMap(r => r.farm_ids as string[]))]);
    return c.json(rows.map(r => { const fs = (r.farm_ids as string[]).map(i => byId.get(i)).filter(Boolean) as typeof d.farms;
      return { id: r.id, name: r.name, note: r.note, created_at: r.created_at, farms: fs.length, sau: fs.reduce((s, f) => s + (f.sau ?? 0), 0), re_labelled: fs.reduce((s, f) => s + (f.re_labelled ?? 0), 0), remaining: fs.reduce((s, f) => s + (fund.get(f.id)?.remaining ?? 0), 0), ids: fs.map(f => f.id),
        sample: fs.slice(0, 12).map(f => ({ id: f.id, project: f.project, departement: f.departement, sau: f.sau == null ? null : Math.round(f.sau), remaining: Math.round(fund.get(f.id)?.remaining ?? 0) })) }; }));
  });
  return { adm, fun };
}
