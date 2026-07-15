# PackDex scanner-AI checkpoint — 2026-07-13

Repository root: `C:\Users\jonjon\Documents\GitHub\pack-dex`

## Status

The offline catalog, image corpus, metric-learning model, TFLite exports, full indexes, deterministic unseen-query validation, hybrid runtime, integrity gates, and an arm64 Android checkpoint build are complete.

The workflow is intentionally stopped **before the fusion audit and before all 16 locked Pixel photos**. Shared fusion calibration found no zero-wrong policy with the predeclared minimum support in both the generic and trained corpora. Runtime config therefore remains `packdex-hybrid-runtime-2026-07-13-v1`; no audit report, final runtime freeze, or holdout report was created.

The current APK is a build/QA checkpoint, not an approved holdout artifact.

## Completed results

- Catalog: 18,747 trusted cards/images, 18,747 valid, 0 failed or missing.
- Identity split: 16,872 training identities and 1,875 unseen validation identities.
- Catalog cards SHA-256: `9f6d1923f562f9dd9d11c86f22dae763970cd8f8a47ebb9d1f8e58a206c21831`.
- Training manifest SHA-256: `7d5ddbaa390d0f9a9688003aa36bed824c6d2a1be933d4b06340288e9ad5f0cc`.
- Training: MobileNetV3 Small, 128-dimensional L2-normalized embedding, supervised contrastive plus batch-hard triplet loss; 1,210.063 seconds CPU-only.
- Selected trained export: float32 TFLite. Float16 was rejected because its sole top-1 disagreement with float32 was a float32-correct/float16-wrong regression.
- Exact 1,875-query retrieval:

| Model | Top-1 | Top-3 |
| --- | ---: | ---: |
| Generic MobileNetV3 Small | 1,254 / 1,875 (66.88%) | 1,433 / 1,875 (76.43%) |
| Trained float32 | 1,780 / 1,875 (94.93%) | 1,862 / 1,875 (99.31%) |
| Trained float16 | 1,779 / 1,875 (94.88%) | 1,863 / 1,875 (99.36%) |

- Float16 versus float32: 1,874/1,875 top-1 ID agreement, 1,823/1,875 exact top-3-set agreement, mean query cosine `0.99996638`.
- Fusion validation: 18,750 deterministic cases per corpus, including positive and adversarial OCR scenarios; no Pixel inputs used.
- Shared calibration search: 1,179 policies evaluated; 45 had zero calibration wrong confirmations; 0 met the 300-confirmation minimum in both corpora.
- Best zero-wrong diagnostic, deliberately **not** a recommendation: generic 184 confirmations, trained 941 confirmations. The untouched 30% audit was not evaluated.
- Hybrid runtime: bounded OCR candidate generation, one native LiteRT embedding, restricted exact cosine search, conservative fusion/no-result behavior, no scan-time artifact fetch. ORB remains disabled.
- Scanner-AI Android build: bundled `com.google.mlkit:text-recognition:16.0.1`, no Play Services OCR download dependency, LiteRT 2.1.6, arm64-v8a only.
- Checkpoint APK QA: 16 KB zip alignment passed; embedded build marker, model, index metadata, vectors, catalog metadata, and runtime-source hash match the loose artifacts byte-for-byte.
- Tests: 40/40 scanner-AI Node tests and 14/14 offline Python tests pass. `git diff --check` passes apart from informational LF/CRLF conversion warnings.
- Production desktop scanner was not built or tested. No files were staged or committed.

Google documents the bundled/static Android OCR dependency separately from the dynamically downloaded Play Services option: <https://developers.google.com/ml-kit/vision/text-recognition/v2/android>.

## Resumed run â€” stopped at Pixel debug-socket gate

The generic model was explicitly reclassified as retrieval-benchmark-only. The
runtime calibration protocol is now `trained-float32-runtime-only-v1`: one
complete trained-float32 corpus, the existing zero-wrong/300-confirmation/1%
upper-bound gates unchanged, and a search-produced policy record that the audit
cryptographically binds before it can run.

Completed in this resumed run, in order:

- Pre-audit policy record:
  `artifacts/scanner-ai/reports/trained-float32-calibration-policy.json`
  (`ecd4e1291755e59a0860b4989851b1710524605b7fc91b814f8c1d893983d270`).
  Calibration result: 941 confirmations, 0 wrong, one-sided 95% upper bound
  `0.0031785002969756393`.
- Exact frozen runtime config:
  `packdex-hybrid-runtime-2026-07-13-trained-float32-v2`, SHA-256
  `c2631702b6958576ad2e3bc5bda0597b2babe847454899d15938b6434b4a570b`.
