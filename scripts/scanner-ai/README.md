# PackDex scanner-AI offline pipeline

This directory builds the isolated mobile scanner-AI proof of concept. It does
not replace the validated production scanner and is never imported by Vite.

## Data and safety invariants

- Card identity is the unique trusted PackDex `cardId`, not its display name.
- Catalog URLs come only from `getCardImageUrl()` through
  `export-catalog-manifest.mjs`. The downloader rejects any other host/path and
  revalidates the final redirect URL.
- Downloads are atomic and resumable. HTTP status, image content type, magic,
  complete-file marker, dimensions, byte count, and SHA-256 are recorded.
- The locked Pixel fixtures are outside the only allowed training image root.
  Training and indexing fail if a manifest path escapes the trusted cache.
- All catalog images, environments, manifests, checkpoints, reports, models,
  generated views, and deploy artifacts are gitignored.

The validated 2026-07-13 catalog run contains 18,747/18,747 images (3.45 GB),
with 16,872 training identities and 1,875 disjoint unseen validation identities.

## Reproducible Windows setup

Use Python 3.12. The example keeps every package under the ignored artifact
tree:

```powershell
$python = "C:\Users\jonjon\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
New-Item -ItemType Directory -Force artifacts/scanner-ai/cache/python, artifacts/scanner-ai/cache/keras | Out-Null
$env:PYTHONPATH = (Resolve-Path "artifacts/scanner-ai/cache/python").Path
$env:KERAS_HOME = (Resolve-Path "artifacts/scanner-ai/cache/keras").Path
& $python -m pip install --target artifacts/scanner-ai/cache/python -r scripts/scanner-ai/requirements-training.txt
```

Export and validate the trusted catalog cache:

```powershell
node scripts/scanner-ai/export-catalog-manifest.mjs
& $python scripts/scanner-ai/build-dataset.py --download --workers 16
& $python scripts/scanner-ai/train-embedding.py --dry-run
```

The downloader can be interrupted and rerun. Valid cached files are verified
and reused. Use `--limit 16` for a network smoke.

## Bounded metric training

The single selected architecture is MobileNetV3 Small with a 256-unit
projection layer and a 128-dimensional L2-normalized embedding. A batch has
eight identities and two independently generated views per identity (16
images). The deterministic batch planner pairs catalog hard negatives based on
same name/family, set, layout, rarity, series, and collector region. Batch-hard
triplet mining then selects the visually closest negative actually present.

On-the-fly transforms cover bounded perspective/rotation, scale/distance,
partial framing, imperfect crops, backgrounds, defocus and motion blur, JPEG
compression, exposure/contrast/white balance, shadows, glare, sleeve tint,
noise, and slight edge obstruction. No transformed images are written to disk.

Training combines supervised contrastive loss (temperature 0.12) and
batch-hard triplet loss (margin 0.18, weight 0.5). It runs one frozen-backbone
epoch followed by at most two partial-unfreeze epochs, with NaN termination,
validation early stopping, periodic resumable weights, and a hard wall clock:

```powershell
& $python scripts/scanner-ai/train-embedding.py `
  --frozen-epochs 1 --unfrozen-epochs 2 --unfreeze-layers 40 `
  --max-wall-minutes 180
```

Use `--resume` after interruption. A bounded timing smoke is:

```powershell
& $python scripts/scanner-ai/train-embedding.py `
  --max-steps-per-epoch 100 --max-validation-steps 25 `
  --frozen-epochs 1 --unfrozen-epochs 0 --skip-retrieval-eval `
  --output artifacts/scanner-ai/models/timing-smoke.keras
