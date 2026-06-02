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
```

Add those same environment variables to the hosting platform before deploying:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Only use the Supabase publishable/anon key in the frontend. Do not add a service role or secret key to this Vite app.

To allow users to sign in immediately after signup, disable Confirm Email in Supabase: Authentication -> Sign In / Providers -> Email -> Confirm Email OFF, then save.

Authentication is powered by Supabase. Supabase maintains its own Terms of Service, Privacy Policy, and Acceptable Use Policy. PackDex should also maintain its own Terms and Privacy pages for users.

- Supabase Terms: https://supabase.com/terms
- Supabase Privacy Policy: https://supabase.com/privacy
- Supabase Acceptable Use Policy: https://supabase.com/aup
