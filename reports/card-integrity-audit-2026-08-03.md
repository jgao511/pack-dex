# PackDex Card-Integrity Audit and Release Report

**Audit date:** 2026-08-03

**Protected production baseline:** `a423856c81d33530d6e961c4e790e0e1bf568089`

**Protected pagination deployment:** `51b8dac9-d716-435d-b9da-889fad1c49eb`

**Card release commit:** `3b3f6aea9a10eda4ec3a1f98fa229caee4892c2e`

**Card release deployment:** `12800a30-ccc3-4ad1-80d6-41c98ba0b430`

**Release status:** deployed and production-verified

## Decision summary

The final source contains **129 active official sets** and **18,836 canonical active cards**, all pinned to PokémonTCG data commit `8b4e387930ead7be6595b4d4c59b7ba7a3a79f08`. The deterministic audit reports zero foreign IDs, duplicate IDs, manifest mismatches, scanner omissions, price-catalog omissions, image gaps, rarity gaps, intended pull-route gaps, count mismatches, slot failures, pack-length failures, or active/historical lifecycle leaks.

The repair:

- quarantines 16 wrong-set legacy identities from all new active pulls and new wishlist additions while preserving historical display, sharing, onboarding, collection, and wishlist-removal behavior;
- makes 26 legitimate cards reachable through ordinary pack logic;
- corrects 38 rarities, including 26 Prism Stars and 12 numbered Hyper Rare Energy cards;
- corrects 226 canonical card names across 48 logical set catalogs;
- repairs physical-slot routing for Prism Stars, Radiants, ACE SPEC, Cosmic Eclipse character secrets, Shining Fates shiny tiers, Paldean Fates, Mega Attack Rares, Mega Hyper Rares, and Prismatic demi-god packs;
- keeps all persistent card IDs stable and performs no production database row rewrite or cleanup.

The collection-pagination implementation and protected persistence contract remain byte-identical to production baseline `a423856c`. No schema, RLS, grants, rate limits, receipt/event behavior, idempotency behavior, pack-save request count, polling, or service-worker source was changed.

## Authoritative scope

### Active sets audited

- **Wizards Vintage (7):** Base Set; Jungle; Fossil; Base Set 2; Team Rocket; Gym Heroes; Gym Challenge.
- **Neo (4):** Neo Genesis; Neo Discovery; Neo Revelation; Neo Destiny.
- **e-Card / Late WOTC (4):** Legendary Collection; Expedition Base Set; Aquapolis; Skyridge.
- **EX (16):** EX Ruby & Sapphire; EX Sandstorm; EX Dragon; EX Team Magma vs Team Aqua; EX Hidden Legends; EX FireRed & LeafGreen; EX Team Rocket Returns; EX Deoxys; EX Emerald; EX Unseen Forces; EX Delta Species; EX Legend Maker; EX Holon Phantoms; EX Crystal Guardians; EX Dragon Frontiers; EX Power Keepers.
- **Diamond & Pearl (7):** Diamond & Pearl; Diamond & Pearl—Mysterious Treasures; Diamond & Pearl—Secret Wonders; Diamond & Pearl—Great Encounters; Diamond & Pearl—Majestic Dawn; Diamond & Pearl—Legends Awakened; Diamond & Pearl—Stormfront.
- **Platinum (4):** Platinum; Platinum—Rising Rivals; Platinum—Supreme Victors; Platinum—Arceus.
- **HeartGold & SoulSilver (5):** HeartGold & SoulSilver; HS—Unleashed; HS—Undaunted; HS—Triumphant; Call of Legends.
- **Black & White (12):** Black & White; Black & White—Emerging Powers; Black & White—Noble Victories; Black & White—Next Destinies; Black & White—Dark Explorers; Black & White—Dragons Exalted; Dragon Vault; Black & White—Boundaries Crossed; Black & White—Plasma Storm; Black & White—Plasma Freeze; Black & White—Plasma Blast; Black & White—Legendary Treasures.
- **XY (15):** XY—Kalos Starter Set; XY; XY—Flashfire; XY—Furious Fists; XY—Phantom Forces; XY—Primal Clash; Double Crisis; XY—Roaring Skies; XY—Ancient Origins; XY—BREAKthrough; XY—BREAKpoint; Generations; XY—Fates Collide; XY—Steam Siege; XY—Evolutions.
- **Sun & Moon (16):** Sun & Moon; Guardians Rising; Burning Shadows; Shining Legends; Crimson Invasion; Ultra Prism; Forbidden Light; Celestial Storm; Dragon Majesty; Lost Thunder; Team Up; Detective Pikachu; Unbroken Bonds; Unified Minds; Hidden Fates; Cosmic Eclipse.
- **Sword & Shield (17):** Sword & Shield; Rebel Clash; Darkness Ablaze; Champion’s Path; Vivid Voltage; Shining Fates; Battle Styles; Chilling Reign; Evolving Skies; Celebrations; Fusion Strike; Brilliant Stars; Astral Radiance; Pokémon GO; Lost Origin; Silver Tempest; Crown Zenith.
- **Scarlet & Violet (16):** Scarlet & Violet; Paldea Evolved; Obsidian Flames; 151; Paradox Rift; Paldean Fates; Temporal Forces; Twilight Masquerade; Shrouded Fable; Stellar Crown; Surging Sparks; Prismatic Evolutions; Journey Together; Destined Rivals; Black Bolt; White Flare.
- **Mega Evolution (6):** Mega Evolution; Phantasmal Flames; Ascended Heroes; Perfect Order; Chaos Rising; Pitch Black.

