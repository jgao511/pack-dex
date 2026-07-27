# Mobile onboarding: local testing

The version 1 onboarding is part of the mobile app only. It does not change the
desktop `/welcome` route.

## Start the mobile app

From the repository root:

```bash
npm install
npm --prefix mobile-app install
npm --prefix mobile-app run dev
```

Open:

```text
http://127.0.0.1:5174/mobile-app/dev/onboarding
```

The development route forces onboarding without deleting collection, account,
or unrelated browser data. In any build, Profile → Settings → Replay
Onboarding resets only the device onboarding version and resumable tutorial
state.

The equivalent development query is:

```text
http://127.0.0.1:5174/mobile-app/?onboardingTest=1
```

The route and query override are compiled out of production behavior.

## Refinement-pass visual scenarios

Append these development-only parameters to `/mobile-app/dev/onboarding` (or
`/mobile-app/?onboardingTest=1`) to start at a specific real onboarding view:

```text
?onboardingStep=welcome
?onboardingStep=choose-set
?onboardingStep=summary
?onboardingStep=collection
?onboardingStep=pokemon
?onboardingStep=explore&tourStep=1
?onboardingStep=explore&tourStep=2
?onboardingStep=explore&tourStep=3
?onboardingStep=final
```

These are the exact local routes used for the final walkthrough:

```text
/mobile-app/dev/onboarding?onboardingStep=welcome
/mobile-app/dev/onboarding?onboardingStep=summary
/mobile-app/dev/onboarding?onboardingStep=collection
/mobile-app/dev/onboarding?onboardingStep=pokemon
/mobile-app/dev/onboarding?onboardingStep=pokemon&slowImages=1
/mobile-app/dev/onboarding?onboardingStep=explore&tourStep=1
/mobile-app/dev/onboarding?onboardingStep=explore&tourStep=2
/mobile-app/dev/onboarding?onboardingStep=explore&tourStep=3
/mobile-app/dev/onboarding?onboardingStep=final
/mobile-app/dev/onboarding?onboardingStep=final&stats=loading
/mobile-app/dev/onboarding?onboardingStep=final&stats=failure
/mobile-app/dev/onboarding?onboardingStep=final&stats=real
/mobile-app/dev/onboarding?onboardingStep=final&statsPreview=1
/mobile-app/dev/onboarding?onboardingStep=final&statsPreview=1&statSlide=cards
/mobile-app/dev/onboarding?onboardingStep=final&reducedMotion=1
/mobile-app/dev/onboarding?onboardingStep=final&shortViewport=1
/mobile-app/dev/onboarding?onboardingStep=summary&cardPreview=1
/mobile-app/dev/onboarding?onboardingStep=collection&cardPreview=1
/mobile-app/dev/onboarding?onboardingStep=explore&prices=empty
/mobile-app/dev/onboarding?onboardingStep=explore&prices=populated
/mobile-app/explore/pokemon/6
```

`summary` and `final` are development aliases for the shared pack summary and
community screen. Every route uses the same scroll-reset path as a real
onboarding transition. The Explore tour has exactly three steps: Pokémon
information, the complete card catalog, and Appears In / sets.

The following scenarios are visual-only and are removed from production builds:

```text
?prices=empty
?prices=populated
?prices=slow
?stats=empty
?stats=failure
?stats=loading
?stats=real
?reducedMotion=1
?cardPreview=1
?shortViewport=1
?slowImages=1
?statSlide=packs|cards|popular
```

For example, use
`http://127.0.0.1:5174/mobile-app/dev/onboarding?onboardingStep=explore&prices=slow`
to verify the live Explore walkthrough and its loading price state. `prices`
does not write a price record or alter the shared cache; it only controls the
onboarding preview surface.

## Reward previews

Append one of these development-only query values while signed in, then open
Profile:

```text
?rewardState=0
?rewardState=49
?rewardState=50
?rewardState=claimed
```

These values change presentation only. They do not write pack events and do not
bypass the production claim function's server-side 50-pack check.

`statsPreview=1` is the only way to intentionally show mock community data. It
does not call the public-stat loader. Without that flag, including on the
development route, onboarding uses the same `getPublicPackDexStats` loader,
cache key, RPC fields, and formatter as `/welcome`; a failed load temporarily
hides the unavailable statistic while preserving the statistic area's height.
Production never renders preview data.

`stats=loading` holds the compact skeleton, while `stats=failure` exercises the
reserved empty statistic layout. `stats=real` uses the shared public-stat loader.
`statSlide` pins one preview slide for screenshot QA and has no effect on the
values; preview values still require the explicit `statsPreview=1` flag.
`cardPreview=1` opens the shared card-detail modal in its tutorial-only minimal
mode. `shortViewport=1` constrains the final page to the short-device fallback
height without affecting production.
`slowImages=1` delays only development onboarding image sources. Use it on the
Pokémon-selection or final route to confirm that the header and text enter
immediately, card placeholders retain their full footprint, and late images do
not collapse or delay the surrounding page. `/mobile-app/explore/pokemon/6`
is the normal, non-tour Appears In interaction route once local onboarding has
been completed.

