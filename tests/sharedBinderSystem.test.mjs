import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const desktopAppPath = new URL("../src/App.jsx", import.meta.url);
const mobileAppPath = new URL("../mobile-app/src/App.jsx", import.meta.url);
const binderSystemPath = new URL("../src/components/binders/BinderSystem.jsx", import.meta.url);
const binderStylesPath = new URL("../src/components/binders/BinderSystem.css", import.meta.url);

test("desktop and mobile render the same shared binder system", async () => {
  const [desktopApp, mobileApp] = await Promise.all([
    readFile(desktopAppPath, "utf8"),
    readFile(mobileAppPath, "utf8"),
  ]);

  assert.match(desktopApp, /import BinderSystem from "\.\/components\/binders\/BinderSystem\.jsx"/);
  assert.match(mobileApp, /import BinderSystem from "\.\.\/\.\.\/src\/components\/binders\/BinderSystem\.jsx"/);
  assert.match(desktopApp, /<BinderSystem[\s\S]*onAddCards=\{onAddBinderCards\}/);
  assert.match(mobileApp, /<BinderSystem[\s\S]*onAddCards=\{onAddBinderCards\}/);
});

test("shared binder pages preserve the mobile nine-slot model", async () => {
  const binderSystem = await readFile(binderSystemPath, "utf8");

  assert.match(binderSystem, /const BINDER_PAGE_SIZE = 9;/);
  assert.match(binderSystem, /Array\.from\(\{ length: BINDER_PAGE_SIZE \}\)/);
  assert.match(binderSystem, /pageIndex \* BINDER_PAGE_SIZE/);
});

test("desktop binder differences are layout-only", async () => {
  const binderStyles = await readFile(binderStylesPath, "utf8");

  assert.match(binderStyles, /@media \(min-width: 760px\)/);
  assert.match(binderStyles, /\.custom-binder-grid \{\s*grid-template-columns: repeat\(6,/);
  assert.match(binderStyles, /\.master-binder-grid-mobile \{\s*display: grid;\s*grid-template-columns: repeat\(3,/);
});
