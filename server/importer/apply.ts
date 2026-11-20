// Import pipeline: dry run → diff preview → apply (idempotent upsert keyed on farm.id) → history → rollback.
import { createHash } from 'node:crypto';
import type { Db, Q } from '../db.ts';
import { parseDataMaster, PRIVATE_FIELDS, type Parsed, type Val, type LeverDef } from './parse.ts';
import { slugify, MASTER_INDICATORS } from '../../shared/catalogue.ts';
const MASTER_CODES = MASTER_INDICATORS.map(i => i.code);

const same = (a: Val | undefined, b: Val | undefined) => {
  if (a == null && b == null) return true;
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
  return a === b;
};

/** Deterministic privacy blur: the same farm always gets the same 2–5 km offset, so repeated requests cannot average it out. */
export function blur(id: string, lat: number, lng: number, secret: string, km = 3) {
  const h = createHash('sha256').update(secret + '|' + id).digest();
  const angle = (h.readUInt32BE(0) / 2 ** 32) * 2 * Math.PI;
  const dist = Math.max(2, Math.min(5, km - 1 + (h.readUInt32BE(4) / 2 ** 32) * 3));
  return { lat: lat + (dist * Math.cos(angle)) / 111.32, lng: lng + (dist * Math.sin(angle)) / (111.32 * Math.cos((lat * Math.PI) / 180)) };
}

export interface Diff { created: string[]; updated: { id: string; changes: { field: string; old: Val; new: Val }[] }[]; unchanged: number; absent: string[]; locked_skipped: number }

export async function dryRun(db: Db, buf: Buffer, meta: { filename: string; userId?: number | null; sheet?: string }) {
  const sha = createHash('sha256').update(buf).digest('hex');
  let parsed: Parsed;
  try { parsed = await parseDataMaster(buf, { sheet: meta.sheet }); }
  catch (e: any) {
    const r = await db.owner.query(`insert into imports(kind,filename,file_sha256,user_id,status,report) values('data_master',$1,$2,$3,'failed',$4::jsonb) returning id`, [meta.filename, sha, meta.userId ?? null, JSON.stringify({ fatal: e.message })]);
    return { id: r.rows[0].id as number, status: 'failed', fatal: e.message as string };
  }
  const cur = await db.owner.query<{ farm_id: string; imported: Record<string, Val>; locked_fields: string[] }>(`select farm_id, imported, locked_fields from farm_private`);
  const curMap = new Map(cur.rows.map(r => [r.farm_id, r]));
  const diff: Diff = { created: [], updated: [], unchanged: 0, absent: [], locked_skipped: 0 };
  for (const f of parsed.farms) {
    const c = curMap.get(f.id);
    if (!c) { diff.created.push(f.id); continue; }
    // a column absent from the file never blanks an existing value (partial / project files)
    for (const k of Object.keys(c.imported)) if (!(k in f.rec)) f.rec[k] = c.imported[k];
    const changes = [];
    for (const k of new Set([...Object.keys(f.rec), ...Object.keys(c.imported)])) {
      if (same(f.rec[k], c.imported[k])) continue;
      if (c.locked_fields.includes(k)) { diff.locked_skipped++; f.rec[k] = c.imported[k] ?? null; continue; }
      changes.push({ field: k, old: c.imported[k] ?? null, new: f.rec[k] ?? null });
    }
    if (changes.length) diff.updated.push({ id: f.id, changes }); else diff.unchanged++;
  }
  const inFile = new Set(parsed.farms.map(f => f.id));
  // full import: every farm missing from the file is "absent". Project import: only the farms of the project(s) in the file.
  diff.absent = cur.rows.filter(r => !inFile.has(r.farm_id) && (parsed.scope === 'full' || parsed.projects.includes(String(r.imported.project ?? '')))).map(r => r.farm_id);
  const byCode: Record<string, { level: string; n: number }> = {};
  for (const i of parsed.issues) (byCode[i.code] ??= { level: i.level, n: 0 }).n++;
  const counts = { in_file: parsed.farms.length, created: diff.created.length, updated: diff.updated.length, unchanged: diff.unchanged, absent: diff.absent.length, errors: parsed.issues.filter(i => i.level === 'error').length, warnings: parsed.issues.filter(i => i.level === 'warning').length, locked_skipped: diff.locked_skipped };
  const r = await db.owner.query(`insert into imports(kind,filename,file_sha256,user_id,status,counts,report,payload,data_as_of) values('data_master',$1,$2,$3,'dry_run',$4::jsonb,$5::jsonb,$6::jsonb,current_date) returning id`,
    [meta.filename, sha, meta.userId ?? null, JSON.stringify(counts), JSON.stringify({ issues: parsed.issues, by_code: byCode, stats: parsed.stats, diff, scope: { type: parsed.scope, sheet: parsed.main_sheet, projects: parsed.projects } }), JSON.stringify({ farms: parsed.farms, levers: parsed.levers, porteurs: parsed.porteurs })]);
  return { id: r.rows[0].id as number, status: 'dry_run', counts, by_code: byCode, stats: parsed.stats, scope: parsed.scope, projects: parsed.projects };
}

