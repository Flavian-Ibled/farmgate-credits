// Phase 4 — funders, users & invitations, allocations (with the over-allocation guard), opening balances, credit ledger, funder portal.
import { Hono } from 'hono';
import { randomBytes, createHash } from 'node:crypto';
import { PUBLIC, type Db, type Ctx, type Q } from './db.ts';
import { dataset, invalidate, applyFilters, type Filters } from './facts.ts';
import { hashPassword } from './auth.ts';
import { FUNDED_STATUSES, TRANSITIONS, spread, funding, funderShare } from '../shared/allocation.ts';
import { farmEndOfProjectEstimate } from '../shared/rating.ts';
import { resolveRemuneration, farmerAmount } from '../shared/remuneration.ts';
const note = async (db: Db, n: any) => (await import('./phase7.ts')).notify(db, n);

type Env = { Variables: { ctx: (Ctx & { email: string }) | null } };
const FUNDED = `('${FUNDED_STATUSES.join("','")}')`;
const N = (x: any) => (x == null ? null : Number(x));
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const num = (x: any, label: string) => { if (x === '' || x == null) return null; const v = Number(x); if (!Number.isFinite(v)) throw new Error(`${label} : nombre invalide`); return v; };
/**
 * Credits that can be sold on a farm = Data Master "Volume vendable" (labelled volume minus what is valued through supply chains).
 * When that cell is empty (farms still in diagnostic, mostly) the farm is not open for sale yet: 0. This keeps the platform's
 * "available" total equal to the Data Master's (≈ 396,000 tCO₂e in the 2026-09-21 file).
 */
const SELLABLE = `coalesce(f.vol_vendable, 0)`;

/** funded / remaining per farm, with the funders who agreed to be named. Aggregates only: safe for public pages. */
export async function farmFunding(db: Db, farmIds: string[]) {
  const rows = (await db.owner.query(`select f.id, ${SELLABLE} sellable, f.re_labelled, coalesce(sum(l.volume_tco2e) filter (where a.status in ${FUNDED}), 0) allocated,
      array_remove(array_agg(distinct case when a.status in ${FUNDED} and o.public_name_policy='named' and coalesce(a.display_name_policy,'named')='named' then o.name end), null) funders,
      count(distinct a.funder_org_id) filter (where a.status in ${FUNDED})::int n_funders, coalesce(sum(l.volume_tco2e) filter (where a.status in ${FUNDED} and a.funder_org_id is null), 0) unassigned
    from farms f left join allocation_lines l on l.farm_id=f.id left join allocations a on a.id=l.allocation_id left join organizations o on o.id=a.funder_org_id where f.id = any($1::text[]) group by f.id`, [farmIds])).rows;
  return new Map(rows.map(r => [r.id as string, { ...funding(N(r.sellable), Number(r.allocated)), labelled: N(r.re_labelled), funders: r.funders as string[], n_funders: r.n_funders as number, unassigned: Number(r.unassigned) }]));
}

async function nextRef(q: Q, id: number, prefix = 'FG') { const ref = `${prefix}-${new Date().getFullYear()}-${String(id).padStart(6, '0')}`; await q.query(`update allocations set reference=$2 where id=$1`, [id, ref]); return ref; }
/** Sold Out ⇄ Labellisé follows the remaining credits (only for these two statuses). */
async function syncStatus(q: Q, farmIds: string[], reopened = false) {
  await q.query(`update farms f set lbc_status='Sold Out' where f.id = any($1::text[]) and f.lbc_status='Labellisé' and ${SELLABLE} > 0 and ${SELLABLE} - coalesce((select sum(l.volume_tco2e) from allocation_lines l join allocations a on a.id=l.allocation_id where l.farm_id=f.id and a.status in ${FUNDED}),0) <= 0.5`, [farmIds]);
  if (reopened) await q.query(`update farms f set lbc_status='Labellisé' where f.id = any($1::text[]) and f.lbc_status='Sold Out' and ${SELLABLE} - coalesce((select sum(l.volume_tco2e) from allocation_lines l join allocations a on a.id=l.allocation_id where l.farm_id=f.id and a.status in ${FUNDED}),0) > 0.5`, [farmIds]);
}
/**
 * Creates the lines of an allocation inside ONE transaction: the farms are locked (FOR UPDATE), what remains is recomputed,
 * and the write fails if the volume no longer fits. Two funders can never take the same credits.
 */