```

## Export and full index

Quantization is deliberately opt-in. First export the float model; export fails
unless Keras/TFLite cosine parity passes on trusted unseen-validation images:

```powershell
& $python scripts/scanner-ai/export-tflite.py --quantization none
& $python scripts/scanner-ai/build-embedding-index.py --dtype float16
```

The custom TFLite contract is float32 NHWC `[1,224,224,3]`, normalized to
`[0,1]`, with a float32 128-vector output. The model contains MobileNet's own
`[-1,1]` rescaling. The scannerAi-only native bridge uses raw LiteRT Interpreter
because raw custom TFLite does not carry MediaPipe Task metadata.

Index outputs are copied only to the ignored scannerAi public asset source:

- `catalog-embeddings.f16`: little-endian row-major normalized vectors.
- `catalog-embeddings.meta.json`: dimensions, ordering, model/source/index
  versions, tensor contract, SHA-256 bindings, float16 retrieval validation,
  and direct full-catalog cosine timing.
- `catalog-metadata.json`: ordered trusted card metadata, separate from vectors.

The builder invokes the exact deployed TFLite model once per clean catalog
image, rejects duplicate/missing/checksum-mismatched identities, and requires
float16 top-1 agreement of 100%, mean top-3 set agreement of at least 99.9%,
and minimum vector cosine of at least 0.9999. It benchmarks exact cosine before
any ANN dependency is considered.

## Tests

```powershell
py -m unittest discover -s scripts/scanner-ai/tests -v
git diff --check
```

The 16 Pixel photos remain locked until model, fusion weights, and thresholds
are frozen. They are not used by any command in this document.

## Validation-only fusion calibration

Embedding top-1/top-3 reports are not sufficient to set confirmation policy:
they do not contain the real OCR candidate pool, restricted visual ranking, or
false-confirm outcomes. The generic model remains an offline retrieval
benchmark only; it is neither deployed nor a runtime calibration gate. The
deployed runtime is the selected trained float32 model/index. Its deterministic
1,875-identity corpus is the sole calibration/audit corpus. Camera-like query
views exist only in memory; this workflow never discovers or reads the Pixel
holdout.

```powershell
# Final trained exact deployed float32 TFLite/index (default deploy paths).
& $python scripts/scanner-ai/build-validation-query-embeddings.py `
  --output artifacts/scanner-ai/generated/trained-validation/validation-queries.meta.json
node scripts/scanner-ai/build-fusion-validation-observations.mjs `
  --query-metadata artifacts/scanner-ai/generated/trained-validation/validation-queries.meta.json `
  --output artifacts/scanner-ai/reports/trained-fusion-validation-observations.jsonl
```

The observation builder runs the real catalog candidate generator and exact
cosine search over the deployed float16 index. For each identity it records
seven positive OCR conditions and three adversarial/conflicting OCR conditions,
including actual projected `candidatePool` and `visualCandidates` inputs to
`fuseHybridEvidence()`. Each query producer also prints and records deterministic
full-catalog top-1 and top-3 retrieval counts/rates under
`fullCatalogRetrieval`; the JSONL metadata header carries the same summary.

Predeclare and freeze one conservative trained-float32 runtime policy using
only the calibration identity partition. This command must complete before the
audit is opened; its output is the immutable policy record consumed by audit.

```powershell
node scripts/scanner-ai/calibrate-fusion.mjs --mode search `
  --protocol trained-float32-runtime-only-v1 `
  --observations artifacts/scanner-ai/reports/trained-fusion-validation-observations.jsonl `
  --output artifacts/scanner-ai/reports/trained-float32-calibration-policy.json
```

Apply the exact recommended `ranking` object to
`scannerAiRuntimeConfig.js` and bump `configVersion`. Then evaluate that exact
policy once on the untouched trained-float32 audit partition, binding it to the
frozen policy record:

```powershell
node scripts/scanner-ai/calibrate-fusion.mjs --mode evaluate-current `
  --protocol trained-float32-runtime-only-v1 `
  --observations artifacts/scanner-ai/reports/trained-fusion-validation-observations.jsonl `
  --policy-freeze artifacts/scanner-ai/reports/trained-float32-calibration-policy.json `
  --output artifacts/scanner-ai/reports/fusion-calibration.json
