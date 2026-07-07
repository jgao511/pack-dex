# sync-card-prices deploy rule

Keep this Edge Function self-contained.

Do not import from `src/`, `public/`, `dist/`, or any card image/logo asset path. Supabase deploys the function dependency graph, and app imports can cause large frontend/card-image assets to be uploaded.

Use:

```sh
npm run deploy:sync-card-prices
```

That script regenerates `catalog.json`, checks that the function has no app/image imports, then runs:

```sh
supabase functions deploy sync-card-prices
```