async function projectId(q: Q, name: string | null, cache: Map<string, number>, porteurs: Record<string, string>) {
  if (!name) return null;
  if (cache.has(name)) return cache.get(name)!;
  let org: number | null = null;
  if (porteurs[name]) org = (await q.query(`insert into organizations(type,name,public_name_policy) values('project_owner',$1,'named') on conflict(name) do update set name=excluded.name returning id`, [porteurs[name]])).rows[0].id;
  const r = await q.query(`insert into projects(slug,name,porteur_org_id) values($1,$2,$3) on conflict(name) do update set porteur_org_id=coalesce(excluded.porteur_org_id, projects.porteur_org_id) returning id`, [slugify(name), name, org]);
  cache.set(name, r.rows[0].id); return r.rows[0].id as number;
}

/** Projects one imported record into the relational tables. Platform-owned fields (story, photos, consent, allocations) are never touched. */
export async function project(q: Q, id: string, rec: Record<string, Val>, importId: number, secret: string, pcache: Map<string, number>, porteurs: Record<string, string>) {
  const n = (k: string) => (typeof rec[k] === 'number' ? (rec[k] as number) : null), s = (k: string) => (rec[k] == null ? null : String(rec[k]));
  const pid = await projectId(q, s('project'), pcache, porteurs);
  const lat = n('lat'), lng = n('lng'); const b = lat !== null && lng !== null ? blur(id, lat, lng, secret) : null;
  const pub = ['em_init_ha', 'em_target_ha', 'st_init_ha', 'st_target_ha', 're_evit_ha', 're_evit_total', 're_stock_ha', 're_stock_total', 're_total_ha', 're_total_ha_yr', 're_labelled', 'vol_filieres', 'vol_vendable', 'vol_vendu', 'vol_dispo'];
  await q.query(`insert into farms(id,project_id,departement,region,typology,lbc_status,sau,lat_blur,lng_blur,reference_period,project_period,rabais,rabais_text,${pub.join(',')},last_import_id,last_diag_date,verified_at,verified_by,absent_from_last_import,updated_at)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,${pub.map((_, i) => '$' + (i + 14)).join(',')},$${pub.length + 14},$${pub.length + 15},$${pub.length + 16},$${pub.length + 17},false,now())
    on conflict(id) do update set project_id=excluded.project_id,departement=excluded.departement,region=excluded.region,typology=excluded.typology,lbc_status=excluded.lbc_status,sau=excluded.sau,lat_blur=excluded.lat_blur,lng_blur=excluded.lng_blur,reference_period=excluded.reference_period,project_period=excluded.project_period,rabais=excluded.rabais,rabais_text=excluded.rabais_text,${pub.map(k => `${k}=excluded.${k}`).join(',')},last_import_id=excluded.last_import_id,last_diag_date=excluded.last_diag_date,verified_at=excluded.verified_at,verified_by=excluded.verified_by,absent_from_last_import=false,updated_at=now()`,
    [id, pid, s('departement'), s('region'), s('typology'), s('lbc_status'), n('sau'), b?.lat ?? null, b?.lng ?? null, s('reference_period'), s('project_period'), n('rabais_num'), s('rabais'), ...pub.map(n), importId, s('last_diag_date'), s('verified_at'), s('verified_by')]);
  await q.query(`insert into farm_private(farm_id,name,farmer,address,commune,postal_code,siret,legal_status,lat,lng,diagnostic_referent,imported) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)
    on conflict(farm_id) do update set name=excluded.name,farmer=excluded.farmer,address=excluded.address,commune=excluded.commune,postal_code=excluded.postal_code,siret=excluded.siret,legal_status=excluded.legal_status,lat=excluded.lat,lng=excluded.lng,diagnostic_referent=excluded.diagnostic_referent,imported=excluded.imported`,
    [id, s('name'), s('farmer'), s('address'), s('commune'), s('postal_code'), s('siret'), s('legal_status'), lat, lng, s('diagnostic_referent'), JSON.stringify(rec)]);
  if (pid) await q.query(`insert into farm_memberships(farm_id,project_id,status) values($1,$2,$3) on conflict(farm_id,project_id) do update set status=excluded.status`, [id, pid, s('lbc_status')]);
  await q.query(`delete from indicator_values where farm_id=$1 and state in ('initial','prospectif') and indicator_code = any($2::text[])`, [id, MASTER_CODES]);
  await q.query(`delete from farm_levers where farm_id=$1 and cost_annual_eur_ha is null and cost_one_off_eur_ha is null and saving_eur_ha is null`, [id]);
  const fu: Record<string, Record<string, number>> = {};
  for (const [k, v] of Object.entries(rec)) {
    if (v == null) continue;
    const p = k.split(':');
    if (p[0] === 'ind' && typeof v === 'number') await q.query(`insert into indicator_values(farm_id,indicator_code,state,value) values($1,$2,$3,$4)`, [id, p[1], p[2], v]);
    else if (p[0] === 'lever' && typeof v === 'boolean') await q.query(`insert into farm_levers(farm_id,lever_code,active) values($1,$2,$3) on conflict(farm_id,lever_code) do update set active=excluded.active`, [id, p[1], v]);
    else if (p[0] === 'fu' && typeof v === 'number') (fu[p[1]] ??= {})[p[2]] = v;
  }
  for (const [year, x] of Object.entries(fu)) {
    const tot = x.re_avoidance != null || x.re_storage != null ? (x.re_avoidance ?? 0) + (x.re_storage ?? 0) : null;
    await q.query(`insert into annual_followups(farm_id,harvest_year,re_avoidance_year,re_storage_year,re_total_year,emissions_year,storage_year,source) values($1,$2,$3,$4,$5,$6,$7,$8)
      on conflict(farm_id,harvest_year) do update set re_avoidance_year=excluded.re_avoidance_year,re_storage_year=excluded.re_storage_year,re_total_year=excluded.re_total_year,emissions_year=excluded.emissions_year,storage_year=excluded.storage_year,source=excluded.source`,
      [id, Number(year), x.re_avoidance ?? null, x.re_storage ?? null, tot, x.emissions ?? null, x.storage ?? null, `import #${importId}`]);
  }
}

