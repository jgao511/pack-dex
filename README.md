# PackDex

PackDex is a fan-made Pokemon TCG pack opening simulator built with React and Vite. It lets users open simulated packs, reveal cards with animated foil effects, track collections by set, build binders/posters, and optionally sign in to save collection progress across devices.

Live site: https://www.pack-dex.com/

## Features

- **Pack opening simulator** with set-specific pack logic, reveal animations, sound effects, and summary screens.
- **Era and set browsing** with a responsive set grid, era filters, newest-first ordering, set logos, and collection progress.
- **Modern foil rendering** with rainbow glare, sparkles, shine sweeps, tilt-reactive foil variables, and white-blob-safe overlay clipping.
- **Smooth card tilt system** shared by pack reveal cards, summary cards, detail views, collection cards, and binder cards.
- **Persistent collection tracking** for every set, including duplicate counts, progress percentages, missing-card states, and localStorage guest support.
- **Cloud collection saving** through Supabase for logged-in users, while guests can still use localStorage.
- **Binder/poster tools** so users can build custom displays from collected cards.
- **Profile tab** with collection and pack-opening stats.
- **God Pack support** for configured English sets, including Pokemon 151, Prismatic Evolutions, Black Bolt, White Flare, and Ascended Heroes.
- **XY era support** with hard-coded simulator pull profiles, BREAK pre-rare slot behavior, Evolutions special secret handling, Generations Radiant Collection handling, and Double Crisis 7-card packs.
- **Energy filtering** that removes actual Energy cards from pulls while preserving Trainer/Item/Stadium/Pokemon cards whose names mention Energy.
- **Supabase Auth** with email/password signup, login, logout, email confirmation callback, password reset, and Cloudflare Turnstile protection for signup/reset requests.
- **Cloudflare R2 asset loading** for card images, set logos, sounds, card back, and loading assets.
- **Responsive PackDex UI** for desktop, laptop, tablet, and mobile layouts.

## Tech Stack

- React
- Vite
- Supabase Auth and Postgres
- Cloudflare Turnstile
- Cloudflare R2-hosted assets
- LocalStorage for guest collection and profile data
- CSS modules/global CSS in the app stylesheet

## Project Structure

```text
src/
  components/          React UI components
  data/                Set metadata, card data, and pull-rate configs
  lib/                 Supabase and cloud collection helpers
  utils/               Pack generation, assets, collection, binder, foil, rarity helpers
  App.jsx              Main app shell, routes, tabs, profile, dashboard
  App.css              Main PackDex styling
public/
  packdex-large.png    Main PackDex logo/banner
  packdex-small.png    Small PackDex icon/favicon
```

## Local Development

Install dependencies:

```bash
npm install
```

Run the dev server:

```bash
npm run dev
```

Open the Vite URL, usually:

```text
http://localhost:5173/
```

If localhost has trouble in your browser, try:

```text
http://127.0.0.1:5173/
```

Build for production:

```bash
npm run build
```

## Environment Variables

Create a local `.env` file. Do not commit `.env`.

```env
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_publishable_key
VITE_TURNSTILE_SITE_KEY=your_turnstile_site_key
VITE_SITE_URL=http://localhost:5173
VITE_ASSET_BASE_URL=https://assets.pack-dex.com
VITE_SET_ASSET_BASE_URL=https://assets.pack-dex.com/sets
```

For production, use:

```env
VITE_SITE_URL=https://www.pack-dex.com
```

Only use public frontend keys in this Vite app. Never commit Supabase service role keys, Resend API keys, SMTP passwords, Cloudflare Turnstile secret keys, database passwords, or JWT secrets.

## Supabase Auth Setup

PackDex uses Supabase Auth for optional accounts. Guests can still open packs and save collection progress locally.

In Supabase, verify:

- Email/password auth is enabled.
- Confirm Email can be enabled for production.
- SMTP/Resend email sending is configured if using custom email delivery.
- Row Level Security is enabled for user-owned collection data.

Recommended Supabase URL configuration:

- Site URL: `https://www.pack-dex.com`
- Redirect URLs:
  - `https://www.pack-dex.com/auth/callback`
  - `https://www.pack-dex.com/reset-password`
  - `http://localhost:5173/auth/callback`
  - `http://localhost:5173/reset-password`

Supabase email templates should use the confirmation/recovery action link Supabase provides. Do not hardcode localhost in production email templates.

## Cloud Collection Table

The app expects an existing `public.user_collection` table with user-scoped rows.

Current saved metadata is intentionally compact:

- `user_id`
- `card_id`
- `set_id`
- `quantity`
- `card_name`
- `card_number`
- `rarity`
- `image_url`
- `created_at`
- `updated_at`

The app does not save full card image blobs or large nested card objects to Supabase. If a `card_data` column exists, it should remain `null` or minimal.

## Cloudflare Turnstile

Turnstile is used for:

- New account signup
- Forgot password / password reset email requests

Turnstile is not required for normal login. Add the public site key through:

```env
VITE_TURNSTILE_SITE_KEY=your_turnstile_site_key
```

The Turnstile secret key must stay server-side or in the Supabase dashboard only. Do not put it in frontend code.

For local development, make sure the Turnstile widget allows:

- `localhost`
- `127.0.0.1`

## Asset Hosting

PackDex loads external assets from Cloudflare R2.

Default asset domain:

```text
https://assets.pack-dex.com
```

Expected asset patterns:

```text
https://assets.pack-dex.com/sets/{setFolder}/cards/{fileName}
https://assets.pack-dex.com/sets/{setFolder}/logo.png
https://assets.pack-dex.com/sounds/{fileName}
https://assets.pack-dex.com/card-back.png
https://assets.pack-dex.com/pokeball-loading-transparent.png
```

Card file names and set folder names should match the project data exactly.

## Auth Routes

PackDex includes lightweight client-side routes:

- `/auth/callback` handles Supabase email confirmation redirects.
- `/reset-password` handles recovery links and password updates.
- `/terms` displays the Terms of Service.
- `/privacy` displays the Privacy Policy.
- `/image-credits` displays asset/source credits.

For static hosting, configure rewrites so these routes serve the app entry point.

## Important Behavior Notes

- Pull rates and pack logic are intentionally set-specific and should not be changed casually.
- Actual Energy cards are filtered globally from packs and collection completion where applicable.
- Rare Holo cards should not play hit sounds.
- Hit/big-hit sounds should only play once when cards are first revealed.
- God Packs are only enabled for configured sets.
- The app should remain usable for guests even if Supabase is unavailable.

## Disclaimer

PackDex is a fan-made Pokemon TCG pack opening simulator. PackDex is not affiliated with, endorsed by, sponsored by, or associated with Nintendo, The Pokemon Company, Creatures Inc., or Game Freak. Pokemon, Pokemon TCG, and related names, images, and trademarks are the property of their respective owners. Card images and related assets are used for informational and entertainment purposes only.
