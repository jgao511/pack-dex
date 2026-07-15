# PackDex private Android setup

This project packages only the mobile Vite app from `mobile-app/dist`. It does not use a remote `server.url` and does not package the legacy desktop app.

## First local setup

Install Node.js 22 or newer, Android Studio with the Android SDK, and a JDK supported by the generated Android Gradle plugin. Then, from `mobile-app`:

```sh
npm install
npm run cap:sync:android
npm run cap:open:android
```

Android Studio uses its bundled JDK automatically. For command-line Gradle on Windows, if `java -version` still reports Java 8, set `JAVA_HOME` for that terminal to `C:\Program Files\Android\Android Studio\jbr` and set `ANDROID_HOME` to your Android SDK directory before running Gradle.

`cap:sync:android` always runs the relative-path native Vite build first, then copies it into Android. The ordinary `npm run build` remains the `/mobile-app/` web/PWA build.

## Run privately on Jonathan's Pixel

1. On the Pixel, enable Developer options and USB debugging.
2. Connect the phone by USB and accept its debugging authorization prompt.
3. Run `npm run cap:sync:android`, followed by `npm run cap:open:android`.
4. Let Android Studio finish Gradle sync.
5. Choose the connected Pixel in the device selector.
6. Select the `app` run configuration and press Run.
7. Android Studio installs a private debug build. This does not publish or submit anything to Google Play.

For later web changes, repeat `npm run cap:sync:android` before pressing Run. `npm run cap:run:android` is an optional command-line alternative when the Android SDK and device are already configured.

## Files that must not be committed

- `.env` files and credentials
- `android/local.properties`
- `.gradle/`, `build/`, APK, AAB, and other compiled output
- signing keystores (`*.jks`, `*.keystore`), aliases, and passwords
- `google-services.json` unless a separately reviewed Firebase feature explicitly requires it later
- Android Studio user/workspace files

The generated Android `.gitignore` covers these files. Do not put a Supabase service-role key in Vite, Capacitor, or Android resources. The existing public anon-key configuration continues to come from the mobile Vite environment.

## Intentionally deferred

- Camera and on-device OCR plugin installation and adapter wiring
- Scanner collection or wishlist writes
- Password-reset/app-link handling back into the installed app
- Email confirmation deep links and OAuth redirects
- Release signing, Play Console, payments, ads, and store submission
- iOS (`@capacitor/ios`, Xcode project, signing, associated domains, and iOS permissions)

Ordinary email/password session initialization uses the existing Supabase web client and Android `INTERNET` permission. Password reset and email-link flows continue to use the web routes until native deep links are implemented in a separate phase.