The retired custom **Pokémon 30th Anniversary** preview is not counted among the 129 active official sets. Its 15 frozen identities remain historically resolvable but are not discoverable, openable, or present in active manifest, scanner, or price catalogs.

### Deterministic cardinality

| Surface | Count |
|---|---:|
| Authoritative source cards | 18,836 |
| Canonical active runtime cards | 18,836 |
| Official manifest cards | 18,836 |
| Scanner cards | 18,836 |
| Price-identity catalog cards | 18,836 |
| Pullable / collection-checklist cards | 18,827 |
| Intentional noncollectible Sun & Moon bonus Energies | 9 |
| Retired historical runtime cards | 15 |

Machine-readable evidence is in `audits/card-integrity/authoritative-set-registry.json`, `official-card-manifest.json`, `per-set-validation.json`, and `normalization-collisions.json`.

## Root cause and quarantine

The 16 contaminants were created by an older filename/directory-driven ingestion path that formed a PackDex identity from the directory being processed without first proving that the provider’s authoritative set ID matched that directory. Foreign records with overlapping collector numbers were therefore serialized into four set files. The pinned source manifest now validates both source set and source card identity before an active catalog can pass.

Quarantine is intentionally asymmetric:

- old holdings, onboarding payloads, and public shares can resolve the exact legacy ID;
- an existing wishlist row can be removed by its exact stored predicates;
- new pulls and new wishlist additions reject the legacy ID;
- the canonical card in the correct set remains independently collectible;
- no existing collection, wishlist, share, price, receipt, event, or idempotency row is rewritten.

### All 16 wrong-set identities

| Wrong active identity quarantined | Canonical identity |
|---|---|
| `sun-moon-151-moon-sun-badge` | `evolving-skies-151-moon-sun-badge` |
| `ultra-prism-111-prism-tower` | `chaos-rising-111-prism-tower` |
| `ultra-prism-132-amarys` | `prismatic-evolutions-132-amarys` |
| `ultra-prism-133-atticus` | `prismatic-evolutions-133-atticus` |
| `ultra-prism-134-atticus` | `prismatic-evolutions-134-atticus` |
| `ultra-prism-135-brassius` | `prismatic-evolutions-135-brassius` |
| `ultra-prism-136-eri` | `prismatic-evolutions-136-eri` |
| `ultra-prism-137-friends-in-paldea` | `prismatic-evolutions-137-friends-in-paldea` |
| `ultra-prism-138-giacomo` | `prismatic-evolutions-138-giacomo` |
| `ultra-prism-139-larry-s-skill` | `prismatic-evolutions-139-larry-s-skill` |
| `ultra-prism-140-mela` | `prismatic-evolutions-140-mela` |
| `ultra-prism-141-ortega` | `prismatic-evolutions-141-ortega` |
| `ultra-prism-142-raifort` | `prismatic-evolutions-142-raifort` |
| `ultra-prism-143-tyme` | `prismatic-evolutions-143-tyme` |
| `team-up-95-team-rocket-s-pupitar` | `destined-rivals-95-team-rocket-s-pupitar` |
| `151-151-audino` | `black-bolt-151-audino` |

