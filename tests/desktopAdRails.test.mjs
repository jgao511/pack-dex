import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("canonical set gameplay uses two separately mounted rail placements outside the center experience", async () => {
  const app = await read("../src/App.jsx");
  const stageStart = app.indexOf('<div className="public-set-experience__stage">');
  const contentStart = app.indexOf("<DeferredPublicSetPage", stageStart);
  const stageEnd = app.lastIndexOf("</div>", contentStart);

  assert.ok(stageStart >= 0);
  assert.ok(contentStart > stageStart);
  assert.ok(stageEnd > stageStart && stageEnd < contentStart);
  assert.equal((app.slice(stageStart, contentStart).match(/placement=\{AD_PLACEMENTS\.SET_RAIL\}/g) || []).length, 2);
  assert.match(app.slice(stageStart, contentStart), /public-set-rail-ad--left[\s\S]*minViewportWidth=\{1360\}/);
  assert.match(app.slice(stageStart, contentStart), /public-set-rail-ad--right[\s\S]*minViewportWidth=\{1280\}/);
  assert.match(app, /developmentLabel="Left ad rail"/);
  assert.match(app, /developmentLabel="Right ad rail"/);
  assert.match(app, /disabled: unsafeSetAdState \|\| screen !== "opening"/);
});

test("rail CSS preserves the 760px gameplay column and defines none, one, and two rail tiers", async () => {
  const css = await read("../src/public.css");

  assert.match(css, /max-width:\s*760px\s*!important/);
  assert.match(css, /@media \(max-width: 1279px\)[\s\S]*public-set-rail-ad[\s\S]*display:\s*none/);
  assert.match(css, /@media \(min-width: 1280px\) and \(max-width: 1359px\)[\s\S]*grid-template-areas:\s*"left main right"/);
  assert.match(css, /@media \(min-width: 1360px\)[\s\S]*grid-template-areas:\s*"left main right"/);
  assert.match(css, /public-set-rail-ad--left[\s\S]*border-right/);
  assert.match(css, /public-set-rail-ad--right[\s\S]*border-left/);
});

test("AdSlot supports per-instance rail thresholds and distinct development labels", async () => {
  const slot = await read("../src/ads/AdSlot.jsx");

  assert.match(slot, /developmentLabel = "Ad placement"/);
  assert.match(slot, /minViewportWidth/);
  assert.match(slot, /maxViewportWidth/);
  assert.match(slot, /viewportWidth >= minViewportWidth/);
  assert.match(slot, /<span>\{developmentLabel\}<\/span>/);
});