For a true responsive check, set the browser viewport rather than relying only
on `shortViewport=1`: Pixel 6a is 412 × 915 CSS pixels, the standard modern
iPhone check is 390 × 844, and the larger iPhone check is 430 × 932.

## Final iconic-card conveyor

The final row uses only IDs resolved from the local `sets` catalog and the same
supported image URL helper as card details. The order intentionally alternates
dominant colors and frame styles so adjacent cards do not read as one repeated
block.

| Card ID | Card | Set | Era | Inclusion reason |
| --- | --- | --- | --- | --- |
| `base1-4` | Charizard | Base Set | Wizards Vintage | The defining early TCG silhouette and orange/yellow-border anchor. |
| `paldean-fates-232-mew-ex` | Mew ex | Paldean Fates | Scarlet & Violet | Playful modern full-art color and an instantly recognizable Mythical Pokémon. |
| `neo1-9` | Lugia | Neo Genesis | Neo | A landmark Johto-era holo with a cool blue break after Mew. |
| `paldea-evolved-203-magikarp` | Magikarp | Paldea Evolved | Scarlet & Violet | Highly expressive illustration art and a familiar underdog Pokémon. |
| `ex8-107` | Rayquaza ★ | EX Deoxys | EX | Gold Star-era prestige, strong green silhouette, and the required Rayquaza representation. |
| `151-200-blastoise-ex` | Blastoise ex | 151 | Scarlet & Violet | Modern treatment of a nostalgic Kanto starter with strong blue contrast. |
| `pl4-94` | Arceus LV.X | Platinum—Arceus | Platinum | Preserves the distinctive LV.X frame and a major Sinnoh-era icon. |
| `team-up-164-gengar-mimikyu-gx` | Gengar & Mimikyu-GX | Team Up | Sun & Moon | Beloved Tag Team pairing and a dramatic purple composition. |
| `bw8-136` | Charizard | Black & White—Plasma Storm | Black & White | A second, visually distinct Charizard that represents the secret-rare Black & White style. |
| `evolving-skies-191-dragonite-v` | Dragonite V | Evolving Skies | Sword & Shield | Calm alternate-art scene and a softer sky-blue transition. |
| `xy7-98-m_rayquaza-ex` | M Rayquaza-EX | XY—Ancient Origins | XY | Energetic Mega Evolution artwork and a second, clearly different Rayquaza composition. |
| `lost-origin-186-giratina-v` | Giratina V | Lost Origin | Sword & Shield | One of the era’s most recognizable alternate-art compositions and strong dark geometry. |
| `surging-sparks-238-pikachu-ex` | Pikachu ex | Surging Sparks | Scarlet & Violet | Modern Pikachu centerpiece with a bright late-row color lift. |
| `prismatic-evolutions-161-umbreon-ex` | Umbreon ex | Prismatic Evolutions | Scarlet & Violet | A single Eeveelution anchor with moonlit contrast and current-era appeal. |
| `twilight-masquerade-214-greninja-ex` | Greninja ex | Twilight Masquerade | Scarlet & Violet | Distinct blue/orange action art and broad modern recognizability. |
| `base1-58` | Pikachu | Base Set | Wizards Vintage | Closes the loop with the original yellow-border mascot and guarantees an early-era Pikachu. |

This selection spans nine named catalog eras, contains two Charizard cards and
one Eeveelution card, and mixes vintage yellow borders, LV.X, EX/GX, alternate
art, and current illustration treatments.

## Account and guest cases

- Signed out: use the forced route and choose Continue as guest.
- New account: use Create Account on the last screen. If email confirmation is
  enabled, the tutorial remains local and resumes after the verified login.
- Existing account: sign in on the last screen, or begin while already signed
  in. Account onboarding version 1 prevents a second tutorial grant.
- Guest-to-account: a completed guest tutorial pack remains in a dedicated
  pending record and migrates once on a later authenticated session.
- First-time mobile root visits are routed directly to `/mobile-app/`, where
  the versioned completion guard decides whether to show onboarding. Explicit
  `/welcome` and desktop root behavior remain unchanged.

## Pack audio policy

Pack-opening audio is disabled across desktop, mobile, onboarding, normal and
Welcome Reward God Packs. Reveal timers schedule visual state and haptics only;
they never enqueue an audio callback. The saved Sound Effects preference remains
compatible with the unrelated achievement notification and future UI audio.

## Build checks

```bash
npm --prefix mobile-app run build
npm --prefix mobile-app run build:native
node --test tests/mobileOnboarding.test.mjs tests/welcomeRewardEligibility.test.mjs tests/publicPackDexStats.test.mjs tests/mobileCollectionDurability.test.mjs
git diff --check
```

For an Android native compile after the Capacitor sync:

```bash
npm --prefix mobile-app run cap:sync:android
mobile-app\android\gradlew.bat assembleDebug
```

## Backend setup

Apply `supabase/migrations/20260726120000_mobile_onboarding_and_welcome_reward.sql`
and deploy the `complete-mobile-onboarding` and updated
`claim-welcome-god-pack` Edge Functions before testing authenticated tutorial
migration or reward claims against a remote project. Production changes must be
performed only as part of an explicitly authorized release.