Team Up’s regular Pupitar remains card **#80**; Team Up **#95** remains Yveltal. The quarantined Team Rocket’s Pupitar remains resolvable only through the historical compatibility path and its correct Destined Rivals identity.

## Canonical names, rarities, aliases, and collisions

Against baseline `a423856c`, stable-ID comparison confirms **226 canonical name corrections across 48 logical set catalogs**: 214 name-only and 12 correcting both name and rarity. There are another 26 rarity-only changes, giving **38 rarity corrections total**. Sixteen quarantine removals are tracked separately and are not counted as name corrections.

A prior positional-array count of 328 was discarded. Deleting one row from `151.json` and 13 rows from `ultra-prism.json` shifted later entries, creating 118 false positional pairs; subtracting 16 unrelated quarantines still left a net overcount of 102. Stable card-ID matching removes that drift.

The collision audit records:

- 2,762 normalized-name collision groups;
- 31 destructive normalized-name groups;
- 1,873 cross-set normalized-name groups;
- 53 scanner-key collision groups.

All are contained by canonical printing IDs and the explicit ambiguity policy. Number-only scanner evidence never automatically chooses one of multiple printings. Thirty-eight historical scanner identities retain their source numbers exactly; no invented denominator suffix was added. Transient reverse, Poké Ball, Master Ball, or other parallel markers do not alter the canonical ID or persistence payload.

### Rarity corrections

Twenty-six cards changed from `Rare` to `Rare Prism Star`:

- **Celestial Storm:** Jirachi #97, Latias #107, Latios #108.
- **Dragon Majesty:** Victini #7, Lance #61.
- **Forbidden Light:** Volcanion #31, Diancie #74, Arceus #96, Lysandre #110, Beast Energy #117.
- **Lost Thunder:** Celebi #19, Xerneas #144, Ditto #154, Heat Factory #178, Life Forest #180, Lusamine #182, Thunder Mountain #191.
- **Team Up:** Shaymin #10, Tapu Koko #51, Black Market #134, Wondrous Labyrinth #158.
- **Ultra Prism:** Giratina #58, Lunala #62, Darkrai #77, Solgaleo #89, Cyrus #120.

One additional Prism Star was already correct, so all **27** now share correct identity, rarity, and reverse-slot routing.

Twelve numbered Energies changed from `Rare` to `Hyper Rare` and are collectible:

- 151 Basic Psychic Energy #207;
- Journey Together Spiky Energy #190;
- Obsidian Flames Basic Fire Energy #230;
- Paldea Evolved Basic Grass Energy #278 and Basic Water Energy #279;
- Paradox Rift Reversal Energy #266;
- Scarlet & Violet Basic Lightning Energy #257 and Basic Fighting Energy #258;
- Shrouded Fable Basic Darkness Energy #98 and Basic Metal Energy #99;
- Surging Sparks Jet Energy #252;
- Twilight Masquerade Luminous Energy #226.

The nine unnumbered Sun & Moon bonus Energies remain intentionally noncollectible. Five XY holo cards—Vivillon #17 (XY), Victreebel #3 (Furious Fists), Virizion #12 and Volcarona #17 (Ancient Origins), and Vivillon #15 (BREAKthrough)—no longer normalize as Pokémon V. Ordinary cards named Poké Ball remain in their normal Common/Uncommon pools.

## The 26 intended cards made reachable

### Radiant reverse-slot cards (12)

- **Astral Radiance:** Radiant Heatran #27, Radiant Greninja #46, Radiant Hawlucha #81.
- **Lost Origin:** Radiant Gardevoir #69, Radiant Hisuian Sneasler #123, Radiant Steelix #124.
- **Silver Tempest:** Radiant Tsareena #16, Radiant Alakazam #59, Radiant Jirachi #120.
- **Crown Zenith:** Radiant Charizard #20, Radiant Charjabug #51, Radiant Eternatus #105.

### Other repaired routes (14)