- The one-time trained-float32 audit was consumed and passed:
  `artifacts/scanner-ai/reports/fusion-calibration.json`
  (`ff874ea08029ac37317f3fc53154c2d171475ddc48842f2c47e5460407a19f53`):
  461 confirmations, 0 wrong, one-sided 95% upper bound
  `0.006477266134638282`.
- Final frozen Android artifact:
  `artifacts/scanner-ai/reports/trained-float32-hybrid.apk`, 65,765,851 bytes,
  SHA-256 `6d7872862aabd3d01b7e24e3e312017a6bddb3afe860b050962d96509f63bd2c`;
  `artifacts/scanner-ai/reports/trained-float32-runtime-freeze.json` binds it
  to runtime-source SHA-256
  `de568448901a42a5072bb534d893e23951df941bf209b4c59b86c86b71b03268`.

The connected device was confirmed as `Pixel_6a` / `bluejay`. The frozen APK
installed successfully. The locked holdout runner then failed at its required
WebView-debug-socket gate after it staged the manifest files but **before it
located the browser file input or invoked any scanner function**:

`The connected PackDex WebView did not expose a debug socket.`

No recognition item completed and no holdout JSON/Markdown report was written.
Stop here: do not retry, alter the policy, rerun the audit, or create another
Android build in this run. A future resume must first make the installed frozen
APK expose its WebView debug socket, and verify that socket before any further
holdout access. If that requires a runtime-source change, preserve this audit
but create a new final build and freeze before seeking explicit direction on a
new holdout attempt.

## Pre-recognition infrastructure correction and terminal holdout stop

The prior missing WebView socket was traced to a scanner-AI APK crash during
Capacitor OCR-plugin loading. Two scanner-AI/debug-only infrastructure changes
were made, with no retraining, embedding regeneration, calibration, threshold,
model, index, metadata, catalog, or policy change:

- `MainActivity` enables `WebView.setWebContentsDebuggingEnabled(true)` only
  when `BuildConfig.PACKDEX_SCANNER_AI_POC && BuildConfig.DEBUG`; normal builds
  compile the flag as `false`.
- The bundled `com.google.mlkit:text-recognition:16.0.1` dependency was allowed
  to retain its required recognizer API dependency. The scanner build now
  verifies the statically packaged `assets/mlkit-google-ocr-models/` assets and
  still rejects any `com.google.mlkit.vision.DEPENDENCIES` download request.

The final rebuilt/frozen infrastructure artifact is:

- APK: `artifacts/scanner-ai/reports/trained-float32-hybrid-webdebug-bundled-ocr.apk`
  (65,848,469 bytes, SHA-256
  `c215792354835805cfb15d190ad2e5c93da2f0b3d3173e5835f59d2180968492`).
- Freeze: `artifacts/scanner-ai/reports/trained-float32-runtime-freeze-webdebug-bundled-ocr.json`
  (runtime-source SHA-256
  `6342d4e20429a0b2b622944fa637589846f26b5bfcca789405c8b947c4043a90`).

Before holdout access, the new freeze was compared field-for-field with the
original freeze: config, calibration audit/policy binding, trained float32
model, index metadata, catalog metadata, vectors, card IDs, catalog hash, and
query metadata/vectors were unchanged. A no-fixture scanner-AI preflight passed
on the Pixel 6a, including a live WebView debug page and the scanner-AI preload.

**Terminal stop:** the subsequent locked runner staged the fixtures and
submitted the first photo (`IMG_6651.jpeg`) through the ordinary browser-File
scanner path. After that invocation returned, its post-recognition artifact
identity check failed at `benchmark-holdout.mjs:302`:

`Installed scanner-AI artifacts do not match the pre-holdout runtime freeze.`

No holdout JSON/Markdown report was written and no later photo was submitted.
Because one locked photo has now been processed, do **not** retry any holdout
command, inspect the mismatch using another photo, or continue this benchmark
without explicit new direction and a newly defined holdout protocol. Do not
rerun the already-consumed audit or alter the frozen model/index/thresholds.

## Essential artifacts

All paths below are relative to the repository root unless shown otherwise.