export async function applyImport(db: Db, importId: number, userId?: number | null) {
  return db.tx(async q => {
    const imp = (await q.query(`select * from imports where id=$1 for update`, [importId])).rows[0];
    if (!imp) throw new Error('Import introuvable');
    if (imp.status !== 'dry_run') throw new Error(`Import déjà ${imp.status}`);
    const newer = (await q.query(`select count(*)::int n from imports where id>$1 and status='applied'`, [importId])).rows[0].n;
    if (newer) throw new Error('Un import plus récent a déjà été appliqué : relancez une simulation');
    const { farms, levers, porteurs } = imp.payload as { farms: { id: string; rec: Record<string, Val> }[]; levers: LeverDef[]; porteurs: Record<string, string> };
    const diff = imp.report.diff as Diff;
    for (const l of levers) await q.query(`insert into levers(code,family,name_fr,type,scope,sort) values($1,$2,$3,$4,$5,$6) on conflict(code) do update set family=excluded.family,name_fr=excluded.name_fr,type=excluded.type,scope=excluded.scope,sort=excluded.sort`, [l.code, l.family, l.name_fr, l.type, l.scope, l.sort]);
    const touch = new Set([...diff.created, ...diff.updated.map(u => u.id)]); const pcache = new Map<string, number>();
    for (const f of farms) if (touch.has(f.id)) await project(q, f.id, f.rec, importId, db.blurSecret, pcache, porteurs);
    for (const id of diff.created) await q.query(`insert into import_changes(import_id,farm_id,change) values($1,$2,'created')`, [importId, id]);
    for (const u of diff.updated) for (const c of u.changes) await q.query(`insert into import_changes(import_id,farm_id,change,field,old_value,new_value) values($1,$2,'updated',$3,$4::jsonb,$5::jsonb)`, [importId, u.id, c.field, JSON.stringify(c.old), JSON.stringify(c.new)]);
    // a farm absent from the file is never deleted: it is flagged
    if ((imp.report.scope?.type ?? 'full') === 'full') await q.query(`update farms set absent_from_last_import = not (id = any($1::text[])) where created_from is null or id = any($1::text[])`, [farms.map(f => f.id)]);
    else if (diff.absent.length) await q.query(`update farms set absent_from_last_import = true where id = any($1::text[])`, [diff.absent]);
    await q.query(`update imports set status='applied', applied_at=now(), payload=null where id=$1`, [importId]);
    await q.query(`insert into audit_log(user_id,action,entity,entity_id,detail) values($1,'import.apply','import',$2,$3::jsonb)`, [userId ?? null, String(importId), JSON.stringify(imp.counts)]);
    return imp.counts;
  });
}

