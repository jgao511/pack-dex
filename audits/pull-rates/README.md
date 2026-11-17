# English effective pull-rate audit

Baseline: `9dc767a1958cace3530ebef589bb0549f766125a`. Scope: the shared web/iOS pack generator and its rate/catalog dependencies. No deployment, native sync, account edits, or saved-card migration is included.

## Review result

All 131 active set formats were inspected and exercised. All 19,148 booster-eligible catalog cards have a positive route. The checked-in normal-pack run contains 131,000 generated packs with zero structural, reachability, or statistical errors. Delta Reign additionally passed 50,000 packs with all 141 eligible cards observed. Celebrations additionally passed 10,000 packs with card-specific final/Classic distributions checked.

These checks establish agreement between implementation and the stated model. They do not establish that uncertain physical odds are exact. The CSV and JSON identify measured rates, community models, retained estimates, and era fallbacks separately. Kalos Starter is a fixed-deck product: its existing simulated pack format has no real booster odds to match.

## Files

- `set-evidence.csv`: one review row for every active set, source, evidence quality, notes and reachability result.
- `set-evidence.json`: same review with complete configured profiles and vintage slot models.
- `generated-outcomes.json`: expected and actual normal-pack slot frequencies, 1,000 packs per set.
- `delta-reign-50000.json`: deeper Delta Reign run.
- `celebrations-10000.json`: deeper card-specific Celebrations run.
- `automatic-god-pack-outcomes.json`: public `generatePack` run, including automatic God-pack selection, rather than only normal packs.
- `baseline-test-comparison.json`: exact failing test names compared against an independent clean baseline checkout.

## What changed and why

1. Removed the hidden experience-tuning overrides. Both clients already import the same generator; changing only a rate table would previously have left boosted runtime rates active.
2. Repaired zero-weight standard ex routes in Mega-era sets, including six Delta Reign cards. Measured combined Double Rare probabilities are split across standard/Mega eligible cards rather than counted twice.
3. Separated runtime buckets that display rarity merges: VMAX/VSTAR, full art/alternate art, shiny premium/gold, Trainer/Galarian Gallery tiers, Rainbow/Gold, vintage Gold Star/ex/LV.X/Prime/LEGEND/SH/SL/Rotom/Arceus/ACE SPEC. Existing display rarities and persisted IDs are retained.
4. Corrected physical slot placement: Amazing Rare/reverse subsets, early e-card/EX common replacements, Legendary Collection pack length, Legendary Treasures' two Radiant Collection slots, and Delta Reign's paired Legendary Stadium halves. Missing selected tiers fall back to an ordinary result; they do not inflate another hit tier.
5. Calibrated ordinary packs around rare God-pack outcomes so their extra cards are included in aggregate rates rather than added above them. Forced-format regressions and a separate automatic-generator run check both paths.
6. Celebrations uses its observed individual final-card and Classic-card distributions. Gold Mew is not equiprobable with ordinary main-set holos. The source records 540 final cards in 541 packs; final weights are explicitly conditional on those 540 observations, while Classic frequency uses all 541 packs.
7. Excluded 11 physical product inserts from booster completion requirements. They remain in the canonical catalog, retain saved IDs, and remain visible when owned. The server achievement checklist is updated consistently. No existing cards or counts are deleted.

## Preservation and uncertainty

