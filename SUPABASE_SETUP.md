# Déploiement Supabase · Sous-lots 1A et 1B

## 1. Base de données et Storage

Pour un nouveau projet, exécuter tout `script.sql` dans le SQL Editor Supabase. Si la partie 1A a déjà été exécutée, exécuter seulement la section commençant par `Sous-lot 1B` afin de ne pas recréer les premiers objets. Cette section crée le journal, les médias, les lieux, les dépenses, le bucket privé `trip-media` et les politiques RLS.

## 2. Clé OpenAI (backend uniquement)

Ne jamais placer la clé OpenAI dans `environment.ts` ou dans Angular.

```bash
npx supabase login
npx supabase link --project-ref VOTRE_PROJECT_REF
npx supabase secrets set OPENAI_API_KEY=sk-proj-VOTRE_CLE
npx supabase secrets set GEOAPIFY_API_KEY=VOTRE_CLE_GEOAPIFY
```

## 3. Edge Functions

```bash
npx supabase functions deploy transcribe-day
npx supabase functions deploy generate-journal
npx supabase functions deploy publish-trip
npx supabase functions deploy resolve-place
```

Les fonctions contrôlent le JWT Supabase de l'utilisateur. `generate-journal` utilise `gpt-5.6-luna` avec un effort faible et deux traitements structurés. `transcribe-day` utilise `gpt-4o-mini-transcribe`.

## 4. Développement local des fonctions

Copier `supabase/functions/.env.example` vers `supabase/functions/.env` et y mettre une clé de développement, puis lancer :

```bash
npx supabase functions serve --env-file supabase/functions/.env
```

Le fichier `.env` ne doit jamais être versionné.
