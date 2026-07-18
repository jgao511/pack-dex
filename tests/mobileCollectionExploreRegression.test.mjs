import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { calculateValueCoverage } from "../src/lib/priceCoverage.js";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("Binder renders valid set slots and has a recovery state without crashing", async () => {
  const app = await read("../mobile-app/src/App.jsx");
  assert.match(app, /getPullableCollectionCards\(set\)\.map\(\(card\) => \(\{ set, card \}\)\)/);
  assert.match(app, /This binder has no available cards/);
  assert.match(app, /onClick=\{\(\) => item\?\.card && onInspectCard/);
  const binders = app.match(/function CollectionBinders\([\s\S]*?\n\}/)?.[0] || "";
  assert.doesNotMatch(binders, /\{ownedShimmer && isRarePlusVisual\(card, set\)/);
});

test("Collection Value loads from its current parent tab and always renders numeric zero", async () => {
  const app = await read("../mobile-app/src/App.jsx");
  assert.match(app, /activeTab !== "collection" && activeTab !== "value" && activeTab !== "profile"/);
  assert.match(app, /isValueLoading \? <strong>Loading\.\.\.<\/strong> : <strong>\{formatUsd\(valueCoverage\.totalValue\)\}<\/strong>/);
  assert.deepEqual(calculateValueCoverage([{ count: 3 }], () => 2), { totalValue: 6, pricedCards: 1, totalCards: 1, isComplete: true });
  assert.deepEqual(calculateValueCoverage([{ count: 1, price: 2 }, { count: 4 }], (item) => item.price), { totalValue: 2, pricedCards: 1, totalCards: 2, isComplete: false });
});

test("Card details derive contextual actions and count-based centering", async () => {
  const [app, css] = await Promise.all([read("../mobile-app/src/App.jsx"), read("../mobile-app/src/App.css")]);
  assert.match(app, /getCardDetailActionVisibility\(inspectOrigin/);
  assert.match(app, /contextualActions\.length > 0/);
  assert.match(app, /getCardActionLayoutClass\(contextualActions\.length\)/);
  assert.match(css, /\.inspect-explore-links\.has-1-actions \{[^}]*justify-content:\s*center/);
  assert.match(css, /\.inspect-explore-links\.has-3-actions > :last-child/);
});

test("Binder naming uses an iOS-safe input size", async () => {
  const css = await read("../mobile-app/src/App.css");
  assert.match(css, /\.custom-binder-form input \{[^}]*font-size:\s*16px/);
});

test("Collection card to Pokémon keeps the card modal mounted for one-step Back", async () => {
  const app = await read("../mobile-app/src/App.jsx");
  assert.match(app, /function openCardDestination\(route\)[\s\S]*packdexCardReturn:\s*true[\s\S]*packdexCardDestination:\s*true[\s\S]*setCardDestinationOverlay\(true\)/);
  assert.match(app, /cardDestinationOverlay && \([\s\S]*<ExploreScreen/);
  assert.match(app, /!cardDestinationOverlay && <CardInspectModal/);
  assert.match(app, /if \(!window\.history\.state\?\.packdexCardDestination\) setCardDestinationOverlay\(false\)/);
});

test("Explore search has one scroll surface, clear and back controls, and no offline helper copy", async () => {
  const [screen, css] = await Promise.all([read("../mobile-app/src/explore/ExploreScreen.jsx"), read("../mobile-app/src/explore/ExploreScreen.css")]);
  assert.doesNotMatch(screen, /Results are searched locally, even when account data is offline/);
  assert.match(screen, /aria-label="Clear search"/);
  assert.match(screen, /PageHeader title="Search" onBack=\{goBack\}/);
  assert.doesNotMatch(css, /\.explore-live-results \{[^}]*overflow-y:\s*auto/);
  assert.match(css, /\.explore-search input \{[^}]*font-size:\s*16px/);
  assert.match(css, /\.explore-back \{[^}]*place-items:\s*center/);
  assert.match(css, /\.explore-back::before \{/);
});

test("Set and Era Featured Pokémon omit global collection progress", async () => {
  const screen = await read("../mobile-app/src/explore/ExploreScreen.jsx");
  const matches = screen.match(/is-set-featured[^\n]*showProgress=\{false\}/g) || [];
  assert.equal(matches.length, 2);
  assert.match(screen, /aria-label=\{showProgress \?[^:]+: `View \$\{species\.displayName\}`\}/);
});

test("Surprise Me selects a detail card and Daily Fact lives in Spotlight", async () => {
  const screen = await read("../mobile-app/src/explore/ExploreScreen.jsx");
  assert.match(screen, /onClick=\{\(\) => setSurpriseRecommendation\(recommendations\.surprise\)\}/);
  assert.doesNotMatch(screen, /else onOpenPack\(setById\.get\(recommendations\.surprise\.setId\)\)/);
  const spotlight = screen.match(/<div className="explore-spotlights">[\s\S]*?<\/div><\/section>/)?.[0] || "";
  assert.match(spotlight, />Fun Fact</);
  assert.match(spotlight, /PokemonTile[\s\S]*contextLine=/);
  assert.match(spotlight, /SetTile[\s\S]*contextLine=/);
  assert.match(spotlight, /EraTile[\s\S]*contextLine=/);
  assert.match(spotlight, /featureLabel="Featured Pokémon"/);
  assert.match(spotlight, /featureLabel="Featured Set"/);
  assert.match(spotlight, /featureLabel="Featured Era"/);

  const styles = await read("../mobile-app/src/explore/ExploreScreen.css");
  assert.match(styles, /\.explore-spotlights \.explore-tile-copy \{[^}]*align-items: flex-start;[^}]*text-align: left;/);
  assert.match(styles, /\.explore-spotlights \.explore-types \{ justify-content: flex-start; \}/);
});

test("Pokémon price highlight remains mounted through loading and failure", async () => {
  const [screen, css] = await Promise.all([read("../mobile-app/src/explore/ExploreScreen.jsx"), read("../mobile-app/src/explore/ExploreScreen.css")]);
  assert.match(screen, /function PriceHighlight/);
  assert.match(screen, /Checking card prices…/);
  assert.match(screen, /Checking latest price…/);
  assert.match(screen, /Some prices could not be checked\./);
  assert.match(screen, /Couldn’t check the latest prices\./);
  assert.doesNotMatch(screen.match(/function PriceHighlight[\s\S]*?function PokemonDetail/)?.[0] || "", /\$0\.00|NaN|undefined/);
  assert.match(css, /\.price-highlight-card\.is-loading/);
  assert.match(css, /prefers-reduced-motion[\s\S]*price-highlight-card\.is-loading/);
});