async function allocateLines(q: Q, allocationId: number, farmIds: string[], volume: number, by: 'labelled' | 'sau' = 'labelled') {
  const farms = (await q.query(`select f.id, ${SELLABLE} sellable, f.re_labelled, f.sau, f.lbc_status from farms f where f.id = any($1::text[]) and not f.absent_from_last_import order by f.id for update`, [farmIds])).rows;
  if (!farms.length) throw new Error('Aucune ferme dans la cible');
  const al = new Map((await q.query(`select l.farm_id, sum(l.volume_tco2e) v from allocation_lines l join allocations a on a.id=l.allocation_id where l.farm_id = any($1::text[]) and a.status in ${FUNDED} group by 1`, [farmIds])).rows.map(r => [r.farm_id, Number(r.v)]));
  const lines = spread(volume, farms.filter(f => f.lbc_status !== 'Désengagé').map(f => ({ id: f.id, remaining: Math.max(0, Number(f.sellable) - (al.get(f.id) ?? 0)), weight: Number((by === 'sau' ? f.sau : f.re_labelled) ?? 0) })));
  for (const l of lines) await q.query(`insert into allocation_lines(allocation_id,farm_id,volume_tco2e) values($1,$2,$3)`, [allocationId, l.farm_id, l.volume]);
  await syncStatus(q, lines.map(l => l.farm_id)); return lines;
}
async function targetFarms(db: Db, q: Q, type: string, targetId: string | null, filters?: Filters): Promise<string[]> {
  if (type === 'farm') return targetId ? [targetId.toUpperCase()] : [];
  if (type === 'project') return (await q.query(`select f.id from farms f join projects p on p.id=f.project_id where p.slug=$1`, [targetId])).rows.map(r => r.id);
  return applyFilters((await dataset(db)).farms, filters ?? {}).map(f => f.id);
}

export async function createAllocation(db: Db, ctx: Ctx, b: { funder_org_id?: number | null; target_type: 'farm' | 'project' | 'portfolio'; target_id?: string | null; filters?: Filters; volume_tco2e: number; price_per_tco2e?: number | null; status?: string; vintage_scope?: string; notes?: string | null; spread_by?: 'labelled' | 'sau'; kind?: string }) {
  const status = b.status ?? 'reserved'; if (!['quote', 'reserved', 'contracted'].includes(status)) throw new Error('Statut initial invalide');
  if (!(b.volume_tco2e > 0)) throw new Error('Le volume doit être positif');
  const r = await db.tx(async q => {
    const ids = await targetFarms(db, q, b.target_type, b.target_id ?? null, b.filters);
    const a = (await q.query(`insert into allocations(funder_org_id,target_type,target_id,vintage_scope,volume_tco2e,price_per_tco2e,amount_eur,status,kind,created_by,notes,cost_breakdown,signed_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13) returning id`,
      [b.funder_org_id ?? null, b.target_type, b.target_type === 'portfolio' ? null : b.target_id, b.vintage_scope ?? 'all', b.volume_tco2e, b.price_per_tco2e ?? null, b.price_per_tco2e != null ? Math.round(b.volume_tco2e * b.price_per_tco2e * 100) / 100 : null, status, b.kind ?? 'standard', ctx.uid ?? null, b.notes ?? null, JSON.stringify({ filters: b.filters ?? null, spread_by: b.spread_by ?? 'labelled' }), status === 'contracted' ? new Date().toISOString().slice(0, 10) : null])).rows[0].id as number;
    const reference = await nextRef(q, a);
    const lines = status === 'quote' ? [] : await allocateLines(q, a, ids, b.volume_tco2e, b.spread_by); // a quote reserves nothing
    if (status === 'contracted') await q.query(`update allocation_lines set frozen=true where allocation_id=$1`, [a]);
    await q.query(`insert into audit_log(user_id,action,entity,entity_id,detail) values($1,'allocation.create','allocation',$2,$3::jsonb)`, [ctx.uid ?? null, reference, JSON.stringify({ status, volume: b.volume_tco2e, farms: lines.length })]);
    return { id: a, reference, status, lines };
  });
  if (status === 'quote') await note(db, { audience: 'cf', kind: 'quote', title: `Nouvelle demande de proposition ${r.reference} : ${b.volume_tco2e} tCO₂e`, link: '/admin' });
  else if (b.funder_org_id && (b.kind ?? 'standard') === 'standard') await note(db, { audience: 'org', organization_id: b.funder_org_id, kind: 'allocation', title: `Contribution ${r.reference} enregistrée : ${b.volume_tco2e} tCO₂e (${status === 'contracted' ? 'contractualisée' : 'réservée'})`, link: '/financeur' });
  invalidate(); return r;
}

