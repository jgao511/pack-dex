import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCanonicalCardLookup,
  buildMarketplaceRow,
  collectorNumbersDescribeSamePrinting,
  isCanonicalIdentityConsistent,
  matchCanonicalCard,
  normalizeCanonicalName,
  normalizeCollectorNumber,
  preserveCanonicalMarketplaceIdentity,
  selectTcgplayerPrice,
} from "../supabase/functions/_shared/cardPricing.js";

function apiCard(overrides = {}) {
  return {
    id: "set1-1",
    name: "Test Card",
    number: "1",
    rarity: "Common",
    set: { id: "set1" },
    tcgplayer: {
      url: "https://prices.pokemontcg.io/tcgplayer/set1-1",
      updatedAt: "2026/08/03",
      prices: { normal: { market: 1.25, low: 1, mid: 1.5, high: 2 } },
    },
    ...overrides,
  };
}

test("matches exact API card IDs before all fallback identities", () => {
  const exact = { id: "packdex-exact", name: "Wrong Display Name", number: "999", sourceSetId: "set1", sourceCardId: "set1-1" };
  const fallback = { id: "fallback", name: "Test Card", number: "1", sourceSetId: "set1", sourceCardId: "set1-other" };
  const result = matchCanonicalCard(apiCard(), buildCanonicalCardLookup([fallback, exact]));
  assert.equal(result.card, exact);
  assert.equal(result.matchType, "api_card_id");
});

test("matches set plus normalized number and canonical name", () => {
  const card = { id: "owner-card", name: "Rocket's Zapdos", number: "015/132", sourceSetId: "gym2" };
  const result = matchCanonicalCard(
    apiCard({ id: "gym2-15", name: "Rocket’s Zapdos", number: "15/132", set: { id: "gym2" } }),
    buildCanonicalCardLookup([card]),
  );
  assert.equal(result.card, card);
  assert.equal(result.matchType, "set_number_name");
});

test("uses collector number only when it is unique inside the exact API set", () => {
  const unique = { id: "unique", name: "Local Name", number: "7", sourceSetId: "set1" };
  const otherSet = { id: "other-set", name: "Other", number: "7", sourceSetId: "set2" };
  const result = matchCanonicalCard(apiCard({ id: "set1-7", name: "Upstream Name", number: "7" }), buildCanonicalCardLookup([unique, otherSet]));
  assert.equal(result.card, unique);
  assert.equal(result.matchType, "set_unique_number");
});

test("rejects ambiguous historical collector-number collisions", () => {
  const cards = [
    { id: "a", name: "Articuno", number: "H03", sourceSetId: "ecard3" },
    { id: "b", name: "Different Card", number: "H3", sourceSetId: "ecard3" },
  ];
  const result = matchCanonicalCard(apiCard({ id: "ecard3-unknown", name: "Unknown", number: "H3", set: { id: "ecard3" } }), buildCanonicalCardLookup(cards));
  assert.equal(result.card, null);
  assert.equal(result.ambiguous, true);
});

test("normalizes H numbers and subset prefixes without dropping meaningful prefixes", () => {
  assert.equal(normalizeCollectorNumber("H3/H32"), "h3/h32");
  assert.equal(normalizeCollectorNumber("H3"), "h3");
  assert.equal(normalizeCollectorNumber("SH07"), "sh7");
  assert.equal(normalizeCollectorNumber("SV041/SV094"), "sv41/sv94");
  assert.equal(normalizeCollectorNumber("TG01/TG30"), "tg1/tg30");
  assert.equal(normalizeCollectorNumber("SWSH001"), "swsh1");
  assert.notEqual(normalizeCollectorNumber("SH3"), normalizeCollectorNumber("SV3"));
});

test("collector-number identity allows an API numerator but never a different printing", () => {
  assert.equal(collectorNumbersDescribeSamePrinting("186/132", "186"), true);
  assert.equal(collectorNumbersDescribeSamePrinting("H3/H32", "H3"), true);
  assert.equal(collectorNumbersDescribeSamePrinting("17/132", "18"), false);
  assert.equal(collectorNumbersDescribeSamePrinting("1/10", "1/20"), false);
});

