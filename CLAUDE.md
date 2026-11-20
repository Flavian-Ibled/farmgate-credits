# Farmgate Credits — guide for Claude Code

Public transparency platform of Carbone Farmers (Label Bas Carbone). Product owner: non-developer; explain in plain French, show results, never invent data.
The full product brief is `docs/BRIEF.md` when present (single source of truth for scope: sections 4, 4B–4F, 5–11, build plan in section 10).

## State
Phases 0–6 built (Phase 6: `server/scores.ts`, `server/selectionWorkbook.ts` — Eau score v2 (initial state + evolution) and Biodiversité score, the latter verified against inputs/Sélection_Carbone_Farmers.xlsx in tests/selection.test.ts; ranking page /selection; versioned score settings. Phase 5: `server/money.ts`, `shared/remuneration.ts` — farmer gets at least 75 % of the price of a tonne, contract-level overrides such as SEDIF 82 % incl. 7 % agronomic advice, lever costs, social co-benefits; Phase 4: `server/funders.ts`, `shared/allocation.ts` — funders, invitations, allocations with over-allocation guard, opening balances, ledger, funder portal). Phase 7 built too (`server/phase7.ts`: in-app notifications, project-owner portal /porteur, compare page /comparer, Excel imports for crops and lever costs, bulk assignment of historical sales). Next: Phase 8 (public dashboard, methodology page, data downloads, embeddable funder widget), then Phase 9 (performance, SEO, accessibility, security review, backups, EU deployment) with the IT department. The Eau score has no reference workbook to check against.
Work phase by phase; after each phase run the app and the tests, then report what works / what is missing / which data is missing. Wait for the owner's "go" before the next phase.

Phase 8 built: public dashboard /impact, methodology /methodologie (live score settings), open data /donnees (CSV/Excel, non-identifying, respects the co-benefit display choices), funder opt-in page /contribution/:slug and iframe widget /widget/:slug (`server/phase8.ts`). Also built after Phase 7: funder management in the admin (edit, users, % attribution, shared selections: `server/funderAdmin.ts`), map ungroup and multi-selection (click, zone, list), co-benefit icons (`web/src/components/Icons.tsx`). Next: Phase 9 with the IT department. Also built earlier: farm photos and farmer identity for admins (`server/media.ts`), direct purchase of remaining credits (`server/shop.ts`, `server/payments.ts`, page `/acheter`; bank transfer only, online payment to be connected — see README).

## Run
Node.js is not on the PATH on this Mac:

    export PATH="$HOME/.local/share/nodejs/current/bin:$PATH"
    npm run dev                          # API :8787 + web :5173
    npm test                             # vitest
    npx tsc --noEmit                     # type-check
    npm run import:master -- --apply     # (re)import inputs/carbone_farmers_data_Master_2026sept21.xlsx
    npx tsx server/cli.ts create-admin <email>   # dev admin; credentials in ~/.local/share/farmgate-credits/data/dev-admin.txt
    npm run db:reset                     # needed after any change to db/schema.sql (dev database only)

Never run the CLI against the database while the API server is running (single-process embedded Postgres): stop the server first.
There is no python3, brew or docker on this Mac (calling python3 opens an Xcode install dialog).

## Layout
- `db/schema.sql` — schema + row-level security. `shared/` — pure calculations (`aggregate.ts`, `scores.ts`, `rating.ts`, `catalogue.ts`).
- `server/` — Hono API. `app.ts` (public + admin routes), `pages.ts` (project / farm pages, admin config, PDF), `followups.ts` (annual follow-up),
  `importer/` (Data Master + per-project sheets: dry run, diff, apply, rollback), `livrable.ts` (PDF livrables "Grandes Cultures": read, preview, apply — other families not done), `excel.ts` (Excel outputs), `facts.ts` (public facts cache, filters, geography).
- `web/` — React + Tailwind v4 + react-leaflet, FR default / EN (`web/src/i18n.ts`). Brand assets in `web/public/brand`.
- `tests/` — every computed number has a test. `inputs/` — source files with farm data.
- `~/.local/share/farmgate-credits/` — node_modules (symlink target), local database, secrets: kept outside OneDrive on purpose.

## Rules that must hold
1. Never invent data. Missing = "à fournir" with an owner. No demo values, no averages to fill gaps.
2. Privacy: names, farmers, addresses, communes, SIRET, exact coordinates, farmer payments live only in `farm_private` / `followup_private`.
   The public API returns blurred coordinates and non-identifying fields only; reads go through `db.as(ctx, …)` so RLS applies. Add a test for anything new that is exposed.
3. Aggregations run on the server (`shared/aggregate.ts`): totals are sums; per-hectare values are SAU-weighted means; evolutions are computed on aggregated values; always return n_with_data / n_applicable.
4. Imports are keyed on `farm.id`, idempotent, dry run first, never delete a farm (flag "absente"), never overwrite platform-owned fields.
5. Every estimate carries "sous réserve du suivi annuel et de l'audit". The labelled volume is the default reference value.
6. Ask before any irreversible or paid action (deploy, domain, paid service, deleting data).
7. When a livrable and the Data Master disagree on a follow-up value (emissions, storage of the year), the livrable wins once applied (owner decision, 2026-11-13); a Data Master re-import does not overwrite it. The labelled volume always comes from the Data Master.
8. Open questions for the team are listed in `server/openPoints.ts` and shown in the admin: add to it rather than deciding silently.
