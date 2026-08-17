# PackDex iOS 1.0 build 2 release handoff

This document describes the public App Store build only.

## Release identity

- App name: PackDex
- Bundle identifier: `com.packdex.mobile`
- Marketing version: `1.0`
- Build number: `2`
- Minimum iOS version: `15.0`
- Xcode project: `mobile-app/ios/App/App.xcodeproj`
- Capacitor web directory: `mobile-app/dist`
- Production backend: the PackDex Supabase project configured through local public Vite values

## Public native exclusions

The public native build must not contain scanner, OCR, camera, photo-library, private model, or donation functionality. The release build therefore:

- omits camera, camera-preview, and ML Kit plugins from the Capacitor package;
- has no camera or photo-library usage descriptions in `Info.plist`;
- removes scanner assets and hosting-only files from the native distribution;
- strips private scanner styles from the native bundle;
- rejects a native build if scanner, camera, OCR, or Buy Me a Coffee material remains; and
- retains website donation functionality outside the App Store bundle.

Private scanner development remains separate from the public App Store build and must not be copied into the Xcode public directory.

## Reproducible build

From `mobile-app` on the Mac:

1. Install the committed dependencies with `npm ci`.
2. Provide the production public Vite configuration locally. Do not commit local environment files or privileged credentials.
3. Run `npm run cap:sync:ios`.
4. Run `npm run validate:ios`.
5. Confirm `git status` shows no unexplained source or generated changes.
6. Open `ios/App/App.xcodeproj` in Xcode.

The build must use the production Supabase URL and publishable client credential. It must not use a service-role key, `server.url`, localhost development server, or test backend.

## Xcode verification

Before archiving, confirm:

- PackDex target and `com.packdex.mobile` bundle ID;
- version `1.0`, build `2`, and iOS `15.0` deployment target;
- development team `TM9KXB4QWR` with automatic signing;
- Release configuration and an iOS device/archive destination;
- final app icon and launch screen;
- no camera, photo-library, microphone, or tracking permission prompts;
- no unexpected entitlements; and
- the bundled web application launches without a development server.

Exercise sign in, sign out, session restoration, account creation, password recovery, account deletion, set browsing, virtual pack opening, collection persistence, collection filtering, profile, and settings. Verify the collector-companion positioning and that large collections load beyond 1,000 rows.

Do not archive from a dirty or different commit. Record the exact release commit used for the archive and upload.
