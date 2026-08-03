import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VALIDATOR_PATH = path.join(ROOT_DIR, "scripts", "pack-rate-validator.mjs");

function runValidator(args) {
  return spawnSync(process.execPath, [VALIDATOR_PATH, ...args], {
    cwd: ROOT_DIR,
    encoding: "utf8",
    timeout: 30_000,
  });
}

test("CLI validates all active structures while reporting a requested active set", () => {
  const result = runValidator(["--packs=1", "--sets=151"]);
  const output = `${result.stdout}\n${result.stderr}`;

  assert.equal(result.status, 0, output);
  assert.match(output, /Active sets structurally validated: 129/);
  assert.match(output, /Sets reported: 1/);
  assert.match(output, /Set: 151 \(151\)/);
  assert.match(output, /Validation: OK/);
  assert.match(output, /All 1 reported active sets passed authoritative pack structure validation/);
});

test("CLI rejects retired sets instead of simulating them", () => {
  const result = runValidator(["--packs=1", "--sets=30th-anniversary"]);
  const output = `${result.stdout}\n${result.stderr}`;

  assert.equal(result.status, 1, output);
  assert.match(output, /Unknown or retired set id\(s\): 30th-anniversary/);
});
