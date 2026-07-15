import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  calculateVisualDescriptor,
  createCachedImageLoader,
  generateVisualIndex,
  resolveCatalogImageUrl,
} from "../scripts/build-scanner-visual-index.mjs";
import {
  compareVisualDescriptors,
  scoreVisualDescriptorsCoarse,
  VISUAL_DESCRIPTOR_SCHEMA,
} from "../src/lib/cardScanner/localVisual/visualDescriptors.js";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot = path.join(testDirectory, "fixtures", "scanner");
const charizardPath = path.join(fixtureRoot, "mega-charizard-x-ex-013-094.jpg");
const pikachuPath = path.join(fixtureRoot, "visual-references", "xy1-42-pikachu.jpg");

test("visual descriptor is compact, deterministic, and image-specific", async () => {
  const image = await fs.readFile(charizardPath);
  const first = await calculateVisualDescriptor(image);
  const second = await calculateVisualDescriptor(image);
  const other = await calculateVisualDescriptor(await fs.readFile(pikachuPath));

  assert.deepEqual(first, second);
  assert.equal(first.length, 11);
  assert.match(first[0], /^[0-9a-f]{16}$/);
  assert.match(first[1], /^[0-9a-f]{16}$/);
  assert.equal(Buffer.from(first[2], "base64").byteLength, 24);
  for (const hash of first.slice(3)) assert.match(hash, /^[0-9a-f]{16}$/);
  assert.notDeepEqual(first, other);
});

test("v2 matching gives global color only a small supporting weight", async () => {
  const descriptor = await calculateVisualDescriptor(await fs.readFile(charizardPath));
  const colorChanged = [...descriptor];
  colorChanged[2] = Buffer.alloc(24).toString("base64");
  const comparison = compareVisualDescriptors(descriptor, colorChanged);
  assert.equal(comparison.schemaVersion, 2);
  assert.ok(comparison.score >= .97);
  assert.equal(comparison.top.pHash, 1);
  assert.equal(comparison.artwork.edgeHash, 1);
  assert.equal(scoreVisualDescriptorsCoarse(descriptor, descriptor), 1);
});

test("generated manifest is keyed only by trusted card IDs and reports unreadable images", async () => {
  const buffers = new Map([
    ["charizard", await fs.readFile(charizardPath)],
    ["pikachu", await fs.readFile(pikachuPath)],
  ]);
  const { manifest, failures } = await generateVisualIndex({
    entries: [
      { cardId: "xy1-42-pikachu", source: "pikachu" },
      { cardId: "phantasmal-flames-13-mega-charizard-x-ex", source: "charizard" },
      { cardId: "trusted-but-unreadable", source: "missing" },
    ],
    loadImage: async (source) => {
      if (!buffers.has(source)) throw new Error("fixture missing");
      return buffers.get(source);
    },
    concurrency: 2,
  });

  assert.deepEqual(Object.keys(manifest.cards), [
    "phantasmal-flames-13-mega-charizard-x-ex",
    "xy1-42-pikachu",
  ]);
  assert.equal(manifest.version, 2);
  assert.deepEqual(manifest.descriptor.fields, VISUAL_DESCRIPTOR_SCHEMA.fields);
  assert.deepEqual(Object.keys(manifest.cards["xy1-42-pikachu"]), [...Array(11).keys()].map(String));
  assert.equal(failures.length, 1);
  assert.equal(failures[0].cardId, "trusted-but-unreadable");
  assert.equal("name" in manifest.cards["xy1-42-pikachu"], false);
  assert.equal("imageUrl" in manifest.cards["xy1-42-pikachu"], false);
});

test("catalog image paths resolve to the existing PackDex small-image host", () => {
  assert.equal(
    resolveCatalogImageUrl("/assets/sets/151/cards/25_Pikachu_Common.png"),
    "https://assets.pack-dex.com/assets/sets/151/cards/25_Pikachu_Common.png",
  );
  assert.equal(
    resolveCatalogImageUrl("sets/base-set/cards/4_charizard.jpg"),
    "https://assets.pack-dex.com/assets/sets/base-set/cards/4_charizard.jpg",
  );
  assert.equal(resolveCatalogImageUrl("https://example.test/card.webp"), "https://example.test/card.webp");
});

test("remote image loader reuses its on-disk cache", async () => {
  const cachePath = await fs.mkdtemp(path.join(os.tmpdir(), "packdex-visual-index-test-"));
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    return new Response("cached-card-image");
  };
  try {
    const loader = createCachedImageLoader({ cachePath });
    const first = await loader.load("https://example.test/card.png");
    const second = await loader.load("https://example.test/card.png");
    assert.equal(first.toString(), "cached-card-image");
    assert.equal(second.toString(), "cached-card-image");
    assert.equal(requests, 1);
    assert.deepEqual(loader.stats, { cacheHits: 1, downloads: 1 });
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(cachePath, { recursive: true, force: true });
  }
});
