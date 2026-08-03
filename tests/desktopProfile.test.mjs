import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (file) => fs.readFileSync(new URL(file, import.meta.url), "utf8");

const appSource = read("../src/App.jsx");
const desktopTheme = read("../src/DesktopTheme.css");
const deleteDialogSource = read("../src/components/DeleteAccountDialog.jsx");
const profileSource = appSource.slice(
  appSource.indexOf("function ProfilePage("),
  appSource.indexOf("function DevGodPackAnimationPreview(")
);
const profileDataEffect = appSource.slice(
  appSource.lastIndexOf("useEffect(() => {", appSource.indexOf("loadCloudCollection(")),
  appSource.indexOf("}, [authUser?.id]);", appSource.indexOf("loadCloudCollection(")) + "}, [authUser?.id]);".length
);

test("desktop is dark-only without retaining a light-mode control", () => {
  assert.match(appSource, /document\.documentElement\.dataset\.theme = "dark"/);
  assert.match(appSource, /document\.documentElement\.style\.colorScheme = "dark"/);
  assert.doesNotMatch(appSource, /function ThemeToggle|THEME_STORAGE_KEY|Theme selector/);
  assert.doesNotMatch(desktopTheme, /:root\[data-theme="light"\]/);
});

test("Profile removes the two standalone notice boxes while preserving footer legal language", () => {
  assert.doesNotMatch(profileSource, /Stats are tied to your signed-in PackDex account/);
  assert.doesNotMatch(profileSource, /Fan-made Pokemon TCG pack-opening simulator/);
  assert.match(appSource, /Fan-made Pokemon TCG pack-opening simulator[\s\S]*?site-footer__bottom/);
});

test("Delete Account is hidden in Settings and still opens the deliberate confirmation flow", () => {
  assert.match(profileSource, /<details className="profile-settings">[\s\S]*?<summary>[\s\S]*?Manage your PackDex account/);
  assert.match(profileSource, /profile-settings__content[\s\S]*?Danger Zone[\s\S]*?Delete Account/);
  assert.doesNotMatch(profileSource, /profile-settings-section/);
  assert.match(appSource, /onDeleteAccount=\{\(\) => setIsDeleteAccountOpen\(true\)\}/);
  assert.match(deleteDialogSource, /confirmation !== "DELETE"/);
  assert.match(deleteDialogSource, /Permanently Delete Account/);
});

test("an existing authenticated session renders Profile during background validation", () => {
  assert.match(appSource, /const authUser = authSession\?\.user \|\| null/);
  assert.match(profileSource, /const isAccountResolving = isAuthLoading && !user/);
  assert.match(profileSource, /<AuthPanel user=\{user\} isAuthLoading=\{isAccountResolving\}/);
});

test("Profile data loading follows identity rather than tab or background-auth changes", () => {
  assert.match(profileDataEffect, /if \(!authUser\) return undefined/);
  assert.match(profileDataEffect, /const hasLoadedStats = loadedProfileStatsUserIdRef\.current === userId/);
  assert.match(profileDataEffect, /setAreProfileStatsLoading\(!hasLoadedStats\)/);
  assert.match(profileDataEffect, /}, \[authUser\?\.id\]\);/);
  assert.doesNotMatch(profileDataEffect, /activeTab|isAuthLoading/);
});

test("Profile, Collection, Open Packs, and rapid tab switching cannot cancel account hydration", () => {
  assert.match(appSource, /function selectMainTab\(tab\)[\s\S]*?setActiveTab\(tab\)[\s\S]*?setScreen\(nextScreen\)/);
  assert.doesNotMatch(appSource, /tabLoadTokenRef|setIsTabLoading/);
  assert.doesNotMatch(profileDataEffect, /screen|activeTab/);
  assert.match(appSource, /finally \{[\s\S]*?validationAttempt === authValidationAttemptRef\.current[\s\S]*?setIsAuthLoading\(false\)/);
});

test("signed-out, login, logout, and failed Profile loads all settle explicitly", () => {
  assert.match(appSource, /if \(isAuthLoading \|\| authUser\) return;[\s\S]*?setAreProfileStatsLoading\(false\)[\s\S]*?setProfileStatsError\(""\)/);
  assert.match(appSource, /function commitAuthSession\(nextSession\)[\s\S]*?setAuthSession\(nextSession\)/);
  assert.match(appSource, /handleContinueAsGuest[\s\S]*?commitAuthSession\(null\)[\s\S]*?setIsAuthLoading\(false\)/);
  assert.match(profileDataEffect, /\.catch\(\(error\) => \{[\s\S]*?setAreProfileStatsLoading\(false\)[\s\S]*?temporarily unavailable/);
});
