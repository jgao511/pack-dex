import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  filterBinderSets,
  filterOwnedBinderCards,
  getOwnedBinderCards,
  matchesBinderEra,
  sortBinderRarities,
  sortSetsByRelease,
} from "../mobile-app/src/utils/binderCatalog.js";
import {
  addCardsToBinder,
  createBinder,
  getBinderCardKey,
  replaceBinderCards,
} from "../src/utils/binderStorage.js";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const sets = [
  {
    id: "old",
    name: "Ancient Cards",
    code: "OLD1",
    era: "Older",
    releaseDate: "1999-01-09",
    cards: [{ id: "old-1", number: "1", name: "Old One", rarity: "Rare" }],
  },
  {
    id: "sv",
    name: "Future Cards",
    code: "SV9",
    era: "Scarlet & Violet",
    releaseDate: "2025-03-28",
    cards: [
      { id: "sv-1", number: "1", name: "Alpha", rarity: "Common" },
      { id: "sv-2", number: "2", name: "Beta", rarity: "Ultra Rare" },
    ],
  },
];
const collection = {
  sv: {
    "sv-1": { count: 2, firstCollectedAt: 10, lastCollectedAt: 20 },
    "sv-2": { count: 1, firstCollectedAt: 30, lastCollectedAt: 40 },
  },
};
const getCards = (set) => set.cards;
const getCount = (owned, card, setId) => owned?.[setId]?.[card.id]?.count || 0;

test("master-set catalog defaults newest-first and searches metadata immediately", () => {
  assert.deepEqual(sortSetsByRelease(sets).map((set) => set.id), ["sv", "old"]);
  assert.deepEqual(filterBinderSets(sets, { query: "sv9" }).map((set) => set.id), ["sv"]);
  assert.deepEqual(filterBinderSets(sets, { query: "scarlet" }).map((set) => set.id), ["sv"]);
  assert.deepEqual(filterBinderSets(sets, { query: "Ancient" }).map((set) => set.id), ["old"]);
  assert.equal(matchesBinderEra(sets[1], "Scarlet & Violet"), true);
  assert.equal(matchesBinderEra(sets[1], "Sword & Shield"), false);
});

test("owned-card catalog excludes unowned cards and applies search, era, set, and rarity filters", () => {
  const owned = getOwnedBinderCards(sets, collection, getCards, getCount, getBinderCardKey);
  assert.equal(owned.length, 2);
  assert.equal(owned.some((item) => item.card.name === "Old One"), false);
  assert.deepEqual(filterOwnedBinderCards(owned, { query: "beta" }).map((item) => item.card.id), ["sv-2"]);
  assert.equal(filterOwnedBinderCards(owned, { era: "Sword & Shield" }).length, 0);
  assert.equal(filterOwnedBinderCards(owned, { setId: "old" }).length, 0);
  assert.deepEqual(filterOwnedBinderCards(owned, { rarity: "Ultra Rare" }).map((item) => item.card.id), ["sv-2"]);
  assert.deepEqual(filterOwnedBinderCards(owned, { sort: "recent" }).map((item) => item.card.id), ["sv-2", "sv-1"]);
  assert.deepEqual(filterOwnedBinderCards(owned, { sort: "rarity" }).map((item) => item.card.id), ["sv-2", "sv-1"]);
  assert.deepEqual(sortBinderRarities(owned), ["Ultra Rare", "Common"]);
});

test("multi-select adds owned cards once and preserves the no-duplicate binder model", () => {
  const binder = createBinder({ name: "Test Binder", tag: "Custom Binder" });
  const owned = getOwnedBinderCards(sets, collection, getCards, getCount, getBinderCardKey);
  const selections = owned.map(({ card, set }) => ({ card, setId: set.id }));
  const added = addCardsToBinder([binder], binder.id, [...selections, selections[0]], 50)[0];

  assert.equal(added.cards.length, 2);
  assert.deepEqual(added.cards.map((card) => card.order), [0, 1]);

  const unchanged = addCardsToBinder([added], binder.id, selections, 60)[0];
  assert.equal(unchanged.cards.length, 2);

  const reordered = replaceBinderCards([added], binder.id, [added.cards[1], added.cards[0], added.cards[1]], 70)[0];
  assert.deepEqual(reordered.cards.map((card) => card.key), [added.cards[1].key, added.cards[0].key]);
  assert.deepEqual(reordered.cards.map((card) => card.order), [0, 1]);
});