test("an exact source ID is blocked when its canonical name or number conflicts", () => {
  const consistent = { name: "Wally's Compassion", number: "186/132", sourceSetId: "me1", sourceCardId: "me1-186" };
  const upstream = apiCard({ id: "me1-186", name: "Wally's Compassion", number: "186", set: { id: "me1" } });
  assert.equal(isCanonicalIdentityConsistent(upstream, consistent), true);
  assert.equal(isCanonicalIdentityConsistent(upstream, { ...consistent, name: "Different Card" }), false);
  assert.equal(isCanonicalIdentityConsistent(upstream, { ...consistent, number: "185" }), false);
  assert.equal(isCanonicalIdentityConsistent({ ...upstream, tcgplayer: { url: "https://prices.pokemontcg.io/tcgplayer/me1-186" } }, {
    ...consistent,
    number: "185",
    verifiedTcgplayerUrl: "https://prices.pokemontcg.io/tcgplayer/me1-186",
    verifiedTcgplayerProductId: "654525",
  }), true);
  assert.equal(isCanonicalIdentityConsistent(upstream, { ...consistent, sourceSetId: "rsv10pt5" }), false);
});

test("Black Bolt Antique Cover Fossil keeps collector number 80 despite the provider's number 60 defect", () => {
  const url = "https://prices.pokemontcg.io/tcgplayer/zsv10pt5-80";
  const upstream = apiCard({
    id: "zsv10pt5-80",
    name: "Antique Cover Fossil",
    number: "60",
    set: { id: "zsv10pt5" },
    tcgplayer: { url, prices: { normal: { market: 0.08 } } },
  });
  const canonical = {
    id: "black-bolt-60-antique-cover-fossil",
    name: "Antique Cover Fossil",
    number: "80",
    sourceSetId: "zsv10pt5",
    sourceCardId: "zsv10pt5-80",
  };
  assert.equal(isCanonicalIdentityConsistent(upstream, canonical), false);
  assert.equal(isCanonicalIdentityConsistent(upstream, {
    ...canonical,
    verifiedTcgplayerUrl: url,
    verifiedTcgplayerProductId: "642529",
  }), true);
});

test("matches H3/H32 to H3 only when set and canonical name prove the printing", () => {
  const card = { id: "skyridge-h3-articuno", name: "Articuno", number: "H3/H32", sourceSetId: "ecard3" };
  const result = matchCanonicalCard(
    apiCard({ id: "ecard3-H3", name: "Articuno", number: "H3", set: { id: "ecard3" } }),
    buildCanonicalCardLookup([card]),
  );
  assert.equal(result.card, card);
  assert.equal(result.matchType, "set_number_name");
});

test("normalizes Star display glyphs to the canonical Star identity", () => {
  assert.equal(normalizeCanonicalName("Umbreon ★"), "umbreon star");
  assert.equal(normalizeCanonicalName("Umbreon ⭐"), "umbreon star");
  assert.equal(normalizeCanonicalName("Umbreon Star"), "umbreon star");
});

test("selects holofoil or normal only when printing evidence supports it", () => {
  const prices = {
    normal: { market: 0.33 },
    holofoil: { market: 48.75 },
    reverseHolofoil: { market: 55 },
  };
  assert.equal(selectTcgplayerPrice(apiCard({ rarity: "Classic Collection", tcgplayer: { prices } }), {}).priceType, "holofoil");
  assert.equal(selectTcgplayerPrice(apiCard({ rarity: "Common", tcgplayer: { prices } }), {}).priceType, "normal");
});

