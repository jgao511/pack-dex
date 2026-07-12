# Scanner development fixtures

These files are test-only and must not be imported by normal mobile or native builds.

- `mega-charizard-x-ex-013-094.jpg` is the user-supplied physical-test reference, converted losslessly enough for OCR/visual regression work.
- `visual-references/` caches 20 resized PackDex catalog images so the local visual benchmark is deterministic and does not download or upload card photos.
- `visual-benchmark-cards.json` records the trusted catalog metadata and OCR-family shortlist for those cached images.

Run `npm run test:scanner-visual-benchmark` from the repository root. The harness generates perspective, rotation, brightness, blur, JPEG-compression, and glare variants in memory, then writes its machine-readable and Markdown reports under `reports/`.
