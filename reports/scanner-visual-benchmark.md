# PackDex local scanner visual benchmark

Generated: 2026-07-12T22:17:40.915Z

This development-only benchmark compares each synthetic scan only with its OCR-narrowed card-family shortlist (3–5 trusted catalog cards), never the full catalog. It uses no network services or uploads.

## Results

| Pipeline | Top-1 | Top-3 |
| --- | ---: | ---: |
| pHash + color + OCR | 97.5% (117/120) | 100.0% (120/120) |
| pHash + color + ORB/RANSAC + OCR | 100.0% (120/120) | 100.0% (120/120) |

Mean processing time: 179.1 ms/query; p50 177.0 ms; p95 210.3 ms. Reference descriptor setup (20 cards): 2653.1 ms.

ORB Top-1 change: 2.5 percentage points. ORB materially improved this benchmark.

## Supplied Mega Charizard reference

Expected: `phantasmal-flames-13-mega-charizard-x-ex`; pHash baseline rank: 1; ORB/RANSAC rank: 1; shortlist: xy2-11-charizard-ex, burning-shadows-20-charizard-gx, darkness-ablaze-20-charizard-vmax, obsidian-flames-223-charizard-ex, phantasmal-flames-13-mega-charizard-x-ex.

The reference observation uses the Pixel diagnostic text (`Mega Charizard XeA360`, `O1B/094`) and the bounded collector alternatives `013/094` and `018/094`; the image itself still supplies the visual evidence.

## Coverage

- 20 PackDex cards; 120 generated queries plus the supplied reference query
- Eras: XY, Sun & Moon, Sword & Shield, Scarlet & Violet, Mega Evolution
- Rarities: Rare Holo EX, Double Rare, Ultra Rare, Special Illustration Rare, Common, Secret Rare, Illustration Rare, Rare Shiny, Rare
- Variations: perspective, rotation, brightness, blur, jpeg, glare

## Failure examples

- glare: expected `phantasmal-flames-13-mega-charizard-x-ex`; baseline #3 (picked `darkness-ablaze-20-charizard-vmax`); ORB #1 (picked `phantasmal-flames-13-mega-charizard-x-ex`).
- glare: expected `team-up-184-pikachu-zekrom-gx`; baseline #2 (picked `xy1-42-pikachu`); ORB #1 (picked `team-up-184-pikachu-zekrom-gx`).
- glare: expected `prismatic-evolutions-167-eevee-ex`; baseline #2 (picked `hidden-fates-SV41-eevee`); ORB #1 (picked `prismatic-evolutions-167-eevee-ex`).

## Interpretation

The benchmark is a feasibility check, not a production accuracy claim: its OCR shortlist is simulated from a stable family token and selectively available collector evidence. The next useful step is to collect a labeled Pixel corpus (including sleeves, glare, real backgrounds, and failed crops), replay the real OCR shortlists, and rerun this harness before choosing an Android implementation.
