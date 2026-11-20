// Purchase of the credits that remain to be funded. A purchase = an order + a "reserved" allocation (credits held by the
// over-allocation guard). Paid → the allocation becomes contracted then paid; not paid by the deadline → cancelled, credits freed.
import { Hono } from 'hono';
import type { Db, Ctx } from './db.ts';
import { createAllocation, updateAllocation, farmFunding } from './funders.ts';
import { PROVIDERS, enabledProviders } from './payments.ts';
import { notify } from './phase7.ts';

type Env = { Variables: { ctx: (Ctx & { email: string }) | null } };
const N = (x: any) => (x == null ? null : Number(x));
export const RESERVATION_DAYS = 14;

/** offer for a farm or a project: what remains and the list price (null = not on sale, quote only) */
export async function offer(db: Db, type: 'farm' | 'project', id: string) {
  if (type === 'farm') {
    const f = (await db.owner.query(`select f.id, f.lbc_status, p.name project, p.slug, p.list_price_eur from farms f left join projects p on p.id=f.project_id where f.id=$1`, [id.toUpperCase()])).rows[0]; if (!f) throw new Error('Ferme introuvable');
    const fu = (await farmFunding(db, [f.id])).get(f.id)!; const open = f.lbc_status === 'Labellisé' && fu.remaining > 0.5 && f.list_price_eur != null;
    return { type, id: f.id, label: `Ferme ${f.id}`, project: f.project, project_slug: f.slug, remaining: fu.remaining, price_eur: N(f.list_price_eur), open, reason: open ? null : f.lbc_status !== 'Labellisé' ? 'not_labelled' : fu.remaining <= 0.5 ? 'sold_out' : 'no_price' };
  }
  const p = (await db.owner.query(`select id, slug, name, list_price_eur from projects where slug=$1`, [id])).rows[0]; if (!p) throw new Error('Projet introuvable');
  const ids = (await db.owner.query(`select id from farms where project_id=$1 and lbc_status='Labellisé' and not absent_from_last_import`, [p.id])).rows.map(r => r.id); const m = await farmFunding(db, ids); let remaining = 0; for (const v of m.values()) remaining += v.remaining;
  const open = remaining > 0.5 && p.list_price_eur != null;
  return { type, id: p.slug, label: p.name, project: p.name, project_slug: p.slug, remaining: Math.round(remaining * 100) / 100, price_eur: N(p.list_price_eur), open, reason: open ? null : remaining <= 0.5 ? 'sold_out' : 'no_price', labelled_farms: ids };
}

/** reservations past their deadline are cancelled (credits freed) — run lazily whenever orders are read */
export async function expireOrders(db: Db) {
  const late = (await db.owner.query(`select id, allocation_id, organization_id, reference from orders where status='awaiting_payment' and expires_at < now()`)).rows;
  for (const o of late) { await updateAllocation(db, { role: 'platform_admin' }, o.allocation_id, { status: 'cancelled' }).catch(() => {}); await db.owner.query(`update orders set status='expired' where id=$1`, [o.id]);
    await notify(db, { audience: 'org', organization_id: o.organization_id, kind: 'order', title: `Commande ${o.reference} expirée : les crédits ont été libérés`, link: '/financeur' }); }
  return late.length;
}

