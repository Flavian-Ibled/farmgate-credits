import { PGlite } from '@electric-sql/pglite';
import { readFileSync, mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { MASTER_INDICATORS, EXTRA_INDICATORS } from '../shared/catalogue.ts';
import { WATER_CONFIG_V1, WATER_CONFIG_V2, BIO_CONFIG_V1 } from '../shared/scores.ts';
import { OPEN_POINTS } from './openPoints.ts';

const here = dirname(fileURLToPath(import.meta.url));
// Local data (database, secrets) stays OUTSIDE the synced OneDrive folder.
export const DATA_DIR = process.env.FG_DATA_DIR ?? join(homedir(), '.local/share/farmgate-credits/data');

export interface Ctx { role: string; org?: number | null; uid?: number | null }
export const PUBLIC: Ctx = { role: 'public' };
export type Q = { query: <T = any>(sql: string, params?: any[]) => Promise<{ rows: T[] }>; exec: (sql: string) => Promise<any> };

export interface Db {
  /** table-owner access: importer, auth and migrations only. Never used to answer a read request. */
  owner: Q; tx: <T>(fn: (q: Q) => Promise<T>) => Promise<T>;
  /** every read request goes through here: SET LOCAL ROLE fg_app + RLS context */
  as: <T>(ctx: Ctx, fn: (q: Q) => Promise<T>) => Promise<T>;
  blurSecret: string; close: () => Promise<void>;
}

export async function openDb(opts: { memory?: boolean } = {}): Promise<Db> {
  (await import('./scores.ts')).resetScoreCache();
  let blurSecret = 'test-secret';
  if (!opts.memory) {
    mkdirSync(DATA_DIR, { recursive: true });
    const f = join(DATA_DIR, 'blur-secret.txt');
    if (!existsSync(f)) writeFileSync(f, randomBytes(32).toString('hex'), { mode: 0o600 });
    blurSecret = readFileSync(f, 'utf8').trim();
  }
  const pg = opts.memory ? new PGlite() : new PGlite(join(DATA_DIR, 'pg'));
  const has = await pg.query<{ n: number }>(`select count(*)::int n from pg_tables where schemaname='public' and tablename='farms'`);
  if (!has.rows[0].n) {
    await pg.exec(readFileSync(join(here, '../db/schema.sql'), 'utf8'));
    await seedReference(pg as any);
  }
  for (const m of MIGRATIONS) await pg.exec(m);
  // indicators measured outside the Data Master (selection workbooks): added to the catalogue once
  for (const [k, e] of EXTRA_INDICATORS.entries()) await pg.query(`insert into indicators(code,category,label_fr,label_en,unit,aggregation,scope,collected,catalogue_source,sort,threshold_red,threshold_green,why_fr) values($1,$2,$3,$4,$5,'wmean','GC',true,'selection_workbook',$6,$7,$8,$9) on conflict(code) do nothing`, [e.code, e.category, e.label_fr, e.label_en, e.unit, 100 + k, e.red ?? null, e.green ?? null, e.why_fr ?? null]);
  // water score v2 (initial state + evolution), added once; later versions are created from the admin
  await pg.query(`insert into score_configs(score,version,config,author) select 'eau',2,$1::jsonb,'demande product owner 2026-11-15' where not exists (select 1 from score_configs where score='eau' and version>=2)`, [JSON.stringify(WATER_CONFIG_V2)]);
  const num = (x: any) => (x == null ? '' : String(Number(x)));
  return {
    owner: pg as any, blurSecret,
    tx: fn => pg.transaction(tx => fn(tx as any)) as any,
    as: (ctx, fn) => pg.transaction(async tx => {
      await tx.exec('set local role fg_app');
      await tx.query(`select set_config('app.role',$1,true), set_config('app.org',$2,true), set_config('app.uid',$3,true)`, [ctx.role, num(ctx.org), num(ctx.uid)]);
      return fn(tx as any);
    }) as any,
    close: () => pg.close(),
  };
}

/** Idempotent statements run at every start (keep in sync with db/schema.sql). */
const MIGRATIONS = [
  // phase 8: opt-in public page of a funder, and editorial settings of the public dashboard
  `alter table organizations add column if not exists public_slug text; alter table organizations add column if not exists public_page_enabled boolean not null default false;
   create unique index if not exists organizations_public_slug on organizations(public_slug) where public_slug is not null;
   create table if not exists app_settings (key text primary key, value jsonb not null);
   alter table app_settings enable row level security; grant select, insert, update on app_settings to fg_app;
   do $$ begin if not exists (select 1 from pg_policies where tablename='app_settings') then
     create policy app_settings_read on app_settings for select using (true); create policy app_settings_cf on app_settings for all using (is_cf()) with check (is_cf()); end if; end $$;`,
  // curated list of farms shared with a funder (shown in its space; gives no access to farm identities)
  `create table if not exists funder_selections (id serial primary key, organization_id int not null references organizations(id) on delete cascade, name text not null, note text, farm_ids text[] not null, created_by int references users(id), created_at timestamptz not null default now());
   alter table funder_selections enable row level security; grant select, insert, update, delete on funder_selections to fg_app; grant usage on all sequences in schema public to fg_app;
   do $$ begin if not exists (select 1 from pg_policies where tablename='funder_selections') then
     create policy funder_selections_cf on funder_selections for all using (is_cf()) with check (is_cf());
     create policy funder_selections_own on funder_selections for select using (organization_id = app_org() and app_role() in ('funder_admin','funder_user')); end if; end $$;`,
  // direct purchase: list price per project (null = not on sale) and orders
  `alter table projects add column if not exists list_price_eur numeric;
   create table if not exists orders (id serial primary key, reference text unique not null, allocation_id int not null references allocations(id), organization_id int references organizations(id), user_id int references users(id), target_type text, target_id text, target_label text,
     volume_tco2e numeric not null, price_eur numeric not null, amount_eur numeric not null, method text not null, status text not null check (status in ('awaiting_payment','paid','cancelled','expired')), instructions jsonb, provider_ref text, created_at timestamptz not null default now(), expires_at timestamptz, paid_at timestamptz);
   alter table orders enable row level security; grant select on orders to fg_app;
   do $$ begin if not exists (select 1 from pg_policies where tablename='orders') then
     create policy orders_cf on orders for all using (is_cf()) with check (is_cf());
     create policy orders_funder on orders for select using (organization_id = app_org() and app_role() in ('funder_admin','funder_user')); end if; end $$;`,
  // in-app notifications: for Carbone Farmers (audience cf) or for one organisation (funder / porteur)
  `create table if not exists notifications (id bigserial primary key, audience text not null check (audience in ('cf','org')), organization_id int references organizations(id), kind text not null, title text not null, link text, created_at timestamptz not null default now(), read_by int[] not null default '{}');
   alter table notifications enable row level security; grant select, update on notifications to fg_app;
   do $$ begin if not exists (select 1 from pg_policies where tablename='notifications') then
     create policy notifications_read on notifications for select using ((audience='cf' and is_cf()) or (audience='org' and organization_id = app_org()));
     create policy notifications_mark on notifications for update using ((audience='cf' and is_cf()) or (audience='org' and organization_id = app_org())) with check (true); end if; end $$;`,
  // remuneration model and social / territorial co-benefits of a project (null = default 75 % / "à fournir")
  `alter table projects add column if not exists remuneration jsonb; alter table projects add column if not exists social jsonb;`,
  // a farm created from a livrable before it exists in the Data Master must not be flagged "absent" by the next full import
  `alter table farms add column if not exists created_from text;`,
  // co-benefits chosen NOT to be displayed on a farm or project page (editorial choice made in the admin)
  `alter table farms add column if not exists hidden_indicators text[] not null default '{}'; alter table projects add column if not exists hidden_indicators text[] not null default '{}';`,
  // credits already allocated per farm (aggregate only): lets the public facts follow the ledger without exposing allocations
  `create or replace function farm_allocated() returns table(farm_id text, allocated numeric) language sql stable security definer as $f$
     select l.farm_id, sum(l.volume_tco2e) from allocation_lines l join allocations a on a.id=l.allocation_id where a.status in ('reserved','contracted','paid','delivered','retired') group by 1 $f$;
   grant execute on function farm_allocated() to fg_app;`,
  // livrables (PDF) : extraction complète conservée côté Carbone Farmers uniquement ; coûts des pratiques par levier
  `create table if not exists livrables (id serial primary key, farm_id text references farms(id) on delete cascade, harvest_year int, kind text, filename text, file_sha256 text, extracted jsonb, applied jsonb, imported_by text, imported_at timestamptz not null default now());
   alter table livrables enable row level security; grant select, insert, update, delete on livrables to fg_app; grant usage on all sequences in schema public to fg_app;
   do $$ begin if not exists (select 1 from pg_policies where tablename='livrables') then create policy livrables_cf on livrables for all using (is_cf()) with check (is_cf()); end if; end $$;
   alter table farm_levers add column if not exists saving_eur_ha numeric; alter table farm_levers add column if not exists cost_source text;`,
  `create table if not exists farm_sheets (farm_id text primary key references farms(id) on delete cascade, content jsonb not null default '{}', published boolean not null default false, updated_at timestamptz not null default now(), updated_by text);
   alter table farm_sheets enable row level security; grant select, insert, update, delete on farm_sheets to fg_app;
   do $$ begin if not exists (select 1 from pg_policies where tablename='farm_sheets') then
     create policy farm_sheets_public on farm_sheets for select using (published);
     create policy farm_sheets_cf on farm_sheets for all using (is_cf()) with check (is_cf()); end if; end $$;`,
];

async function seedReference(q: Q) {
  let i = 0;
  for (const d of MASTER_INDICATORS)
    await q.query(`insert into indicators(code,category,label_fr,label_en,unit,aggregation,area_code,scope,collected,catalogue_source,sort,threshold_red,threshold_green,why_fr) values($1,$2,$3,$4,$5,$6,$7,$8,true,'master_columns',$9,$10,$11,$12)`,
      [d.code, d.category, d.label_fr, d.label_en, d.unit, d.aggregation, d.area_code ?? null, d.scope, i++, d.red ?? null, d.green ?? null, d.why_fr ?? null]);
  await q.query(`insert into score_configs(score,version,config,author) values('eau',1,$1::jsonb,'brief 4C'),('biodiversite',1,$2::jsonb,'brief 4C')`, [JSON.stringify(WATER_CONFIG_V1), JSON.stringify(BIO_CONFIG_V1)]);
  for (const p of OPEN_POINTS) await q.query(`insert into open_points(id,title,detail,owner,blocks_phase) values($1,$2,$3,$4,$5)`, [p.id, p.title, p.detail, p.owner, p.blocks_phase]);
  await q.query(`insert into organizations(type,name,public_name_policy) values('carbone_farmers','Carbone Farmers','named')`);
}
