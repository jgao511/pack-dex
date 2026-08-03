# Changed-slot realized-frequency release evidence

## Scope and method

- Baseline: `bc721bf` and pagination baseline `a423856` have the same pre-audit pack behavior for these categories.
- Corrected source under test: preserved card-integrity release worktree based on `a423856`.
- No application behavior was changed for this evidence pass. The only code artifact is `tests/changedSlotFrequency.test.mjs`.
- Compact fixtures isolate one physical slot at a time. Separate assertions prove that the production catalogs contain every expected card and that each card is eligible only in its intended slot.
- Simulations use a fixed 32-bit LCG seed. Acceptance is target ± six target-binomial standard deviations (`6σ`, two-sided normal-approximation confidence above 99.999999%). Exact configured-weight and slot assertions supplement the statistical checks.

## Baseline-to-corrected behavior

| Area | `a423856` / `bc721bf` behavior | Corrected behavior | Unrelated-rate effect |
| --- | --- | --- | --- |
| 27 Prism Stars | No positive Prism reverse-slot route; several cards were also normalized as ordinary Rare. | Six set-specific reverse-slot rates: 8.72%, 7.91%, 5.47%, 10.80%, 12.17%, 5.96%. | Final rare-slot weights are unchanged; reverse-slot normal weight absorbs the Prism rate. |
| 12 newly routed Radiants | Astral Radiance, Lost Origin, Silver Tempest, and Crown Zenith Radiants had 0% configured subset weight. | Reverse-slot rates 4.88%, 5.01%, 4.55%, and 4.55%. | Companion Gallery tiers also move from old simulator estimates to the source measurements shown below. Final rare slot is unchanged. |
| Three Shrouded Fable ACE SPEC cards | Classified as ACE SPEC but assigned 0%; unreachable. | First reverse slot at 5.00%. | Only first-reverse normal weight falls to 95%. |
| 12 Cosmic Eclipse character secrets | No character-subset identity. They competed with nine gold secrets in the 3% final Secret bucket: expected character 1.714%, gold 1.286%. | Character secrets use the reverse slot at 10%; gold secrets retain the final slot at 3%. | Gold-secret frequency rises because character cards no longer dilute that bucket; GX/full-art/rainbow weights do not move. |
| Shining Fates Shiny Vault | 104 baby + nine premium cards shared the 20.2% bucket; nine other premium cards used 8%. Expected aggregate baby 18.591%, premium 9.609%. | All 104 baby cards use 20.2%; all 18 SV105–SV122 premium cards use 8%. | Total subset probability remains 28.2%; only tier allocation changes. |
| Paldean Fates | First slot had one 12% shiny bucket (production mix implied 10.909% Shiny Rare and 1.091% Shiny Ultra). IR was 0%; SIR was about 2.041% in slot 9; HR remained in the final slot at about 1.042%; final DR/UR were about 18.750%/5.208%. | Independent slot targets: first reverse 25.44%/7.72%; second reverse 7.22%/1.72%/1.61%; final rare 15.89%/6.61%. | This is a deliberate source-profile replacement, so several companion rates move. |
| Ascended Heroes MAR/MHR | MAR was unreachable. MHR was 0.2% in the final slot. Second foil IR/SIR were 5%/2%; final DR/Mega DR/UR were 14%/12%/6%. | Slot 9 IR/SIR/MHR 11.25%/1.44%/0.19%; slot 10 DR/Mega DR/UR/MAR 13.58%/6.79%/4.81%/3.47%. | Companion rates deliberately move to the 2,000+ pack source sample. |
| Other Mega-series MHR | MHR was sampled in the final rare slot. | MHR is sampled in the second foil slot. Mega Evolution retains its established simulator target of 0.20%. | Mega Evolution IR/SIR/Mega DR/UR remain 6%/2%/18%/6%; only 0.2 points move from final MHR to second-foil MHR and final normal Rare. |
| Prismatic demi-god pack | Three cards were selected from the nine Eeveelution SIRs. | Three unique cards are selected from all 32 production SIRs. | Normal-pack rates and the full Eeveelution God Pack are unchanged. |