export async function updateAllocation(db: Db, ctx: Ctx, id: number, b: { status?: string; funder_org_id?: number | null; price_per_tco2e?: number | null; contract_ref?: string | null; display_name_policy?: string | null; claim_wording?: string | null }) {
  const r = await db.tx(async q => {
    const a = (await q.query(`select * from allocations where id=$1 for update`, [id])).rows[0]; if (!a) throw new Error('Allocation introuvable');
    let reopened = false;
    if (b.status && b.status !== a.status) {
      if (!(TRANSITIONS[a.status] ?? []).includes(b.status)) throw new Error(`Passage ${a.status} → ${b.status} non autorisé`);
      if (a.status === 'quote' && b.status !== 'cancelled') { const cb = a.cost_breakdown ?? {}; await q.query(`update allocations set status=$2 where id=$1`, [id, b.status]); await allocateLines(q, id, await targetFarms(db, q, a.target_type, a.target_id, cb.filters ?? undefined), Number(a.volume_tco2e), cb.spread_by); }
      else await q.query(`update allocations set status=$2 where id=$1`, [id, b.status]);
      if (b.status === 'contracted') { await q.query(`update allocation_lines set frozen=true where allocation_id=$1`, [id]); await q.query(`update allocations set signed_at=coalesce(signed_at,current_date) where id=$1`, [id]); }
      reopened = b.status === 'cancelled';
    }
    const price = b.price_per_tco2e === undefined ? N(a.price_per_tco2e) : b.price_per_tco2e;
    await q.query(`update allocations set funder_org_id=$2, price_per_tco2e=$3, amount_eur=$4, contract_ref=$5, display_name_policy=$6, claim_wording=$7 where id=$1`, [id, b.funder_org_id === undefined ? a.funder_org_id : b.funder_org_id, price, price != null ? Math.round(Number(a.volume_tco2e) * price * 100) / 100 : null, b.contract_ref === undefined ? a.contract_ref : b.contract_ref, b.display_name_policy === undefined ? a.display_name_policy : b.display_name_policy, b.claim_wording === undefined ? a.claim_wording : b.claim_wording]);
    const farms = (await q.query(`select farm_id from allocation_lines where allocation_id=$1`, [id])).rows.map(x => x.farm_id);
    await syncStatus(q, farms, reopened);
    await q.query(`insert into audit_log(user_id,action,entity,entity_id,detail) values($1,'allocation.update','allocation',$2,$3::jsonb)`, [ctx.uid ?? null, a.reference, JSON.stringify(b)]);
    return { id, reference: a.reference };
  });
  if (b.status) { const a = (await db.owner.query(`select funder_org_id, status, reference from allocations where id=$1`, [id])).rows[0]; if (a?.funder_org_id) await note(db, { audience: 'org', organization_id: a.funder_org_id, kind: 'allocation', title: `Contribution ${a.reference} : statut « ${a.status} »`, link: ['contracted', 'paid', 'delivered', 'retired'].includes(a.status) ? `/certificat/${a.reference}` : '/financeur' }); }
  invalidate(); return r;
}

