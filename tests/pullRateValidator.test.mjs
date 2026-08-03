import assert from "node:assert/strict";
import test from "node:test";

import { activeSets } from "../src/data/sets.js";
import { validateHardcodedPullRates } from "../src/utils/pullRateTester.js";

function validateWithoutConsole(sets) {
  const originalGroup = console.group;
  const originalGroupEnd = console.groupEnd;
  const originalTable = console.table;
  console.group = () => {};
  console.groupEnd = () => {};
  console.table = () => {};
  try {
    return validateHardcodedPullRates(sets);
  } finally {
    console.group = originalGroup;
    console.groupEnd = originalGroupEnd;
    console.table = originalTable;
  }
}

test("hardcoded-rate validation does not apply modern second-foil rules to vintage or XY sets", () => {
  const selectedIds = new Set(["base-set", "xy0", "151"]);
  const rows = validateWithoutConsole(activeSets.filter((set) => selectedIds.has(set.id)));
  const byId = new Map(rows.map((row) => [row["Set Id"], row]));

  assert.equal(byId.get("base-set").Warnings, "None");
  assert.equal(byId.get("base-set")["Active Second-Foil Weights"], "N/A");
  assert.equal(byId.get("xy0").Warnings, "None");
  assert.equal(byId.get("xy0")["Active Second-Foil Weights"], "N/A");
  assert.equal(byId.get("151").Warnings, "None");
});
