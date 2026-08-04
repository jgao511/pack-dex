import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyTcgplayerProductDetails,
  classifyTcgplayerTerminalDestination,
  getTcgplayerProductId,
} from "../scripts/marketplace-url-classifier.mjs";

const expectedWally = {
  apiCardId: "me1-186",
  name: "Wally's Compassion",
  number: "186",
  setName: "Mega Evolution",
  apiSetName: "Mega Evolution",
};

test("classifies an exact product-page identity", () => {
  const result = classifyTcgplayerProductDetails({
    productId: 654525,
    productName: "Wally's Compassion - 186/132",
    setName: "ME01: Mega Evolution",
    customAttributes: { number: "186/132" },
  }, expectedWally);
  assert.equal(result.classification, "A");
  assert.equal(result.reason, "exact_verified_product");
});

test("classifies a wrong product printing", () => {
  const result = classifyTcgplayerProductDetails({
    productId: 654524,
    productName: "Lillie's Determination - 184/132",
    setName: "ME01: Mega Evolution",
    customAttributes: { number: "184/132" },
  }, expectedWally);
  assert.equal(result.classification, "C");
  assert.equal(result.reason, "product_identity_mismatch");
});

test("normalizes a documented provider title spelling when set and number are exact", () => {
  const result = classifyTcgplayerProductDetails({
    productId: 1,
    productName: "Drowsee",
    setName: "Base Set",
    customAttributes: { number: "49/102" },
  }, { name: "Drowzee", number: "49", apiSetName: "Base Set" });
  assert.equal(result.classification, "A");
  assert.equal(result.reason, "exact_verified_product");
});

test("rejects wrong collector numbers even when the product title is similar", () => {
  const suffixVariant = classifyTcgplayerProductDetails({
    productName: "Golduck (50a)",
    setName: "Aquapolis",
    number: "050a/147",
  }, { name: "Golduck", number: "50", apiSetName: "Aquapolis" });
  assert.equal(suffixVariant.classification, "C");

  const wrongCard = classifyTcgplayerProductDetails({
    productName: "Seadra",
    setName: "Legends Awakened",
    number: "70/146",
  }, { name: "Starmie", number: "71", apiSetName: "Legends Awakened" });
  assert.equal(wrongCard.classification, "C");
});

test("accepts documented TCGplayer set-label aliases without weakening number or name", () => {
  const sunMoon = classifyTcgplayerProductDetails({
    productName: "Pelipper",
    setName: "SM Base Set",
    number: "38/149",
  }, { name: "Pelipper", number: "38", apiSetName: "Sun & Moon" });
  assert.equal(sunMoon.classification, "A");

  const heartGold = classifyTcgplayerProductDetails({
    productName: "Mareep",
    setName: "HeartGold SoulSilver",
    number: "73/123",
  }, { name: "Mareep", number: "73", apiSetName: "HeartGold & SoulSilver" });
  assert.equal(heartGold.classification, "A");

  const exEra = classifyTcgplayerProductDetails({
    productName: "Rayquaza Star",
    setName: "EX Deoxys",
    number: "107/107",
  }, { name: "Rayquaza Star", number: "107", apiSetName: "Deoxys" });
  assert.equal(exEra.classification, "A");

  const hsEra = classifyTcgplayerProductDetails({
    productName: "Gastly",
    setName: "Triumphant",
    number: "63/102",
  }, { name: "Gastly", number: "63", apiSetName: "HS—Triumphant" });
  assert.equal(hsEra.classification, "A");

  const radiantCollection = classifyTcgplayerProductDetails({
    productName: "Ralts",
    setName: "Legendary Treasures: Radiant Collection",
    number: "RC8/RC25",
  }, { name: "Ralts", number: "RC8", apiSetName: "Legendary Treasures" });
  assert.equal(radiantCollection.classification, "A");

  const expedition = classifyTcgplayerProductDetails({
    productName: "Chikorita (100)",
    setName: "Expedition",
    number: "100/165",
  }, { name: "Chikorita", number: "100", apiSetName: "Expedition Base Set" });
  assert.equal(expedition.classification, "A");

  const scarletViolet151 = classifyTcgplayerProductDetails({
    productName: "Blastoise ex - 009/165",
    setName: "SV: Scarlet & Violet 151",
    number: "009/165",
  }, { name: "Blastoise ex", number: "9", apiSetName: "151" });
  assert.equal(scarletViolet151.classification, "A");

  const megaEvolution = classifyTcgplayerProductDetails({
    productName: "Erika's Oddish",
    setName: "ME: Ascended Heroes",
    number: "001/217",
  }, { name: "Erika's Oddish", number: "1", apiSetName: "Ascended Heroes" });
  assert.equal(megaEvolution.classification, "A");

  const baseMachamp = classifyTcgplayerProductDetails({
    productName: "Machamp - 8/102",
    setName: "Deck Exclusives",
    number: "008/102",
  }, { name: "Machamp", number: "8", apiSetName: "Base" });
  assert.equal(baseMachamp.classification, "A");

  const wrongSet = classifyTcgplayerProductDetails({
    productName: "Pelipper",
    setName: "SM Base Set",
    number: "38/149",
  }, { name: "Pelipper", number: "38", apiSetName: "Base Set 2" });
  assert.equal(wrongSet.classification, "C");
});

test("distinguishes exact products, generic searches, wrong hosts, and redirect loops", () => {
  assert.equal(getTcgplayerProductId("https://www.tcgplayer.com/product/654525?Language=English"), "654525");
  assert.deepEqual(classifyTcgplayerTerminalDestination({
    hopCount: 5,
    lastStatus: 200,
    finalStatus: 200,
    finalUrl: "https://www.tcgplayer.com/product/654525",
  }), { classification: null, reason: "product_details_required", productId: "654525" });
  assert.equal(classifyTcgplayerTerminalDestination({
    hopCount: 1,
    lastStatus: 200,
    finalStatus: 200,
    finalUrl: "https://www.tcgplayer.com/search/pokemon/product",
  }).classification, "B");
  assert.equal(classifyTcgplayerTerminalDestination({
    hopCount: 1,
    lastStatus: 200,
    finalStatus: 200,
    finalUrl: "https://example.com/product/654525",
  }).classification, "C");
  assert.equal(classifyTcgplayerTerminalDestination({
    hopCount: 10,
    lastStatus: 302,
    finalStatus: 302,
    finalUrl: "https://www.tcgplayer.com/product/654525",
  }).classification, "D");
});
