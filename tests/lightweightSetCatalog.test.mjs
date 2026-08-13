import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { activeSets } from "../src/data/sets.js";
import { buildSetCatalogMetadata } from "../scripts/generate-set-catalog-metadata.mjs";
import {
  getCanonicalSetPath,
  resolveLightweightPublicSetRoute,
  setCatalogMetadata,
} from "../src/lib/setRouteCatalog.js";

test("generated route metadata exactly matches the authoritative active set catalog", () => {
  assert.deepEqual(setCatalogMetadata, buildSetCatalogMetadata(activeSets));
  assert.equal(setCatalogMetadata.length, 129);
  assert.equal(setCatalogMetadata.some((entry) => entry.id === "30th-anniversary"), false);
  assert.equal(setCatalogMetadata.find((entry) => entry.id === "151")?.cardCount, 207);
  assert.equal(getCanonicalSetPath("151"), "/set/pokemon-151");
  for (const entry of setCatalogMetadata) {
    assert.equal("cards" in entry, false);
    assert.equal(resolveLightweightPublicSetRoute(entry.path)?.setId, entry.id);
  }
});

test("the lightweight runtime boundary does not import full card data", async () => {
  const [catalogSource, runtimeSource, seoSource] = await Promise.all([
    readFile(new URL("../src/lib/setRouteCatalog.js", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/runtimeRoutes.js", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/publicSeo.js", import.meta.url), "utf8"),
  ]);
  for (const source of [catalogSource, runtimeSource, seoSource]) {
    assert.doesNotMatch(source, /data\/sets\.js|publicSetRoutes|setContent/);
  }
});
