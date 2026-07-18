import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import pitchBlackCards from "../src/data/pitch-black.json" with { type: "json" };
import { NEWEST_SET_ID, sets } from "../src/data/sets.js";
import { PRICE_SET_MAP } from "../src/lib/priceSetMap.js";
import { getPriceSetAlias } from "../src/lib/priceSetAliases.js";
import { generatePack, getDisplayRarity, getRarityCategory } from "../src/utils/packGenerator.js";
import { getPullableCollectionCards, getSetCollectionProgress } from "../src/utils/collectionStorage.js";
import { getCardImageUrl, getSetLogoUrl } from "../src/utils/assetUrls.js";
import { loadAppPriceSyncData } from "../scripts/load-app-price-sync-data.mjs";
import {
  catalogCards,
  exploreEras,
  getSetGuide,
  getSpeciesCards,
  groupedExploreSearch,
  searchCollectionCatalog,
  setById,
} from "../mobile-app/src/explore/exploreData.js";
import { buildOpenRecommendations } from "../mobile-app/src/explore/recommendations.js";
import { getWishlistKey, resolveCatalogWishlistItem } from "../mobile-app/src/lib/wishlist.js";

const pitchBlack = sets.find((set) => set.id === "pitch-black");
const ordinary = new Set(["common", "uncommon", "rare"]);
const slot9 = new Set([...ordinary, "illustrationRare", "specialIllustrationRare"]);
const slot10 = new Set(["rare", "doubleRare", "megaDoubleRare", "ultraRare", "megaHyperRare"]);

function normalizeFilePart(value) {
  return String(value)
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[\\/]/g, "-")
    .replace(/[\u002a?\u0022<>]/g, "")
    .replace(/[:|]/g, "-")
    .trim()
    .replace(/\s+/g, "_");
}

test("Pitch Black compact catalog contains exactly the complete 120-card me5 set", () => {
  assert.ok(pitchBlack);
  assert.equal(pitchBlackCards.length, 120);
  assert.deepEqual([...new Set(pitchBlackCards.map((card) => card.number))], Array.from({ length: 120 }, (_, index) => String(index + 1)));
  assert.equal(new Set(pitchBlackCards.map((card) => card.id)).size, 120);
  assert.equal(new Set(pitchBlackCards.map((card) => card.image)).size, 120);
  assert.deepEqual(
    Object.fromEntries(Object.entries(Object.groupBy(pitchBlackCards, (card) => card.rarity)).map(([rarity, cards]) => [rarity, cards.length])),
    {
      Common: 37,
      Uncommon: 26,
      Rare: 11,
      "Double Rare": 10,
      "Illustration Rare": 11,
      "Ultra Rare": 18,
      "Special Illustration Rare": 6,
      "Mega Hyper Rare": 1,
    },
  );

  for (const card of pitchBlackCards) {
    assert.deepEqual(Object.keys(card), ["id", "name", "rarity", "number", "image"]);
    assert.match(card.id, new RegExp(`^pitch-black-${card.number}-`));
    const expected = `/assets/sets/pitch-black/cards/${Number(card.number)}_${normalizeFilePart(card.name)}_${normalizeFilePart(card.rarity)}.png`;
    assert.equal(card.image, expected);
    assert.equal(getCardImageUrl(card), `https://assets.pack-dex.com/sets/pitch-black/cards/${expected.split("/").at(-1)}`);
    assert.equal("isReverseHolo" in card, false);
    assert.equal("variant" in card, false);
  }

  const goldeen = pitchBlackCards.find((card) => card.number === "87");
  assert.equal(getRarityCategory(goldeen, pitchBlack), "illustrationRare");
  assert.equal(getDisplayRarity(goldeen, pitchBlack), "Illustration Rare");
});

test("Pitch Black is registered once, immediately after Chaos Rising, and is the sole New set", async () => {
  const index = sets.findIndex((set) => set.id === "pitch-black");
  assert.equal(sets.filter((set) => set.id === "pitch-black").length, 1);
  assert.equal(sets[index - 1]?.id, "chaos-rising");
  assert.equal(NEWEST_SET_ID, "pitch-black");
  assert.deepEqual(sets.filter((set) => set.isNew).map((set) => set.id), ["pitch-black"]);
  assert.equal(sets.find((set) => set.id === "chaos-rising")?.isNew, false);
  assert.equal(pitchBlack.name, "Pitch Black");
  assert.equal(pitchBlack.releaseDate, "2026-07-17");
  assert.equal(pitchBlack.printedTotal, 84);
  assert.equal(pitchBlack.total, 120);
  assert.equal(pitchBlack.era, "Mega Evolution");
  assert.equal(pitchBlack.pullRateProfile, "megaEvolutionStandard");
  assert.equal(pitchBlack.pokemonTcgApiSetId, "me5");
  assert.equal(getSetLogoUrl(pitchBlack), "/set-logos/pitch-black.png");
  await access(new URL("../public/set-logos/pitch-black.png", import.meta.url));
});

test("real Pitch Black packs open through the shared ten-card architecture", () => {
  for (let index = 0; index < 500; index += 1) {
    const pack = generatePack(pitchBlack);
    const categories = pack.map((card) => getRarityCategory(card, pitchBlack));
    assert.equal(pack.length, 10);
    assert.deepEqual(categories.slice(0, 4), ["common", "common", "common", "common"]);
    assert.deepEqual(categories.slice(4, 7), ["uncommon", "uncommon", "uncommon"]);
    assert.ok(ordinary.has(categories[7]), `slot 8 was ${categories[7]}`);
    assert.ok(slot9.has(categories[8]), `slot 9 was ${categories[8]}`);
    assert.ok(slot10.has(categories[9]), `slot 10 was ${categories[9]}`);
  }
});

