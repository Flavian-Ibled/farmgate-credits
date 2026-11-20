-- Farmgate Credits — full schema (brief sections 4, 4D, 4E, 4F, 6).
-- Identifying farm data lives ONLY in farm_private; the public role can never read it (RLS below).

create table organizations (
  id serial primary key,
  type text not null check (type in ('funder','project_owner','partner','carbone_farmers')),
  name text not null unique, sector text, logo_url text,
  public_name_policy text not null default 'private' check (public_name_policy in ('named','anonymised','private')),
  billing_contact text, seat_limit int, status text not null default 'active', public_slug text unique, public_page_enabled boolean not null default false,
  created_at timestamptz not null default now()
);

create table users (
  id serial primary key, email text not null unique, first_name text, last_name text,
  organization_id int references organizations(id),
  role text not null check (role in ('platform_admin','staff','project_owner_user','funder_admin','funder_user','farmer')),
  status text not null default 'invited' check (status in ('invited','active','disabled')),
  locale text not null default 'fr', password_hash text, totp_secret text,
  failed_logins int not null default 0, locked_until timestamptz, last_login timestamptz,
  created_at timestamptz not null default now()
);
create table sessions (token_hash text primary key, user_id int not null references users(id) on delete cascade, expires_at timestamptz not null, created_at timestamptz not null default now());
create table invitations (token_hash text primary key, email text not null, organization_id int references organizations(id), role text not null, invited_by int references users(id), expires_at timestamptz not null, accepted_at timestamptz);
create table audit_log (id bigserial primary key, at timestamptz not null default now(), user_id int, action text not null, entity text, entity_id text, detail jsonb);

create table projects (
  id serial primary key, slug text not null unique, name text not null unique, sheet_name text,
  porteur_org_id int references organizations(id), partner_type text, status text,
  -- the 8 client-required blocks; null = "à fournir". Each block: {fields..., source, updated_at, verified_by}
  block_geography jsonb, block_standard jsonb, block_baseline jsonb, block_volumes jsonb,
  block_cobenefits jsonb, block_mrv jsonb, block_contract jsonb, block_cost jsonb,
  document_farms_count int, document_labelled_volume numeric, document_source text, hidden_indicators text[] not null default '{}', remuneration jsonb, social jsonb, list_price_eur numeric,
  published boolean not null default false, created_at timestamptz not null default now()
);
create table project_memberships (project_id int references projects(id), organization_id int references organizations(id), primary key (project_id, organization_id));

