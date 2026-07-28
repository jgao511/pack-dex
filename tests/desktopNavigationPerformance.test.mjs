import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const appSource = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const backToSets = appSource.slice(
  appSource.indexOf("function backToSets()"),
  appSource.indexOf("  return (", appSource.indexOf("function backToSets()"))
);
const selectMainTab = appSource.slice(
  appSource.indexOf("function selectMainTab(tab)"),
  appSource.indexOf("\n\n  function openAuthModal()", appSource.indexOf("function selectMainTab(tab)"))
);
const openAuthModal = appSource.slice(
  appSource.indexOf("function openAuthModal()"),
  appSource.indexOf("\n\n  async function handleDeleteAccount()", appSource.indexOf("function openAuthModal()"))
);

test("Back to Sets changes screens immediately and cancels image warmup", () => {
  assert.match(backToSets, /clearImageWarmupQueue\(\)/);
  assert.match(backToSets, /setSelectedSet\(null\)/);
  assert.match(backToSets, /setScreen\("home"\)/);
  assert.doesNotMatch(backToSets, /setTimeout|performance\.now|Loading/);
});

test("the Open Packs grid stays mounted between pack screens", () => {
  assert.match(
    appSource,
    /<div className="desktop-screen-cache" hidden=\{!\(activeTab === "open" && screen === "home"\)\}>[\s\S]*?<SetSelect/
  );
  assert.match(appSource, /\{activeTab === "open" && screen !== "home" && \(/);
  assert.doesNotMatch(appSource, /\{screen === "home" && \([\s\S]*?<SetSelect/);
});

test("the cached Open Packs screen centers one four-column content block on wide desktops", () => {
  const desktopTheme = fs.readFileSync(new URL("../src/DesktopTheme.css", import.meta.url), "utf8");

  assert.match(desktopTheme, /\.desktop-screen-cache\s*\{[\s\S]*?width:\s*min\(100%,\s*1180px\)/);
  assert.match(
    desktopTheme,
    /@media \(min-width:\s*1181px\)\s*\{[\s\S]*?\.desktop-screen-cache\s*\{[\s\S]*?width:\s*min\(100%,\s*1006px\)[\s\S]*?margin-inline:\s*auto/
  );
  assert.match(desktopTheme, /\.set-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(0,\s*238px\)\)/);
  assert.match(desktopTheme, /\.set-grid\s*\{[\s\S]*?justify-content:\s*start/);
});

test("desktop tab navigation has no artificial loading delay", () => {
  assert.match(selectMainTab, /setActiveTab\(tab\)/);
  assert.match(selectMainTab, /setScreen\(nextScreen\)/);
  assert.doesNotMatch(selectMainTab, /setTimeout|setIsTabLoading|tabLoadTokenRef/);
  assert.doesNotMatch(appSource, /TAB_LOADING_MS|MIN_RETURN_LOADING_MS|RETURN_LOADING_RENDER_DELAY_MS/);
});

test("the account dialog opens directly while real async loading states remain", () => {
  assert.match(openAuthModal, /setIsAuthModalOpen\(true\)/);
  assert.doesNotMatch(openAuthModal, /setTimeout|AUTH_MODAL_LOADING_MS|setIsAuthOpening/);
  assert.match(appSource, /isClaimingWelcomeReward && \([\s\S]*?<TabLoadingOverlay/);
});