- **Shrouded Fable ACE SPEC:** Dangerous Laser #58, Neutralization Zone #60, Poké Vital A #62.
- **Paldean Fates Illustration Rare:** Wugtrio #224, Palafin #225, Pawmi #226.
- **Ascended Heroes Mega Attack Rare:** Mega Froslass ex #265, Mega Eelektross ex #266, Mega Diancie ex #267, Mega Hawlucha ex #268, Mega Gengar ex #269, Mega Scrafty ex #270, Mega Dragonite ex #271.
- **White Flare Illustration Rare:** Archen #131.

## Physical slots and pull-rate effects

| Area | Baseline behavior | Corrected behavior | Realized corrected evidence |
|---|---|---|---|
| 27 Prism Stars | No positive Prism reverse route; 26 had ordinary `Rare` rarity | Six source-backed reverse rates: 8.72%, 7.91%, 5.47%, 10.80%, 12.17%, 5.96% | 5.787%–11.893% by set, all within six-sigma bounds |
| 12 Radiants | 0% configured subset weight in four sets | Reverse rates 4.88%, 5.01%, 4.55%, 4.55% | 4.733%–4.747% for the first two and 4.560%–4.587% for the latter two |
| Shrouded Fable ACE SPEC | 0%, unreachable | First reverse at 5.00% | 5.333% |
| Cosmic Eclipse | 12 characters diluted nine gold secrets in a 3% final bucket | Character secrets reverse slot 10%; gold secrets final slot 3% | 9.920% / 2.947% |
| Shining Fates | 104 baby and nine premium shared 20.2%; nine premium used 8% | 104 baby at 20.2%; all 18 SV105–SV122 premium at 8% | 20.300% / 7.920% |
| Paldean Fates | Conflated first/second reverse and rare pools; three IRs unreachable | Independent first reverse 25.44%/7.72%; second 7.22%/1.72%/1.61%; final 15.89%/6.61% | 26.233/7.607/7.067/1.753/1.687/15.973/6.387% |
| Ascended Heroes | MAR unreachable; MHR in final slot; obsolete companion weights | Second foil IR/SIR/MHR 11.25/1.44/0.19%; final DR/Mega DR/UR/MAR 13.58/6.79/4.81/3.47% | 11.456/1.420/0.196/13.552/6.724/4.584/3.408% |
| Other Mega sets | MHR in final rare slot | MHR in second foil; established set-specific point rate preserved | Mega Evolution 0.220% vs configured 0.20% |
| Prismatic demi-god | Three picks from nine Eeveelution SIRs | Three unique picks from all 32 SIRs | 32/32 observed in 768 draws; no within-pack duplicates |

All changed-category frequency fixtures passed at six-sigma acceptance bounds. Companion rates were asserted so an intended slot repair could not silently move unrelated buckets. Full methods, targets, sources, confidence bounds, and results are in `reports/changed-slot-frequency-evidence.md`.

## Historical compatibility

Focused historical tests prove:

- a saved quarantined identity remains visible and resolvable but does not count toward the corrected canonical set checklist;
- an existing quarantined wishlist row can be removed with exact user/set/card predicates;
- a quarantined identity cannot be newly added to a wishlist or newly emitted by a pack;
- old public shares resolve their exact historical identity;
- pre-fix onboarding state restores the exact legacy identity and remains idempotent;
- existing quantities and persistent IDs are not remapped or rewritten.

The combined historical/public-share suite passed 10/10 tests.

## Read-only production impact

Production was observed read-only on 2026-08-03 from 14:50–14:59 UTC. No user identifiers were retained in this report.

| Contaminated PackDex set | Accounts holding affected identity | Collection rows | Total quantity | Public shares | Checklist denominator before → after |
|---|---:|---:|---:|---:|---:|
| 151 | 14 | 14 | 26 | 1 | 208 → 207 |
| Sun & Moon | 8 | 8 | 19 | 0 | 165 → 164 |
| Team Up | 51 | 51 | 213 | 5 | 199 → 198 |
| Ultra Prism | 3 | 4 | 4 | 0 | 191 → 178 |
| **Distinct / total** | **70 distinct accounts** | **77** | **262** | **6 shares** | — |

Only Prism Tower, Eri, Giacomo, and Larry’s Skill had nonzero Ultra Prism holdings. There were zero affected wishlist rows. Sixty-four account/set rounded percentage values change, but **zero accounts become complete or cease to be complete**. The 16 legacy IDs had zero `card_prices` rows and zero generated active price-catalog entries. No production row was modified.

## Scanner, images, mobile, and native consistency