export async function placeOrder(db: Db, ctx: Ctx & { email?: string }, b: { type: string; id: string; volume_tco2e: number; method: string; accept_terms: boolean }) {
  if (!b.accept_terms) throw new Error('Veuillez accepter les conditions de vente');
  const prov = PROVIDERS[b.method]; if (!prov || !prov.enabled) throw new Error('Moyen de paiement indisponible');
  const type = b.type === 'project' ? 'project' : 'farm'; const o = await offer(db, type, b.id);
  if (!o.open) throw new Error(o.reason === 'no_price' ? 'Ces crédits ne sont pas en vente directe : demandez une proposition' : o.reason === 'sold_out' ? 'Il ne reste plus de crédits à financer' : 'Ces crédits ne sont pas encore labellisés');
  const v = Math.round(Number(b.volume_tco2e) * 100) / 100; if (!(v >= 1)) throw new Error('Volume minimum : 1 tCO₂e'); if (v > o.remaining + 0.005) throw new Error(`Il reste ${o.remaining} tCO₂e à financer`);
  // the allocation holds the credits (over-allocation guard, row locks); on a project only labelled farms are used
  const a = await createAllocation(db, ctx, { funder_org_id: ctx.org!, target_type: type === 'farm' ? 'farm' : 'portfolio', target_id: type === 'farm' ? o.id : null, filters: type === 'project' ? { ids: (o as any).labelled_farms } : undefined, volume_tco2e: v, price_per_tco2e: o.price_eur, status: 'reserved', notes: `Achat en ligne — ${o.label}` });
  const amount = Math.round(v * o.price_eur! * 100) / 100; const expires = new Date(Date.now() + RESERVATION_DAYS * 86400000).toISOString();
  const r = (await db.owner.query(`insert into orders(reference,allocation_id,organization_id,user_id,target_type,target_id,target_label,volume_tco2e,price_eur,amount_eur,method,status,expires_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'awaiting_payment',$12) returning id`,
    [a.reference.replace(/^FG-/, 'CMD-'), a.id, ctx.org, ctx.uid ?? null, type, o.id, o.label, v, o.price_eur, amount, prov.id, expires])).rows[0];
  const start = await prov.start({ reference: a.reference.replace(/^FG-/, 'CMD-'), amount_eur: amount, expires_at: expires });
  await db.owner.query(`update orders set instructions=$2::jsonb where id=$1`, [r.id, JSON.stringify(start.instructions ?? null)]);
  await notify(db, { audience: 'cf', kind: 'order', title: `Nouvelle commande ${a.reference.replace(/^FG-/, 'CMD-')} : ${v} tCO₂e, ${amount} € (${prov.label_fr})`, link: '/admin' });
  await db.owner.query(`insert into audit_log(user_id,action,entity,entity_id,detail) values($1,'order.create','order',$2,$3::jsonb)`, [ctx.uid ?? null, a.reference.replace(/^FG-/, 'CMD-'), JSON.stringify({ volume: v, amount, method: prov.id })]);
  return { reference: a.reference.replace(/^FG-/, 'CMD-'), allocation_reference: a.reference, volume_tco2e: v, price_eur: o.price_eur, amount_eur: amount, expires_at: expires, farms: a.lines.length, ...start };
}

/** payment confirmed (by an admin today, by a provider webhook later) */
export async function confirmPayment(db: Db, ctx: Ctx, orderId: number, providerRef?: string | null) {
  const o = (await db.owner.query(`select * from orders where id=$1`, [orderId])).rows[0]; if (!o) throw new Error('Commande introuvable'); if (o.status !== 'awaiting_payment') throw new Error(`Commande déjà ${o.status}`);
  await updateAllocation(db, ctx, o.allocation_id, { status: 'contracted' }); await updateAllocation(db, ctx, o.allocation_id, { status: 'paid' });
  await db.owner.query(`update orders set status='paid', paid_at=now(), provider_ref=$2 where id=$1`, [orderId, providerRef ?? null]);
  const ref = (await db.owner.query(`select reference from allocations where id=$1`, [o.allocation_id])).rows[0].reference;
  await notify(db, { audience: 'org', organization_id: o.organization_id, kind: 'order', title: `Paiement reçu pour la commande ${o.reference} : votre certificat est disponible`, link: `/certificat/${ref}` });
  await db.owner.query(`insert into audit_log(user_id,action,entity,entity_id) values($1,'order.paid','order',$2)`, [ctx.uid ?? null, o.reference]); return { ok: true, certificate: ref };
}
export async function cancelOrder(db: Db, ctx: Ctx, orderId: number, byFunder = false) {
  const o = (await db.owner.query(`select * from orders where id=$1`, [orderId])).rows[0]; if (!o || (byFunder && o.organization_id !== ctx.org)) throw new Error('Commande introuvable'); if (o.status !== 'awaiting_payment') throw new Error('Seule une commande en attente de paiement peut être annulée');
  await updateAllocation(db, { role: 'platform_admin', uid: ctx.uid }, o.allocation_id, { status: 'cancelled' }); await db.owner.query(`update orders set status='cancelled' where id=$1`, [orderId]);
  await db.owner.query(`insert into audit_log(user_id,action,entity,entity_id) values($1,'order.cancel','order',$2)`, [ctx.uid ?? null, o.reference]); return { ok: true };
}