```

The audit passes only when the trained-float32 runtime has zero observed wrong
confirmations, at least 300 confirmations, and a one-sided 95% wrong-rate upper
bound no greater than 1%. Search mode deliberately never evaluates the audit
partition. If the one-time audit fails, do not tune against it; predeclare a new
independent validation corpus/seed before making another policy decision.

This remains a synthetic OCR calibration. It does not measure ML Kit's device
error distribution, non-card inputs, or out-of-catalog cards, and ORB remains
disabled. Those limitations favor safe no-result thresholds.

## Isolated Android builds

The AI web mode and native Gradle source set are deliberately coupled. The AI
Vite build emits `scanner-ai-build.json`; Gradle fails if that marker and
`-PpackdexScannerAiPoc=true` disagree. Use the single root command instead of
invoking those switches independently:

```powershell
npm run build:scanner-ai:android -- --require-index
```

On Windows the wrapper uses Android Studio's bundled JBR when `JAVA_HOME` is
unset. It synchronizes the AI web bundle, clean-builds the scannerAi-only APK,
and verifies that the APK contains the model/build marker and no Pixel fixture
names. The output is:

`mobile-app/android/app/build/outputs/apk/debug/app-debug.apk`

The normal build remains separate and excludes the scannerAi Java source,
model, index, and LiteRT dependency:

```powershell
npm.cmd --prefix mobile-app run cap:sync:android:scanner
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
Push-Location mobile-app/android
./gradlew.bat clean assembleDebug
Pop-Location
New-Item -ItemType Directory -Force artifacts/scanner-ai/reports | Out-Null
Copy-Item mobile-app/android/app/build/outputs/apk/debug/app-debug.apk `
  artifacts/scanner-ai/reports/existing-scanner.apk
```

Verify 16 KB native-library alignment for either final APK:

```powershell
$zipalign = Get-ChildItem "$env:LOCALAPPDATA\Android\Sdk\build-tools" -Directory |
  Sort-Object Name -Descending | Select-Object -First 1 |
  Join-Path -ChildPath zipalign.exe
& $zipalign -c -P 16 4 mobile-app/android/app/build/outputs/apk/debug/app-debug.apk
```

## Freeze before the locked holdout

Do not open or run any of the 16 Pixel photos until the trained-float32 model,
its full index, versioned fusion weights/thresholds, source tree, and the
already-built Android APK have been frozen. The generic model remains
benchmark-only and has no runtime APK or holdout run. With the exact trained
assets in the deploy layout, build, copy, and freeze the final APK in this
order:

```powershell
npm run build:scanner-ai:android -- --require-index
Copy-Item mobile-app/android/app/build/outputs/apk/debug/app-debug.apk `
  artifacts/scanner-ai/reports/trained-float32-hybrid.apk
npm run freeze:scanner-ai -- `
  --apk artifacts/scanner-ai/reports/trained-float32-hybrid.apk `
  --calibration-report artifacts/scanner-ai/reports/fusion-calibration.json `
  --output artifacts/scanner-ai/reports/trained-float32-runtime-freeze.json
```

The freeze binds the complete relative-import closure of the installed mobile
runtime (including OCR, rectification worker, catalog data, and asset mapping),
the versioned weights/thresholds, ordered card IDs, catalog metadata, vector
bytes, index version, model version, actual model bytes, and already-built APK
bytes. The holdout runner hashes the installed `base.apk` before accessing any
holdout image and refuses any installed hybrid whose APK or runtime hashes differ.

Only after the final trained-float32 APK and freeze exist, run the locked photos
through the ordinary Android browser-`File` path on the connected Pixel. Its
report records measured Pixel stage-by-stage timing. Install the frozen APK
before the command:

```powershell
$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"

& $adb install -r artifacts/scanner-ai/reports/trained-float32-hybrid.apk
node scripts/scanner-ai/benchmark-holdout.mjs --system trained-hybrid `
  --freeze artifacts/scanner-ai/reports/trained-float32-runtime-freeze.json `
  --output artifacts/scanner-ai/reports/trained-float32-holdout.json
```

The runner verifies the exact 16-photo manifest/checksums, uses ADB `run-as`
staging plus `DOM.setFileInputFiles` to create real browser `File` objects,
does not inject expected IDs into recognition, records per-stage timing and
retrieval/fusion evidence, and fails a hybrid run if any external scan-time
request is observed.
