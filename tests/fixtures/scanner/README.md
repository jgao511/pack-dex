# Scanner development fixtures

These files are test-only and must not be imported by normal mobile or native builds.

- `mega-charizard-x-ex-013-094.jpg` is the user-supplied physical-test reference, converted losslessly enough for OCR/visual regression work.
- `visual-references/` caches 50 resized PackDex catalog images so repeated local visual benchmarks are deterministic and do not download or upload scanned photos. The benchmark downloads only missing catalog references that declare a `sourceUrl`, then reuses the cache.
- `visual-benchmark-cards.json` records trusted catalog metadata for the cached test catalog. It includes Gardevoir and Groudon as a focused unrelated-card regression pair.

Run `npm run test:scanner-visual-benchmark` from the repository root. The harness searches the complete 50-card test catalog for exact, shifted-outline, missing-margin, perspective, rotation, blur, JPEG-compression, brightness, and glare variants. It reports simulated OCR-only matching, full-catalog lightweight visual matching, and top-eight ORB/RANSAC reranking under `reports/`.

The Mega Charizard acceptance matrix also exercises direct fixture bytes and a real Node `Blob` converted back to bytes before the same decode, preparation, descriptor, and ranking functions. This is a development approximation of Choose Photo; it does not exercise browser preview geometry, ML Kit, or a physical camera.
