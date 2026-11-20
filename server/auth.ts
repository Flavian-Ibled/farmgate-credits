// DEV auth adapter (email + password, scrypt, server-side sessions, lockout). Production must use a managed auth
// provider (e.g. Supabase Auth, EU region) behind the same interface — see README "Auth".
import { scryptSync, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import type { Db, Ctx } from './db.ts';

export const MIN_PASSWORD = 12;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
export function hashPassword(pw: string) {
  if (pw.length < MIN_PASSWORD) throw new Error(`Mot de passe : ${MIN_PASSWORD} caractères minimum`);
  const salt = randomBytes(16); return `scrypt$${salt.toString('hex')}$${scryptSync(pw, salt, 64).toString('hex')}`;
}
function verify(pw: string, stored: string | null) {
  if (!stored) return false; const [, salt, hash] = stored.split('$');
  const h = scryptSync(pw, Buffer.from(salt, 'hex'), 64); return timingSafeEqual(h, Buffer.from(hash, 'hex'));
}
export async function createUser(db: Db, u: { email: string; password: string; role: string; organization_id?: number | null; first_name?: string }) {
  const r = await db.owner.query(`insert into users(email,first_name,organization_id,role,status,password_hash) values(lower($1),$2,$3,$4,'active',$5) returning id`, [u.email, u.first_name ?? null, u.organization_id ?? null, u.role, hashPassword(u.password)]);
  return r.rows[0].id as number;
}
export async function login(db: Db, email: string, password: string): Promise<{ token: string } | { error: string }> {
  const u = (await db.owner.query(`select * from users where email=lower($1)`, [email])).rows[0];
  const fail = { error: 'Identifiants invalides' };
  if (!u || u.status !== 'active') { await db.owner.query(`insert into audit_log(action,detail) values('login.failed',$1::jsonb)`, [JSON.stringify({ reason: 'unknown_or_disabled' })]); return fail; }
  if (u.locked_until && new Date(u.locked_until) > new Date()) return { error: 'Compte temporairement verrouillé' };
  if (!verify(password, u.password_hash)) {
    const n = u.failed_logins + 1;
    await db.owner.query(`update users set failed_logins=$2, locked_until=case when $2>=5 then now()+interval '15 minutes' else null end where id=$1`, [u.id, n]);
    await db.owner.query(`insert into audit_log(user_id,action) values($1,'login.failed')`, [u.id]); return fail;
  }
  const token = randomBytes(32).toString('hex');
  await db.owner.query(`insert into sessions(token_hash,user_id,expires_at) values($1,$2,now()+interval '8 hours')`, [sha(token), u.id]);
  await db.owner.query(`update users set failed_logins=0, locked_until=null, last_login=now() where id=$1`, [u.id]);
  await db.owner.query(`insert into audit_log(user_id,action) values($1,'login.ok')`, [u.id]);
  return { token };
}
export async function sessionCtx(db: Db, token: string | undefined): Promise<(Ctx & { email: string }) | null> {
  if (!token) return null;
  const r = (await db.owner.query(`select u.id,u.role,u.organization_id,u.email from sessions s join users u on u.id=s.user_id where s.token_hash=$1 and s.expires_at>now() and u.status='active'`, [sha(token)])).rows[0];
  return r ? { role: r.role, org: r.organization_id, uid: r.id, email: r.email } : null;
}
export const logout = (db: Db, token: string) => db.owner.query(`delete from sessions where token_hash=$1`, [sha(token)]);
