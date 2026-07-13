import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { getScannerCatalog } from "../src/lib/cardScanner/buildScannerCatalog.js";
import { getCardImageUrl } from "../src/utils/assetUrls.js";

const root = path.dirname(fileURLToPath(import.meta.url));
const manifestPath = path.join(root, "fixtures", "scanner", "local-pixel-manifest.json");
const localFixtureRoot = path.join(root, "fixtures", "scanner", "local-pixel");
const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));

test("local photo manifest contains all 16 attached cards and trusted catalog IDs", () => {
  assert.equal(manifest.fixtureDirectoryGitignored, true);
  assert.equal(manifest.includedInAnyBundle, false);
  assert.equal(manifest.items.length, 16);
  assert.equal(new Set(manifest.items.map(({ fixture }) => fixture)).size, 16);
  const catalogById = new Map(getScannerCatalog().map((entry) => [entry.cardId, entry]));
  for (const item of manifest.items) {
    assert.match(item.fixture, /^IMG_\d{4}\.jpeg$/);
    assert.match(item.sha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(item.dimensions, { width: 5712, height: 4284, exifOrientation: 6 });
    const catalog = catalogById.get(item.cardId);
    assert.ok(catalog, `${item.cardId} must be in the trusted scanner catalog`);
    assert.equal(catalog.card.name, item.name);
    assert.equal(catalog.setName, item.set);
    assert.ok(item.collectorNumber.startsWith(String(catalog.card.number).padStart(item.collectorNumber.split("/")[0].length, "0")));
    const imageUrl = getCardImageUrl(catalog.card);
    assert.match(imageUrl, /^https:\/\/assets\.pack-dex\.com\/assets\/sets\//);
    assert.doesNotMatch(imageUrl, /^https:\/\/pack-dex\.com\/assets\//);
  }
});

test("local attached photos remain intact when present", async (context) => {
  try { await fs.access(localFixtureRoot); } catch { context.skip("Local gitignored attachments are not present in this checkout."); return; }
  const files = (await fs.readdir(localFixtureRoot)).filter((file) => /\.jpe?g$/i.test(file)).sort();
  assert.deepEqual(files, manifest.items.map(({ fixture }) => fixture).sort());
  for (const item of manifest.items) {
    const bytes = await fs.readFile(path.join(localFixtureRoot, item.fixture));
    assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"), item.sha256);
    const metadata = await sharp(bytes).metadata();
    assert.deepEqual({ width: metadata.width, height: metadata.height, exifOrientation: metadata.orientation }, item.dimensions);
  }
});

test("runtime scanner source never references local regression photos", async () => {
  const sourceRoots = [path.join(root, "..", "src"), path.join(root, "..", "mobile-app", "src")];
  const pending = [...sourceRoots];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(target);
      else if (/\.(?:js|jsx|mjs|json)$/i.test(entry.name)) {
        const source = await fs.readFile(target, "utf8");
        assert.doesNotMatch(source, /local-pixel|IMG_66\d{2}\.jpeg/);
      }
    }
  }
});

test("connected fixture runner uses a real browser File without expected-ID injection", async () => {
  const page = await fs.readFile(path.join(root, "..", "mobile-app", "src", "CardScannerDevPage.jsx"), "utf8");
  const start = page.indexOf("globalThis.__PACKDEX_RUN_LOCAL_SCANNER_FILE__ = async");
  const runner = page.slice(start, page.indexOf("}, [activeOcrAdapter]);", start));
  assert.match(runner, /file instanceof File/);
  assert.match(runner, /createTemporaryImage\(file\)/);
  assert.match(runner, /recognizeCardText\(temporaryImage, \{ adapter: activeOcrAdapter \}\)/);
  assert.doesNotMatch(runner, /expected|cardId ===|fixtureDirectory/);

  const connected = await fs.readFile(path.join(root, "..", "scripts", "run-connected-local-scanner-fixtures.mjs"), "utf8");
  assert.match(connected, /DOM\.setFileInputFiles/);
  assert.match(connected, /__PACKDEX_RUN_LOCAL_SCANNER_FILE__/);
  assert.ok(connected.indexOf("__PACKDEX_RUN_LOCAL_SCANNER_FILE__") < connected.indexOf("const finalRank"));
});

test("local fixture directory is gitignored", async () => {
  const ignore = await fs.readFile(path.join(root, "..", ".gitignore"), "utf8");
  assert.match(ignore, /^tests\/fixtures\/scanner\/local-pixel\/$/m);
});
