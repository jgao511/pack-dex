import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("mobile navigation has the permanent four-tab Scanner order", async () => {
  const app = await source("../mobile-app/src/App.jsx");
  const tabOrder = [...app.matchAll(/\{ id: "([^"]+)", label: "([^"]+)"/g)].slice(0, 4).map((match) => `${match[1]}:${match[2]}`);
  assert.deepEqual(tabOrder, ["open:Open a Pack", "collection:Collection", "scanner:Scanner", "profile:Profile"]);
  assert.match(app, /activeTab === "scanner" && <MobileScannerPage onInspectCard=\{inspectCard\} \/>/);
});

test("production Scanner contains capture guidance and no diagnostic controls", async () => {
  const scanner = await source("../mobile-app/src/MobileScannerPage.jsx");
  assert.match(scanner, /New · Beta/);
  assert.match(scanner, /Keep the entire card inside the frame\./);
  assert.match(scanner, /Foil and highly reflective cards may require another photo\./);
  assert.match(scanner, /captureCardImage/);
  assert.match(scanner, /recognizeCardText/);
  assert.match(scanner, /confirmTrustedCandidate/);
  assert.doesNotMatch(scanner, /Scanner Diagnostics|Run Reference Test|Run Pixel Fixture|multi-frame|Supabase|addWishlistCard|savePulledCardsToCloud/);
});