| Artifact | Path | SHA-256 / binding |
| --- | --- | --- |
| Training manifest used | `artifacts/scanner-ai/generated/training-manifest-training-3faa34f9.jsonl` | `7d5ddbaa390d0f9a9688003aa36bed824c6d2a1be933d4b06340288e9ad5f0cc` |
| Training report | `artifacts/scanner-ai/reports/training-report.json` | `3cf41bf7ffeabc2ea8bc8f6f5b5865b2fcd238c5754b997cbd688172c4eb43ee` |
| Completed Keras model | `artifacts/scanner-ai/models/packdex-card-embedder.keras` | `3faa34f9ccddca93084fee5af4e7e330c537fab7614267ffc938c2d77889e40d` |
| Selected float32 TFLite | `artifacts/scanner-ai/models/packdex-mnv3s-d128-float32.tflite` | `62f2ff60cfdb09714a01fa74343e4dc1968601c2a43046979cbc548c28027c7c` |
| Selected index directory | `artifacts/scanner-ai/generated/index-float32` | 18,747 x 128 |
| Selected index metadata | `artifacts/scanner-ai/generated/index-float32/catalog-embeddings.meta.json` | `20a84210a8208c4edca964863376323c7f897406864f760397aba3c6b51d3d0c` |
| Selected index vectors | `artifacts/scanner-ai/generated/index-float32/catalog-embeddings.f16` | `a851d797aef5c140d8918bb2ffa7dcafa2315cb1f0cbdb6ca4abbd91c3d61edb` |
| Generic model/index | `artifacts/scanner-ai/generated/generic-baseline` | model `bbbb4c51a55a53905af1daec995ca1aae355046f8839bb8c9f5ce9271394bc40`; vectors `600a6fe01f12c7c219cf23b83cbac4fb4951b5217b949de55c19fbfdf4bd0120` |
| Generic query metadata | `artifacts/scanner-ai/generated/generic-validation/validation-queries.meta.json` | 1,875 queries |
| Trained float32 query metadata | `artifacts/scanner-ai/generated/trained-float32-validation/validation-queries.meta.json` | 1,875 queries |
| Float16 comparison | `artifacts/scanner-ai/reports/trained-float16-retrieval-preservation.json` | `22b57778065f009bcc6f6b302fbbef9d0be130ce0d773a3055b1af4bd570eaa7` |
| Generic fusion observations | `artifacts/scanner-ai/reports/generic-fusion-validation-observations.jsonl` | 18,750 cases |
| Trained fusion observations | `artifacts/scanner-ai/reports/trained-fusion-validation-observations.jsonl` | 18,750 cases |
| Calibration blocker report | `artifacts/scanner-ai/reports/fusion-calibration-recommendation.json` | `fbd27270ce96d6cd4535550d91d585bc415df124d8d3bc728413fe8a85283091` |
| Android checkpoint APK | `artifacts/scanner-ai/reports/trained-float32-checkpoint.apk` | 65,765,827 bytes; `51a919c5d338e906244974038e5dc647818a15ef40fd64fa46b9efcba568f82a` |

The deployed Android asset source currently contains the trained float32 model/index byte-for-byte. Its runtime-source SHA-256 is `493c35af1a1cf2ef4bdee6c1872e3d17c22c255de1fd106b29b41d589f69b4bf`.

## Remaining blocker and guardrails

`artifacts/scanner-ai/reports/fusion-calibration.json` is intentionally absent. Do not run `--mode evaluate-current`, do not freeze this checkpoint APK, and do not open/run the locked Pixel holdout while calibration status is `no-policy-meets-calibration-safety-and-support-gates`.

A pre-audit model/fusion design change is required that yields zero calibration wrong confirmations and at least 300 calibration confirmations in **each** corpus. Do not lower the evidence gate merely to force a pass. If the validation design itself changes, predeclare the new independent design/seed before generating it.

After a legitimate pre-audit improvement, rerun search using the preserved observations if the observation schema still contains everything the new fusion policy consumes:

```powershell
Set-Location C:\Users\jonjon\Documents\GitHub\pack-dex
node scripts/scanner-ai/calibrate-fusion.mjs --mode search `
  --observations artifacts/scanner-ai/reports/generic-fusion-validation-observations.jsonl,artifacts/scanner-ai/reports/trained-fusion-validation-observations.jsonl `
  --output artifacts/scanner-ai/reports/fusion-calibration-recommendation.json
```

If model inputs, candidate projection, scenarios, or fusion inputs change, regenerate the affected query/observation corpora using the commands in `scripts/scanner-ai/README.md` before rerunning search.

Only when search exits successfully with a supported recommendation:

1. Apply its exact `recommendedRanking` to `src/lib/cardScanner/aiVisual/scannerAiRuntimeConfig.js` and bump `configVersion`.
2. Consume the untouched audit exactly once:

