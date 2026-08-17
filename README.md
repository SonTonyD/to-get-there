# ToGetThere

This project was generated using [Angular CLI](https://github.com/angular/angular-cli) version 19.1.2.

## Development server

To start a local development server, run:

```bash
ng serve
```

Once the server is running, open your browser and navigate to `http://localhost:4200/`. The application will automatically reload whenever you modify any of the source files.

## Code scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
ng generate component component-name
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
ng generate --help
```

## Building

To build the project run:

```bash
ng build
```

This will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.

## Connexion avec Google

L'application utilise Google OAuth via Supabase. Aucun identifiant ni secret Google ne doit être ajouté dans les fichiers Angular.

1. Dans Google Cloud, configure l'écran de consentement OAuth puis crée un client OAuth de type **Application Web**.
2. Ajoute les origines JavaScript `http://localhost:4200` et l'origine du site de production.
3. Ajoute comme URI de redirection Google `https://zknedkwzwchqnbegmhkv.supabase.co/auth/v1/callback`.
4. Dans Supabase, ouvre **Authentication > Providers > Google**, active le fournisseur et renseigne le Client ID et le Client Secret Google.
5. Dans **Authentication > URL Configuration**, ajoute `http://localhost:4200/login` et `https://VOTRE-DOMAINE/login` aux Redirect URLs. Configure aussi la Site URL de production.
6. Exécute la migration `supabase/migrations/20260819_google_oauth_profiles.sql` afin d'initialiser le pseudo, le prénom et la photo des nouveaux comptes Google.

Le retour OAuth conserve la page privée que l'utilisateur voulait consulter. Un nouveau compte passe d'abord par le questionnaire, puis reprend cette navigation.

## Navigation et liens profonds

Les écrans principaux disposent maintenant d’URL stables :

- `/trips/:tripId` et `/trips/:tripId/days/:dayId`
- `/explore` et `/travel/:slug`
- `/profile/:username`
- `/messages/:conversationId`
- `/video/:projectId`

Les pages privées conservent leur destination pendant la connexion. Le lecteur expose également la page courante dans l’URL afin de pouvoir partager une journée précise.

Le shell principal charge désormais à la demande les domaines autonomes suivants :

- `features/reader` pour la lecture, le plein écran, le balayage et le partage ;
- `features/messaging` pour la boîte de réception, les conversations et leurs paramètres.

Ces composants utilisent des blocs Angular `@defer` : leur code et leurs styles ne sont téléchargés que lors de la première ouverture du domaine concerné.

En production, l’hébergeur doit appliquer une règle SPA qui renvoie `index.html` pour toute URL ne correspondant pas à un fichier statique. Sans ce fallback, l’ouverture ou le rechargement direct d’un lien profond peut produire une 404 côté serveur. Exemples :

- Netlify ou Render Static Site : `/* /index.html 200` dans `_redirects` ;
- Vercel : une rewrite de `/(.*)` vers `/index.html` ;
- Nginx : `try_files $uri $uri/ /index.html`.

## Film souvenir

Le studio Angular est relié à Supabase par la migration `supabase/migrations/20260816_video_memories_mvp.sql` et deux Edge Functions :

```bash
supabase db push
supabase functions deploy generate-video-storyboard
```

La génération du storyboard utilise `OPENAI_VIDEO_MODEL`, puis `OPENAI_MODEL`, avec `gpt-5.6-luna` comme valeur par défaut. Le MP4 est ensuite généré directement sur l’appareil avec WebCodecs et Mediabunny en 720p/25 fps, puis téléchargé et sauvegardé dans le bucket privé `video-renders`. Aucun serveur Render, secret de renderer ou service vidéo tiers n’est nécessaire.

Après déploiement de `20260817_browser_video_export.sql`, l’ancienne Edge Function distante peut être supprimée :

```bash
supabase functions delete request-video-render
```

## Running unit tests

To execute unit tests with the [Karma](https://karma-runner.github.io) test runner, use the following command:

```bash
ng test
```

## Running end-to-end tests

For end-to-end (e2e) testing, run:

```bash
ng e2e
```

Angular CLI does not come with an end-to-end testing framework by default. You can choose one that suits your needs.

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.