export function shopRoutes(db: Db) {
  const pub = new Hono<Env>(), buy = new Hono<Env>(), adm = new Hono<Env>();
  // public: is there something to buy here? (no price: prices are shown to signed-in funders only)
  pub.get('/shop/:type/:id', async c => { const o = await offer(db, c.req.param('type') === 'project' ? 'project' : 'farm', c.req.param('id')); return c.json({ open: o.open, remaining: o.remaining, label: o.label }); });
  // a payment provider webhook will land here once one is connected
  pub.post('/payments/webhook/:provider', c => c.json({ error: 'Aucun prestataire de paiement en ligne n’est branché' }, 501));
  buy.use('*', async (c, next) => { const x = c.get('ctx'); if (!x || !['funder_admin', 'funder_user'].includes(x.role) || x.org == null) return c.json({ error: 'Connectez-vous à votre espace financeur pour acheter des crédits' }, x ? 403 : 401); await next(); });
  buy.get('/offer/:type/:id', async c => { const o = await offer(db, c.req.param('type') === 'project' ? 'project' : 'farm', c.req.param('id')); const { labelled_farms, ...rest } = o as any; return c.json({ ...rest, providers: enabledProviders(), reservation_days: RESERVATION_DAYS }); });
  buy.post('/orders', async c => c.json(await placeOrder(db, c.get('ctx')!, await c.req.json())));
  buy.get('/orders', async c => { await expireOrders(db); return c.json((await db.as(c.get('ctx')!, q => q.query(`select o.id,o.reference,o.target_type,o.target_id,o.target_label,o.volume_tco2e,o.price_eur,o.amount_eur,o.method,o.status,o.created_at,o.expires_at,o.paid_at,o.instructions,a.reference allocation_reference from orders o join allocations a on a.id=o.allocation_id order by o.id desc`))).rows); });
  buy.post('/orders/:id/cancel', async c => c.json(await cancelOrder(db, c.get('ctx')!, Number(c.req.param('id')), true)));
  adm.get('/orders', async c => { await expireOrders(db); return c.json((await db.as(c.get('ctx')!, q => q.query(`select o.*, org.name funder from orders o left join organizations org on org.id=o.organization_id order by (o.status='awaiting_payment') desc, o.id desc limit 200`))).rows); });
  adm.post('/orders/:id/paid', async c => c.json(await confirmPayment(db, c.get('ctx')!, Number(c.req.param('id')), (await c.req.json().catch(() => ({}))).provider_ref ?? null)));
  adm.post('/orders/:id/cancel', async c => c.json(await cancelOrder(db, c.get('ctx')!, Number(c.req.param('id')))));
  adm.put('/projects/:slug/price', async c => { const b = await c.req.json(); const v = b.list_price_eur === '' || b.list_price_eur == null ? null : Number(String(b.list_price_eur).replace(',', '.')); if (v != null && !(v > 0 && v < 1000)) throw new Error('Prix invalide (en € par tCO₂e)');
    const r = await db.as(c.get('ctx')!, q => q.query(`update projects set list_price_eur=$2 where slug=$1 returning slug, list_price_eur`, [c.req.param('slug'), v])); if (!r.rows[0]) return c.json({ error: 'Projet introuvable ou accès refusé' }, 404);
    await db.owner.query(`insert into audit_log(user_id,action,entity,entity_id,detail) values($1,'project.price','project',$2,$3::jsonb)`, [c.get('ctx')!.uid, c.req.param('slug'), JSON.stringify({ list_price_eur: v })]); return c.json(r.rows[0]); });
  return { pub, buy, adm };
}
