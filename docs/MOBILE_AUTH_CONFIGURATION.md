# Mobile authentication configuration

PackDex production authentication uses one public origin:

```text
VITE_PUBLIC_SITE_URL=https://www.pack-dex.com
```

Set the Supabase Auth **Site URL** to:

```text
https://www.pack-dex.com
```

Add these exact production **Redirect URLs**:

```text
https://www.pack-dex.com/mobile-app/auth/callback
https://www.pack-dex.com/mobile-app/reset-password
https://pack-dex.com/mobile-app/auth/callback
https://pack-dex.com/mobile-app/reset-password
```

The mobile Vite server uses port `5174`. Add these exact local redirects:

```text
http://localhost:5174/mobile-app/auth/callback
http://localhost:5174/mobile-app/reset-password
http://127.0.0.1:5174/mobile-app/auth/callback
http://127.0.0.1:5174/mobile-app/reset-password
```

## Confirm Signup template

Keep the verification token in both links:

```html
<a href="{{ .ConfirmationURL }}">Confirm email</a>
```

The fallback text link must also use `{{ .ConfirmationURL }}`. Mobile signup supplies:

```js
emailRedirectTo: `${PUBLIC_SITE_URL}/mobile-app/auth/callback`
```

Do not replace `{{ .ConfirmationURL }}` with `{{ .SiteURL }}`.

## Password Recovery template

PackDex consistently uses the manual `token_hash` recovery flow:

```html
<a href="https://www.pack-dex.com/mobile-app/reset-password?token_hash={{ .TokenHash }}&type=recovery">
  Reset password
</a>
```

Use the same canonical URL for the fallback text:

```text
https://www.pack-dex.com/mobile-app/reset-password?token_hash={{ .TokenHash }}&type=recovery
```

The mobile reset route verifies that token with `verifyOtp`, updates the password
with `updateUser`, and returns the authenticated recovery session to
`/mobile-app/?tab=profile`.