-- Public-safe farm facts (no name, no address, no commune, blurred coordinates only).
create table farms (
  id text primary key, project_id int references projects(id),
  departement text, region text, typology text, lbc_status text,
  sau numeric, lat_blur double precision, lng_blur double precision, blur_km numeric not null default 3,
  reference_period text, project_period text, lbc_dossier_number text,
  em_init_ha numeric, em_target_ha numeric, st_init_ha numeric, st_target_ha numeric,
  rabais numeric, rabais_text text,
  re_evit_ha numeric, re_evit_total numeric, re_stock_ha numeric, re_stock_total numeric,
  re_total_ha numeric, re_total_ha_yr numeric, re_labelled numeric,
  vol_filieres numeric, vol_vendable numeric, vol_vendu numeric, vol_dispo numeric,
  public_name text, consent_public_name boolean not null default false, story_status text,
  last_diag_date date, verified_at date, verified_by text, hidden_indicators text[] not null default '{}', created_from text,
  absent_from_last_import boolean not null default false,
  last_import_id int, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index on farms(project_id); create index on farms(lbc_status); create index on farms(region); create index on farms(departement);

-- Identifying data + the raw imported record (source of truth for diffs). Never exposed publicly.
create table farm_private (
  farm_id text primary key references farms(id) on delete cascade,
  name text, farmer text, address text, commune text, postal_code text, siret text, legal_status text,
  lat double precision, lng double precision, diagnostic_referent text,
  imported jsonb not null default '{}', locked_fields text[] not null default '{}'
);
create table farm_memberships (farm_id text references farms(id) on delete cascade, project_id int references projects(id), entry_date date, exit_date date, status text, primary key (farm_id, project_id));

create table indicators (
  code text primary key, category text not null, label_fr text not null, label_en text, unit text,
  aggregation text not null check (aggregation in ('sum','wmean','area_share')), area_code text,
  scope text not null default 'both' check (scope in ('GC','EL','both')),
  mandatory boolean, priority int, feasibility int, collected boolean not null default false,
  comment text, catalogue_source text not null, sort int,
  -- admin-configurable rating (red → green), weight inside the category, buyer-facing sentence, linked levers
  threshold_red numeric, threshold_green numeric, weight numeric not null default 1, why_fr text, why_en text,
  lever_codes text[] not null default '{}', config_status text not null default 'a_valider', config_updated_at timestamptz, config_updated_by text
);
-- optional farm-specific sentence per indicator (placeholder until filled by the agronomist)
create table farm_indicator_notes (farm_id text references farms(id) on delete cascade, indicator_code text references indicators(code), note_fr text, note_en text, updated_at timestamptz default now(), primary key (farm_id, indicator_code));
create table indicator_values (
  farm_id text references farms(id) on delete cascade, indicator_code text references indicators(code),
  state text not null check (state in ('initial','prospectif','suivi')), harvest_year int not null default 0,
  value numeric not null, primary key (farm_id, indicator_code, state, harvest_year)
);

create table levers (code text primary key, family text not null, name_fr text not null, name_en text, type text check (type in ('avoidance','storage')), scope text, icon text, sort int,
  description_fr text, description_en text, impact_tco2e_ha_yr numeric, impact_source text);
create table farm_levers (
  farm_id text references farms(id) on delete cascade, lever_code text references levers(code), active boolean not null,
  description text, hectares numeric, expected_tco2e numeric,
  cost_one_off_eur_ha numeric, cost_annual_eur_ha numeric, saving_eur_ha numeric, cost_source text, yield_impact text, paid_by text, -- "à documenter" until imported
  primary key (farm_id, lever_code)
);

create table annual_followups (
  farm_id text references farms(id) on delete cascade, harvest_year int not null,
  diagnostic_date date, status text not null default 'diagnosed' check (status in ('planned','diagnosed','verified','audited')),
  em_baseline_ha numeric, em_year_ha numeric, st_year_ha numeric, net_balance_ha numeric, net_balance_change numeric,
  emissions_year numeric, storage_year numeric,
  re_avoidance_year numeric, re_storage_year numeric, re_total_year numeric,
  cumulative_generated numeric, end_of_project_extrapolation numeric,
  lever_changes jsonb, indicators_observed jsonb, document_url text,
  source text, primary key (farm_id, harvest_year)
);
-- private part of a follow-up (farmer payment, agronomist): Carbone Farmers only
create table followup_private (farm_id text references farms(id) on delete cascade, harvest_year int not null, diagnostician text, payment_to_farmer_eur numeric, payment_date date, primary key (farm_id, harvest_year));

create table farm_crops (farm_id text references farms(id) on delete cascade, harvest_year int, crop text, hectares numeric, share numeric, primary key (farm_id, harvest_year, crop));
create table media (id serial primary key, farm_id text references farms(id) on delete cascade, kind text, file_url text, alt_fr text, alt_en text, caption_fr text, caption_en text, taken_at date, credit text, consent_status text not null default 'pending', public boolean not null default false, sort int);
create table stories (id serial primary key, farm_id text references farms(id), project_id int references projects(id), locale text, context text, motivations text, stakes text, status text not null default 'draft' check (status in ('draft','farmer_approved','published')), version int not null default 1, updated_at timestamptz default now());
create table documents (id serial primary key, project_id int references projects(id), farm_id text references farms(id), kind text, title text, file_url text, public boolean not null default false, created_at timestamptz default now());
create table credit_lots (id serial primary key, project_id int references projects(id), vintage int, status text check (status in ('issued','sold','retired')), volume_tco2e numeric, certificate_ref text);

create table allocations (
  id serial primary key, reference text unique, funder_org_id int references organizations(id),
  target_type text not null check (target_type in ('farm','project','portfolio')), target_id text,
  vintage_scope text not null default 'all', volume_tco2e numeric not null check (volume_tco2e >= 0),
  price_per_tco2e numeric, amount_eur numeric, cost_breakdown jsonb,
  status text not null check (status in ('quote','reserved','contracted','paid','delivered','retired','cancelled')),
  kind text not null default 'standard' check (kind in ('standard','historical_sale')),
  contract_ref text, invoice_ref text, signed_at date, display_name_policy text, claim_wording text,
  created_by int references users(id), notes text, created_at timestamptz not null default now()
);
create table allocation_lines (id serial primary key, allocation_id int not null references allocations(id) on delete cascade, farm_id text not null references farms(id), volume_tco2e numeric not null check (volume_tco2e >= 0), frozen boolean not null default false);
create index on allocation_lines(farm_id);

create table portfolios (id serial primary key, name text not null, owner_user_id int references users(id), organization_id int references organizations(id), filters jsonb not null, created_at timestamptz default now());
create table score_configs (id serial primary key, score text not null, version int not null, config jsonb not null, status text not null default 'a_valider', author text, created_at timestamptz not null default now(), unique (score, version));

create table imports (
  id serial primary key, kind text not null, filename text, file_sha256 text, user_id int, created_at timestamptz not null default now(),
  status text not null check (status in ('dry_run','applied','rolled_back','failed')), applied_at timestamptz, data_as_of date,
  counts jsonb, report jsonb, payload jsonb
);
create table import_changes (id bigserial primary key, import_id int not null references imports(id) on delete cascade, farm_id text not null, change text not null check (change in ('created','updated')), field text, old_value jsonb, new_value jsonb);
create index on import_changes(import_id); create index on import_changes(farm_id);

create table open_points (id int primary key, title text not null, detail text, status text not null default 'a_valider', owner text, blocks_phase int);

-- Manually entered content of a farm sheet (intro, lever rows with credits, team, story…). Public only once published.
create table farm_sheets (farm_id text primary key references farms(id) on delete cascade, content jsonb not null default '{}', published boolean not null default false, updated_at timestamptz not null default now(), updated_by text);

-- Livrables (PDF) read by the platform: full extraction kept for Carbone Farmers only
create table livrables (id serial primary key, farm_id text references farms(id) on delete cascade, harvest_year int, kind text, filename text, file_sha256 text, extracted jsonb, applied jsonb, imported_by text, imported_at timestamptz not null default now());

create table notifications (id bigserial primary key, audience text not null check (audience in ('cf','org')), organization_id int references organizations(id), kind text not null, title text not null, link text, created_at timestamptz not null default now(), read_by int[] not null default '{}');

create table orders (id serial primary key, reference text unique not null, allocation_id int not null references allocations(id), organization_id int references organizations(id), user_id int references users(id), target_type text, target_id text, target_label text,
  volume_tco2e numeric not null, price_eur numeric not null, amount_eur numeric not null, method text not null, status text not null check (status in ('awaiting_payment','paid','cancelled','expired')), instructions jsonb, provider_ref text, created_at timestamptz not null default now(), expires_at timestamptz, paid_at timestamptz);

create table funder_selections (id serial primary key, organization_id int not null references organizations(id) on delete cascade, name text not null, note text, farm_ids text[] not null, created_by int references users(id), created_at timestamptz not null default now());

create table app_settings (key text primary key, value jsonb not null);

-- ---------- Row-level security ----------
-- The API never queries as the table owner. Every request runs inside a transaction with
--   SET LOCAL ROLE fg_app; app.role = <role>; app.org = <organization id>; app.uid = <user id>
create role fg_app nologin;
create function app_role() returns text language sql stable as $$ select coalesce(nullif(current_setting('app.role', true), ''), 'public') $$;
create function app_org() returns int language sql stable as $$ select nullif(current_setting('app.org', true), '')::int $$;
create function app_uid() returns int language sql stable as $$ select nullif(current_setting('app.uid', true), '')::int $$;
create function is_cf() returns boolean language sql stable as $$ select app_role() in ('platform_admin','staff') $$;

grant usage on schema public to fg_app;
grant select, insert, update, delete on all tables in schema public to fg_app;
grant usage on all sequences in schema public to fg_app;

do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table %I enable row level security', t);
  end loop;
  -- reference / public-safe tables: readable by everyone, writable by Carbone Farmers only
  foreach t in array array['projects','project_memberships','farms','farm_memberships','indicators','indicator_values','levers','farm_levers','annual_followups','farm_crops','credit_lots','open_points','score_configs','farm_indicator_notes'] loop
    execute format('create policy %I on %I for select using (true)', t || '_read', t);
    execute format('create policy %I on %I for all using (is_cf()) with check (is_cf())', t || '_cf', t);
  end loop;
  -- Carbone Farmers-only tables
  foreach t in array array['imports','import_changes','audit_log','invitations','followup_private','livrables'] loop
    execute format('create policy %I on %I for all using (is_cf()) with check (is_cf())', t || '_cf', t);
  end loop;
end $$;

-- identifying farm data: CF staff; a porteur for the farms of its own projects; a funder for farms it funds
create function farm_allocated() returns table(farm_id text, allocated numeric) language sql stable security definer as $f$
  select l.farm_id, sum(l.volume_tco2e) from allocation_lines l join allocations a on a.id=l.allocation_id where a.status in ('reserved','contracted','paid','delivered','retired') group by 1 $f$;
grant execute on function farm_allocated() to fg_app;

create policy farm_private_cf on farm_private for all using (is_cf()) with check (is_cf());
create policy farm_private_owner on farm_private for select using (
  app_role() = 'project_owner_user' and exists (
    select 1 from farms f join projects p on p.id = f.project_id
    left join project_memberships pm on pm.project_id = p.id
    where f.id = farm_private.farm_id and (p.porteur_org_id = app_org() or pm.organization_id = app_org())));
create policy farm_private_funder on farm_private for select using (
  app_role() in ('funder_admin','funder_user') and exists (
    select 1 from allocation_lines l join allocations a on a.id = l.allocation_id
    where l.farm_id = farm_private.farm_id and a.funder_org_id = app_org() and a.status in ('contracted','paid','delivered','retired')));

create policy org_cf on organizations for all using (is_cf()) with check (is_cf());
create policy org_self on organizations for select using (id = app_org());
create policy org_public on organizations for select using (public_name_policy = 'named' or type in ('project_owner','carbone_farmers'));

create policy users_admin on users for all using (app_role() = 'platform_admin') with check (app_role() = 'platform_admin');
create policy users_self on users for select using (id = app_uid());
create policy users_funder_admin on users for select using (app_role() = 'funder_admin' and organization_id = app_org());
create policy sessions_self on sessions for all using (user_id = app_uid()) with check (user_id = app_uid());

create policy alloc_cf on allocations for all using (is_cf()) with check (is_cf());
create policy alloc_funder on allocations for select using (app_role() in ('funder_admin','funder_user') and funder_org_id = app_org());
create policy lines_cf on allocation_lines for all using (is_cf()) with check (is_cf());
create policy lines_funder on allocation_lines for select using (exists (select 1 from allocations a where a.id = allocation_id and a.funder_org_id = app_org()));

create policy farm_sheets_public on farm_sheets for select using (published);
create policy farm_sheets_cf on farm_sheets for all using (is_cf()) with check (is_cf());
create policy notifications_read on notifications for select using ((audience='cf' and is_cf()) or (audience='org' and organization_id = app_org()));
create policy notifications_mark on notifications for update using ((audience='cf' and is_cf()) or (audience='org' and organization_id = app_org())) with check (true);
create policy orders_cf on orders for all using (is_cf()) with check (is_cf());
create policy orders_funder on orders for select using (organization_id = app_org() and app_role() in ('funder_admin','funder_user'));
create policy funder_selections_cf on funder_selections for all using (is_cf()) with check (is_cf());
create policy funder_selections_own on funder_selections for select using (organization_id = app_org() and app_role() in ('funder_admin','funder_user'));
create policy app_settings_read on app_settings for select using (true);
create policy app_settings_cf on app_settings for all using (is_cf()) with check (is_cf());
create policy media_public on media for select using (public and consent_status = 'granted');
create policy media_cf on media for all using (is_cf()) with check (is_cf());
create policy stories_public on stories for select using (status = 'published');
create policy stories_cf on stories for all using (is_cf()) with check (is_cf());
create policy documents_public on documents for select using (public);
create policy documents_cf on documents for all using (is_cf()) with check (is_cf());
create policy portfolios_own on portfolios for all using (owner_user_id = app_uid() or is_cf()) with check (owner_user_id = app_uid() or is_cf());
