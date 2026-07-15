# Native scanner test build

The Android scanner lab uses the official Capacitor Camera plugin and Pantrist’s on-device ML Kit text-recognition bridge. It remains excluded from normal web and native builds.

From `mobile-app`, build and sync the private scanner APK:

```sh
npm install
npm run cap:sync:android:scanner
npm run cap:open:android
```

Select Jonathan’s connected Pixel, choose the `app` run configuration, and press Run. In PackDex, open Profile → Settings → Scanner Test.

Normal builds remain scanner-free:

```sh
npm run build
npm run cap:sync:android
```

The scanner uses temporary URI capture with `saveToGallery: false`, prepares an in-memory 1800px-long-edge JPEG for recognition, and clears recognition base64 immediately afterward. It performs no uploads or collection, wishlist, price, pack-event, or Supabase writes.

Physical-card recognition quality still requires testing. Camera/OCR support for iOS remains deferred.
