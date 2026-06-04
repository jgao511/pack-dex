# Pokemon Pack Opening Simulator

## Development

1. Run `npm install` once.
2. Run `npm run dev` once.
3. Keep that terminal open while you work.
4. Open the localhost URL printed by Vite, usually `http://localhost:5173/`.
5. Edits should update automatically through Vite hot module replacement or live reload.

You do not need to rerun `npm run dev` after every edit. If the browser ever looks stale, refresh the page once while leaving the dev server terminal running.

## Supabase Auth Environment

PackDex uses Supabase Auth for optional login. Guests can still open packs and save progress locally.

For local development, create `.env` with:

```env
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_publishable_key
VITE_TURNSTILE_SITE_KEY=your_turnstile_site_key
```

Add those same environment variables to the hosting platform before deploying:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_TURNSTILE_SITE_KEY`

Only use the Supabase publishable/anon key in the frontend. Do not add a service role or secret key to this Vite app.

PackDex uses Cloudflare Turnstile for new account signup and password reset email requests. The Turnstile site key can be exposed through `VITE_TURNSTILE_SITE_KEY`; never add the Turnstile secret key to frontend code or commit it to GitHub.

To allow users to sign in immediately after signup, disable Confirm Email in Supabase: Authentication -> Sign In / Providers -> Email -> Confirm Email OFF, then save.

For password reset emails, add `https://www.pack-dex.com/reset-password` to the allowed redirect URLs in Supabase: Authentication -> URL Configuration.

Authentication is powered by Supabase. Supabase maintains its own Terms of Service, Privacy Policy, and Acceptable Use Policy. PackDex should also maintain its own Terms and Privacy pages for users.

- Supabase Terms: https://supabase.com/terms
- Supabase Privacy Policy: https://supabase.com/privacy
- Supabase Acceptable Use Policy: https://supabase.com/aup