test("Collection, complete search, wishlist, and card detail data discover all Pitch Black cards", () => {
  assert.equal(getPullableCollectionCards(pitchBlack).length, 120);
  assert.deepEqual(getSetCollectionProgress({}, pitchBlack), { collected: 0, total: 120, percent: 0 });
  assert.equal(searchCollectionCatalog("Pitch Black", 200).filter((entry) => entry.set.id === "pitch-black").length, 120);
  assert.ok(searchCollectionCatalog("Mega Darkrai ex").some((entry) => entry.set.id === "pitch-black" && entry.card.number === "120"));
  assert.ok(searchCollectionCatalog("Mega Hyper Rare").some((entry) => entry.set.id === "pitch-black" && entry.card.number === "120"));
  assert.ok(searchCollectionCatalog("Gladions Final Battle").some((entry) => entry.set.id === "pitch-black" && entry.category === "Trainer"));
  assert.ok(searchCollectionCatalog("Shadowy Darkness Energy").some((entry) => entry.set.id === "pitch-black" && entry.category === "Energy"));

  const card = pitchBlackCards.at(-1);
  assert.equal(getWishlistKey(pitchBlack.id, card.id), `pitch-black:${card.id}`);
  const resolved = resolveCatalogWishlistItem(pitchBlack.id, card.id);
  assert.equal(resolved?.set.id, "pitch-black");
  assert.equal(resolved?.card.number, "120");
});

test("Explore places Pitch Black in Mega Evolution with editorial and Pokemon relationships", () => {
  assert.equal(setById.get("pitch-black"), pitchBlack);
  const megaEra = exploreEras.find((era) => era.name === "Mega Evolution");
  assert.equal(megaEra?.sets.at(-1)?.id, "pitch-black");
  assert.ok(groupedExploreSearch("Pitch Black").sets.some((set) => set.id === "pitch-black"));
  assert.equal(groupedExploreSearch("Gladions Final Battle").cards.length, 0);
  assert.ok(groupedExploreSearch("Mega Darkrai ex", 20).cards.some((entry) => entry.set.id === "pitch-black"));

  const guide = getSetGuide("pitch-black");
  assert.match(guide.summary, /released on July 17, 2026/);
  assert.match(guide.summary, /120 supported cards/);
  assert.deepEqual(guide.featuredPokemonIds, [491, 609, 807]);
  assert.equal(guide.contentStatus, "curated");

  const darkraiCards = getSpeciesCards(491).filter((entry) => entry.set.id === "pitch-black");
  assert.deepEqual(darkraiCards.map((entry) => entry.card.number), ["48", "101", "116", "120"]);
  assert.equal(catalogCards.filter((entry) => entry.set.id === "pitch-black").length, 120);
  assert.ok(catalogCards.filter((entry) => entry.set.id === "pitch-black").some((entry) => entry.speciesIds.includes(609)));
  assert.ok(catalogCards.filter((entry) => entry.set.id === "pitch-black").some((entry) => entry.speciesIds.includes(807)));
});

test("What Should I Open derives Pitch Black as the newest openable set without an exception", () => {
  for (const context of [{}, { collection: {}, wishlistEntries: [], viewedSetIds: [] }]) {
    const result = buildOpenRecommendations({ sets, ...context });
    assert.equal(result.primary?.category, "latest");
    assert.equal(result.primary?.setId, "pitch-black");
    assert.match(result.primary?.reason || "", /newest supported set/);
  }
});

test("price sync discovers me5 safely without a guessed marketplace slug", async () => {
  assert.deepEqual(getPriceSetAlias("pitch-black"), { pokemonTcgApiSetId: "me5" });
  assert.equal(PRICE_SET_MAP["pitch-black"], null);
  const priceSets = await loadAppPriceSyncData(process.cwd());
  const priceSet = priceSets.find((set) => set.id === "pitch-black");
  assert.equal(priceSet.apiSetId, "me5");
  assert.equal(priceSet.tcgplayerSetSlug, null);
  assert.equal(priceSet.cardCount, 120);
  assert.equal(priceSet.cardsWithPriceLookupInfo, 120);
  assert.equal(priceSet.canSync, true);
});

test("mobile surfaces use the shared registry for New state and generic set workflows", async () => {
  const [mobileSource, desktopSource] = await Promise.all([
    readFile(new URL("../mobile-app/src/App.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/App.jsx", import.meta.url), "utf8"),
  ]);
  assert.match(mobileSource, /set\.isNew && <small className="mobile-set-new-badge">New<\/small>/);
  assert.match(mobileSource, /const nextPack = generatePack\(selectedSet\)/);
  assert.match(mobileSource, /getSetCollectionProgress\(collection, selectedSet\)/);
  assert.match(mobileSource, /resolveCatalogWishlistItem/);
  assert.match(mobileSource, /runPostPackAchievementFlow[\s\S]*recordPackOpenEvent\(\{[\s\S]*setId: set\.id/);
  assert.match(mobileSource, /<SharePullButton[\s\S]*setId=\{selectedSet\.id\}/);
  assert.match(desktopSource, /href="\/mobile-app\/"/);
});