```powershell
node scripts/scanner-ai/calibrate-fusion.mjs --mode evaluate-current `
  --observations artifacts/scanner-ai/reports/generic-fusion-validation-observations.jsonl,artifacts/scanner-ai/reports/trained-fusion-validation-observations.jsonl `
  --output artifacts/scanner-ai/reports/fusion-calibration.json
```

3. If and only if both corpus audits pass, produce fresh generic and trained builds and freezes. The exact deploy/build/copy/freeze sequence is in `scripts/scanner-ai/README.md` under **Freeze before the locked holdout**. The new freeze code will reject an APK unless its embedded runtime bytes match the loose model/index and its source marker.
4. Build/copy the normal scanner APK for the isolation comparison.
5. Only after all three APKs and both passing hybrid freezes exist may the locked holdout commands in the README be run.

## Reproduction environment

The offline tests/training dependencies are isolated under the ignored artifact cache:

```powershell
$python = 'C:\Users\jonjon\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
$env:PYTHONPATH = (Resolve-Path 'artifacts/scanner-ai/cache/python').Path
& $python -m unittest discover -s scripts/scanner-ai/tests -v
$tests = (Get-ChildItem -LiteralPath tests -Filter 'scannerAi*.test.mjs' -File).FullName
node --test $tests
git diff --check
```

The completed training model needs no resume. If a future source-bound interrupted training run needs resumption, use:

```powershell
& $python scripts/scanner-ai/train-embedding.py --resume `
  --frozen-epochs 1 --unfrozen-epochs 2 --unfreeze-layers 40 `
  --max-wall-minutes 180 --checkpoint-every-steps 500
```

Do not edit `artifacts/scanner-ai/reports/training-report.json` without regenerating the completion sentinel, model sidecars, and selected index metadata that bind its SHA-256.

## 2026-07-13 — 15-photo continuation: no-fixture identity gate failed (stopped)

Scope remained limited to the scanner-AI/debug holdout build. `IMG_6651.jpeg`
remains consumed and was not accessed; none of the other 15 locked photos were
read, staged, or submitted in this attempt.

### Diagnosis before any fixture access

The prior post-scan identity failure was reproduced using an in-browser
synthetic File only. The exact mismatches were `indexVersion`, `vectorSha256`,
`modelVersion`, `modelFileSha256`, `indexMetadataSha256`,
`catalogMetadataSha256`, `catalogCardsSha256`, and `cardIdsSha256`: each was
`null` at runtime while the frozen value was present. The runtime status was
`scanner-ai-poc-unavailable` with `Failed to fetch`. Config version and
runtime-source marker were not mismatched.

The infrastructure cause is that the scanner's browser File URL (`blob:`) was
sent through `CapacitorHttp`, which cannot fetch the WebView-local URL. The
scanner-only transport correction routes `blob:`/`data:` URLs through WebView
`fetch`; native HTTP candidate access is otherwise unchanged. This does not
modify the model, index, metadata, thresholds, calibration, or policy.

### New frozen build and preserved bindings

Focused scanner tests passed, then the scanner-AI/debug APK was rebuilt and
frozen as:

| Item | Value |
| --- | --- |
| APK | `artifacts/scanner-ai/reports/trained-float32-hybrid-webdebug-bundled-ocr-blobfix.apk` |
| APK SHA-256 | `4180432d577b50ff7b3fe77a56e22065965542d9e8510dc7790a466c4cd0b007` |
| Runtime-source SHA-256 | `868406f7bad59f7d7dbfe271e4dd9329cbf543eb67430f75eac92bc9c61e18af` |
| Runtime freeze | `artifacts/scanner-ai/reports/trained-float32-runtime-freeze-webdebug-bundled-ocr-blobfix.json` |

The new freeze was compared field-for-field with the preceding frozen build.
All protected config, trained model, index, vector, catalog/card metadata,
query artifacts, calibration report, and policy bindings matched exactly. Only
the APK hash and runtime-source hash changed for the transport correction.

### Device preparation and terminal gate

ADB confirmed the Pixel (`29231JEGR14539`) was online. Stale forwards were
removed; `com.packdex.app` was force-stopped, fully uninstalled, installed from
the exact APK above, package data cleared, forwards removed again, and the app
force-stopped. The harness is restricted to
`@webview_devtools_remote_<current com.packdex.app PID>` and checks runtime
identity before each scan. It also excludes `IMG_6651.jpeg` and records a
per-photo continuation ledger atomically with an in-flight marker.

The first of the required two clean-restart no-fixture identity probes then
failed before any holdout manifest or photo was opened. It again returned
`scanner-ai-poc-unavailable` / `Failed to fetch` and the same eight runtime
identity fields were `null`. The second restart, all 15 photos, latency
measurement, final report, and final focused verification were **not run**.

