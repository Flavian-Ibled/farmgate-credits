// Farm photos: upload (admin), automatic resize + WebP, EXIF removed (GPS would reveal the exact location),
// publication only with a recorded consent. Files live in the local data folder, outside the synced project folder.
import { Hono } from 'hono';
import sharp from 'sharp';
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DATA_DIR, type Db, type Ctx, PUBLIC } from './db.ts';

type Env = { Variables: { ctx: (Ctx & { email: string }) | null } };
export const MEDIA_KINDS = ['portrait', 'farmstead', 'field', 'cover_crop', 'before', 'after'] as const;
const dirOf = (db: Db) => { const d = db.blurSecret === 'test-secret' ? join(tmpdir(), 'fg-media-test') : join(DATA_DIR, 'media'); mkdirSync(d, { recursive: true }); return d; };
const str = (x: any, n = 300) => { const s = String(x ?? '').trim().slice(0, n); return s || null; };

/** Resizes to 1600 px max, converts to WebP and drops all metadata (EXIF, GPS). */
export async function processImage(buf: Buffer) {
  const meta = await sharp(buf).metadata().catch(() => null); if (!meta?.format || !['jpeg', 'png', 'webp', 'heif', 'tiff'].includes(meta.format)) throw new Error('Format d’image non reconnu (JPEG, PNG, WebP ou HEIC attendus)');
  return sharp(buf).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
}

export function mediaRoutes(db: Db) {
  const pub = new Hono<Env>(), adm = new Hono<Env>();
  // a file is served only if row-level security lets the requester see its row: public + consent, or Carbone Farmers
  pub.get('/:file', async c => { const file = c.req.param('file'); if (!/^[a-f0-9]{32}\.webp$/.test(file)) return c.json({ error: 'Introuvable' }, 404);
    const row = (await db.as(c.get('ctx') ?? PUBLIC, q => q.query(`select id from media where file_url=$1`, [`/api/media/${file}`]))).rows[0]; const p = join(dirOf(db), file);
    if (!row || !existsSync(p)) return c.json({ error: 'Introuvable' }, 404); return c.body(readFileSync(p) as any, 200, { 'content-type': 'image/webp', 'cache-control': 'private, max-age=300' }); });

  adm.get('/farms/:id/media', async c => c.json((await db.as(c.get('ctx')!, q => q.query(`select id,kind,file_url,alt_fr,caption_fr,credit,consent_status,public,sort from media where farm_id=$1 order by sort, id`, [c.req.param('id').toUpperCase()]))).rows));
  adm.post('/farms/:id/media', async c => {
    const id = c.req.param('id').toUpperCase(); const form = await c.req.parseBody(); const file = form.file as File | undefined; if (!file || typeof file === 'string') return c.json({ error: 'Fichier manquant' }, 400);
    if (file.size > 25 * 1024 * 1024) throw new Error('Photo trop lourde (25 Mo maximum)');
    const out = await processImage(Buffer.from(await file.arrayBuffer())); const name = `${randomBytes(16).toString('hex')}.webp`; const kind = (MEDIA_KINDS as readonly string[]).includes(String(form.kind)) ? String(form.kind) : 'field';
    const consent = form.consent === '1' ? 'granted' : 'pending';
    const r = await db.as(c.get('ctx')!, q => q.query(`insert into media(farm_id,kind,file_url,alt_fr,caption_fr,credit,consent_status,public,sort) values($1,$2,$3,$4,$5,$6,$7,$8,(select coalesce(max(sort),0)+1 from media where farm_id=$1)) returning id,kind,file_url,consent_status,public`, [id, kind, `/api/media/${name}`, str(form.alt_fr), str(form.caption_fr), str(form.credit, 120), consent, consent === 'granted' && form.public === '1']));
    if (!r.rows[0]) return c.json({ error: 'Accès refusé' }, 403); writeFileSync(join(dirOf(db), name), out);
    await db.owner.query(`insert into audit_log(user_id,action,entity,entity_id,detail) values($1,'media.upload','farm',$2,$3::jsonb)`, [c.get('ctx')!.uid, id, JSON.stringify({ kind, bytes: out.length, consent })]); return c.json(r.rows[0]);
  });
  adm.put('/media/:mid', async c => { const b = await c.req.json(); const consent = b.consent_status === 'granted' ? 'granted' : b.consent_status === 'refused' ? 'refused' : 'pending';
    // a photo can never be public without a recorded consent
    const r = await db.as(c.get('ctx')!, q => q.query(`update media set kind=$2, alt_fr=$3, caption_fr=$4, credit=$5, consent_status=$6, public=$7 where id=$1 returning id,farm_id,consent_status,public`, [Number(c.req.param('mid')), (MEDIA_KINDS as readonly string[]).includes(b.kind) ? b.kind : 'field', str(b.alt_fr), str(b.caption_fr), str(b.credit, 120), consent, consent === 'granted' && b.public === true]));
    if (!r.rows[0]) return c.json({ error: 'Introuvable ou accès refusé' }, 404); await db.owner.query(`insert into audit_log(user_id,action,entity,entity_id,detail) values($1,'media.update','farm',$2,$3::jsonb)`, [c.get('ctx')!.uid, r.rows[0].farm_id, JSON.stringify({ consent, public: r.rows[0].public })]); return c.json(r.rows[0]); });
  adm.delete('/media/:mid', async c => { const r = await db.as(c.get('ctx')!, q => q.query(`delete from media where id=$1 returning farm_id, file_url`, [Number(c.req.param('mid'))])); if (!r.rows[0]) return c.json({ error: 'Introuvable ou accès refusé' }, 404);
    rmSync(join(dirOf(db), String(r.rows[0].file_url).split('/').pop()!), { force: true }); await db.owner.query(`insert into audit_log(user_id,action,entity,entity_id) values($1,'media.delete','farm',$2)`, [c.get('ctx')!.uid, r.rows[0].farm_id]); return c.json({ ok: true }); });
  return { pub, adm };
}
