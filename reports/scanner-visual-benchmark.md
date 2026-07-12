# PackDex local scanner visual benchmark

Generated: 2026-07-12T23:13:12.848Z

This development-only benchmark searches the complete 50-card trusted test catalog. Lightweight visual search evaluates every reference; ORB/RANSAC runs only against the strongest 8 fused visual/OCR candidates. It uses no cloud vision, uploads, or paid services.

## Accuracy

| Pipeline | Top-1 | Top-3 |
| --- | ---: | ---: |
| Simulated OCR-only evidence | 57.6% (259/450) | 70.4% (317/450) |
| Lightweight pHash + dHash + color | 99.6% (448/450) | 100.0% (450/450) |
| Fused evidence + top-8 ORB/RANSAC | 100.0% (450/450) | 100.0% (450/450) |

OCR-only numbers measure deterministic, degraded text observations; this harness does not run ML Kit OCR. They are a matching benchmark, not an OCR-engine accuracy claim.

## Timing

| Stage | Mean | p95 |
| --- | ---: | ---: |
| OCR score/rank only (excludes OCR inference) | 0.1 ms | 0.2 ms |
| Query descriptors + full lightweight search | 87.3 ms | 95.0 ms |
| Top-8 ORB/RANSAC rerank | 75.9 ms | 98.0 ms |
| End to end (excluding OCR inference) | 163.3 ms | 187.6 ms |

Reference descriptor setup: 4823.2 ms. Times are desktop Node/OpenCV.js measurements, not Pixel timings.

## Mega Charizard acceptance matrix

| Input | OCR rank | Lightweight rank | ORB rank | ORB top |
| --- | ---: | ---: | ---: | --- |
| direct-fixture | 1 | 1 | 1 | `phantasmal-flames-13-mega-charizard-x-ex` |
| file-blob-equivalent | 1 | 1 | 1 | `phantasmal-flames-13-mega-charizard-x-ex` |
| shifted-outside-outline | 1 | 1 | 1 | `phantasmal-flames-13-mega-charizard-x-ex` |
| missing-margin | 1 | 1 | 1 | `phantasmal-flames-13-mega-charizard-x-ex` |
| perspective | 1 | 1 | 1 | `phantasmal-flames-13-mega-charizard-x-ex` |
| rotation | 1 | 1 | 1 | `phantasmal-flames-13-mega-charizard-x-ex` |
| blur | 1 | 1 | 1 | `phantasmal-flames-13-mega-charizard-x-ex` |
| brightness | 1 | 1 | 1 | `phantasmal-flames-13-mega-charizard-x-ex` |
| glare | 1 | 1 | 1 | `phantasmal-flames-13-mega-charizard-x-ex` |

Expected: `phantasmal-flames-13-mega-charizard-x-ex`. Direct fixture and File/Blob-equivalent bytes both use the normal decode/resize/descriptor/ranking functions; the Blob case creates a real Node Blob and decodes its bytes. Browser preview geometry, ML Kit, and physical-camera behavior are outside this development harness.

## Catalog and variation coverage

- 50 trusted cards; 450 generated catalog queries
- Eras: XY, Sun & Moon, Sword & Shield, Scarlet & Violet, Mega Evolution, Original Series, Neo Series, e-Card Series, EX Series, Diamond & Pearl Series, Black & White Series
- Sets: 26; rarities: Rare Holo EX, Double Rare, Ultra Rare, Special Illustration Rare, Common, Secret Rare, Illustration Rare, Rare Shiny, Rare, Rare Holo, Uncommon, Rare Ultra, Rare Secret
- Variations: exact, shifted-outside-outline, missing-margin, perspective, rotation, blur, jpeg, brightness, glare
- Estimated lightweight index: 14055 JSON bytes; 5310 gzip bytes
- Reference cache: 50 hits, 0 downloads, 0 failures

## Failures and false positives

Top-1 failures: OCR-only 191/450; lightweight visual 2/450; ORB reranked 0/450. Confident ORB false positives at the benchmark threshold: 0/450.