**Terminal stop:** preserve the frozen artifacts and do not access a locked
photo. Resume only by diagnosing this remaining no-fixture browser-File fetch
failure without changing frozen model/index/calibration/policy/thresholds. No
commit was created.

## 2026-07-13 — resumed file-bridge correction and 15-photo continuation

The remaining synthetic-only failure was diagnosed without accessing a locked
photo: this Android WebView also returned `Failed to fetch` for its own
`blob:` URL. The first correction had been wired into `scannerAiFetch`, but
the scan preparation call had not supplied it. The final scanner-AI/debug-only
infrastructure correction retains the actual browser `File` as
`scannerInputBlob` in `__PACKDEX_RUN_AI_SCANNER_FILE__` and supplies that Blob
directly to `prepareCardImage`; neither normal scanner nor desktop paths use
this bridge. This bypasses URL re-fetching entirely. Camera permission being
granted was treated only as context, not as the attributed cause.

Focused tests passed, then this scanner-AI/debug APK was built and frozen:

| Item | Value |
| --- | --- |
| APK | `artifacts/scanner-ai/reports/trained-float32-hybrid-webdebug-bundled-ocr-filebridge.apk` |
| APK SHA-256 | `53e33bd3b059eba00ee8b644d4ba0f2a09d6a1e88fe5140dcd1c4a28488f8654` |
| Runtime-source SHA-256 | `5d6516e76af5a6b64120311b51742d359b0deb9c20ce60b2dd833eef16ebfa11` |
| Runtime freeze | `artifacts/scanner-ai/reports/trained-float32-runtime-freeze-webdebug-bundled-ocr-filebridge.json` |

The freeze comparison again verified every protected config, model, index,
vector, catalog/card metadata, calibration report, policy, and query-artifact
binding against the prior trained-float32 freeze; only the infrastructure APK
and runtime-source hashes changed. The Pixel was fully uninstalled/reinstalled
from that exact APK with data and ADB forwards cleared. Two clean synthetic
no-fixture restarts passed every runtime identity field, using only the debug
socket bound to the active `com.packdex.app` PID. A transient no-PID startup
race in the harness was corrected to retry rather than throw.

### Locked 15-photo continuation (complete, not a 16-photo holdout)

`IMG_6651.jpeg` was not staged or read and remains the sole consumed photo.
The other 15 were each identity-verified before submission, then atomically
recorded after submission in
`artifacts/scanner-ai/reports/trained-float32-continuation-15-completed.json`.
The ledger has 15 completed items, no in-flight item, and records only
`IMG_6651.jpeg` as consumed. No external scan-time requests occurred.

| Result | Value |
| --- | --- |
| Report | `artifacts/scanner-ai/reports/trained-float32-holdout-continuation-15.json` |
| Result label | `locked-holdout-continuation-15` |
| Correct / wrong / safe no-result | 0 / 0 / 15 |
| Confirmations | 0 |
| Mean preprocessing / OCR / inference / ranking / total | 643.25 / 844.73 / 6.13 / 62.12 / 1667.40 ms |
| Median total | 1655 ms |
| P95 total | 1786.70 ms |
| Maximum total | 1849 ms |
| Final installed APK verification | installed base APK SHA-256 matched the filebridge freeze exactly |

The report contains each photo's confirmation state plus preprocessing, OCR,
inference, ranking (candidate build/search/fusion/ORB), and total timings.

### Terminal test gate failure (stopped, no commit)

The directly touched focused tests passed. The broader scanner-AI test set
then ran 40 tests: 38 passed and these two pre-existing calibration/ranking
expectations failed under the frozen conservative policy:

1. `tests/scannerAiFusionCalibration.test.mjs:46` — expected
   `generateConservativePolicyCandidates(unsafe).length > 300`.
2. `tests/scannerAiHybridRanking.test.mjs:7` — expected confirmed card ID
   `expected`, actual `null`.

No thresholds, calibration, model, index, or completed photo result was
changed to bypass those failures. Per the gate rule, stop here. The final APK
hash verification passed, but no commit was created because the broader
focused test gate did not fully pass.

## 2026-07-13 — consumed-photo preprocessing diagnosis (in progress)

The user authorized the already-consumed Pixel photos for development-only
diagnostics. No model, full catalog index, calibration, or threshold was
changed and no embeddings were regenerated.