## Source targets

- Prism Stars and Cosmic Eclipse: [Elite Fourum English opening dataset](https://www.elitefourum.com/t/pull-rates-in-sun-moon-sword-shield-sets/25220). It reports the six Prism rates above and Cosmic character secrets at 10.11% ± 1.06%; the simulator uses a rounded 10.00%.
- Shining Fates: the same dataset reports Shiny Rare 22.73% ± 1.76% and Shiny V/VMAX 8.96% ± 1.20%. The release preserves the older simulator targets 20.2% and 8.0% while repairing tier membership; this remaining tuning difference is explicit, not hidden by the test.
- Radiants: [Astral Radiance](https://www.tcgplayer.com/content/article/Pok%C3%A9mon-TCG-Astral-Radiance-Pull-Rates/10da749f-9c8b-45c0-b80a-dbd86ca5dcde/), [Lost Origin](https://www.tcgplayer.com/content/article/Pok%C3%A9mon-TCG-Lost-Origin-Pull-Rates/ba20ac4d-9448-45ce-b919-d856d107c744/), [Silver Tempest](https://www.tcgplayer.com/content/article/Pok%C3%A9mon-TCG-Silver-Tempest-Pull-Rates/6490d591-e582-4930-8446-00e190876d30/), and [Crown Zenith](https://www.tcgplayer.com/content/article/Pok%C3%A9mon-TCG-Crown-Zenith-Pull-Rates/56af3032-cb34-4da1-92fb-9cf206d10c0f/).
- Shrouded Fable ACE SPEC: [1,000+ pack community sample](https://pokepatch.com/2025/05/24/shrouded-fable-pull-rates-in-pokemon-tcg-set/) reports 5%, or 1 in 20 packs.
- Paldean Fates: [TCGplayer 1,500+ pack sample](https://www.tcgplayer.com/content/article/Pok%C3%A9mon-TCG-Paldean-Fates-Pull-Rates/23de3e93-0d0f-4ae0-abc4-13664f3001a3/) reports the seven configured rates and their physical slots.
- Ascended Heroes: [TCGplayer 2,000+ pack sample](https://www.tcgplayer.com/content/article/Pok%C3%A9mon-TCG-Ascended-Heroes-Pull-Rates/60143d94-88a7-42ce-8e73-babd7b3fabd6/) reports DR 20.37%, UR 4.81%, MAR 3.47%, IR 11.25%, SIR 1.44%, and MHR 0.19%.
- Prismatic: [TCGplayer](https://www.tcgplayer.com/content/article/Pok%C3%A9mon-TCG-Prismatic-Evolutions-Pull-Rates/d94889ea-f76a-4a13-b74d-5b0b071220a7/) states that a demi-god pack may contain any three SIRs in the set.
- Mega Evolution: [TCGplayer's 5,000+ pack sample](https://www.tcgplayer.com/content/article/Pok%C3%A9mon-TCG-Mega-Evolution-Pull-Rates/40cbeedc-21ce-473b-aef1-74e3969d9f91/) reports MHR 0.08% ± 0.08%. The release preserves the pre-existing 0.20% simulator tuning while moving the card to the correct slot. That point-rate mismatch remains a separately disclosed tuning uncertainty.

## Final seeded results

| Fixture outcome | Target | Realized | Error | 6σ bound |
| --- | ---: | ---: | ---: | ---: |
| Ultra Prism Prism | 8.720% | 8.680% | -0.040 pp | ±1.382 pp |
| Forbidden Light Prism | 7.910% | 7.987% | +0.077 pp | ±1.322 pp |
| Celestial Storm Prism | 5.470% | 5.613% | +0.143 pp | ±1.114 pp |
| Dragon Majesty Prism | 10.800% | 11.007% | +0.207 pp | ±1.521 pp |
| Lost Thunder Prism | 12.170% | 11.893% | -0.277 pp | ±1.602 pp |
| Team Up Prism | 5.960% | 5.787% | -0.173 pp | ±1.160 pp |
| Astral Radiance Radiant / Gallery | 4.880% / 12.580% | 4.747% / 12.187% | -0.133 / -0.393 pp | ±1.055 / ±1.625 pp |
| Lost Origin Radiant / Gallery | 5.010% / 12.310% | 4.733% / 12.027% | -0.277 / -0.283 pp | ±1.069 / ±1.610 pp |
| Silver Tempest Radiant / Gallery | 4.550% / 12.230% | 4.560% / 12.000% | +0.010 / -0.230 pp | ±1.021 / ±1.605 pp |
| Crown Zenith Radiant / regular / premium / gold gallery | 4.550% / 22.400% / 12.000% / 0.800% | 4.587% / 22.473% / 11.640% / 0.687% | +0.037 / +0.073 / -0.360 / -0.113 pp | ±1.021 / ±2.042 / ±1.592 / ±0.436 pp |
| Shrouded Fable ACE SPEC | 5.000% | 5.333% | +0.333 pp | ±1.068 pp |
| Cosmic character / gold secret | 10.000% / 3.000% | 9.920% / 2.947% | -0.080 / -0.053 pp | ±1.470 / ±0.836 pp |
| Shining Fates baby / premium shiny | 20.200% / 8.000% | 20.300% / 7.920% | +0.100 / -0.080 pp | ±1.967 / ±1.329 pp |
| Paldean SR / SUR / IR / SIR / HR / DR / UR | 25.440 / 7.720 / 7.220 / 1.720 / 1.610 / 15.890 / 6.610% | 26.233 / 7.607 / 7.067 / 1.753 / 1.687 / 15.973 / 6.387% | +0.793 / -0.113 / -0.153 / +0.033 / +0.077 / +0.083 / -0.223 pp | all within ±0.617–2.134 pp |
| Ascended IR / SIR / MHR / DR / Mega DR / UR / MAR | 11.250 / 1.440 / 0.190 / 13.580 / 6.790 / 4.810 / 3.470% | 11.456 / 1.420 / 0.196 / 13.552 / 6.724 / 4.584 / 3.408% | +0.206 / -0.020 / +0.006 / -0.028 / -0.066 / -0.226 / -0.062 pp | all within ±0.165–1.300 pp |
| Mega Evolution IR / SIR / MHR / Mega DR / UR | 6.000 / 2.000 / 0.200 / 18.000 / 6.000% | 6.148 / 2.032 / 0.220 / 18.428 / 5.844% | +0.148 / +0.032 / +0.020 / +0.428 / -0.156 pp | all within ±0.170–1.458 pp |

Subset, Paldean, and Cosmic fixtures use 15,000 trials; Ascended Heroes and Mega Evolution use 25,000. The forced Prismatic test generated 256 seeded demi-god packs (768 SIR draws), observed all 32 production SIR IDs, and found no duplicate within a pack.

## Production-catalog gate and result

- Exactly 27 Prism Stars, 12 newly routed Radiants, three Shrouded Fable ACE SPEC cards, 12 Cosmic character secrets, 104/18 Shining Fates tiers, three Paldean Fates IRs, 12 Paldean Shiny Ultra Rares, seven Ascended MARs, eight MHRs across six Mega sets, and 32 Prismatic SIRs were asserted.
- Every changed card is present in its production pool, allowed in its intended physical slot, and rejected from the competing slot.
- Command: `node --test tests/changedSlotFrequency.test.mjs`
- Result: **7 tests passed, 0 failed**, 53.4 seconds on the audit workstation.
- Node emitted only the repository's existing typeless-package warning.
