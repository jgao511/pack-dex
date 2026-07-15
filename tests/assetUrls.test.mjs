import assert from "node:assert/strict";
import test from "node:test";
import { getCardImageUrl, getSetAssetUrl } from "../src/utils/assetUrls.js";

test("catalog card paths resolve through the assets subdomain with their assets prefix", () => {
  const catalogPath = "/assets/sets/mega-evolution/cards/58_Ralts_Common.png";
  const resolved = getCardImageUrl({ imageUrl: catalogPath });
  assert.equal(resolved, "https://assets.pack-dex.com/assets/sets/mega-evolution/cards/58_Ralts_Common.png");
  assert.equal(new URL(resolved).hostname, "assets.pack-dex.com");
  assert.notEqual(new URL(resolved).hostname, "pack-dex.com");
});

test("set-relative paths use the same assets/sets base and absolute URLs remain unchanged", () => {
  assert.equal(
    getSetAssetUrl("mega-evolution/cards/58_Ralts_Common.png"),
    "https://assets.pack-dex.com/assets/sets/mega-evolution/cards/58_Ralts_Common.png",
  );
  assert.equal(
    getSetAssetUrl("https://cdn.example.test/card.png"),
    "https://cdn.example.test/card.png",
  );
});
