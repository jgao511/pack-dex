import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const setSelect = fs.readFileSync(new URL("../src/components/SetSelect.jsx", import.meta.url), "utf8");
const desktopTheme = fs.readFileSync(new URL("../src/DesktopTheme.css", import.meta.url), "utf8");

test("the entire desktop set card is the primary pack action", () => {
  assert.match(setSelect, /aria-label=\{isReady \? `Open \$\{set\.name\} pack`/);
  assert.match(setSelect, /className="set-card-primary-action"/);
  assert.doesNotMatch(setSelect, /set-open-pill/);
  assert.doesNotMatch(setSelect, />Open Pack</);
});

test("collection is a compact in-card action that does not open a pack", () => {
  assert.match(setSelect, /aria-label=\{`View \$\{set\.name\} collection`\}/);
  assert.match(setSelect, /event\.stopPropagation\(\)/);
  assert.match(setSelect, /onViewCollection\(set\)/);
  assert.match(setSelect, /<span>View collection<\/span>/);
  assert.doesNotMatch(setSelect, /aria-hidden="true">→/);
  assert.match(desktopTheme, /\.set-collection-button\s*\{[\s\S]*?justify-self:\s*center/);
});

test("set cards provide clear pointer and keyboard states", () => {
  assert.match(desktopTheme, /\.set-card-primary-action:hover:not\(:disabled\)/);
  assert.match(desktopTheme, /\.set-card-primary-action:focus-visible/);
  assert.match(desktopTheme, /\.set-collection-button:focus-visible/);
});

test("set cards use one surface with an in-card collection action", () => {
  assert.match(desktopTheme, /\.set-tile\s*\{[\s\S]*?border:\s*1px solid var\(--pd-border\)/);
  assert.match(desktopTheme, /\.set-card-primary-action\s*\{[\s\S]*?background:\s*transparent/);
  assert.match(desktopTheme, /\.set-collection-button\s*\{[\s\S]*?position:\s*relative[\s\S]*?z-index:\s*2/);
});

test("responsive grids stay left aligned without horizontal overflow", () => {
  assert.match(desktopTheme, /\.set-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(0,\s*238px\)\)/);
  assert.match(desktopTheme, /@media \(max-width:\s*760px\)[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(desktopTheme, /@media \(max-width:\s*430px\)[\s\S]*?grid-template-columns:\s*minmax\(0,\s*300px\)[\s\S]*?justify-content:\s*start/);
});

test("set readiness is cached across grid remounts", () => {
  assert.match(setSelect, /const SET_READINESS_CACHE = new WeakMap\(\)/);
  assert.match(setSelect, /SET_READINESS_CACHE\.set\(set,\s*canGeneratePack\(set\)\)/);
  assert.match(setSelect, /sets\.map\(\(set\) => \[set\.id,\s*getSetReadiness\(set\)\]\)/);
});
