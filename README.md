# To Get There

> **Accéder à l’application : [https://to-get-there.vercel.app/](https://to-get-there.vercel.app/)**

To Get There est une application web de création, d’organisation et de partage de carnets de voyage. Elle accompagne le voyageur depuis la préparation de son séjour jusqu’à la publication de ses souvenirs : itinéraire quotidien, journal enrichi par IA, médias, lieux, dépenses, statistiques, lecture immersive, communauté et exports pour les réseaux sociaux.

## Sommaire

- [Fonctionnalités](#fonctionnalités)
- [Parcours utilisateur](#parcours-utilisateur)
- [Architecture technique](#architecture-technique)
- [Technologies](#technologies)
- [Installation locale](#installation-locale)
- [Configuration de Supabase](#configuration-de-supabase)
- [Services externes et IA](#services-externes-et-ia)
- [Routes principales](#routes-principales)
- [Sécurité et données](#sécurité-et-données)
- [Scripts et tests](#scripts-et-tests)
- [Déploiement](#déploiement)
- [Structure du projet](#structure-du-projet)

## Fonctionnalités

### Compte et profil voyageur

- Inscription et connexion par e-mail et mot de passe, ou avec Google via Supabase Auth.
- Réinitialisation du mot de passe.
- Questionnaire d’onboarding : personnalité, sensibilité au bruit et à la foule, régime alimentaire, allergies, mobilité et besoins particuliers.
- Profil public avec pseudo, prénom, biographie, avatar et pays visités.
- Conservation de la destination demandée pendant l’authentification, y compris après un retour OAuth.

### Gestion des voyages

- Création d’un voyage avec titre, pays, dates, devise, budget et visibilité.
- Génération automatique des journées comprises entre les dates du séjour.
- Tableau de bord, progression de chaque journée et image de couverture.
- Centre de commande regroupant journaux, médias, publication et film souvenir.

### Journal quotidien

- Parcours guidé en quatre étapes avec reprise à la dernière étape enregistrée.
- Saisie libre ou enregistrement audio, puis transcription automatique.
- Génération assistée par IA d’un titre, d’un résumé, d’événements et de lieux potentiels.
- Modification manuelle, sauvegarde automatique et validation des éléments incertains.
- Personnalisation du carnet : style, palette, papier, composition, typographie, décorations et couleurs.

### Photos, lieux et carte

- Import de photos, vidéos et fichiers audio dans un espace privé.
- Légendes, sélection des médias à publier et réorganisation de leur ordre.
- Géocodage des lieux détectés avec Geoapify, confirmation des suggestions et création de visites.
- Carte interactive Leaflet des étapes et évaluation des lieux visités.

### Budget et bilan

- Ajout et modification de dépenses par journée et catégorie.
- Conservation du montant d’origine et du montant converti.
- Calcul des statistiques et clôture du voyage.
- Retour d’expérience sur la destination, la période, la durée conseillée et le budget.

### Publication et exploration

- Publication d’un instantané public avec choix des informations exposées : photos, récit, recommandations, budget et design.
- Copie des seules photos retenues vers un bucket public dédié.
- Découverte et recherche de carnets, destinations et lieux par mois, durée, budget, type, catégorie, recommandation et récence.
- Pages publiques partageables au moyen d’un slug stable.
- Lecteur immersif paginé, utilisable en plein écran, au clavier ou par balayage tactile.

### Communauté et messagerie

- Abonnements, demandes d’amitié, mentions « J’aime » et commentaires.
- Sauvegarde de carnets dans les inspirations.
- Conversations privées, messages non lus et partage d’un voyage, d’une journée ou d’une recommandation.
- Confidentialité des messages, masquage, blocage et signalement.

### Films et contenus sociaux

- Génération par IA d’un storyboard à partir d’un voyage ou d’une journée.
- Édition des scènes, durées, textes, médias, palette et format.
- Export local en MP4 H.264, 1080p à 30 images/s, grâce à WebCodecs et Mediabunny.
- Création de Reels/TikTok verticaux, Stories, carrousels Instagram et cartes souvenir PNG.
- Feuille de partage native lorsqu’elle est disponible, avec téléchargement comme solution de repli.

## Parcours utilisateur

1. L’utilisateur crée un compte ou se connecte avec Google.
2. Lors de sa première visite, il complète son profil voyageur.
3. Il crée un voyage ; les journées correspondantes sont automatiquement préparées.
4. Chaque jour, il ajoute ses notes, un enregistrement vocal, ses médias, ses lieux et ses dépenses.
5. L’IA peut structurer ces informations en un journal que l’utilisateur relit et corrige.
6. Une fois le voyage terminé, il consulte son bilan, personnalise son carnet et choisit ce qui sera public.
7. Il peut publier le carnet, le lire en mode immersif, créer un film ou exporter des contenus sociaux.
8. Les carnets publiés alimentent l’exploration et peuvent être commentés, aimés, sauvegardés ou partagés.

## Architecture technique

L’application est une SPA Angular composée de composants standalone. `AppComponent` porte le shell principal et orchestre les écrans. Les domaines les plus autonomes — lecteur, messagerie, studio vidéo et studio de partage — disposent de leurs propres composants. Plusieurs sont chargés avec les blocs Angular `@defer` lors de leur première ouverture.

Le routeur fournit des URL stables et des liens profonds. `AppNavigationService` convertit l’état d’écran en URL, protège les écrans privés et permet de reprendre la destination initialement demandée après connexion.

`SupabaseService` centralise l’accès à Supabase Auth, PostgreSQL/PostgREST, aux fonctions RPC, à Storage et aux Edge Functions. Les traitements d’images et de vidéos destinés à l’export sont effectués dans le navigateur. Les clés OpenAI et Geoapify restent exclusivement côté backend.

## Technologies

| Domaine | Technologie |
| --- | --- |
| Interface | Angular 19, TypeScript 5.7, composants standalone |
| Formulaires et état | Angular Forms, RxJS |
| Navigation | Angular Router |
| Carte | Leaflet 1.9 |
| Backend | Supabase Auth, PostgreSQL, PostgREST, RPC et Edge Functions |
| Stockage | Supabase Storage |
| IA | API OpenAI pour la transcription, le journal et le storyboard |
| Géocodage | Geoapify |
| Vidéo navigateur | WebCodecs et Mediabunny |
| Tests | Jasmine, Karma et Chrome Headless |
| Hébergement actuel | Vercel |

## Installation locale

### Prérequis

- Node.js compatible avec Angular 19 et npm ;
- un projet Supabase ;
- Supabase CLI pour le backend ;
- Chrome ou Edge récent pour l’export MP4.

```bash
git clone <URL_DU_DEPOT>
cd to-get-there
npm install
npm start
```

L’application est disponible sur [http://localhost:4200](http://localhost:4200) et se recharge automatiquement après une modification.

### Configuration Angular

Renseigner `src/environments/environment.ts` :

```ts
export const environment = {
  production: false,
  supabaseUrl: 'https://VOTRE_PROJET.supabase.co',
  supabasePublishableKey: 'VOTRE_CLE_PUBLIABLE'
};
```

La clé publiable peut être utilisée dans le navigateur : les droits sont contrôlés par l’authentification et les politiques RLS. Ne jamais ajouter de clé `service_role`, OpenAI ou Geoapify dans Angular.

## Configuration de Supabase

### Base de données

Pour un nouveau projet, exécuter `script.sql` dans le SQL Editor Supabase, puis appliquer dans l’ordre les migrations de `supabase/migrations` :

1. `20260815_sub_lot_2b_search.sql` — recherche et exploration ;
2. `20260816_scrapbook_customization.sql` — personnalisation du carnet ;
3. `20260816_video_memories_mvp.sql` — projets vidéo et storyboards ;
4. `20260817_browser_video_export.sql` — export local et stockage des rendus ;
5. `20260818_trip_command_center.sql` — centre de commande et suivi du journal ;
6. `20260819_google_oauth_profiles.sql` — profils créés par Google OAuth.

```bash
npx supabase login
npx supabase link --project-ref VOTRE_PROJECT_REF
npx supabase db push
```

Le schéma comprend notamment les profils, préférences voyageur, voyages, journées, journaux, événements, médias, lieux, visites, dépenses, publications, interactions communautaires, conversations, messages et projets vidéo.

### Buckets Storage

- `trip-media` : médias originaux privés, protégés par RLS ;
- `published-trip-media` : copies publiques des photos sélectionnées lors de la publication ;
- `video-renders` : rendus vidéo privés générés dans le navigateur.

### Edge Functions

```bash
npx supabase functions deploy transcribe-day
npx supabase functions deploy generate-journal
npx supabase functions deploy resolve-place
npx supabase functions deploy publish-trip
npx supabase functions deploy generate-video-storyboard
```

Pour le développement local, créer `supabase/functions/.env`, sans le versionner, puis lancer :

```bash
npx supabase functions serve --env-file supabase/functions/.env
```

### Google OAuth

1. Créer un client OAuth **Application Web** dans Google Cloud.
2. Ajouter `http://localhost:4200` et le domaine de production aux origines autorisées.
3. Ajouter `https://VOTRE_PROJET.supabase.co/auth/v1/callback` aux URI de redirection Google.
4. Activer Google dans **Supabase > Authentication > Providers** et saisir les identifiants.
5. Dans **Authentication > URL Configuration**, définir la Site URL et autoriser `http://localhost:4200/login` ainsi que `https://VOTRE_DOMAINE/login`.

## Services externes et IA

```bash
npx supabase secrets set OPENAI_API_KEY=VOTRE_CLE_OPENAI
npx supabase secrets set GEOAPIFY_API_KEY=VOTRE_CLE_GEOAPIFY
```

`OPENAI_MODEL` permet de choisir le modèle du journal. `OPENAI_VIDEO_MODEL` sélectionne celui du storyboard vidéo, avec repli sur `OPENAI_MODEL`. La transcription, la génération structurée et le géocodage sont toujours exécutés côté Edge Functions.

## Routes principales

| Route | Usage | Accès |
| --- | --- | --- |
| `/login` | Connexion et inscription | Public |
| `/onboarding` | Questionnaire voyageur | Privé |
| `/home` | Accueil connecté | Privé |
| `/trips` et `/trips/new` | Liste et création de voyages | Privé |
| `/trips/:tripId` | Tableau de bord | Privé |
| `/trips/:tripId/days/:dayId` | Journal quotidien | Privé |
| `/trips/:tripId/read/:page` | Lecteur propriétaire | Privé |
| `/trips/:tripId/video` | Film souvenir | Privé |
| `/trips/:tripId/share` | Studio de partage | Privé |
| `/explore` | Exploration | Public |
| `/explore/destinations/:destinationId` | Fiche destination | Public |
| `/explore/places/:placeId` | Fiche lieu | Public |
| `/travel/:slug` | Carnet publié | Public |
| `/travel/:slug/read/:page` | Lecteur public | Public |
| `/profile/:username` | Profil communautaire | Public |
| `/inspirations` | Carnets sauvegardés | Privé |
| `/messages/:conversationId` | Conversation | Privé |
| `/settings/community` | Confidentialité communautaire | Privé |
| `/video/:projectId` | Reprise d’un projet vidéo | Privé |

Les paramètres `?day=<id>` et `?page=<numéro>` ciblent respectivement une journée dans les studios et une page publique. Toute URL privée ouverte sans session est conservée comme URL de retour vers `/login`.

## Sécurité et données

- Les tables sensibles utilisent Row Level Security (RLS).
- Les voyages, journaux, dépenses et médias privés sont réservés à leur propriétaire.
- Les publications sont des instantanés distincts afin de maîtriser les données exposées.
- Les fonctions sensibles vérifient le JWT Supabase.
- Les opérations nécessitant la `service_role` restent dans les Edge Functions.
- La messagerie respecte les règles de confidentialité, d’amitié et de blocage.
- Aucun secret backend ne doit être exposé dans le bundle Angular ou dans Git.

## Scripts et tests

| Commande | Description |
| --- | --- |
| `npm start` | Serveur Angular de développement |
| `npm run build` | Bundle optimisé dans `dist/to-get-there` |
| `npm run watch` | Compilation continue en développement |
| `npm test` | Tests unitaires Karma/Jasmine |

Les tests couvrent notamment la navigation, la progression des journées, la pagination du lecteur, la messagerie et le studio de partage.

```bash
npm test -- --watch=false --browsers=ChromeHeadless
npm run build
```

## Déploiement

La commande de production est `npm run build`. Avec le builder Angular actuel, le dossier statique à publier sur Vercel est `dist/to-get-there/browser`.

L’hébergeur doit réécrire toute route ne correspondant pas à un fichier statique vers `index.html`. Sans ce fallback SPA, le rechargement direct d’un lien `/travel/...`, `/trips/...` ou `/messages/...` renvoie une 404.

Avant une mise en production, vérifier les URL OAuth, les migrations, les cinq Edge Functions, les secrets OpenAI et Geoapify, les politiques RLS et les buckets Storage. L’ancienne fonction `request-video-render` n’est plus utile après le passage au rendu navigateur :

```bash
npx supabase functions delete request-video-render
```

## Structure du projet

```text
to-get-there/
├── public/                         # Ressources statiques
├── src/
│   ├── app/
│   │   ├── features/
│   │   │   ├── messaging/         # Boîte de réception et conversations
│   │   │   ├── reader/            # Lecteur immersif
│   │   │   └── trips/             # Progression des journées
│   │   ├── app.component.*         # Shell et parcours principaux
│   │   ├── app-navigation.service.ts
│   │   ├── browser-video-renderer.service.ts
│   │   ├── share-studio.component.*
│   │   ├── supabase.service.ts
│   │   └── video-studio.component.*
│   ├── environments/               # Configuration publique Angular
│   └── styles.css
├── supabase/
│   ├── functions/                  # Edge Functions Deno
│   └── migrations/                 # Évolutions SQL
├── script.sql                      # Schéma Supabase initial
├── SUPABASE_SETUP.md               # Notes backend complémentaires
├── angular.json
└── package.json
```

## Compatibilité et limites connues

- L’export MP4 requiert WebCodecs ; Chrome et Edge récents sont recommandés.
- Le partage natif dépend de la Web Share API et du système d’exploitation.
- L’enregistrement audio nécessite l’autorisation du microphone.
- Les contenus et lieux générés par IA doivent être relus par l’utilisateur.
- Une connexion est nécessaire pour Supabase, l’IA et le géocodage.

---

Le package est actuellement déclaré privé (`private: true`) et aucune licence de réutilisation n’est indiquée dans le dépôt.