/** One click rolls back a whole import (only the most recent applied one, so history stays linear). */
export async function rollbackImport(db: Db, importId: number, userId?: number | null) {
  return db.tx(async q => {
    const imp = (await q.query(`select id,status from imports where id=$1 for update`, [importId])).rows[0];
    if (!imp || imp.status !== 'applied') throw new Error('Seul un import appliqué peut être annulé');
    if ((await q.query(`select count(*)::int n from imports where id>$1 and status='applied'`, [importId])).rows[0].n) throw new Error("Annulez d'abord les imports plus récents");
    const ch = (await q.query(`select farm_id,change,field,old_value from import_changes where import_id=$1`, [importId])).rows;
    const created = ch.filter(c => c.change === 'created').map(c => c.farm_id);
    if (created.length) await q.query(`delete from farms where id = any($1::text[])`, [created]);
    const upd = new Map<string, Record<string, Val>>();
    for (const c of ch) if (c.change === 'updated') (upd.get(c.farm_id) ?? upd.set(c.farm_id, {}).get(c.farm_id)!)[c.field] = c.old_value;
    const pcache = new Map<string, number>();
    for (const [id, old] of upd) {
      const cur = (await q.query(`select imported from farm_private where farm_id=$1`, [id])).rows[0];
      if (cur) await project(q, id, { ...cur.imported, ...old }, importId, db.blurSecret, pcache, {});
    }
    await q.query(`update imports set status='rolled_back' where id=$1`, [importId]);
    await q.query(`insert into audit_log(user_id,action,entity,entity_id,detail) values($1,'import.rollback','import',$2,$3::jsonb)`, [userId ?? null, String(importId), JSON.stringify({ created_removed: created.length, farms_restored: upd.size })]);
    return { created_removed: created.length, farms_restored: upd.size };
  });
}
export { PRIVATE_FIELDS };