test("selects the standard modern Rare holo and rejects an ordinary reverse-only card", () => {
  const modernRare = selectTcgplayerPrice(apiCard({ rarity: "Rare", tcgplayer: { prices: {
    holofoil: { market: 0.41 },
    reverseHolofoil: { market: 0.53 },
  } } }), {});
  assert.equal(modernRare.priceType, "holofoil");
  assert.equal(modernRare.reason, "rare_holo_printing");

  const ordinaryReverseOnly = selectTcgplayerPrice(apiCard({ rarity: "Common", tcgplayer: { prices: {
    reverseHolofoil: { market: 0.18 },
  } } }), {});
  assert.equal(ordinaryReverseOnly.priceType, null);
  assert.equal(ordinaryReverseOnly.reason, "expected_normal_missing");
});

test("requires explicit finish metadata for reverse-only products and rejects ambiguous promos", () => {
  const reverseOnly = selectTcgplayerPrice(apiCard({ rarity: "Rare Secret", tcgplayer: { prices: { reverseHolofoil: { market: 900 } } } }), {});
  assert.equal(reverseOnly.priceType, null);
  assert.equal(reverseOnly.reason, "expected_holofoil_missing");

  const explicitReverse = selectTcgplayerPrice(
    apiCard({ rarity: "Rare Secret", tcgplayer: { prices: { reverseHolofoil: { market: 900 } } } }),
    { tcgplayerPriceType: "reverseHolofoil" },
  );
  assert.equal(explicitReverse.priceType, "reverseHolofoil");
  assert.equal(explicitReverse.reason, "explicit_catalog_finish");

  const ambiguous = selectTcgplayerPrice(apiCard({ rarity: "Promo", tcgplayer: { prices: { normal: { market: 2 }, holofoil: { market: 8 } } } }), {});
  assert.equal(ambiguous.priceType, null);
  assert.equal(ambiguous.reason, "multiple_non_reverse_ambiguity");
});

test("Detective Pikachu commons use their explicit holo-only printing metadata", () => {
  const upstream = apiCard({
    id: "det1-1",
    name: "Bulbasaur",
    number: "1",
    rarity: "Common",
    set: { id: "det1" },
    tcgplayer: { prices: { holofoil: { market: 0.52 } } },
  });
  assert.equal(selectTcgplayerPrice(upstream, {}).reason, "expected_normal_missing");
  const selection = selectTcgplayerPrice(upstream, { tcgplayerPriceType: "holofoil" });
  assert.equal(selection.priceType, "holofoil");
  assert.equal(selection.reason, "explicit_catalog_finish");
});

test("accepts a special card's sole non-reverse market only with exact audited product proof", () => {
  const url = "https://prices.pokemontcg.io/tcgplayer/xy12-109";
  const upstream = apiCard({
    id: "xy12-109",
    name: "Exeggutor",
    number: "109",
    rarity: "Rare Secret",
    set: { id: "xy12" },
    tcgplayer: { url, prices: { normal: { market: 1.25 }, reverseHolofoil: { market: 2.5 } } },
  });
  assert.equal(selectTcgplayerPrice(upstream, {}).priceType, null);

  const verified = selectTcgplayerPrice(upstream, {
    verifiedTcgplayerUrl: url,
    verifiedTcgplayerProductId: "123456",
  });
  assert.equal(verified.priceType, "normal");
  assert.equal(verified.reason, "single_verified_non_reverse_bucket");
  assert.equal(selectTcgplayerPrice(upstream, {
    verifiedTcgplayerUrl: `${url}-wrong`,
    verifiedTcgplayerProductId: "123456",
  }).priceType, null);
});

test("runtime pricing requires exact audited marketplace product proof", () => {
  const upstream = apiCard();
  const unverified = selectTcgplayerPrice(upstream, {}, { requireVerifiedProduct: true });
  assert.equal(unverified.priceType, null);
  assert.equal(unverified.reason, "marketplace_product_unverified");

  const verified = selectTcgplayerPrice(upstream, {
    verifiedTcgplayerUrl: upstream.tcgplayer.url,
    verifiedTcgplayerProductId: "123",
  }, { requireVerifiedProduct: true });
  assert.equal(verified.priceType, "normal");
  assert.equal(verified.reason, "rarity_evidence");
});

