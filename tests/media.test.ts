import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import sharp from 'sharp';
import { openDb, type Db } from '../server/db.ts';
import { createApp } from '../server/app.ts';
import { invalidate } from '../server/facts.ts';
import { dryRun, applyImport } from '../server/importer/apply.ts';
import { processImage } from '../server/media.ts';
import { createUser } from '../server/auth.ts';
import { workbook, COLS, farm } from './helpers.ts';

let db: Db, app: ReturnType<typeof createApp>, cAdmin = '', cFunder = '';
const photo = () => sharp({ create: { width: 3000, height: 2000, channels: 3, background: '#529a38' } }).jpeg().withExif({ IFD3: { GPSLatitude: '48/1 30/1 0/1', GPSLongitude: '1/1 45/1 0/1' } }).toBuffer();
const upload = async (cookie: string, fields: Record<string, string> = {}, buf?: Buffer) => { const fd = new FormData(); fd.set('file', new File([new Uint8Array(buf ?? await photo())], 'IMG_0001.jpg', { type: 'image/jpeg' })); for (const [k, v] of Object.entries(fields)) fd.set(k, v); return app.request('/api/admin/farms/tst-001/media', { method: 'POST', headers: { cookie }, body: fd }); };
const json = async (p: string, init?: RequestInit) => { const r = await app.request(p, init); return { status: r.status, body: await r.json().catch(() => null) as any }; };
beforeAll(async () => {
  db = await openDb({ memory: true }); invalidate(); const d: any = await dryRun(db, await workbook(COLS, [farm('TST-001'), farm('TST-002')]), { filename: 't.xlsx' }); await applyImport(db, d.id);
  const org = (await db.owner.query(`insert into organizations(type,name) values('funder','F') returning id`)).rows[0].id;
  await createUser(db, { email: 'admin@test.local', password: 'correct-horse-battery', role: 'platform_admin' }); await createUser(db, { email: 'f@test.local', password: 'correct-horse-battery', role: 'funder_user', organization_id: org });
  app = createApp(db); const login = async (email: string) => (await app.request('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'correct-horse-battery' }) })).headers.get('set-cookie')!.split(';')[0];
  cAdmin = await login('admin@test.local'); cFunder = await login('f@test.local');
});
afterAll(() => db.close());

describe('farm photos', () => {
  it('a photo is resized, converted to WebP and stripped of its GPS data', async () => {
    const src = await photo(); expect((await sharp(src).metadata()).exif).toBeTruthy();
    const out = await processImage(src); const m = await sharp(out).metadata(); expect(m.format).toBe('webp'); expect(m.width).toBe(1600); expect(m.exif).toBeUndefined();
    await expect(processImage(Buffer.from('pas une image'))).rejects.toThrow(/Format d’image/);
  });
  it('an uploaded photo stays private until consent is recorded AND it is published', async () => {
    const up = await upload(cAdmin, { kind: 'portrait', caption_fr: 'Portrait', public: '1' }); expect(up.status).toBe(200); const m = await up.json() as any;
    expect(m).toMatchObject({ kind: 'portrait', consent_status: 'pending', public: false }); expect(m.file_url).toMatch(/^\/api\/media\/[a-f0-9]{32}\.webp$/); // "public" ignored without consent
    expect((await json('/api/public/farms/TST-001')).body.media).toEqual([]); expect((await app.request(m.file_url)).status).toBe(404); expect((await app.request(m.file_url, { headers: { cookie: cFunder } })).status).toBe(404);
    const adminView = await app.request(m.file_url, { headers: { cookie: cAdmin } }); expect(adminView.status).toBe(200); expect(adminView.headers.get('content-type')).toBe('image/webp');
    expect((await sharp(Buffer.from(await adminView.arrayBuffer())).metadata()).exif).toBeUndefined();
    const put = (b: unknown) => json(`/api/admin/media/${m.id}`, { method: 'PUT', headers: { 'content-type': 'application/json', cookie: cAdmin }, body: JSON.stringify(b) });
    expect((await put({ kind: 'portrait', public: true })).body.public).toBe(false); // still no consent
    expect((await put({ kind: 'portrait', caption_fr: 'Portrait de l’exploitant', consent_status: 'granted', public: true })).body).toMatchObject({ consent_status: 'granted', public: true });
    const page = (await json('/api/public/farms/TST-001')).body; expect(page.media).toHaveLength(1); expect(page.media[0]).toMatchObject({ kind: 'portrait', caption_fr: 'Portrait de l’exploitant' }); expect((await app.request(m.file_url)).status).toBe(200);
    expect((await json('/api/public/farms/TST-002')).body.media).toEqual([]);
  });
  it('only Carbone Farmers can upload, edit or delete; deleting removes the file', async () => {
    expect((await upload(cFunder)).status).toBe(403); expect((await upload('')).status).toBe(401); expect((await upload(cAdmin, {}, Buffer.from('%PDF-1.4 pas une photo'))).status).toBe(400);
    const list = (await json('/api/admin/farms/TST-001/media', { headers: { cookie: cAdmin } })).body; expect(list).toHaveLength(1);
    expect((await json(`/api/admin/media/${list[0].id}`, { method: 'DELETE', headers: { cookie: cFunder } })).status).toBe(403);
    expect((await json(`/api/admin/media/${list[0].id}`, { method: 'DELETE', headers: { cookie: cAdmin } })).status).toBe(200); expect((await app.request(list[0].file_url, { headers: { cookie: cAdmin } })).status).toBe(404);
    expect((await json('/api/public/farms/TST-001')).body.media).toEqual([]);
  });
});
describe('farm identity for admins', () => {
  it('admins see the farmer; the public name appears only with consent', async () => {
    const a = (await json('/api/admin/farms/TST-001', { headers: { cookie: cAdmin } })).body; expect(a).toMatchObject({ name: 'EARL SECRET TST-001', farmer: 'DUPONT-PRIVE TST-001', commune: 'VILLESECRETE' });
    expect((await json('/api/admin/farms/TST-001', { headers: { cookie: cFunder } })).status).toBe(403); expect((await json('/api/admin/farms/TST-001')).status).toBe(401);
    const put = (b: unknown) => json('/api/admin/farms/TST-001/identity', { method: 'PUT', headers: { 'content-type': 'application/json', cookie: cAdmin }, body: JSON.stringify(b) });
    await put({ public_name: 'Ferme des Tilleuls', consent_public_name: false }); expect((await json('/api/public/farms/TST-001')).body.name).toBeNull();
    await put({ public_name: 'Ferme des Tilleuls', consent_public_name: true }); expect((await json('/api/public/farms/TST-001')).body.name).toBe('Ferme des Tilleuls');
    expect((await put({ public_name: '', consent_public_name: true })).body.consent_public_name).toBe(false);
  });
});