- glare: expected `dp1-7`; OCR #1, visual #2 (`base1-58`), ORB #1 (`dp1-7`), accepted=true.
- glare: expected `bw1-20`; OCR #1, visual #2 (`bw1-47`), ORB #1 (`bw1-20`), accepted=true.
- shifted-outside-outline: expected `xy2-11-charizard-ex`; OCR #2, visual #1 (`xy2-11-charizard-ex`), ORB #1 (`xy2-11-charizard-ex`), accepted=true.
- missing-margin: expected `xy2-11-charizard-ex`; OCR #7, visual #1 (`xy2-11-charizard-ex`), ORB #1 (`xy2-11-charizard-ex`), accepted=true.
- perspective: expected `xy2-11-charizard-ex`; OCR #7, visual #1 (`xy2-11-charizard-ex`), ORB #1 (`xy2-11-charizard-ex`), accepted=true.
- rotation: expected `xy2-11-charizard-ex`; OCR #7, visual #1 (`xy2-11-charizard-ex`), ORB #1 (`xy2-11-charizard-ex`), accepted=true.
- blur: expected `xy2-11-charizard-ex`; OCR #47, visual #1 (`xy2-11-charizard-ex`), ORB #1 (`xy2-11-charizard-ex`), accepted=true.
- brightness: expected `xy2-11-charizard-ex`; OCR #2, visual #1 (`xy2-11-charizard-ex`), ORB #1 (`xy2-11-charizard-ex`), accepted=true.
- glare: expected `xy2-11-charizard-ex`; OCR #7, visual #1 (`xy2-11-charizard-ex`), ORB #1 (`xy2-11-charizard-ex`), accepted=true.
- missing-margin: expected `burning-shadows-20-charizard-gx`; OCR #4, visual #1 (`burning-shadows-20-charizard-gx`), ORB #1 (`burning-shadows-20-charizard-gx`), accepted=true.
- perspective: expected `burning-shadows-20-charizard-gx`; OCR #4, visual #1 (`burning-shadows-20-charizard-gx`), ORB #1 (`burning-shadows-20-charizard-gx`), accepted=true.
- rotation: expected `burning-shadows-20-charizard-gx`; OCR #4, visual #1 (`burning-shadows-20-charizard-gx`), ORB #1 (`burning-shadows-20-charizard-gx`), accepted=true.
- blur: expected `burning-shadows-20-charizard-gx`; OCR #8, visual #1 (`burning-shadows-20-charizard-gx`), ORB #1 (`burning-shadows-20-charizard-gx`), accepted=true.
- glare: expected `burning-shadows-20-charizard-gx`; OCR #4, visual #1 (`burning-shadows-20-charizard-gx`), ORB #1 (`burning-shadows-20-charizard-gx`), accepted=true.
- missing-margin: expected `darkness-ablaze-20-charizard-vmax`; OCR #5, visual #1 (`darkness-ablaze-20-charizard-vmax`), ORB #1 (`darkness-ablaze-20-charizard-vmax`), accepted=true.
- perspective: expected `darkness-ablaze-20-charizard-vmax`; OCR #5, visual #1 (`darkness-ablaze-20-charizard-vmax`), ORB #1 (`darkness-ablaze-20-charizard-vmax`), accepted=true.
- rotation: expected `darkness-ablaze-20-charizard-vmax`; OCR #5, visual #1 (`darkness-ablaze-20-charizard-vmax`), ORB #1 (`darkness-ablaze-20-charizard-vmax`), accepted=true.
- blur: expected `darkness-ablaze-20-charizard-vmax`; OCR #15, visual #1 (`darkness-ablaze-20-charizard-vmax`), ORB #1 (`darkness-ablaze-20-charizard-vmax`), accepted=true.
- glare: expected `darkness-ablaze-20-charizard-vmax`; OCR #5, visual #1 (`darkness-ablaze-20-charizard-vmax`), ORB #1 (`darkness-ablaze-20-charizard-vmax`), accepted=true.
- missing-margin: expected `obsidian-flames-223-charizard-ex`; OCR #6, visual #1 (`obsidian-flames-223-charizard-ex`), ORB #1 (`obsidian-flames-223-charizard-ex`), accepted=true.

## Gardevoir/Groudon confusion check

The benchmark contains both `ex1-7` and `ex9-5`. Across Gardevoir's nine variations, Groudon was never shortlisted in the top 8; Gardevoir ORB Top-1 accuracy was 100.0%.

## Limits

These are synthetic transforms of catalog/reference images on a desktop, not a labeled physical Pixel corpus. They do not reproduce sleeves, arbitrary backgrounds, motion during capture, incorrect preview-to-sensor mapping, real ML Kit OCR, or every crop failure. A correct benchmark result must not be described as proof that physical scanning is fixed.
