import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const desktopThemeUrl = new URL("../src/DesktopTheme.css", import.meta.url);
const mobileThemeUrl = new URL("../mobile-app/src/App.css", import.meta.url);
const collectionPageUrl = new URL("../src/components/CollectionPage.jsx", import.meta.url);

test("desktop native dropdown menus use a readable option palette without changing the closed select", async () => {
  const css = await readFile(desktopThemeUrl, "utf8");

  assert.match(css, /:root\[data-theme\] select option\s*\{[\s\S]*?color:\s*#11111f;[\s\S]*?background:\s*#ffffff;/);
  assert.match(css, /:root\[data-theme\] select option:disabled\s*\{[\s\S]*?color:\s*#6b7280;/);
  assert.match(css, /\.set-select-heading \.era-filter select\s*\{[\s\S]*?background:\s*transparent;/);
});

test("mobile native dropdown menus use the same readable light-menu fallback", async () => {
  const css = await readFile(mobileThemeUrl, "utf8");

  assert.match(css, /\.mobile-app select option\s*\{[\s\S]*?color:\s*#11172b;[\s\S]*?background:\s*#ffffff;/);
  assert.match(css, /\.mobile-app select option:disabled\s*\{[\s\S]*?color:\s*#68718b;/);
  assert.match(css, /\.mobile-filter-pill select,[\s\S]*?background:\s*rgba\(6,\s*8,\s*22,\s*0\.72\);/);
});

test("desktop collection filters capitalize labels while preserving internal values", async () => {
  const source = await readFile(collectionPageUrl, "utf8");

  assert.match(source, /\{ value: "all", label: "All" \}/);
  assert.match(source, /\{ value: "collected", label: "Collected" \}/);
  assert.match(source, /\{ value: "missing", label: "Missing" \}/);
  assert.match(source, /className=\{filter === value \? "is-active" : ""\}/);
  assert.match(source, /onClick=\{\(\) => setFilter\(value\)\}/);
});
