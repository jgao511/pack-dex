import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { buildMobileShareUrl, PUBLIC_SHARE_CODE_PATTERN } from "../mobile-app/src/utils/mobileShareUrl.js";

test("mobile shares replace the generic server URL with the explicit mobile route", () => {
  const result = { share_code: "Abc_123-xyz", url: "https://old-server-url.invalid/Abc_123-xyz" };
  assert.equal(
    buildMobileShareUrl(result, "https://pack-dex.com"),
    "https://pack-dex.com/mobile-app/share/Abc_123-xyz"
  );
});

test("mobile share URL construction rejects missing and invalid database codes", () => {
  assert.throws(() => buildMobileShareUrl({}, "https://pack-dex.com"));
  assert.throws(() => buildMobileShareUrl({ share_code: "" }, "https://pack-dex.com"));
  assert.throws(() => buildMobileShareUrl({ share_code: "v1.payload" }, "https://pack-dex.com"));
  assert.equal(PUBLIC_SHARE_CODE_PATTERN.test("letters-NUMBERS_123"), true);
});

test("the mobile share button uses the explicit URL for native sharing and clipboard fallback", () => {
  const source = fs.readFileSync("mobile-app/src/components/SharePullButton.jsx", "utf8");
  assert.match(source, /const mobileShareUrl = buildMobileShareUrl\(result, window\.location\.origin\)/);
  assert.match(source, /url: mobileShareUrl/);
  assert.match(source, /copyShareUrl\(mobileShareUrl\)/);
  assert.doesNotMatch(source, /const \{ url \} = await createPublicPullShare/);
});

test("the only mobile share route passes an ordinary database shareCode", () => {
  const mobileMain = fs.readFileSync("mobile-app/src/main.jsx", "utf8");
  assert.match(mobileMain, /<PublicPullSharePage shareCode=\{shareRouteMatch\[1\]\}/);
  assert.doesNotMatch(mobileMain, /legacyShareRouteMatch|shortShareRouteMatch|interfaceMode|token=/);

  const sharePage = fs.readFileSync("mobile-app/src/PublicPullSharePage.jsx", "utf8");
  assert.match(sharePage, /await getPublicPullShare\(shareCode\)/);
  assert.doesNotMatch(sharePage, /token|interfaceMode|decodeSharePullPayload|is-desktop|is-mobile/);
});

test("sharing is absent from the legacy desktop entry and abandoned redirects", () => {
  const desktopMain = fs.readFileSync("src/main.jsx", "utf8");
  assert.doesNotMatch(desktopMain, /PublicPullSharePage|shareRouteMatch|shortShareRouteMatch|legacyShareRouteMatch/);

  const redirects = fs.readFileSync("public/_redirects", "utf8");
  assert.equal(redirects.trim(), "/mobile-app/share/* /mobile-app/index.html 200\n/mobile-app/* /mobile-app/index.html 200");
});

test("the public share client and Edge Function depend on the new database-code contract", () => {
  const client = fs.readFileSync("src/lib/publicPullShares.js", "utf8");
  assert.match(client, /if \(!data\?\.share_code\)/);
  assert.doesNotMatch(client, /!data\?\.url \|\| !data\?\.share_code/);

  const edgeFunction = fs.readFileSync("supabase/functions/create-pull-share/index.ts", "utf8");
  assert.match(edgeFunction, /`\$\{SHARE_ORIGIN\}\/mobile-app\/share\/\$\{shareCode\}`/);
  assert.doesNotMatch(edgeFunction, /`\$\{SHARE_ORIGIN\}\/s\/\$\{shareCode\}`/);
});