- Scanner catalog metadata, frozen index, and visual index each contain 18,836 canonical active identities.
- Every active identity has an image and scanner identity; retired/custom identities do not leak into active indexes.
- Ambiguous number-only input remains nonautomatic.
- Desktop and mobile share the same canonical identity source and pass parity assertions.
- iOS and Android scanner bundles are generated from the same metadata-bound model files.
- Android’s stale hard-coded scanner fallback filenames were removed; both native platforms now require the filenames named by the generated metadata.
- The native model/image test bundle is used only for scanner testing; production mobile and native bundles are regenerated in normal mode for release.

## Pricing and value follow-up

This release improves canonical price identity generation but does not redesign pricing or mutate production prices. The read-only production snapshot contained 16,785 positive, exact source-ID price rows for 18,836 canonical cards: **89.111% coverage**, leaving 2,051 missing.

- 1,499 missing cards are concentrated in 13 wholly unpriced PackDex sets.
- 431 are in eight subsidiary source sets omitted by the old single-source sync path: Shining Fates SV (122), Hidden Fates SV (94), Crown Zenith GG (70), Astral Radiance TG (30), Brilliant Stars TG (30), Lost Origin TG (30), Silver Tempest TG (30), and Celebrations classic (25).
- 121 are scattered gaps.
- The 13 zero-coverage sets are Ascended Heroes, Gym Challenge, Gym Heroes, Perfect Order, Chaos Rising, Pitch Black, Neo Destiny, Neo Genesis, Team Rocket, Neo Discovery, Neo Revelation, Jungle, and Fossil.
- Black Bolt and White Flare had 342 rows grouped under swapped PackDex set IDs (170 White Flare rows under Black Bolt and 172 Black Bolt rows under White Flare), affecting displayed values.
- A pre-existing case-sensitivity caveat affects 438 canonical IDs whose prefixed collector-number case differs from provider IDs (216 SV, 120 TG, 70 GG, 32 RC). Set-wide sync can recover them by generated key, but optimized collection loading can miss exact provider IDs.

The undeployed sync catalog now carries explicit source set/card identities and supports subsidiary source sets. The broader missing-data, swapped-set, and case-normalization issues are recorded for a separate pricing task; they were not used to expand this card release and current behavior is not knowingly worsened.

## Validation and release gates

### Deterministic and seeded validation

- Deterministic audit: 129 active sets; 18,836 canonical cards; 12,900 normal packs; six forced god/special packs; 126,300 cards; **zero failures**.
- Historical audit: one retired set, 15/15 runtime identities resolved; zero active-catalog leaks.
- Changed-slot frequency suite: **7/7 passed** across 15,000- and 25,000-trial fixtures plus 256 forced Prismatic demi-god packs.
- Legacy compatibility suite: **4/4 passed**; combined share compatibility: **10/10 passed**.
- Native/scanner-focused suite: **30/30 passed**.
- Refreshed all-active-set pack validator: **passed** for 129 active sets × 100 normal packs (12,900 packs), with the retired preview excluded, 18,836 canonical cards, and zero failures in 87.80 seconds.

### Build and regression matrix

| Gate | Final result |
|---|---|
| Desktop production build and route verification | Passed; final production assets generated and live |
| Mobile production build | Passed; final production assets generated and live |
| Scanner-only build suite | Passed; final normal-production scanner/native route recheck 26/26 |
| iOS sync and project validation | Passed; normal production bundle synchronized and validated |
| Android sync and artifact validation | Passed; normal production bundle synchronized and validated |
| Collection pagination regression suite | Passed; protected loader/snapshot hashes identical to `a423856c` |
| Persistence / acknowledgement regression suite | Passed; protected queue/policy/RPC boundaries unchanged |
| Achievement suite | Passed |
| Price identity suite | Passed, subject to one baseline millisecond fixture retry described below |
| Full production-mode suite | 582/584 passed, two intentional exclusions, zero failures |
| Independent final disprover | PASS; no unresolved release blocker |

Two unrelated baseline test defects were reproduced on exact `a423856c` and are not card-release regressions:

1. `landingPresentation.test.mjs` expects an Open Graph image tag that the production-baseline `index.html` does not contain.
2. One price-refresh fixture creates a “stale” timestamp from a later `Date.now()` than the function’s captured `now`, producing a millisecond-boundary flake under concurrency; it passes on retry and in isolation.

