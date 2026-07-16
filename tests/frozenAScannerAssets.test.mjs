import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const model = new URL("../public/scanner-ai/frozen-a-62f2ff60.tflite", import.meta.url);
const index = new URL("../public/scanner-ai/catalog-embeddings-a851d797.f16", import.meta.url);
const metadata = new URL("../public/scanner-ai/catalog-embeddings.meta.json", import.meta.url);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

test("bundles the exact frozen-A model and full catalog index with their binding", async () => {
  const [modelBytes, indexBytes, metadataBytes] = await Promise.all([readFile(model), readFile(index), readFile(metadata)]);
  const parsed = JSON.parse(metadataBytes);
  assert.equal(modelBytes.byteLength, 4490924);
  assert.equal(indexBytes.byteLength, 4799232);
  assert.equal(sha256(modelBytes), "62f2ff60cfdb09714a01fa74343e4dc1968601c2a43046979cbc548c28027c7c");
  assert.equal(sha256(indexBytes), "a851d797aef5c140d8918bb2ffa7dcafa2315cb1f0cbdb6ca4abbd91c3d61edb");
  assert.deepEqual({ count: parsed.count, dimensions: parsed.dimensions, dtype: parsed.dtype, normalized: parsed.normalized, vectorSha256: parsed.vectorSha256 }, { count: 18747, dimensions: 128, dtype: "float16-le", normalized: true, vectorSha256: sha256(indexBytes) });
  assert.equal(parsed.model.sha256, sha256(modelBytes));
  assert.equal(parsed.cardIds.length, 18747);
  assert.equal(new Set(parsed.cardIds).size, 18747);
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
