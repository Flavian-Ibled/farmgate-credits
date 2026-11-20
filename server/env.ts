// Loads ./.env if present (never committed). Imported first by server/index.ts and server/cli.ts only — never by tests.
try { process.loadEnvFile('.env'); } catch { /* no .env: defaults (local PGlite) */ }
