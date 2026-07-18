import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { MAX_RECENT_EXPLORE_ITEMS, normalizeRecentExploreRefs, prependRecentExploreRef } from "../mobile-app/src/explore/recentExploreHistory.js";

test("recent Explore history is newest-first, deduplicated, typed, and capped", () => {
  const items = [
    { kind: "pokemon", id: 492 },
    { kind: "set", id: "pitch-black" },
    { kind: "pokemon", id: 492 },
    { kind: "era", id: "mega-evolution" },
    ...Array.from({ length: 10 }, (_, index) => ({ kind: "pokemon", id: index + 1 })),
    { kind: "card", id: "ignored" },
  ];
  const normalized = normalizeRecentExploreRefs(items);
  assert.equal(normalized.length, MAX_RECENT_EXPLORE_ITEMS);
  assert.deepEqual(normalized.slice(0, 3), [{ kind: "pokemon", id: 492 }, { kind: "set", id: "pitch-black" }, { kind: "era", id: "mega-evolution" }]);
  assert.equal(normalized.filter((item) => item.kind === "pokemon" && item.id === 492).length, 1);
  assert.deepEqual(prependRecentExploreRef(normalized, { kind: "set", id: "pitch-black" })[0], { kind: "set", id: "pitch-black" });
});

test("Explore Home removes Continue Exploring and empty Search owns recent history", async () => {
  const source = await readFile(new URL("../mobile-app/src/explore/ExploreScreen.jsx", import.meta.url), "utf8");
  const home = source.match(/function ExploreHome[\s\S]*?function SearchPage/)?.[0] || "";
  const search = source.match(/function SearchPage[\s\S]*?function PokemonBrowse/)?.[0] || "";
  assert.doesNotMatch(home, /Continue Exploring|Recently viewed on this device/);
  assert.match(search, /RecentExploreSearch/);
  assert.match(source, /Recently Viewed/);
  assert.match(source, /Search Pokémon, sets, eras, or cards\./);
  assert.match(source, /suppressSearchAutoFocusOnReturn/);
  assert.match(source, /exploreSearchAutoFocus !== false/);
  assert.doesNotMatch(source.match(/function RecentExploreSearch[\s\S]*?function RecommendationCard/)?.[0] || "", /supabase/i);
});

test("typing shows grouped results and clearing immediately restores recents", async () => {
  const source = await readFile(new URL("../mobile-app/src/explore/ExploreScreen.jsx", import.meta.url), "utf8");
  assert.match(source, /query\.trim\(\) \? <SearchGroups[\s\S]*: <RecentExploreSearch/);
  assert.match(source, /setQuery\(value\); navigate\(\{ kind: "search", query: value \}, true, \{ preserveScroll: true \}\)/);
});