Initial evidence eliminates EXIF orientation as the demonstrated root cause:
all 16 JPEGs have stored dimensions `5712x4284` with EXIF orientation `6`, and
an Android-WebView probe on consumed `IMG_6652.jpeg` produced upright
`4284x5712` dimensions for both `createImageBitmap(...,
{imageOrientation:"none"})` and `createImageBitmap(...,
{imageOrientation:"from-image"})`. Thus the WebView already applies the EXIF
orientation during decode. The temporary ADB staging used for this probe was
removed.

A scanner-AI/debug-only diagnostic capability has been added but not yet
installed or benchmarked: an explicit `includeDiagnostics` option returns the
upright decoded input, outline/rectified card crop, OCR crop images, boundary
metadata, and the Android plugin's actual 224x224 PNG model input. The normal
scanner path does not request or receive these diagnostics. Directly touched
runtime tests passed and the diagnostic Android build succeeded with runtime
source SHA-256 `027c1089c5ffbb70648f0bf1734d4d260f3401069b1d441c08ba4421e80b4593`.

**Resumable next step:** add a development-only consumed-photo diagnostic
runner that exports those images and per-photo OCR/retrieval metrics, freeze
and install the diagnostic APK after verifying all model/index/policy bindings
unchanged, then inspect boundary/rectification and Python-vs-Android input
parity before making any scanner-only correction. Do not infer that EXIF is
the cause and do not rerun a benchmark until the diagnostic output is captured.

## 2026-07-13 — three-photo diagnostic APK: partial evidence, stopped

The diagnostic APK was frozen as
`artifacts/scanner-ai/reports/trained-float32-runtime-freeze-webdebug-diagnostics.json`
and installed only after its protected model/index/calibration/policy bindings
were verified equal to the filebridge freeze. Its APK SHA-256 is
`6ee7e218dac3c219bb472d307bf98022cb4b04d65f4592b6dcf7620dea22a999`.

The three authorized consumed photos (`IMG_6652.jpeg`, `IMG_6658.jpeg`, and
`IMG_6663.jpeg`) were staged for a development-only diagnostic invocation.
ADB staging was removed afterward. The DevTools response stalled while
returning the large diagnostic payload for the third photo, so no new benchmark
or correction was run.

Before the stall, diagnostic images were exported under
`artifacts/scanner-ai/reports/consumed-pixel-diagnostics/` for `IMG_6652` and
`IMG_6658`: upright decode, outline, detected card crop, OCR regions, and the
native 224x224 input. `IMG_6658` provides concrete evidence of a cropping /
rectification failure: the upright full-frame JPEG, outline JPEG, and detected
card-crop JPEG are byte-identical. The visible frame contains a centered
Dudunsparce ex card surrounded by substantial tabletop background, but no
rectification crop was returned. Its existing exact one-card OCR pool and
very-low visual similarity (`0.476243`) are therefore consistent with the
model embedding the uncropped camera frame.

This demonstrates that card-boundary/rectification is a real failure mode; it
does not yet prove which minimal boundary fallback is safe across all three
diagnostic cases. Do not change thresholds, model, index, calibration, or OCR
regions. Resume by making the diagnostic runner stream/write each photo's
images without returning large data URLs over DevTools, capture boundary
metadata and Android/Python embedding parity for all three, then select and
test the smallest scanner-only rectification fallback before any 15-photo
development rerun.

## 2026-07-13 — diagnostic transport correction (ready to capture)

The scanner-AI debug page now keeps diagnostic images in an in-memory map and
returns only small image-reference keys with the recognition result. A
development collector can read and delete one referenced image at a time and
write it to disk immediately, avoiding the prior multi-megabyte DevTools
response that stalled on `IMG_6663`. This transport is enabled only when the
explicit `includeDiagnostics` option is supplied; normal scanner behavior is
unchanged.

`tests/scannerAiOfflineRuntime.test.mjs` passed and the scanner-AI diagnostic
APK rebuilt with runtime-source SHA-256
`b8effb5a480251344a67c60f475f17e063fefa90a92e7bbe8259d3dd1468adb4`.
The APK currently installed on the Pixel is the local diagnostic-stream build
`artifacts/scanner-ai/reports/trained-float32-hybrid-webdebug-diagnostics-stream.apk`.

**Terminal pause:** this latest transport build has not yet been frozen and
its bindings have not yet been compared with the trained-float32 freeze, so do
not submit a diagnostic photo through it yet. Resume by freezing/verifying the
APK first, then capture all three named consumed images incrementally, record
boundary metadata plus Android/Python parity, and only then implement a
conservative scanner-only fallback if the crop failure is confirmed across the
diagnostic cases.

## 2026-07-13 — diagnostic-stream capture complete: consistent boundary failure

