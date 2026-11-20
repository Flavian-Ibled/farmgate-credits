# Travailler à deux (Flavian + Yannick) avec Claude Code

## Principe
- `main` = ce qui est en ligne. **Personne ne pousse directement sur `main`.**
- Chacun travaille sur une branche courte : `flavian/…`, `yannick/…` (une fonctionnalité = une branche).
- On fusionne par **Pull Request** sur GitHub. La CI (tests PGlite + tests Postgres + build) doit être verte.
- Chacun a sa **base locale** (PGlite, rien à installer) : vos essais ne se marchent pas dessus.
  La base Supabase est la base partagée / en ligne : on n'y fait ni essais ni `reset`.

## Démarrer (une fois)
    git clone https://github.com/Flavian-Ibled/farmgate-credits.git
    cd farmgate-credits && npm install
    # copier le Data Master dans inputs/ (depuis SharePoint, jamais dans Git)
    npm run import:master -- --apply
    npx tsx server/cli.ts create-admin vous@carbonefarmers.fr
    npm run dev

## Chaque tâche
    git switch main && git pull
    git switch -c flavian/ma-fonctionnalite
    # … travailler avec Claude Code …
    npm test && npx tsc --noEmit
    git push -u origin flavian/ma-fonctionnalite     # puis ouvrir la PR sur GitHub

Dans Claude Code il suffit de dire : « crée une branche, fais X, lance les tests, ouvre une PR ».

## Éviter les conflits
- Se dire sur Slack qui touche quoi (surtout `db/schema.sql`, `server/db.ts`, `server/app.ts`, `web/src/i18n.ts`).
- Changement de base de données = **ajouter une entrée à la fin de `MIGRATIONS`** dans `server/db.ts`
  (idempotente : `if not exists`), **et** la reporter dans `db/schema.sql`. Ne jamais modifier une migration déjà fusionnée.
- PR petites et fréquentes ; `git pull` sur `main` avant de commencer.

## Ne jamais commiter
`inputs/` (données des fermes), `.env`, identifiants, exports contenant des noms/SIRET. Le `.gitignore` les exclut déjà.