/** Opening balances: the Data Master "Volume Vendu" becomes historical allocation lines without a funder, so that totals match. Idempotent. */
export async function openingBalances(db: Db, ctx: Ctx) {
  const r = await db.tx(async q => {
    const farms = (await q.query(`select f.id, f.vol_vendu, ${SELLABLE} sellable from farms f where coalesce(f.vol_vendu,0) > 0 order by f.id for update`)).rows; let created = 0, updated = 0, capped = 0, total = 0;
    for (const f of farms) {
      const v0 = Number(f.vol_vendu), v = Math.round(v0 * 100) / 100; if (v0 > Number(f.sellable) + 0.5) capped++; // sold above sellable: kept as is, counted for the report
      const ex = (await q.query(`select a.id, a.volume_tco2e from allocations a where a.kind='historical_sale' and a.target_type='farm' and a.target_id=$1 and a.status <> 'cancelled' order by a.id limit 1`, [f.id])).rows[0];
      total += v;
      if (ex) { if (Math.abs(Number(ex.volume_tco2e) - v) > 0.005) { await q.query(`update allocations set volume_tco2e=$2 where id=$1`, [ex.id, v]); await q.query(`update allocation_lines set volume_tco2e=$2 where allocation_id=$1`, [ex.id, v]); updated++; } continue; }
      const a = (await q.query(`insert into allocations(funder_org_id,target_type,target_id,volume_tco2e,status,kind,notes,created_by) values(null,'farm',$1,$2,'contracted','historical_sale','Vente historique — financeur à affecter (Data Master « Volume Vendu »)',$3) returning id`, [f.id, v, ctx.uid ?? null])).rows[0].id;
      await nextRef(q, a, 'FGH'); await q.query(`insert into allocation_lines(allocation_id,farm_id,volume_tco2e,frozen) values($1,$2,$3,true)`, [a, f.id, v]); created++;
    }
    await q.query(`insert into audit_log(user_id,action,entity,detail) values($1,'allocation.opening_balances','allocation',$2::jsonb)`, [ctx.uid ?? null, JSON.stringify({ created, updated, capped, total: Math.round(total) })]);
    return { farms: farms.length, created, updated, capped, total_tco2e: Math.round(total * 100) / 100 };
  });
  invalidate(); return r;
}

/**
 * Attribute farms to a funder with a financing PERCENTAGE: on each farm the funder takes pct % of the sellable volume.
 * Same guard as any allocation (rows locked, nothing is written if one farm cannot take it). dry_run only computes.
 */
export async function createPercentAllocation(db: Db, ctx: Ctx, b: { funder_org_id: number; farm_ids: string[]; pct: number; price_per_tco2e?: number | null; status?: string; notes?: string | null; dry_run?: boolean }) {
  const status = b.status ?? 'reserved'; if (!['reserved', 'contracted'].includes(status)) throw new Error('Statut initial invalide'); if (!(b.pct > 0 && b.pct <= 100)) throw new Error('Le pourcentage doit être compris entre 0 et 100');
  const ids = [...new Set(b.farm_ids.map(x => x.trim().toUpperCase()).filter(Boolean))]; if (!ids.length) throw new Error('Aucune ferme indiquée'); if (ids.length > 1500) throw new Error('1 500 fermes au maximum par attribution');
  const out = await db.tx(async q => {
    const farms = (await q.query(`select f.id, ${SELLABLE} sellable, f.lbc_status from farms f where f.id = any($1::text[]) and not f.absent_from_last_import order by f.id for update`, [ids])).rows;
    const unknown = ids.filter(i => !farms.some(f => f.id === i)); if (unknown.length) throw new Error(`Fermes inconnues : ${unknown.slice(0, 8).join(', ')}${unknown.length > 8 ? '…' : ''}`);
    const al = new Map((await q.query(`select l.farm_id, sum(l.volume_tco2e) v from allocation_lines l join allocations a on a.id=l.allocation_id where l.farm_id = any($1::text[]) and a.status in ${FUNDED} group by 1`, [ids])).rows.map(r => [r.farm_id, Number(r.v)]));
    const lines: { farm_id: string; volume: number; remaining: number }[] = [], skipped: { farm_id: string; reason: string }[] = [], over: string[] = [];
    for (const f of farms) { const rem = Math.max(0, Number(f.sellable) - (al.get(f.id) ?? 0)); if (f.lbc_status === 'Désengagé') { skipped.push({ farm_id: f.id, reason: 'désengagée' }); continue; } if (Number(f.sellable) <= 0) { skipped.push({ farm_id: f.id, reason: 'aucun volume vendable' }); continue; }
      const v = Math.round((b.pct / 100) * Number(f.sellable) * 100) / 100; if (v > rem + 0.005) over.push(`${f.id} (reste ${Math.round(rem * 100) / 100} tCO₂e, ${Math.round(v * 100) / 100} demandés)`); else if (v > 0) lines.push({ farm_id: f.id, volume: v, remaining: rem }); }
    if (over.length) throw new Error(`Crédits insuffisants sur ${over.length} ferme(s) : ${over.slice(0, 4).join(' ; ')}${over.length > 4 ? '…' : ''}`); if (!lines.length) throw new Error('Aucune ferme ne peut recevoir de crédits (volume vendable nul ou déjà financé)');
    const total = Math.round(lines.reduce((s, l) => s + l.volume, 0) * 100) / 100; const amount = b.price_per_tco2e != null ? Math.round(total * b.price_per_tco2e * 100) / 100 : null;
    if (b.dry_run) return { dry_run: true, farms: lines.length, skipped, volume_tco2e: total, amount_eur: amount, lines: lines.slice(0, 200) };
    const a = (await q.query(`insert into allocations(funder_org_id,target_type,target_id,volume_tco2e,price_per_tco2e,amount_eur,status,created_by,notes,cost_breakdown,signed_at) values($1,'portfolio',null,$2,$3,$4,$5,$6,$7,$8::jsonb,$9) returning id`, [b.funder_org_id, total, b.price_per_tco2e ?? null, amount, status, ctx.uid ?? null, b.notes ?? null, JSON.stringify({ filters: { ids }, pct: b.pct }), status === 'contracted' ? new Date().toISOString().slice(0, 10) : null])).rows[0].id as number;
    const reference = await nextRef(q, a); for (const l of lines) await q.query(`insert into allocation_lines(allocation_id,farm_id,volume_tco2e,frozen) values($1,$2,$3,$4)`, [a, l.farm_id, l.volume, status === 'contracted']);
    await syncStatus(q, lines.map(l => l.farm_id)); await q.query(`insert into audit_log(user_id,action,entity,entity_id,detail) values($1,'allocation.create_pct','allocation',$2,$3::jsonb)`, [ctx.uid ?? null, reference, JSON.stringify({ pct: b.pct, farms: lines.length, volume: total })]);
    return { dry_run: false, id: a, reference, farms: lines.length, skipped, volume_tco2e: total, amount_eur: amount };
  });
  if (!b.dry_run) { invalidate(); await note(db, { audience: 'org', organization_id: b.funder_org_id, kind: 'allocation', title: `Contribution ${(out as any).reference} : ${b.pct} % de ${(out as any).farms} fermes (${(out as any).volume_tco2e} tCO₂e)`, link: '/financeur' }); }
  return out;
}

