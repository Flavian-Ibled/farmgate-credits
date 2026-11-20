import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { openDb, type Db } from '../server/db.ts';
import { createApp } from '../server/app.ts';
import { invalidate } from '../server/facts.ts';
import { dryRun, applyImport } from '../server/importer/apply.ts';
import { farmFunding } from '../server/funders.ts';
import { expireOrders } from '../server/shop.ts';
import { createUser } from '../server/auth.ts';
import { workbook, COLS, farm } from './helpers.ts';

let db: Db, app: ReturnType<typeof createApp>; const c: Record<string, string> = {};
const req = async (method: string, p: string, cookie = '', b?: unknown) => { const r = await app.request(p, { method, headers: { 'content-type': 'application/json', cookie }, body: b === undefined ? undefined : JSON.stringify(b) }); const text = await r.text(); return { status: r.status, text, body: (() => { try { return JSON.parse(text); } catch { return null; } })() as any }; };
const left = async (id: string) => (await farmFunding(db, [id])).get(id)!.remaining;
beforeAll(async () => {
  db = await openDb({ memory: true }); invalidate();
  const wb = await workbook([...COLS, { group: 'Données Carbone', unit: 'tCO2e', label: 'Volume vendable' }], [farm('AAA-001', { Projet: 'Projet A', 'Volume Vendu': 0, 'Volume vendable': 100 }), farm('AAA-002', { Projet: 'Projet A', 'Volume Vendu': 0, 'Volume vendable': 100 }), farm('AAA-003', { Projet: 'Projet A', 'Statut LBC': 'En instruction', 'Volume Vendu': 0, 'Volume vendable': 100 })]);
  const d: any = await dryRun(db, wb, { filename: 't.xlsx' }); await applyImport(db, d.id);
  const f1 = (await db.owner.query(`insert into organizations(type,name) values('funder','Acheteur 1') returning id`)).rows[0].id, f2 = (await db.owner.query(`insert into organizations(type,name) values('funder','Acheteur 2') returning id`)).rows[0].id;
  for (const [n, role, o] of [['admin', 'platform_admin', null], ['b1', 'funder_user', f1], ['b2', 'funder_user', f2]] as const) await createUser(db, { email: `${n}@test.local`, password: 'correct-horse-battery', role, organization_id: o });
  app = createApp(db); for (const n of ['admin', 'b1', 'b2']) c[n] = (await app.request('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: `${n}@test.local`, password: 'correct-horse-battery' }) })).headers.get('set-cookie')!.split(';')[0];
});
afterAll(() => db.close());

describe('buying the credits that remain to be funded', () => {
  it('no list price → not on sale (quote only); prices are never public', async () => {
    expect((await req('GET', '/api/public/shop/farm/AAA-001')).body).toMatchObject({ open: false, remaining: 100 });
    expect((await req('GET', '/api/shop/offer/farm/AAA-001', c.b1)).body).toMatchObject({ open: false, reason: 'no_price' });
    expect((await req('POST', '/api/shop/orders', c.b1, { type: 'farm', id: 'AAA-001', volume_tco2e: 10, method: 'transfer', accept_terms: true })).body.error).toMatch(/demandez une proposition/);
    expect((await req('PUT', '/api/admin/projects/projet-a/price', c.b1, { list_price_eur: 40 })).status).toBe(403); expect((await req('PUT', '/api/admin/projects/projet-a/price', c.admin, { list_price_eur: -3 })).status).toBe(400);
    expect((await req('PUT', '/api/admin/projects/projet-a/price', c.admin, { list_price_eur: '42,5' })).body.list_price_eur).toBe('42.5');
    const pub = await req('GET', '/api/public/shop/farm/AAA-001'); expect(pub.body.open).toBe(true); expect(pub.text).not.toMatch(/42/);
    expect((await req('GET', '/api/shop/offer/farm/AAA-001')).status).toBe(401); expect((await req('GET', '/api/shop/offer/farm/AAA-001', c.admin)).status).toBe(403);
    expect((await req('GET', '/api/shop/offer/farm/AAA-003', c.b1)).body).toMatchObject({ open: false, reason: 'not_labelled' }); // not labelled yet
  });
  it('an order holds the credits at once, with bank-transfer instructions and a deadline; nothing is invented', async () => {
    expect((await req('POST', '/api/shop/orders', c.b1, { type: 'farm', id: 'AAA-001', volume_tco2e: 30, method: 'transfer', accept_terms: false })).status).toBe(400);
    expect((await req('POST', '/api/shop/orders', c.b1, { type: 'farm', id: 'AAA-001', volume_tco2e: 30, method: 'online', accept_terms: true })).body.error).toMatch(/indisponible/);
    const o = await req('POST', '/api/shop/orders', c.b1, { type: 'farm', id: 'AAA-001', volume_tco2e: 30, method: 'transfer', accept_terms: true });
    expect(o.body).toMatchObject({ volume_tco2e: 30, price_eur: 42.5, amount_eur: 1275, farms: 1 }); expect(o.body.reference).toMatch(/^CMD-/);
    expect(o.body.instructions).toMatchObject({ method: 'transfer', amount_eur: 1275, bank: { holder: null, iban: null, bic: null } }); // bank details only from the server settings
    expect(await left('AAA-001')).toBe(70); // held immediately
    expect((await req('POST', '/api/shop/orders', c.b2, { type: 'farm', id: 'AAA-001', volume_tco2e: 71, method: 'transfer', accept_terms: true })).body.error).toMatch(/Il reste 70/);
    const mine = (await req('GET', '/api/shop/orders', c.b1)).body, theirs = (await req('GET', '/api/shop/orders', c.b2)).body; expect(mine).toHaveLength(1); expect(theirs).toEqual([]);
    expect((await req('GET', '/api/me/notifications', c.admin)).body.items[0].title).toMatch(/Nouvelle commande CMD-.*1275/);
  });
  it('payment confirmed by Carbone Farmers → contribution paid, certificate available; the buyer is notified', async () => {
    const o = (await req('GET', '/api/admin/orders', c.admin)).body[0]; expect(o).toMatchObject({ status: 'awaiting_payment', funder: 'Acheteur 1' });
    expect((await req('POST', `/api/admin/orders/${o.id}/paid`, c.b1)).status).toBe(403);
    const r = await req('POST', `/api/admin/orders/${o.id}/paid`, c.admin, {}); expect(r.body.certificate).toMatch(/^FG-/); expect((await req('POST', `/api/admin/orders/${o.id}/paid`, c.admin, {})).status).toBe(400);
    expect((await req('GET', `/api/public/ledger/${r.body.certificate}`)).body).toMatchObject({ status: 'paid', valid: true, volume_tco2e: 30 });
    expect((await req('GET', '/api/me/notifications', c.b1)).body.items[0].title).toMatch(/Paiement reçu/); expect((await req('GET', '/api/funder/portfolio', c.b1)).body.totals.funded).toBe(30);
  });
  it('a project purchase is spread over its labelled farms only; cancelling or expiring frees the credits', async () => {
    const o = await req('POST', '/api/shop/orders', c.b2, { type: 'project', id: 'projet-a', volume_tco2e: 100, method: 'transfer', accept_terms: true });
    expect(o.body.farms).toBe(2); expect(await left('AAA-003')).toBe(100); expect((await left('AAA-001')) + (await left('AAA-002'))).toBeCloseTo(70);
    const id = (await req('GET', '/api/shop/orders', c.b2)).body[0].id; expect((await req('POST', `/api/shop/orders/${id}/cancel`, c.b1)).status).toBe(400);
    expect((await req('POST', `/api/shop/orders/${id}/cancel`, c.b2)).body.ok).toBe(true); expect((await left('AAA-001')) + (await left('AAA-002'))).toBeCloseTo(170);
    await req('POST', '/api/shop/orders', c.b2, { type: 'farm', id: 'AAA-002', volume_tco2e: 50, method: 'transfer', accept_terms: true }); expect(await left('AAA-002')).toBe(50);
    await db.owner.query(`update orders set expires_at=now()-interval '1 day' where status='awaiting_payment'`); expect(await expireOrders(db)).toBe(1); expect(await left('AAA-002')).toBe(100);
    expect((await req('GET', '/api/shop/orders', c.b2)).body.map((x: any) => x.status)).toEqual(['expired', 'cancelled']);
    expect((await req('POST', '/api/public/payments/webhook/stripe')).status).toBe(501);
  });
});