test("multiple positive non-reverse variants remain unavailable without explicit finish metadata", () => {
  const upstream = apiCard({ rarity: "Promo", tcgplayer: { prices: {
    normal: { market: 2 },
    holofoil: { market: 8 },
    reverseHolofoil: { market: 10 },
  } } });
  const selection = selectTcgplayerPrice(upstream, {
    verifiedTcgplayerUrl: "https://prices.pokemontcg.io/tcgplayer/set1-1",
    verifiedTcgplayerProductId: "1",
  });
  assert.equal(selection.priceType, null);
  assert.equal(selection.reason, "multiple_non_reverse_ambiguity");
});

test("edition-specific buckets require explicit catalog finish metadata", () => {
  const upstream = apiCard({ rarity: "Rare", tcgplayer: { prices: {
    "1stEdition": { market: 50 },
    unlimited: { market: 20 },
  } } });
  assert.equal(selectTcgplayerPrice(upstream, {}).priceType, null);
  const explicit = selectTcgplayerPrice(upstream, { tcgplayerPriceType: "unlimited" });
  assert.equal(explicit.priceType, "unlimited");
  assert.equal(explicit.reason, "explicit_catalog_finish");

  const specialWithProof = selectTcgplayerPrice(apiCard({ rarity: "Rare Shining", tcgplayer: {
    url: "https://prices.pokemontcg.io/tcgplayer/set1-1",
    prices: { unlimitedHolofoil: { market: 500 } },
  } }), {
    verifiedTcgplayerUrl: "https://prices.pokemontcg.io/tcgplayer/set1-1",
    verifiedTcgplayerProductId: "1",
  });
  assert.equal(specialWithProof.priceType, null);
  assert.equal(specialWithProof.reason, "ambiguous_variant");
});

test("Wally's Compassion selects its current holofoil bucket without relaxed fallback", () => {
  const upstream = apiCard({
    id: "me1-186",
    name: "Wally's Compassion",
    number: "186",
    rarity: "Special Illustration Rare",
    set: { id: "me1" },
    tcgplayer: {
      url: "https://prices.pokemontcg.io/tcgplayer/me1-186",
      updatedAt: "2026/08/03",
      prices: { holofoil: { market: 19.31 } },
    },
  });
  const selection = selectTcgplayerPrice(upstream, {});
  assert.equal(selection.priceType, "holofoil");
  assert.equal(selection.reason, "rarity_evidence");
});

test("stores canonical marketplace identity even when market price is unavailable", () => {
  const card = apiCard({ id: "ecard3-146", name: "Charizard", number: "146", rarity: "Rare Secret", set: { id: "ecard3" }, tcgplayer: {
    url: "https://prices.pokemontcg.io/tcgplayer/ecard3-146",
    updatedAt: "2026/08/03",
    prices: { reverseHolofoil: { low: 2999.99, market: null } },
  } });
  const selection = selectTcgplayerPrice(card, {});
  const row = buildMarketplaceRow({ id: "skyridge" }, {
    id: "ecard3-146",
    verifiedTcgplayerUrl: "https://prices.pokemontcg.io/tcgplayer/ecard3-146",
    verifiedTcgplayerProductId: "123",
  }, card, selection, "2026-08-03T20:00:00Z");
  assert.equal(row.card_id, "ecard3-146");
  assert.equal(row.name, "Charizard");
  assert.equal(row.market_price_usd, null);
  assert.equal(row.price_type, null);
  assert.equal(row.tcgplayer_url, "https://prices.pokemontcg.io/tcgplayer/ecard3-146");
});

