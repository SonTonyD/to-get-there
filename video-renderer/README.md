# Worker de rendu Film souvenir

Ce service conteneurisé transforme un storyboard Supabase en MP4 avec Remotion. Il ne doit pas être exposé directement au navigateur : seule l’Edge Function `request-video-render` l’appelle.

Variables requises :

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `VIDEO_RENDERER_SECRET`
- `PORT` (facultatif, `8080` par défaut)
- `MUSIC_POSTCARD_URL`, `MUSIC_ROADTRIP_URL`, `MUSIC_DAYDREAM_URL` (facultatives, morceaux dont vous détenez les droits)

Après déploiement du conteneur, ajouter aux secrets Supabase :

- `VIDEO_RENDERER_URL=https://...`
- `VIDEO_RENDERER_SECRET=la-meme-valeur`

Le worker répond immédiatement `202`, rend en arrière-plan, met à jour `video_renders`, puis charge le résultat dans le bucket privé `video-renders`.