Neither application source nor those unrelated fixtures was altered to manufacture a green card release. Final focused and production-mode results are recorded separately from these baseline-controlled exceptions.

## Production verification

Cloudflare Pages production deployment `12800a30-ccc3-4ad1-80d6-41c98ba0b430` serves card commit `3b3f6aea9a10eda4ec3a1f98fa229caee4892c2e` at both `https://www.pack-dex.com` and immutable URL `https://12800a30.pack-dex.pages.dev`. Both aliases returned HTTP 200 and the same final entries: desktop `/assets/index-ZbuarRul.js` and mobile `/mobile-app/assets/index-D4Xg4z-q.js`. The desktop application chunk `/assets/App-Cks_uN1c.js` returned JavaScript with a 4,160,202-byte body. The service-worker Git object is identical to protected baseline `a423856c`.

The authorized dedicated account began this release check with **1,016 distinct collection rows**, already above the former 1,000-row limit. Desktop opened and saved one Pitch Black pack, moving the complete collection to **1,020** distinct rows and Pitch Black from 54 to 58. The acknowledged overlay remained visible, the completed paginated snapshot also reported 1,020, refresh retained 1,020, and desktop logout/login retained 1,020.

Mobile then loaded the same 129-set, 1,020-row snapshot before and after refresh. A second authorized Pitch Black pack moved the immediate acknowledged view to **1,024** rows and Pitch Black from 58 to 62; the completed server snapshot, full refresh, and mobile logout/login all remained at 1,024. A final independent desktop reload also returned **1,024**, with all 129 active sets and the 18,827-card collectible denominator matching mobile. No duplicate, skipped, truncated, or cross-account row was observed, and no acknowledged overlay disappeared before complete-snapshot reconciliation. The dedicated session was signed out on both surfaces and all verification tabs were finalized.

The live Team Up catalog displays regular Pupitar **#80** and Yveltal **#95**; the wrong Team Rocket’s Pupitar is absent. Team Up Tapu Koko #51 displays as a Prism Star. Exact deployed-bundle identity plus the final deterministic/forced-category tests prove that all 16 contaminants are absent from active pools, the 26 repaired cards are reachable, numbered Hyper Rare Energies are collectible, the nine Sun & Moon bonus Energies remain excluded, and the corrected Prism Star, Radiant, ACE SPEC, Paldean Fates IR, Mega Attack Rare, Mega Hyper Rare, and Prismatic special-format routes are present. Scanner/image parity remains **18,836/18,836**.

Two normal pack submissions were made only because the user explicitly requested one desktop and one mobile save check. Each used the existing single atomic save request. No polling, extra pack-save request, database repair, grant/RLS change, or protected-boundary change was introduced.

## Separate wishlist permission observation

The eight `42501 permission denied for table user_wishlist` messages **were generated by the earlier adversarial permission-probe sequence**, not by a current production workflow or automatic application retry loop. The preserved task transcript records that probe attribution, and a final read-only log recheck reproduced the exact bounded sequence:

- eight Postgres errors from `2026-08-02 23:41:58.189Z` through `23:42:46.681Z`;
- eight direct `POST /rest/v1/user_wishlist?on_conflict=user_id,set_id,card_id` responses with HTTP 401, plus one initial successful CORS preflight;
- production-root referrer, iPhone Safari user agent, and `supabase-js/2.108.2; runtime=web`;
- missing/invalid JWT metadata on every failed POST;
- immediately preceding deliberate event/reward permission probes; and
- no later wishlist error in the exported window.

The exact impact was therefore **eight failed application requests, one preflight, eight edge 401 entries, and eight corresponding Postgres 42501 entries**. Production authorization remains intentional: `authenticated` has SELECT, INSERT, and DELETE; UPDATE is absent; `anon` has no table permission; and own-row RLS policies guard SELECT, INSERT, and DELETE. Wishlist load/add/remove use direct table operations, not an RPC. The add path is `INSERT ... ON CONFLICT DO NOTHING`, so it does not require UPDATE. Historical production statistics show successful authenticated upserts and deletes after the probe window, and source inspection confirms one mutation request per user action with an in-flight guard and UI rollback on error. No wishlist permission, RLS, RPC, or client change was warranted or made.

## Files changed

