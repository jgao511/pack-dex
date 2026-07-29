import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const desktopAppPath = new URL("../src/App.jsx", import.meta.url);
const mobileAppPath = new URL("../mobile-app/src/App.jsx", import.meta.url);
const binderSystemPath = new URL("../src/components/binders/BinderSystem.jsx", import.meta.url);
const binderStylesPath = new URL("../src/components/binders/BinderSystem.css", import.meta.url);
const binderPickersPath = new URL("../src/components/binders/BinderPickers.jsx", import.meta.url);
const binderPersistencePath = new URL("../src/lib/binderPersistence.js", import.meta.url);

test("desktop and mobile render the same shared binder system", async () => {
  const [desktopApp, mobileApp] = await Promise.all([
    readFile(desktopAppPath, "utf8"),
    readFile(mobileAppPath, "utf8"),
  ]);

  assert.match(desktopApp, /import BinderSystem from "\.\/components\/binders\/BinderSystem\.jsx"/);
  assert.match(mobileApp, /import BinderSystem from "\.\.\/\.\.\/src\/components\/binders\/BinderSystem\.jsx"/);
  assert.match(desktopApp, /<BinderSystem[\s\S]*onAddCards=\{onAddBinderCards\}/);
  assert.match(mobileApp, /<BinderSystem[\s\S]*onAddCards=\{onAddBinderCards\}/);
  assert.match(desktopApp, /onDeleteBinder=\{onDeleteBinder\}/);
  assert.match(mobileApp, /onDeleteBinder=\{onDeleteBinder\}/);
});

test("shared binder pages preserve the mobile nine-slot model", async () => {
  const binderSystem = await readFile(binderSystemPath, "utf8");

  assert.match(binderSystem, /const BINDER_PAGE_SIZE = 9;/);
  assert.match(binderSystem, /Array\.from\(\{ length: BINDER_PAGE_SIZE \}\)/);
  assert.match(binderSystem, /pageIndex \* BINDER_PAGE_SIZE/);
});

test("desktop binder colors are explicitly scoped without changing the mobile surface", async () => {
  const [desktopApp, mobileApp, binderStyles] = await Promise.all([
    readFile(desktopAppPath, "utf8"),
    readFile(mobileAppPath, "utf8"),
    readFile(binderStylesPath, "utf8"),
  ]);

  assert.match(binderStyles, /@media \(min-width: 760px\)/);
  assert.match(binderStyles, /\.custom-binder-grid \{\s*grid-template-columns: repeat\(6,/);
  assert.match(binderStyles, /\.master-binder-grid-mobile \{\s*display: grid;\s*grid-template-columns: repeat\(3,/);
  assert.match(binderStyles, /\.shared-binder-system\.is-desktop-surface \.binder-empty-state/);
  assert.match(desktopApp, /<BinderSystem[\s\S]*desktopSurface/);
  assert.doesNotMatch(mobileApp, /desktopSurface/);
});

test("binder deletion is confirmed, shared, and isolated from Collection data", async () => {
  const [binderSystem, persistence] = await Promise.all([
    readFile(binderSystemPath, "utf8"),
    readFile(binderPersistencePath, "utf8"),
  ]);

  assert.match(binderSystem, /Delete Binder\?/);
  assert.match(binderSystem, /Cards in your Collection will stay unchanged/);
  assert.match(binderSystem, /deletePending \? "Deleting…" : "Delete Binder"/);
  assert.match(binderSystem, /setDeleteError\("This binder could not be deleted\. Please try again\."\)/);
  assert.match(persistence, /await deleteCloudBinder\(userId, binderId\);\s*return loadCloudBinders\(userId\);/);
  assert.doesNotMatch(persistence, /collectionStorage|saveCollection|loadCloudCollection/);
});

test("binder views and pickers do not render owned copy counts", async () => {
  const [binderSystem, binderPickers, binderStyles] = await Promise.all([
    readFile(binderSystemPath, "utf8"),
    readFile(binderPickersPath, "utf8"),
    readFile(binderStylesPath, "utf8"),
  ]);

  assert.doesNotMatch(binderSystem, /binder-pocket-quantity|owned quantity/);
  assert.doesNotMatch(binderPickers, /item\.quantity|preview\.quantity|Owned ×/);
  assert.doesNotMatch(binderStyles, /\.binder-pocket-quantity/);
});
