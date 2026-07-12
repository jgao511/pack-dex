# Scanner native integration handoff

PackDex currently has no Capacitor configuration or Android/iOS projects. This phase deliberately does not create them. The scanner page uses browser-only temporary object URLs and adapter contracts in `captureCardImage.js` and `recognizeCardText.js`.

When PackDex adopts Capacitor, use versions matching the chosen Capacitor major and then add the native platforms:

```sh
npm install @capacitor/core @capacitor/cli @capacitor/android @capacitor/ios @capacitor/camera @capacitor-community/image-to-text
npx cap init
npx cap add android
npx cap add ios
npx cap sync
```

`@capacitor/camera` is the official capture plugin. `@capacitor-community/image-to-text` 8.x is the current maintained Capacitor 8 bridge for still-image, on-device recognition (Android ML Kit and Apple Vision); it supports lines, bounding coordinates, and orientation. Re-check compatibility before installation: https://capacitorjs.com/docs/apis/camera and https://github.com/capacitor-community/image-to-text.

Native adapter work still required:

- Map Camera `checkPermissions`, `requestPermissions`, and `getPhoto` into the existing camera adapter. Request permission only from `captureCardImage` after the user action. Use `saveToGallery: false` and a temporary URI.
- Map `detectText` output into `{ fullText, blocks: [{ text, confidence?, boundingBox? }] }` through `normalizeOcrResult`.
- Android: add only `android.permission.CAMERA` if required by the final capture configuration. Do not add broad storage permissions.
- iOS: add `NSCameraUsageDescription`. Add photo-library usage text only if the native picker requires it. Do not add microphone, location, contacts, or tracking permissions.
- Release/delete plugin temporary files after replacement, retry, confirmation, and route unmount.
- Validate plugin licensing and the selected Capacitor-major compatibility before shipping.