The card release contains 119 non-bundle paths, plus production-generated desktop/mobile/native artifacts. The separate database-capacity report is not part of the card deployment.

| Category | Non-bundle paths | Scope |
|---|---:|---|
| Canonical set/catalog and pull-rate data | 56 | Correct names, rarities, quarantine, official registry, set/source metadata, pull profiles |
| Focused tests and fixtures | 18 | Catalog, pack slots/rates, scanner/image, history, native, price, achievements |
| Scanner code, indexes, metadata, model artifact | 13 | Canonical scanner identity and metadata-bound native files |
| Desktop/mobile runtime and compatibility | 12 | Collection display, binders, wishlist, onboarding, shares, pack generation |
| Audit tooling and evidence | 8 | Manifest, registry, deterministic audit, normalization/collision and validator artifacts |
| Price-sync and achievement derived catalogs/runtime | 6 | Source identity maps and active completion catalog |
| Explore editorial derived artifacts | 3 | Regenerated 129-set guides/audit |
| Native scanner validation/handoff | 3 | Android fallback and iOS/native validation evidence |

Key new evidence and identity files are:

- `src/data/legacyCardQuarantine.json`
- `src/data/officialSetMetadata.json`
- `src/lib/cardSourceIdentity.js`
- `scripts/audit-card-pull-integrity.mjs`
- `scripts/build-card-integrity-manifest.mjs`
- `scripts/build-frozen-scanner-index.mjs`
- `scripts/build-scanner-catalog-metadata.mjs`
- `audits/card-integrity/*.json`
- `tests/changedSlotFrequency.test.mjs`
- `tests/legacySavedStateCompatibility.test.mjs`
- `tests/pullRateValidator.test.mjs`
- `tests/scannerCatalogIntegrity.test.mjs`
- `reports/changed-slot-frequency-evidence.md`

Generated `dist/`, `public/scanner-ai/`, `mobile-app/public/scanner-ai/`, and native Capacitor artifacts are rebuilt from the same final canonical source. No migration or protected Supabase persistence function is in the change set.

## Protected-boundary proof

The following production-baseline files have identical Git object hashes in the release candidate:

- `src/lib/cloudCollection.js`
- `mobile-app/src/lib/cloudCollection.js`
- `src/lib/collectionSnapshotLoader.js`
- `src/lib/completedPackQueue.js`
- `src/lib/packSubmissionPolicy.js`
- `public/sw.js`

No collection pagination, complete-snapshot replacement, overlay reconciliation, stale-load guard, account invalidation, `increment_collection_cards`, completed-pack acknowledgement, atomic persistence, receipt, pack event, `client_event_id`, advisory-lock, direct-write restriction, welcome-reward RPC, RLS, grant, authentication, rate-limit, service-worker, polling, or normal pack-save request behavior was changed.

## Remaining uncertainty

- Shining Fates preserves simulator targets of 20.2% baby / 8.0% premium while the cited opening sample reports 22.73% ±1.76 / 8.96% ±1.20. Membership and slot routing are fixed; point-rate retuning is deferred.
- Mega Evolution preserves its existing 0.20% MHR target while the cited 5,000+ pack sample reports 0.08% ±0.08. The physical slot is corrected; point-rate retuning is deferred.
- Parallel foils are treatments of a canonical printing rather than separate persisted identities, so canonical reachability is proven but a distinct catalog row is not asserted for every physical parallel.
- Production price coverage and the case/swap issues above require a separate focused pricing release.
- No real-user card identity was remapped. Existing quarantined holdings will continue to display as historical rows and remain excluded from corrected completion denominators.

## Acceptance statement

**Accepted and released.** The final merged source, generated desktop/mobile/native artifacts, deterministic audit, statistical fixtures, full production-mode regression gate, and independent disprover all satisfy the card-integrity acceptance standard. Production verification confirms the intended commit and assets are live, corrected identities and slots are present, complete collection pagination and overlay reconciliation remain intact, and desktop/mobile account state agrees above 1,000 rows.

No production collection row, persistent card ID, receipt, event, idempotency record, wishlist row, price row, schema, grant, RLS policy, rate limit, persistence RPC, acknowledgement contract, or service worker was modified by this release. Remaining price coverage and point-rate uncertainties are explicitly deferred rather than silently broadened into this deployment.
