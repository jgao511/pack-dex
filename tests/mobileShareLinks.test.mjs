import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { buildMobileShareUrl, PUBLIC_SHARE_CODE_PATTERN } from "../mobile-app/src/utils/mobileShareUrl.js";

test("mobile shares replace the generic server URL with the explicit mobile route", () => {
  const result = { share_code: "Abc_123-xyz", url: "https://pack-dex.com/s/Abc_123-xyz" };
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

test("database share routes pass shareCode while legacy payload routes pass token", () => {
  const mobileMain = fs.readFileSync("mobile-app/src/main.jsx", "utf8");
  assert.match(mobileMain, /shareRouteMatch\[1\]} interfaceMode="mobile"/);
  assert.match(mobileMain, /<PublicPullSharePage shareCode=\{shareRouteMatch\[1\]\}/);
  assert.match(mobileMain, /<PublicPullSharePage token=\{legacyShareRouteMatch\[1\]\}/);

  const sharePage = fs.readFileSync("mobile-app/src/PublicPullSharePage.jsx", "utf8");
  assert.match(sharePage, /await getPublicPullShare\(shareCode\)/);
  assert.doesNotMatch(sharePage, /getPublicPullShare\(shareCode \|\| token\)/);
});
