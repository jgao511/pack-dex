import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (file) => fs.readFileSync(new URL(file, import.meta.url), "utf8");

const appSource = read("../src/App.jsx");
const landingSource = read("../src/LandingPage.jsx");
const setSelectSource = read("../src/components/SetSelect.jsx");
const desktopTheme = read("../src/DesktopTheme.css");
const mobileTheme = read("../mobile-app/src/App.css");
const documentSource = read("../index.html");

test("the desktop theme is isolated from the welcome and mobile entries", () => {
  assert.match(appSource, /import "\.\/DesktopTheme\.css";/);
  assert.doesNotMatch(landingSource, /DesktopTheme\.css/);
  assert.doesNotMatch(desktopTheme, /mobile-app/);
});

test("the desktop theme keeps the mobile-inspired dark system and responsive boundaries", () => {
  assert.match(desktopTheme, /--pd-page:\s*#090d19/);
  assert.match(desktopTheme, /--pd-accent:\s*#7c4dff/);
  assert.match(desktopTheme, /--pd-brand-purple:\s*#7c4dff/);
  assert.doesNotMatch(desktopTheme, /:root\[data-theme="light"\]/);
  assert.match(mobileTheme, /\.mobile-wordmark span:last-child[\s\S]*?color:\s*#7c4dff/);
  assert.match(desktopTheme, /\.set-grid[\s\S]*?display:\s*grid/);
  assert.match(desktopTheme, /\.set-grid[\s\S]*?justify-content:\s*start/);
  assert.match(desktopTheme, /@media \(max-width:\s*1024px\)/);
  assert.match(desktopTheme, /@media \(max-width:\s*760px\)/);
  assert.match(desktopTheme, /@media \(max-width:\s*430px\)/);
  assert.doesNotMatch(desktopTheme, /(?:linear|radial)-gradient/);
});

test("Open Packs uses the compact product hierarchy and shell-level guest notice", () => {
  assert.doesNotMatch(setSelectSource, /Pokémon TCG Pack Opening Simulator/);
  assert.match(setSelectSource, /<span className="set-mark">Open a Pack<\/span>/);
  assert.match(setSelectSource, /<h1>Choose a set<\/h1>/);
  assert.doesNotMatch(setSelectSource, /AccountSaveNotice/);
  assert.match(appSource, /className="account-save-notice--shell"/);
  assert.match(appSource, /<span className="site-wordmark">[\s\S]*?<span>Pack<\/span>[\s\S]*?<span>Dex<\/span>/);
});

test("desktop metadata remains text-only and describes the complete product", () => {
  assert.match(documentSource, /<title>PackDex — Free Pokémon TCG Pack Opening &amp; Collection<\/title>/);
  assert.match(documentSource, /free, fan-made Pokémon TCG experience/);
  assert.match(documentSource, /every English set/);
  assert.match(documentSource, /chasing favorite cards/);
  assert.match(documentSource, /tracking your collection/);
  assert.match(documentSource, /property="og:type" content="website"/);
  assert.match(documentSource, /property="og:site_name" content="PackDex"/);
  assert.match(documentSource, /name="twitter:card" content="summary"/);
  assert.doesNotMatch(documentSource, /(?:og:image|twitter:image)/);
});
