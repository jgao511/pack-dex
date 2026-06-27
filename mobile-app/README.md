# PackDex Mobile App

This is a separate mobile-first PackDex preview app. It is intentionally isolated from the production website in the repo root.

## Run Locally

```bash
cd mobile-app
npm install
npm run dev
```

The Vite dev server uses port `5174` by default:

```text
http://127.0.0.1:5174
```

## Supabase Setup

The mobile app reads env variables from `mobile-app/.env`. The root website `.env` is separate and is not used by the mobile Vite dev server.

1. Create `mobile-app/.env`:

```bash
cp .env.example .env
```

On Windows Command Prompt, use:

```bat
copy .env.example .env
```

On PowerShell, use:

```powershell
Copy-Item .env.example .env
```

2. Add the public Supabase project URL:

```text
VITE_SUPABASE_URL=
```

3. Add the public Supabase anon key:

```text
VITE_SUPABASE_ANON_KEY=
```

4. Add the public Cloudflare Turnstile site key used for account creation:

```text
VITE_TURNSTILE_SITE_KEY=
```

Optional asset URL overrides can stay as:

```text
VITE_ASSET_BASE_URL=https://assets.pack-dex.com
VITE_SET_ASSET_BASE_URL=https://assets.pack-dex.com/sets
```

5. Restart the dev server after editing `.env`:

```bash
npm run dev
```

Vite only reloads `.env` values on server start, so editing `.env` while the dev server is already running will not update Supabase until you stop and restart it.

Only use the public Supabase anon key and the public Turnstile site key. Never put a Supabase service role key or a Turnstile secret key in this app. The mobile client expects exactly these names: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `VITE_TURNSTILE_SITE_KEY`.

`mobile-app/.env` is ignored by git. Commit `.env.example`, not `.env`.

## Current Scope

- Mobile-first React/Vite shell.
- Bottom tab navigation: Open, Collection, Value, Profile.
- Open a Pack starts on a real scrollable set selector with compact era filtering.
- Tapping a set opens the mobile pack-ready flow with real PackDex set logos, card manifests, card image URLs, and pack generation rules from the root app.
- Pack opening supports the existing modern, vintage, XY, special preview, mini-pack, subset, and God Pack logic through the shared root helpers.
- Pack reveal uses a mobile deal/flip sequence based on the website timing constants, with slower final-card timing and a 5-card row layout.
- Pack reveal preloads the card back, selected set logo, and pulled card images before the reveal sequence starts.
- Mobile pack backs use the same `/card-back.png` public asset as the website.
- Supabase auth/session detection is connected through `mobile-app/src/lib/supabaseClient.js`.
- Profile supports basic login, signup, session display, and logout when Supabase env vars are configured.
- Collection uses the real local collection helpers and loads saved cloud collection data from the existing `user_collection` table when logged in.
- Pack opening saves pulled cards to the logged-in user through the existing `user_collection` row shape and queues failed saves locally for retry.
- Profile stats load/update against the existing `user_profile_stats` table when available.
- Collection has Set Collection and My Binders subtabs.
- Set Collection shows virtual collection cards in a 3-card mobile grid with search, era filter, set filter, and sort controls.
- My Binders shows a mobile binder list, master set import, first-page 3x3 binder previews, and a basic 3x3 binder reader with previous/next page controls.
- Value is structured around real owned collection data, but prices are placeholder estimates. Live pricing is not connected.
- Light/dark preview toggle.
- The production website files have not been moved or modified for this preview.

The mobile Vite config serves the root `public` folder so existing local PackDex set logos resolve in preview.

## Still Placeholder

- Full mobile binder creation/editing/import flows.
- Full mobile binder editing, animated page flipping, and card management.
- Live card pricing, value history, and price-source integrations.
- Final native-app pack animations and haptics.
- Production-grade code splitting for the full card/set catalog. The preview currently imports the real catalog up front, so Vite may warn about a large bundle during build.

## Future Shared Candidates

Before migrating anything, these are the files/systems that should be reviewed for a future shared layer:

- Set metadata and card data from `src/data`.
- Pack generation and rarity helpers from `src/utils/packGenerator.js`.
- Collection helpers from `src/utils/collectionStorage.js`.
- Asset URL helpers from `src/utils/assetUrls.js`.
- Supabase helpers from `src/lib`.
- Binder storage/cloud helpers from `src/utils/binderStorage.js` and `src/lib/cloudBinders.js`.
- Future pricing/value helpers once they are stable.

Do not move these into shared modules until the production website and mobile app boundaries are approved.
