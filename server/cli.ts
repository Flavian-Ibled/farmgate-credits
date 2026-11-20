// tsx server/cli.ts <reset | import [file] [--apply] | create-admin <email> | rollback <id>>
import './env.ts';
import { readFileSync, rmSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { randomBytes } from 'node:crypto';
import { openDb, DATA_DIR } from './db.ts';
import { dryRun, applyImport, rollbackImport } from './importer/apply.ts';
import { createUser } from './auth.ts';

const [cmd, ...args] = process.argv.slice(2);
if (cmd === 'reset' && process.env.DATABASE_URL) { console.log('reset refusé : DATABASE_URL pointe vers une base en ligne. Cette commande ne vide que la base locale.'); process.exit(1); }
if (cmd === 'reset') { rmSync(join(DATA_DIR, 'pg'), { recursive: true, force: true }); console.log('Base locale supprimée (elle sera recréée au prochain démarrage).'); process.exit(0); }
const db = await openDb();
if (process.env.DATABASE_URL) console.log(`⚠︎ Base EN LIGNE : ${new URL(process.env.DATABASE_URL).host}`);
if (cmd === 'import') {
  const file = args.find(a => !a.startsWith('--')) ?? 'inputs/carbone_farmers_data_Master_2026sept21.xlsx';
  const r: any = await dryRun(db, readFileSync(file), { filename: basename(file) });
  console.log(JSON.stringify({ id: r.id, status: r.status, fatal: r.fatal, counts: r.counts, by_code: r.by_code, cvl2_gap: r.stats?.cvl2_gap, columns_mapped: r.stats?.columns_mapped }, null, 1));
  if (args.includes('--apply') && r.status === 'dry_run') console.log('applied', await applyImport(db, r.id));
} else if (cmd === 'rollback') console.log(await rollbackImport(db, Number(args[0])));
else if (cmd === 'create-admin') {
  const email = args[0]; if (!email) throw new Error('email requis');
  const pw = randomBytes(15).toString('base64url'); const f = join(DATA_DIR, 'dev-admin.txt');
  const org = (await db.owner.query(`select id from organizations where type='carbone_farmers' limit 1`)).rows[0]?.id;
  await db.owner.query(`delete from users where email=lower($1)`, [email]);
  await createUser(db, { email, password: pw, role: 'platform_admin', organization_id: org });
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(f, `email: ${email}\npassword: ${pw}\n`, { mode: 0o600 });
  console.log(`Compte admin de développement créé. Identifiants écrits dans ${f} (fichier local, hors OneDrive).`);
} else console.log('Commandes : reset | import [fichier] [--apply] | rollback <id> | create-admin <email>');
await db.close(); process.exit(0);
