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
