# PackDex scanner-AI POC

This is an isolated proof-of-concept path for the hidden mobile scanner. It is not part of the normal mobile production build and does not replace the validated OCR/visual/ORB scanner.

## Data rules

- Use only the trusted PackDex catalog and PackDex Cloudflare card assets resolved through the existing asset helpers.
- Do not use the 16 Pixel photos for training, tuning, hard-negative mining, or augmentation. They are locked holdout fixtures only.
- Do not commit downloaded catalog images, generated augmentations, trained models, reports, or cache files unless the artifact is explicitly reviewed and intentionally promoted.

## Repro flow

```powershell
node scripts/scanner-ai/export-catalog-manifest.mjs
python scripts/scanner-ai/build-dataset.py --download
python scripts/scanner-ai/train-embedding.py
python scripts/scanner-ai/export-tflite.py
python scripts/scanner-ai/build-embedding-index.py
npm --prefix mobile-app run build:native:scanner:ai
```

The intended runtime architecture is:

1. Existing native capture and rectification.
2. Scanner-AI native bridge embeds the prepared card image with a compact LiteRT-compatible model.
3. Cosine retrieval against a precomputed catalog embedding index returns top-20 candidates.
4. Existing OCR evidence remains the validator/reranker.
5. Confidence and margin thresholds prefer safe no-result over unrelated candidates.

The current checked-in POC includes the scanner-test-only build gate, native bridge source-set isolation, deterministic catalog manifest tooling, training/export/index scripts, and cosine-search utilities. It deliberately does not include a trained model, generated embeddings, or downloaded images.