`trained-float32-hybrid-webdebug-diagnostics-stream.apk` was frozen as
`artifacts/scanner-ai/reports/trained-float32-runtime-freeze-webdebug-diagnostics-stream.json`.
Every protected trained-float32 binding matched the filebridge freeze before
the three authorized consumed photos were staged.

The incremental image-reference transport completed for `IMG_6652.jpeg`,
`IMG_6658.jpeg`, and `IMG_6663.jpeg`; images and metadata were written under
`artifacts/scanner-ai/reports/consumed-pixel-diagnostics-stream/` and each
WebView image reference was deleted after read. For every one of the three,
boundary metadata was `null` and upright, outline, and detected-card-crop
outputs were the unchanged full camera frame. This consistently demonstrates
the card-boundary/rectification failure, including the no-OCR/no-correct-rank
case `IMG_6663`.

Baseline diagnostic retrieval: `IMG_6652` correct top-1 at `0.688371` with
margin `0.242867`; `IMG_6658` exact one-card OCR pool but `0.476243` visual
similarity; `IMG_6663` top result `prismatic-evolutions-161-umbreon-ex` at
`0.729615`, margin `0.012997`, with no OCR evidence. Native 224x224 inputs
and OCR regions are exported for all three.

**Next bounded step:** calculate Python-vs-Android parity from the exported
native model-input PNGs, then implement only a conservative scanner-AI
fallback: centered Pokémon card aspect-ratio crop when boundary detection
returns no rectification, with no perspective transform unless valid geometry
exists. Rerun only these three first. Thresholds, policy, calibration, model,
and index remain frozen; do not run the 15-photo benchmark unless all three
improve materially and consistently.

## 2026-07-13 — Android/Python parity audit (no-photo, no-code-change)

Parity could not be numerically calculated from the exported diagnostic set.
`artifacts/scanner-ai/reports/consumed-pixel-diagnostics-stream/diagnostics.json`
contains all three native `model.png` inputs, but it contains no
`queryEmbedding` / Android embedding vector for `IMG_6652.jpeg`,
`IMG_6658.jpeg`, or `IMG_6663.jpeg`. Therefore there is no Android vector to
compare against the frozen Python/TFLite output; reporting a cosine, max
absolute error, or pass status would be fabricated.

No photo was staged, no APK was rebuilt, and no code/model/index/calibration/
policy/threshold was changed during this audit.

**Exact next command (when diagnostic capture is explicitly resumed):** rerun
the incremental three-photo diagnostic collector with
`includeEmbedding:true` in addition to `includeDiagnostics:true`, persist the
returned 128-float `queryEmbedding` beside each existing `model.png`, then run
the frozen float32 TFLite interpreter on each PNG in Python (RGB pixels / 255,
no resize) and compare L2-normalized vectors by cosine and max absolute error.

## 2026-07-14 — scanner-only centered fallback completed

The three authorized consumed diagnostics were recaptured with
`includeDiagnostics:true` and `includeEmbedding:true`. Android native LiteRT
and Python's frozen float32 TFLite interpreter were compared on the exact
exported native 224x224 PNG inputs. All three 128-dimensional normalized
vectors had cosine `1.0`; maximum absolute errors were `2.98e-7`, `3.13e-7`,
and `2.42e-7` for IMG_6652, IMG_6658, and IMG_6663 respectively. Embedding
generation is therefore not the cause.

The smallest scanner-AI-only preprocessing recovery was implemented in
`mobile-app/src/lib/aiScannerPoc.js`: when the boundary worker returns no
found boundary and the source remains the unoutlined full camera frame, it
crops the centered 78% height region at the standard PokÃ©mon-card `63:88`
portrait ratio and scales that crop to the existing 500x700 scanner canvas.
Mapped camera outlines and every successful boundary perspective crop retain
their prior behavior. No model, catalog index/vector, calibration report,
threshold, ranking policy, or OCR policy changed.

The rebuilt artifact and freeze are:

- APK: `artifacts/scanner-ai/reports/trained-float32-hybrid-webdebug-centered-fallback.apk`
  (65,849,277 bytes, SHA-256
  `f643404ef7f0f0686ee3980a58d357985429464a494815252b9ed2baf08664d5`).
- Freeze: `artifacts/scanner-ai/reports/trained-float32-runtime-freeze-webdebug-centered-fallback.json`
  (runtime-source SHA-256
  `71cc1e0f8e4ebfbc4d57a241be1ae46846c485fab3bdebc68f60b00fde2036a1`).