test("an unaudited or changed marketplace URL is withheld for search fallback", () => {
  const card = apiCard();
  const row = buildMarketplaceRow({ id: "set" }, { id: "card" }, card, selectTcgplayerPrice(card, {}));
  assert.equal(row.market_price_usd, null);
  assert.equal(row.tcgplayer_url, null);

  const changed = buildMarketplaceRow({ id: "set" }, {
    id: "card",
    verifiedTcgplayerUrl: "https://prices.pokemontcg.io/tcgplayer/old-card",
    verifiedTcgplayerProductId: "123",
  }, card, selectTcgplayerPrice(card, {}));
  assert.equal(changed.tcgplayer_url, null);
});

test("temporarily missing upstream URL preserves prior canonical identity but clears price", () => {
  const current = buildMarketplaceRow(
    { id: "celebrations" },
    {
      id: "celebrations-17-umbreon",
      name: "Umbreon ★",
      number: "17",
      verifiedTcgplayerUrl: "https://prices.pokemontcg.io/tcgplayer/cel25c-17_A",
      verifiedTcgplayerProductId: "123",
    },
    apiCard({ id: "cel25c-17_A", name: "Umbreon ★", number: "17", tcgplayer: null }),
    selectTcgplayerPrice(apiCard({ tcgplayer: null }), {}),
    "2026-08-03T20:00:00Z",
  );
  const merged = preserveCanonicalMarketplaceIdentity(current, {
    card_id: "cel25c-17_A",
    tcgplayer_url: "https://prices.pokemontcg.io/tcgplayer/cel25c-17_A",
    source_updated_at: "2026/08/02",
  });
  assert.equal(merged.market_price_usd, null);
  assert.equal(merged.tcgplayer_url, "https://prices.pokemontcg.io/tcgplayer/cel25c-17_A");
  assert.equal(merged.source_updated_at, "2026/08/02");
});

test("different numeric denominators never collapse during unique-number fallback", () => {
  const card = { id: "denominator-identity", name: "Different Name", number: "1/10", sourceSetId: "set1" };
  const result = matchCanonicalCard(
    apiCard({ id: "set1-unknown", name: "Upstream Name", number: "1/20" }),
    buildCanonicalCardLookup([card]),
  );
  assert.equal(result.card, null);
});

test("Skyridge Charizard regression stays card 146 and never collapses into an H number", () => {
  const appCard = { id: "ecard3-146", name: "Charizard", number: "146", rarity: "Rare Secret", sourceSetId: "ecard3", sourceCardId: "ecard3-146" };
  const upstream = apiCard({
    id: "ecard3-146",
    name: "Charizard",
    number: "146",
    rarity: "Rare Secret",
    set: { id: "ecard3" },
    tcgplayer: {
      url: "https://prices.pokemontcg.io/tcgplayer/ecard3-146",
      updatedAt: "2026/08/03",
      prices: { reverseHolofoil: { low: 2999.99, market: null } },
    },
  });
  const matched = matchCanonicalCard(upstream, buildCanonicalCardLookup([appCard]));
  assert.equal(matched.card, appCard);
  assert.equal(normalizeCollectorNumber(matched.card.number), "146");
  assert.equal(selectTcgplayerPrice(upstream, appCard).priceType, null);
});

test("Umbreon Star regression cannot match Celebrations Groudon by number", () => {
  const cards = [
    { id: "celebrations-17-groudon", name: "Groudon", number: "17", sourceSetId: "cel25", sourceCardId: "cel25-17" },
    { id: "celebrations-17-umbreon", name: "Umbreon ★", number: "17", sourceSetId: "cel25c", sourceCardId: "cel25c-17_A" },
  ];
  const lookup = buildCanonicalCardLookup(cards);
  assert.equal(matchCanonicalCard(apiCard({ id: "cel25-17", name: "Groudon", number: "17", set: { id: "cel25" } }), lookup).card.id, "celebrations-17-groudon");
  assert.equal(matchCanonicalCard(apiCard({ id: "cel25c-17_A", name: "Umbreon ★", number: "17", set: { id: "cel25c" } }), lookup).card.id, "celebrations-17-umbreon");
});
