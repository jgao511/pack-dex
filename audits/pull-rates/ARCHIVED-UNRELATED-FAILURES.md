# Historical diagnostics outside the pull-rate release scope

The user explicitly requested that unrelated historical work remain archived and that this release stay focused on pull rates and saving compatibility. The original tests and assertions remain intact; none were deleted, skipped, or weakened to produce a green release result.

`baseline-test-comparison.json` preserves the exact 36 failing names on both baseline and the initial patch. They are not 36 proven new production defects.

| Area | Failures | Diagnosis / separate follow-up |
|---|---:|---|
| Collection loading | 10 | Desktop loader ignores injected test-client options; tests assume a different paging contract. Existing snapshot/error handling also needs separate review. No collection loader change in this release. |
| Onboarding | 4 | July fixtures expire against the current clock. Use controlled clocks in a separate test maintenance change. |
| Scanner behavior/index | 12 | Expected private routes/actions differ; frozen index has 18,836 cards versus runtime 19,168. Do not re-enable a scanner or rebuild models in this release. |
| Build/native prerequisites | 5 | Missing synced iOS/Android output or scanner test pointed at public output. Do not overwrite native projects for this web release. |
| Pricing | 2 | August cache fixture rejected by real-clock seven-day freshness check; mobile helper expectation differs. No price-policy change. |
| Legal/reveal | 2 | Source assertions expect a different legal URL expression and reveal-haptic call. No UI change. |
| Legacy combined validator | 1 | Its frozen authoritative registry lacks 30th Celebration and Delta Reign; its test also hardcodes 129 sets. Strict provenance failure is preserved, not relabeled as verified. |

## Explicit validation boundary

The legacy combined validator mixes pack structure with pinned third-party card identity, scanner and pricing manifests. Its two missing set records remain a provenance limitation; this release does not invent official records. The release does not change any canonical card ID, number, rarity, name or image in either set. Their actual generated packs and their save payloads are tested alongside every other active set.

Use `npm run test:pull-rate-release` for the scoped regression gate, `npm run audit:effective-pull-rates` for all-set runtime outcomes, and `npm run audit:god-pack-rates` for the public-generator mixture audit. Account-save tests stay in the release gate because they directly protect this change's output contract. This boundary is not a claim that the archived whole-repository suite passes.
