# Farmgate Credits — Carbone Farmers

State: PHASES 0, 1 and 2 (see the brief). Phase 3 not started. PDF sheets use headless Chrome (set FG_CHROME and FG_WEB_URL on a server).

## Run (this Mac)
Node.js lives in `~/.local/share/nodejs/current/bin` (not on the PATH by default):

    export PATH="$HOME/.local/share/nodejs/current/bin:$PATH"
    npm run dev            # API on :8787 + web on :5173
    npm test               # unit tests (aggregation, scores, importer, one access test per role)
    npm run import:master -- --apply     # dry run + apply inputs/carbone_farmers_data_Master_2026sept21.xlsx
    npx tsx server/cli.ts create-admin <email>   # dev admin; credentials written to the local data folder
    npm run db:reset       # delete the local database

## En ligne / à deux
- Mise en ligne (Supabase + Railway) : `docs/DEPLOIEMENT.md`
- Travailler à deux avec Claude Code : `docs/TRAVAILLER-A-DEUX.md`

## Where things are
- `db/schema.sql` — full schema + row-level security policies
- `shared/` — pure calculation code: `aggregate.ts` (4B rules), `scores.ts` (4C), `catalogue.ts`
- `server/importer/` — Data Master parser, validation, dry run / diff / apply / rollback
- `server/app.ts` — API (`/api/public/*` anonymous and non-identifying; `/api/admin/*` Carbone Farmers only)
- `web/` — React app (FR default, EN)
- `inputs/` — source files (farm data: never commit, never publish)

## Kept OUTSIDE this OneDrive folder on purpose
`~/.local/share/farmgate-credits/` holds `node_modules` (symlinked), the local Postgres (PGlite) database,
the blur secret and the dev admin credentials. They must not sync to the shared library.

## Auth
`server/auth.ts` is a development adapter (scrypt, sessions, lockout). Production must use a managed provider
(e.g. Supabase Auth, EU) with e-mail verification, invitations, reset, breached-password check and TOTP for admins.

## Online sales (for the IT department)
- `server/shop.ts`: a purchase creates an order and a *reserved* allocation (credits held 14 days by the over-allocation guard).
  Payment confirmed → allocation *contracted* then *paid*, certificate available. Unpaid at the deadline → cancelled, credits freed.
- `server/payments.ts`: only "bank transfer on invoice" is active. Bank details come from `FG_BANK_HOLDER`, `FG_BANK_IBAN`, `FG_BANK_BIC`
  (never hard-coded). To add online payment: implement the `online` provider (redirect to the provider's hosted page) and the webhook
  `POST /api/public/payments/webhook/:provider`, which must verify the provider's signature and then call `confirmPayment`.
- Prices: list price per project, set in the admin; shown only to signed-in funders. VAT, invoicing and terms of sale are still to be defined.

## Photos
Stored in `~/.local/share/farmgate-credits/data/media` (outside OneDrive), resized to 1600 px, WebP, all metadata (GPS) removed.
A photo is served publicly only if consent is recorded and it is published. On a server, this folder must be backed up.

## Embeddable widget (Phase 8)
`/widget/:slug` is meant to be embedded in an `<iframe>` on a funder's own site. In production, allow framing for this path only
(`Content-Security-Policy: frame-ancestors *` on `/widget/*`) and keep `X-Frame-Options: DENY` / `frame-ancestors 'self'` everywhere else.
A funder page exists only if the funder is "named" AND an admin enabled it; it never shows amounts, prices or farm identities.

## Open data (Phase 8)
`/api/public/downloads/*` publishes aggregated, non-identifying CSV/Excel. The licence is still to be defined by Carbone Farmers (shown as such on the page).