- Ten unchanged vintage sets reproduce the baseline's exact 100-pack seeded card-ID sequences each: Jungle, Fossil, Base Set 2, Team Rocket, Gym Heroes, Gym Challenge and all four Neo sets. Correct existing rates were not changed merely to match a newer point estimate. Pitch Black's point rates were retained within the available study's uncertainty; 30th Celebration's existing rarity targets were retained.
- Official pack construction and large first-hand opening studies take priority. Vintage/XY estimates use the English rarity guide's collation models; these are community hypotheses, not official published probabilities. Main Sun & Moon estimates use first-hand opening aggregates.
- Delta Reign has no dependable large study in this review. Its chase rates use the explicit Mega Evolution era fallback. A 252-pack sample is too small to estimate Mega Hyper Rare precisely. Stadium pairing is a product rule; pair frequency remains a uniform-uncommon model, not a measured statistic.
- Shrouded Fable uses adjacent English ACE SPEC-era estimates. Battle Styles, Chilling Reign, Fusion Strike and Brilliant Stars combine available measured tiers with labeled base-tier/era assumptions where data are incomplete. Chilling Reign's original chart was not directly retrievable; its community-reported rounded rates have lower confidence.
- God-pack frequency is not publicly established here. The provisional frequency is 1/2,000; Prismatic's full/demi split is also provisional. Calibration preserves aggregate rarity targets under that assumption; it does not prove the physical frequency or every individual card's rate.
- Black Bolt/White Flare's 700-pack study observed no Black White Rare. Zero observed does not mean impossible. The total provisional Black White/Victini rate is 0.1%, split equally. This is explicitly a fallback, not a measured point estimate. RGB Rare is similarly provisional.
- Unless a card-specific distribution is configured (Celebrations), cards are sampled uniformly within their internal bucket. Minor print-sheet variations and box correlations are not modeled. Parallel foil finishes are not separate saved card identities. Real-world estimates have sampling and product/print-run uncertainty.

## Research starting points

Individual links and sample sizes are in the evidence matrix and source configuration.

- [English Pokémon Card Rarity Guide](https://www.elitefourum.com/t/the-english-pokemon-card-rarity-guide/39762): per-set video/print-sheet models, special slots, product inserts.
- [Sun & Moon / Sword & Shield opening dataset](https://www.elitefourum.com/t/pull-rates-in-sun-moon-sword-shield-sets/25220): first-hand community aggregates.
- [Celebrations counted openings](https://www.digitaltq.com/celebrations-booster-pull-rates-pokemon-tcg): 541 packs and individual card counts.
- [Battle Styles opening spreadsheet](https://docs.google.com/spreadsheets/d/1sR4kDFZMMrz2eIJMky1f8_ljho5pMMgfcbB2tYG9ov4/edit): reported denominator 20,195 packs; chase-tier counts.
- [Official Delta Reign announcement](https://press.pokemon.com/en-CA/releases/MEDIA-ALERT-New-Pokemon-Trading-Card-Game-Mega-EvolutionDelta-Reign-Ex): six standard ex, four Mega ex, three paired Stadiums.
- TCGplayer individual opening studies (linked per set): modern English rarity frequencies. Where the page was not readable directly, cached text/infographics and attributed reproductions were cross-checked; these are not independent extra samples.

## Validation and release status

- Public-generator mixture check: **50,000 packs, 29 automatically selected God packs, zero structural or frequency errors** across all five supported sets.
- Final full suite: **737 tests, 699 passed, 36 failed, 2 skipped**. Clean baseline: **728 tests, 690 passed, the same 36 failed, 2 skipped**. No new failing test names. Nine added tests pass.
- Web and mobile web builds pass; production checks verify **165 routes and 141 sitemap URLs**. No Capacitor sync or native project overwrite was performed.
- Generated achievement catalog is current for all 131 sets.
- The source/card integrity audit retains its two pre-existing missing-source-manifest failures for `30th-celebration` and `delta-reign`. Their source identities have not been fabricated to make the audit green. The separately pinned 129-set checks pass their identity, slot, scanner and pricing checks.

**This is a reviewable pull-rate patch, not an assertion that the entire repository has a clean production gate.** The existing 36 failures and two source-manifest gaps remain release-review items. Do not treat the audit JSON as a replacement for resolving those gates.

To reproduce:

```sh
npm run test:effective-pull-rates
npm run audit:effective-pull-rates
node scripts/audit-effective-pull-rates.mjs --sets=delta-reign --packs=50000 --output=audits/pull-rates/delta-reign-50000.json
node scripts/audit-god-pack-effective-rates.mjs
node scripts/build-achievement-set-catalog.mjs --check
node scripts/audit-card-pull-integrity.mjs
node --test tests/*.test.mjs
npm run build
```

Deploy the shared source build and the updated `check-achievements` function together when the release is approved. There is no SQL migration. Rebuild the iOS web bundle from the same source for the next native release; preserve the prepared native project and signing settings. Nothing in this patch deploys automatically or schedules ongoing monitoring.
