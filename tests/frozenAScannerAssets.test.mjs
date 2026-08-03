import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildScannerCatalog } from "../src/lib/cardScanner/buildScannerCatalog.js";

const model = new URL("../public/scanner-ai/frozen-a-62f2ff60.tflite", import.meta.url);
const metadata = new URL("../public/scanner-ai/catalog-embeddings.meta.json", import.meta.url);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

test("bundles the exact frozen-A model and full catalog index with their binding", async () => {
  const metadataBytes = await readFile(metadata);
  const parsed = JSON.parse(metadataBytes);
  const index = new URL(`../public/scanner-ai/${parsed.vectorFile}`, import.meta.url);
  const [modelBytes, indexBytes] = await Promise.all([readFile(model), readFile(index)]);
  const expectedCardIds = new Set(buildScannerCatalog().map(({ cardId }) => cardId));

  assert.equal(modelBytes.byteLength, 4490924);
  assert.equal(sha256(modelBytes), "62f2ff60cfdb09714a01fa74343e4dc1968601c2a43046979cbc548c28027c7c");
  assert.equal(indexBytes.byteLength, parsed.vectorBytes);
  assert.equal(parsed.vectorBytes, parsed.count * parsed.dimensions * 2);
  assert.equal(parsed.vectorSha256, sha256(indexBytes));
  assert.match(parsed.vectorFile, new RegExp(`^catalog-embeddings-${parsed.vectorSha256.slice(0, 8)}\\.f16$`, "u"));
  assert.deepEqual(
    { count: parsed.count, dimensions: parsed.dimensions, dtype: parsed.dtype, normalized: parsed.normalized },
    { count: expectedCardIds.size, dimensions: 128, dtype: "float16-le", normalized: true }
  );
  assert.equal(parsed.model.sha256, sha256(modelBytes));
  assert.equal(new Set(parsed.cardIds).size, parsed.count);
  assert.equal(parsed.cardIds.every((cardId) => expectedCardIds.has(cardId)), true);
});

test("browser and Android frozen-A inputs share NHWC RGB zero-to-one tensor semantics", async () => {
  const [browser, android] = await Promise.all([
    readFile(new URL("../mobile-app/src/lib/frozenAScanner.js", import.meta.url), "utf8"),
    readFile(new URL("../mobile-app/android/app/src/main/java/com/packdex/app/PackDexAiEmbedderPlugin.java", import.meta.url), "utf8"),
  ]);
  assert.match(browser, /model\.inputs\?\.\[0\]\?\.shape\?\.join\(","\) !== "1,224,224,3"/);
  assert.match(browser, /input\[target\+\+\] = pixels\[source\] \/ 255; input\[target\+\+\] = pixels\[source \+ 1\] \/ 255; input\[target\+\+\] = pixels\[source \+ 2\] \/ 255/);
  assert.match(android, /float32 NHWC \[1,H,W,3\]/);
  assert.match(android, /float red = \(pixel >> 16\) & 0xff;\s*float green = \(pixel >> 8\) & 0xff;\s*float blue = pixel & 0xff;/);
  assert.match(android, /input\.putFloat\(red \/ 255f\); input\.putFloat\(green \/ 255f\); input\.putFloat\(blue \/ 255f\);/);
});
