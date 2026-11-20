# Mise en ligne — Supabase (base) + Railway (application)

Tout est hébergé en UE. Aucun secret ni donnée de ferme dans Git.

## 1. Supabase (base de données Postgres)
**Fait le 2026-11-19** : projet `farmgate-credits` (ref `uieagwzhjmngmcfjruqr`), organisation Carbone Farmers, région Paris (eu-west-3), plan Free.
Rôle `fg_app` et RLS vérifiés sur Supabase (Postgres 17). Le schéma est créé par l'application à son premier démarrage.
Plan Free : pas de sauvegarde, mise en pause après 7 jours sans activité → passer en Pro avant d'y mettre les vraies données.

1. supabase.com → New project → organisation Carbone Farmers, nom `farmgate-credits`, **région Paris (eu-west-3)**, mot de passe base fort (gestionnaire de mots de passe).
2. Connect → **Session pooler** → copier l'URL (`postgresql://postgres.<ref>:…@aws-0-eu-west-3.pooler.supabase.com:5432/postgres`).
3. Rien d'autre à faire : au premier démarrage l'application crée le schéma, les règles d'accès (RLS, rôle `fg_app`) et les données de référence.
4. Settings → Database → Backups : vérifier que les sauvegardes quotidiennes sont actives (plan Pro conseillé : sauvegardes 7 j, pas de mise en pause).

> L'application parle à Postgres directement (pas via l'API REST Supabase). Les tables ne sont donc pas exposées par
> l'API auto-générée tant qu'on n'accorde rien aux rôles `anon` / `authenticated`. Ne pas activer l'accès « Data API » sur `public`.

## 2. Railway (application Node)
1. railway.com → New project → Deploy from GitHub repo → `farmgate-credits` (branche `main`). Le `Dockerfile` est détecté.
2. Settings → Region : **EU West (Amsterdam)**.
3. Variables :
   | Variable | Valeur |
   |---|---|
   | `DATABASE_URL` | URL Session pooler Supabase |
   | `FG_BLUR_SECRET` | `openssl rand -hex 32`, généré **une fois**, ne jamais changer |
   | `FG_BANK_HOLDER` / `FG_BANK_IBAN` / `FG_BANK_BIC` | quand l'achat direct ouvre |
4. Ajouter un **Volume** monté sur `/data` (photos des fermes, voir README « Photos »).
5. Settings → Networking → Generate domain (puis domaine `credits.carbonefarmers.fr` quand décidé). Healthcheck : `/healthz`.
6. Premier admin, depuis un poste avec le `.env` pointant sur Supabase : `npx tsx server/cli.ts create-admin prenom@carbonefarmers.fr`.

Chaque merge sur `main` redéploie automatiquement.

## 3. Import des données
L'import du Data Master se fait depuis un poste (le fichier reste dans `inputs/`, hors Git) :

    DATABASE_URL=… FG_BLUR_SECRET=… npm run import:master          # dry run : lire le rapport
    DATABASE_URL=… FG_BLUR_SECRET=… npm run import:master -- --apply

Le CLI affiche « ⚠︎ Base EN LIGNE » quand il vise Supabase. `db:reset` est refusé sur une base en ligne.

## Reste à faire avant ouverture publique (phase 9)
- Auth : `server/auth.ts` est un adaptateur de dev → passer sur Supabase Auth (vérification e-mail, invitations, reset, TOTP admins).
- Photos : passer du volume disque à Supabase Storage (bucket privé).
- Revue sécurité, mentions légales, cookies, licence open data (voir `server/openPoints.ts`).