Its protected config, calibration/policy, trained float32 model, index,
vectors, catalog/card metadata, and query-artifact bindings were compared
field-for-field with the diagnostic-stream freeze and matched exactly. The
installed Pixel base APK SHA-256 matched this new freeze; 16 KB alignment
passed.

### Three-photo before/after gate

Each fallback crop was `{x:173, y:198, width:1005, height:1404}` from the
1350x1800 upright frame, retaining `58.0667%` of the frame while preserving
the full centered card. IMG_6652 stayed correct top-1 and rose from `0.688371`
to `0.803595`; its OCR gained the exact `124/149` reading. IMG_6658 stayed
correct top-1 and rose from `0.476243` to `0.608046`; its OCR gained more name
and collector evidence. IMG_6663 changed from no OCR and an absent expected
candidate to name OCR and expected rank 2 at `0.666075`; the only higher result
was the closely related `xy3-112-m_heracross-ex`. The diagnostic total latency
changed `3746 -> 2711`, `2142 -> 1455`, and `2247 -> 1405` ms respectively.

### Authorized 15-photo development rerun

`IMG_6651.jpeg` remained excluded. The new development-only report is
`artifacts/scanner-ai/reports/trained-float32-development-15-centered-fallback.json`.
Compared with the completed pre-fallback 15-photo continuation, expected AI
top-1 improved `4/15 -> 9/15`, top-3 `5/15 -> 10/15`, expected OCR top-1
`1/15 -> 3/15`, and mean total latency `1667.40 -> 1409.53 ms`. All 15 remained
safe no-results under the unchanged conservative confirmation policy, with
zero wrong confirmations and zero external scan-time requests. One previously
top-1 development image (IMG_6654) no longer ranked, so the fallback is ready
for broader real-device debug testing but not a production-policy change.

## 2026-07-14 — scanner-AI user-confirmation debug flow implemented

The scanner-AI build now presents the frozen ranking policy as a deliberate
user-confirmation flow. A frozen high-confidence result is labelled
**High-confidence match**, non-confirmed results expose at most three
**Possible matches**, and an empty ranking says **No reliable match**. No
candidate writes to collection or wishlist: even a high-confidence candidate
must be selected and explicitly confirmed locally.

The normal scanner remains its default path. The new UI is gated by the
existing `__PACKDEX_SCANNER_AI_POC__` debug-build flag and is reached through
the scanner-AI photo/reference controls only. It uses existing scan-quality
measurements to give concise glare, move-closer, hold-steady, low-light, and
OCR-budget/progressive-result guidance. The existing 3-second OCR budget was
not changed. The bounded highlight-dimming pass is available only as a
user-triggered **Try Foil Scan** retry after a glare warning or a
non-confirmed scan; it does not run on the normal path.

Focused confirmation, quality-guidance, foil-retry, progressive-result, and
no-write tests were added. `node --test tests/scannerAi*.test.mjs` completed
with 45 passing tests. No manual real-device card test was performed during
this implementation run.

The installed debug artifact is
`artifacts/scanner-ai/reports/trained-float32-hybrid-webdebug-confirmation-ux.apk`
(65,851,269 bytes, SHA-256
`e79b41e7ddf734d6fc10f66d5d77241a08c448ae7ab05b26c097d29a38c1e823`). It
was built successfully and installed with `adb install -r` on device
`29231JEGR14539`. Its freeze is
`artifacts/scanner-ai/reports/trained-float32-runtime-freeze-webdebug-confirmation-ux.json`.
All protected model, index, catalog, calibration, thresholds/policy, and query
artifact bindings match the prior quality-budget freeze field-for-field. The
only changed runtime fingerprint is scanner UI/preprocessing source
`a63fd1c9ed2ecb1062c01dfa5b7c2de8d62b5fbfcff34b8da7d24f5d53455935`.

### Manual debug checklist for the next session

1. Confirm a clean normal card remains recognisable and that a high-confidence
   result still requires the Confirm Card button.
2. Check a low-confidence/distant scan shows no auto-confirmation, no
   collection/wishlist write, and no more than three selectable candidates.
3. Check glare over the name area shows glare guidance and exposes Try Foil
   Scan only after the initial result; compare it with the ordinary scan.
4. Check a deliberately dim, blurry, and distant scan respectively surfaces
   improve-lighting, hold-steady, and move-closer guidance.
5. Time a slow OCR scan: it must surface progressive candidates or safe
   no-result after the existing 3-second OCR budget rather than silently
   waiting 8–10 seconds.
6. Export scanner diagnostics and verify crop area, sharpness, glare, OCR
   evidence, similarity/margin, and total latency are populated.