export function funderRoutes(db: Db) {
  const pub = new Hono<Env>(), adm = new Hono<Env>(), fun = new Hono<Env>();

  // ---------- public: credit ledger (verification page of a certificate) and invitations ----------
  pub.get('/ledger/:ref', async c => {
    const a = (await db.owner.query(`select a.*, o.name funder, o.public_name_policy, (select count(*)::int from allocation_lines l where l.allocation_id=a.id) farms, (select count(distinct f.project_id)::int from allocation_lines l join farms f on f.id=l.farm_id where l.allocation_id=a.id) projects, (select string_agg(distinct p.name, ' · ') from allocation_lines l join farms f on f.id=l.farm_id join projects p on p.id=f.project_id where l.allocation_id=a.id) project_names from allocations a left join organizations o on o.id=a.funder_org_id where a.reference=$1`, [c.req.param('ref')])).rows[0];
    if (!a) return c.json({ error: 'Référence inconnue' }, 404);
    const ctx = c.get('ctx'); const own = ctx && (['platform_admin', 'staff'].includes(ctx.role) || (ctx.org != null && ctx.org === a.funder_org_id));
    const named = a.public_name_policy === 'named' && (a.display_name_policy ?? 'named') === 'named';
    return c.json({ reference: a.reference, status: a.status, kind: a.kind, volume_tco2e: Number(a.volume_tco2e), vintage_scope: a.vintage_scope, created_at: new Date(a.created_at).toISOString().slice(0, 10), signed_at: a.signed_at ? new Date(a.signed_at).toISOString().slice(0, 10) : null,
      funder: own || named ? a.funder : null, funder_visibility: a.funder_org_id == null ? 'unassigned' : named ? 'named' : a.public_name_policy === 'anonymised' ? 'anonymised' : 'private', farms: a.farms, projects: a.projects, project_names: a.project_names, farmer_pct: resolveRemuneration(a.cost_breakdown?.remuneration ?? null, null).farmer_pct, claim_wording: a.claim_wording, label: 'Label Bas Carbone', valid: FUNDED_STATUSES.includes(a.status) });
  });
  pub.get('/invitations/:token', async c => { const i = (await db.owner.query(`select i.email, i.role, o.name organization from invitations i left join organizations o on o.id=i.organization_id where i.token_hash=$1 and i.accepted_at is null and i.expires_at > now()`, [sha(c.req.param('token'))])).rows[0]; return i ? c.json(i) : c.json({ error: 'Invitation invalide ou expirée' }, 404); });
  pub.post('/invitations/:token/accept', async c => {
    const b = await c.req.json(); const h = sha(c.req.param('token'));
    return db.tx(async q => {
      const i = (await q.query(`select * from invitations where token_hash=$1 and accepted_at is null and expires_at > now() for update`, [h])).rows[0]; if (!i) return c.json({ error: 'Invitation invalide ou expirée' }, 404);
      const pw = hashPassword(String(b.password ?? ''));
      await q.query(`insert into users(email,first_name,last_name,organization_id,role,status,password_hash) values(lower($1),$2,$3,$4,$5,'active',$6) on conflict(email) do update set password_hash=excluded.password_hash, status='active', organization_id=excluded.organization_id, role=excluded.role`, [i.email, String(b.first_name ?? '').slice(0, 80) || null, String(b.last_name ?? '').slice(0, 80) || null, i.organization_id, i.role, pw]);
      await q.query(`update invitations set accepted_at=now() where token_hash=$1`, [h]); await q.query(`insert into audit_log(action,entity,detail) values('invitation.accept','user',$1::jsonb)`, [JSON.stringify({ role: i.role, org: i.organization_id })]);
      return c.json({ ok: true, email: i.email });
    });
  });

  // ---------- admin ----------
  adm.get('/funders', async c => c.json((await db.as(c.get('ctx')!, q => q.query(`select o.id,o.name,o.sector,o.public_name_policy,o.seat_limit,o.status,(select count(*)::int from users u where u.organization_id=o.id) users,(select coalesce(sum(a.volume_tco2e),0) from allocations a where a.funder_org_id=o.id and a.status in ${FUNDED}) funded,(select count(*)::int from allocations a where a.funder_org_id=o.id and a.status='quote') quotes from organizations o where o.type='funder' order by o.name`))).rows));
  adm.post('/funders', async c => { const b = await c.req.json(); const name = String(b.name ?? '').trim(); if (!name) throw new Error('Nom obligatoire'); const pol = ['named', 'anonymised', 'private'].includes(b.public_name_policy) ? b.public_name_policy : 'private';
    const r = await db.as(c.get('ctx')!, q => q.query(`insert into organizations(type,name,sector,public_name_policy,seat_limit) values('funder',$1,$2,$3,$4) on conflict(name) do update set sector=excluded.sector, public_name_policy=excluded.public_name_policy, seat_limit=excluded.seat_limit returning id,name,public_name_policy`, [name, b.sector ?? null, pol, num(b.seat_limit, 'Sièges')])); return c.json(r.rows[0]); });
  adm.post('/funders/:id/invitations', async c => {
    const ctx = c.get('ctx')!; if (ctx.role !== 'platform_admin') return c.json({ error: 'Réservé aux administrateurs de la plateforme' }, 403);
    const b = await c.req.json(); const email = String(b.email ?? '').trim().toLowerCase(); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('E-mail invalide'); const org = (await db.owner.query(`select type from organizations where id=$1`, [Number(c.req.param('id'))])).rows[0]; if (!org) return c.json({ error: 'Organisation introuvable' }, 404);
    const seats = (await db.owner.query(`select o.seat_limit, (select count(*)::int from users u where u.organization_id=o.id and u.status<>'disabled') + (select count(*)::int from invitations i where i.organization_id=o.id and i.accepted_at is null and i.expires_at > now()) used from organizations o where o.id=$1`, [Number(c.req.param('id'))])).rows[0];
    if (seats.seat_limit != null && seats.used >= seats.seat_limit) return c.json({ error: `Nombre de sièges atteint (${seats.used} sur ${seats.seat_limit}) : augmentez la limite ou désactivez un utilisateur` }, 400);
    const role = org.type === 'project_owner' ? 'project_owner_user' : b.role === 'funder_admin' ? 'funder_admin' : 'funder_user';
    const token = randomBytes(24).toString('base64url');
    await db.owner.query(`insert into invitations(token_hash,email,organization_id,role,invited_by,expires_at) values($1,$2,$3,$4,$5,now()+interval '14 days')`, [sha(token), email, Number(c.req.param('id')), role, ctx.uid]);
    await db.owner.query(`insert into audit_log(user_id,action,entity,entity_id,detail) values($1,'invitation.create','organization',$2,$3::jsonb)`, [ctx.uid, c.req.param('id'), JSON.stringify({ role })]);
    return c.json({ link: `/invitation/${token}`, expires_in_days: 14, note: 'Envoi d’e-mail non branché : transmettez ce lien vous-même.' });
  });
  adm.get('/allocations', async c => c.json((await db.as(c.get('ctx')!, q => q.query(`select a.id,a.reference,a.kind,a.status,a.target_type,a.target_id,a.volume_tco2e,a.price_per_tco2e,a.amount_eur,a.created_at,a.signed_at,a.contract_ref,a.funder_org_id,a.cost_breakdown->'remuneration' remuneration,o.name funder,(select count(*)::int from allocation_lines l where l.allocation_id=a.id) farms from allocations a left join organizations o on o.id=a.funder_org_id where ($1::text is null or a.kind=$1) order by (a.status='quote') desc, a.id desc limit 300`, [c.req.query('kind') ?? null]))).rows));
  adm.get('/funding/summary', async c => c.json((await db.as(c.get('ctx')!, q => q.query(`select (select coalesce(sum(${SELLABLE}),0) from farms f where not f.absent_from_last_import) sellable, (select coalesce(sum(vol_vendu),0) from farms) master_sold,
      (select coalesce(sum(l.volume_tco2e),0) from allocation_lines l join allocations a on a.id=l.allocation_id where a.status in ${FUNDED}) allocated,
      (select coalesce(sum(l.volume_tco2e),0) from allocation_lines l join allocations a on a.id=l.allocation_id where a.status in ${FUNDED} and a.kind='historical_sale') historical,
      (select coalesce(sum(l.volume_tco2e),0) from allocation_lines l join allocations a on a.id=l.allocation_id where a.status in ${FUNDED} and a.funder_org_id is null) unassigned,
      (select count(*)::int from allocations where status='quote') quotes`))).rows[0]));
  adm.post('/allocations/opening-balances', async c => c.json(await openingBalances(db, c.get('ctx')!)));
  adm.post('/allocations', async c => { const b = await c.req.json(); return c.json(await createAllocation(db, c.get('ctx')!, { funder_org_id: num(b.funder_org_id, 'Financeur'), target_type: ['farm', 'project', 'portfolio'].includes(b.target_type) ? b.target_type : 'farm', target_id: b.target_id ? String(b.target_id).trim() : null, filters: b.filters, volume_tco2e: num(b.volume_tco2e, 'Volume') ?? 0, price_per_tco2e: num(b.price_per_tco2e, 'Prix'), status: b.status, notes: b.notes ?? null, spread_by: b.spread_by === 'sau' ? 'sau' : 'labelled' })); });
  adm.put('/allocations/:id', async c => { const b = await c.req.json(); return c.json(await updateAllocation(db, c.get('ctx')!, Number(c.req.param('id')), { status: b.status, funder_org_id: b.funder_org_id === undefined ? undefined : num(b.funder_org_id, 'Financeur'), price_per_tco2e: b.price_per_tco2e === undefined ? undefined : num(b.price_per_tco2e, 'Prix'), contract_ref: b.contract_ref, display_name_policy: b.display_name_policy, claim_wording: b.claim_wording })); });
  // assign a funder to all unassigned historical sales of a project in one go
  adm.put('/projects/:slug/historical-funder', async c => { const b = await c.req.json(); const org = num(b.funder_org_id, 'Financeur'); const r = await db.owner.query(`update allocations a set funder_org_id=$2 from farms f join projects p on p.id=f.project_id where a.kind='historical_sale' and a.target_id=f.id and p.slug=$1 and a.funder_org_id is null returning a.id`, [c.req.param('slug'), org]);
    await db.owner.query(`insert into audit_log(user_id,action,entity,entity_id,detail) values($1,'allocation.assign_historical','project',$2,$3::jsonb)`, [c.get('ctx')!.uid, c.req.param('slug'), JSON.stringify({ org, n: r.rows.length })]); return c.json({ updated: r.rows.length }); });

  // ---------- funder portal (a funder only ever reads its own allocations: enforced by row-level security) ----------
  fun.use('*', async (c, next) => { const x = c.get('ctx'); if (!x || !['funder_admin', 'funder_user'].includes(x.role) || x.org == null) return c.json({ error: 'Espace réservé aux financeurs' }, x ? 403 : 401); await next(); });
  fun.get('/portfolio', async c => {
    const ctx = c.get('ctx')!; const d = await dataset(db);
    const { org, allocs, lines } = await db.as(ctx, async q => ({ org: (await q.query(`select name, public_name_policy from organizations where id=$1`, [ctx.org])).rows[0], allocs: (await q.query(`select a.id,a.reference,a.kind,a.status,a.target_type,a.target_id,a.volume_tco2e,a.price_per_tco2e,a.amount_eur,a.created_at,a.signed_at,a.cost_breakdown->'remuneration' remuneration,(select p.remuneration from projects p where a.target_type='project' and p.slug=a.target_id) project_remuneration from allocations a order by a.id desc`)).rows, lines: (await q.query(`select l.farm_id, l.volume_tco2e, a.status from allocation_lines l join allocations a on a.id=l.allocation_id`)).rows }));
    const mine = new Map<string, number>(); for (const l of lines) if ((FUNDED_STATUSES as readonly string[]).includes(l.status)) mine.set(l.farm_id, (mine.get(l.farm_id) ?? 0) + Number(l.volume_tco2e));
    const fund = await farmFunding(db, [...mine.keys()]);
    const farms = [...mine].map(([id, v]) => { const f = d.farms.find(x => x.id === id); const fu = fund.get(id); const sh = funderShare(v, f?.re_labelled ?? null);
      return { id, project: f?.project ?? null, departement: f?.departement ?? null, region: f?.region ?? null, lat: f?.lat ?? null, lng: f?.lng ?? null, labelled: f?.re_labelled ?? null, my_volume: Math.round(v * 100) / 100, share: sh, remaining: fu?.remaining ?? null,
        attributed: sh == null || !f ? null : { sau: f.sau != null ? f.sau * sh : null, measured: f.re_measured_r25 != null ? f.re_measured_r25 * sh : null, end_estimate: f.re_measured_r25 != null ? farmEndOfProjectEstimate(f.re_avoid_r25 ?? 0, f.re_stor_r25 ?? 0) * sh : null } }; }).sort((a, b) => b.my_volume - a.my_volume);
    const s = (k: (f: (typeof farms)[number]) => number | null | undefined) => farms.reduce((a, f) => a + (k(f) ?? 0), 0);
    return c.json({ organization: org, allocations: allocs.map(a => { const r = resolveRemuneration(a.remuneration, a.project_remuneration); return { id: a.id, reference: a.reference, kind: a.kind, status: a.status, target_type: a.target_type, target_id: a.target_id, created_at: a.created_at, signed_at: a.signed_at, volume_tco2e: Number(a.volume_tco2e), price_per_tco2e: N(a.price_per_tco2e), amount_eur: N(a.amount_eur), farmer_pct: r.farmer_pct, advice_pct: r.advice_pct, farmer_amount_eur: farmerAmount(N(a.amount_eur), r) }; }), farms,
      totals: { funded: s(f => f.my_volume), farms: farms.length, projects: new Set(farms.map(f => f.project)).size, sau_attributed: s(f => f.attributed?.sau), measured_attributed: s(f => f.attributed?.measured), farms_measured: farms.filter(f => f.attributed?.measured != null).length, end_estimate_attributed: s(f => f.attributed?.end_estimate), amount_eur: allocs.filter(a => (FUNDED_STATUSES as readonly string[]).includes(a.status)).reduce((x, a) => x + (Number(a.amount_eur) || 0), 0),
        farmer_amount_eur: allocs.filter(a => (FUNDED_STATUSES as readonly string[]).includes(a.status)).reduce((x, a) => x + (farmerAmount(N(a.amount_eur), resolveRemuneration(a.remuneration, a.project_remuneration)) ?? 0), 0) } });
  });
  // "Request a proposal": creates a quote for Carbone Farmers; nothing is reserved until an admin converts it
  fun.post('/quotes', async c => { const ctx = c.get('ctx')!; const b = await c.req.json(); const v = num(b.volume_tco2e, 'Volume'); if (!v || v <= 0) throw new Error('Indiquez le volume souhaité');
    const tt = ['farm', 'project'].includes(b.target_type) ? b.target_type : 'portfolio'; return c.json(await createAllocation(db, ctx, { funder_org_id: ctx.org!, target_type: tt, target_id: b.target_id ?? null, filters: b.filters ?? {}, volume_tco2e: v, status: 'quote', notes: String(b.notes ?? '').slice(0, 1000) || null })); });
  return { pub, adm, fun };
}