test("custom binder UI is continuous and all add entry points share the owned-card picker", async () => {
  const [app, picker, css] = await Promise.all([
    read("../mobile-app/src/App.jsx"),
    read("../mobile-app/src/components/BinderPickers.jsx"),
    read("../mobile-app/src/App.css"),
  ]);
  const customView = app.match(/function CustomBinderView[\s\S]*?function MasterSetBinderView/)?.[0] || "";

  assert.match(customView, /Your binder is empty/);
  assert.match(customView, /custom-binder-grid/);
  assert.doesNotMatch(customView, /Page \{pageIndex/);
  assert.doesNotMatch(customView, /More binder options|•••/);
  assert.equal((customView.match(/setPickerOpen\(true\)/g) || []).length >= 3, true);
  assert.match(customView, /<OwnedCardPicker/);
  assert.match(customView, /onReplaceCards\(binder\.id, draftCards\)/);
  assert.doesNotMatch(app, /binder\.name\?\.slice\(0, 2\)/);
  assert.match(app, /set && \([\s\S]*?<SetLogo set=\{set\} className="binder-logo" \/>/);
  assert.match(picker, /Search cards you own…/);
  assert.match(picker, /All rarities/);
  assert.match(picker, /Recently pulled/);
  assert.match(picker, /OWNED_CARD_PAGE_SIZE = 48/);
  assert.match(picker, /Load More/);
  assert.doesNotMatch(picker, /autoFocus/);
  assert.match(picker, /selectedKeys/);
  assert.doesNotMatch(picker, /Favorite/);
  assert.match(customView, /custom-binder-remove-card[\s\S]*?>×<\/button>/);
  assert.match(css, /\.custom-binder-grid \{[\s\S]*grid-template-columns:\s*repeat\(3/);
  assert.match(css, /\.screen-content \{[\s\S]*var\(--bottom-nav-height\)/);
  assert.match(css, /\.owned-card-picker-footer \{/);
});

test("master-set binders retain nine-slot pages, swipe paging, identity-rich missing cards, and set order", async () => {
  const [app, css] = await Promise.all([
    read("../mobile-app/src/App.jsx"),
    read("../mobile-app/src/App.css"),
  ]);
  const masterView = app.match(/function MasterSetBinderView[\s\S]*?function BinderPageView/)?.[0] || "";

  assert.match(app, /getPullableCollectionCards\(set\)\.map\(\(card\) => \(\{ set, card \}\)\)/);
  assert.match(masterView, /Array\.from\(\{ length: 9 \}\)/);
  assert.match(masterView, /onTouchEnd=\{finishSwipe\}/);
  assert.match(masterView, /Previous/);
  assert.match(masterView, /Next/);
  assert.match(masterView, /Page \{pageIndex \+ 1\} of \{totalPages\}/);
  assert.match(masterView, /#\{item\.card\.number/);
  assert.match(masterView, /getDisplayCardName\(item\.card, item\.set\)/);
  assert.match(masterView, />Missing</);
  assert.match(css, /\.master-binder-slot-mobile\.is-missing/);
  assert.doesNotMatch(css, /\.master-binder-page-mobile \{[^}]*background:\s*(?:#fff|white)/);
});

test("master-set importer keeps naming, color, and import controls around the shared searchable picker", async () => {
  const app = await read("../mobile-app/src/App.jsx");
  const binders = app.match(/function CollectionBinders[\s\S]*?function CollectionScreen/)?.[0] || "";

  assert.match(binders, /String\(right\.releaseDate \|\| ""\)\.localeCompare\(String\(left\.releaseDate/);
  assert.match(binders, /<SearchableSetPicker/);
  assert.match(binders, /value=\{importBinderName\}/);
  assert.match(binders, /BinderThemePicker value=\{importBinderTheme\}/);
  assert.match(binders, />Import Binder</);
  assert.match(binders, /onImportMasterSet\?\.\(selectedImportSet, name, importBinderTheme\)/);
});
