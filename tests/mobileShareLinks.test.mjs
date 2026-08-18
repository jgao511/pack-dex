import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { buildMobileShareUrl, PUBLIC_SHARE_CODE_PATTERN } from "../mobile-app/src/utils/mobileShareUrl.js";
import { presentPullShare, SHARE_RESULT } from "../mobile-app/src/lib/sharePull.js";

test("web shares preserve the website origin and explicit public share route", () => {
  const result = { share_code: "Abc_123-xyz", url: "https://old-server-url.invalid/Abc_123-xyz" };
  assert.equal(
    buildMobileShareUrl(result, { origin: "https://pack-dex.com", native: false }),
    "https://pack-dex.com/mobile-app/share/Abc_123-xyz"
  );
});

test("Capacitor shares always use the production PackDex origin instead of localhost", () => {
  const result = { share_code: "Abc_123-xyz" };
  assert.equal(
    buildMobileShareUrl(result, { origin: "capacitor://localhost", native: true }),
    "https://www.pack-dex.com/mobile-app/share/Abc_123-xyz"
  );
  assert.equal(
    buildMobileShareUrl(result, { origin: "http://localhost", native: true }),
    "https://www.pack-dex.com/mobile-app/share/Abc_123-xyz"
  );
  assert.doesNotMatch(
    buildMobileShareUrl(result, { origin: "capacitor://localhost", native: true }),
    /localhost/i
  );
});

test("mobile share URL construction rejects missing and invalid database codes", () => {
  const options = { origin: "https://pack-dex.com" };
  assert.throws(() => buildMobileShareUrl({}, options));
  assert.throws(() => buildMobileShareUrl({ share_code: "" }, options));
  assert.throws(() => buildMobileShareUrl({ share_code: "v1.payload" }, options));
  assert.equal(PUBLIC_SHARE_CODE_PATTERN.test("letters-NUMBERS_123"), true);
});

test("native Share Pull uses the Capacitor share sheet and web Share Pull keeps the Web Share API", async () => {
  const calls = [];
  const shareData = { title: "My PackDex Pull", url: "https://www.pack-dex.com/mobile-app/share/code" };
  assert.equal(await presentPullShare(shareData, {
    native: true,
    nativeShare: async (data) => calls.push(["native", data]),
    webShare: async (data) => calls.push(["web", data]),
  }), SHARE_RESULT.shared);
  assert.deepEqual(calls, [["native", shareData]]);

  calls.length = 0;
  assert.equal(await presentPullShare(shareData, {
    native: false,
    nativeShare: async (data) => calls.push(["native", data]),
    webShare: async (data) => calls.push(["web", data]),
  }), SHARE_RESULT.shared);
  assert.deepEqual(calls, [["web", shareData]]);

  assert.equal(await presentPullShare(shareData, {
    native: true,
    nativeShare: async () => { throw Object.assign(new Error("Share cancelled"), { name: "AbortError" }); },
  }), SHARE_RESULT.cancelled);
});

test("the mobile share button uses platform detection, native sharing, and clipboard fallback", () => {
  const source = fs.readFileSync("mobile-app/src/components/SharePullButton.jsx", "utf8");
  assert.match(source, /const native = isNativeRuntime\(\)/);
  assert.match(source, /buildMobileShareUrl\(result, \{[\s\S]*native,[\s\S]*origin: window\.location\.origin/);
  assert.match(source, /presentPullShare\(shareData, \{ native \}\)/);
  assert.match(source, /url: mobileShareUrl/);
  assert.match(source, /copyShareUrl\(mobileShareUrl\)/);
  assert.doesNotMatch(source, /navigator\.share/);
});

test("the only mobile share route passes an ordinary database shareCode", () => {
  const mobileMain = fs.readFileSync("mobile-app/src/main.jsx", "utf8");
  assert.match(mobileMain, /<PublicPullSharePage shareCode=\{shareRouteMatch\[1\]\}/);
  assert.doesNotMatch(mobileMain, /legacyShareRouteMatch|shortShareRouteMatch|interfaceMode|token=/);

  const sharePage = fs.readFileSync("mobile-app/src/PublicPullSharePage.jsx", "utf8");
  assert.match(sharePage, /await getPublicPullShare\(shareCode\)/);
  assert.match(sharePage, /buildMobileShareUrl\(\{ share_code: shareCode \}, \{ native: true \}\)/);
  assert.doesNotMatch(sharePage, /window\.location\.origin|href="\/mobile-app"/);
  assert.doesNotMatch(sharePage, /token|interfaceMode|decodeSharePullPayload|is-desktop|is-mobile/);
});

test("sharing is absent from the legacy desktop entry and abandoned redirects", () => {
  const desktopMain = fs.readFileSync("src/main.jsx", "utf8");
  assert.doesNotMatch(desktopMain, /PublicPullSharePage|shareRouteMatch|shortShareRouteMatch|legacyShareRouteMatch/);

  const redirects = fs.readFileSync("public/_redirects", "utf8");
  assert.doesNotMatch(redirects, /\/mobile-app\/\*/);

  const routes = JSON.parse(fs.readFileSync("public/_routes.json", "utf8"));
  assert.ok(routes.include.includes("/mobile-app/*"));
  assert.ok(routes.exclude.includes("/mobile-app/assets/*"));

  const mobileFallback = fs.readFileSync("functions/mobile-app/[[path]].js", "utf8");
  assert.match(mobileFallback, /entryUrl\.pathname = "\/mobile-app\/"/);
  assert.match(mobileFallback, /X-Robots-Tag", "noindex, follow"/);
});

test("the public share client and Edge Function depend on the new database-code contract", () => {
  const client = fs.readFileSync("src/lib/publicPullShares.js", "utf8");
  assert.match(client, /if \(!data\?\.share_code\)/);
  assert.doesNotMatch(client, /!data\?\.url \|\| !data\?\.share_code/);

  const edgeFunction = fs.readFileSync("supabase/functions/create-pull-share/index.ts", "utf8");
  assert.match(edgeFunction, /"https:\/\/www\.pack-dex\.com"/);
  assert.match(edgeFunction, /`\$\{SHARE_ORIGIN\}\/mobile-app\/share\/\$\{shareCode\}`/);
  assert.doesNotMatch(edgeFunction, /`\$\{SHARE_ORIGIN\}\/s\/\$\{shareCode\}`/);
});
