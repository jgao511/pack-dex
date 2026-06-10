import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sets } from "../src/data/sets.js";
import { getSetLogoUrl } from "../src/utils/assetUrls.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const logoDir = path.join(repoRoot, "public", "set-logos");

function publicPathToFilePath(publicPath) {
  return path.join(repoRoot, "public", publicPath.replace(/^\/+/, ""));
}

function toPosix(value) {
  return String(value || "").replace(/\\/g, "/");
}

const entries = await readdir(logoDir, { withFileTypes: true }).catch(() => []);
const actualFiles = entries.filter((entry) => entry.isFile()).map((entry) => entry.name).sort();
const actualFileSet = new Set(actualFiles);
const expectedFiles = new Map();
const missing = [];
const casingMismatches = [];
const invalidUrls = [];

for (const set of sets) {
  const logoUrl = getSetLogoUrl(set);

  if (!logoUrl.startsWith("/set-logos/") || logoUrl.includes("/public/")) {
    invalidUrls.push({ id: set.id, name: set.name, logoUrl });
    continue;
  }

  const expectedFileName = path.basename(logoUrl);
  const filePath = publicPathToFilePath(logoUrl);
  const fileStat = await stat(filePath).catch(() => null);

  expectedFiles.set(expectedFileName, { id: set.id, name: set.name, logoUrl });

  if (!fileStat?.isFile() || fileStat.size <= 0) {
    const caseInsensitiveMatch = actualFiles.find((fileName) => fileName.toLowerCase() === expectedFileName.toLowerCase());

    if (caseInsensitiveMatch) {
      casingMismatches.push({
        id: set.id,
        name: set.name,
        expected: expectedFileName,
        actual: caseInsensitiveMatch,
        logoUrl,
      });
    } else {
      missing.push({ id: set.id, name: set.name, expected: expectedFileName, logoUrl });
    }
  }
}

const extra = actualFiles.filter((fileName) => !expectedFiles.has(fileName));

const summary = {
  sets: sets.length,
  expectedLogoFiles: expectedFiles.size,
  actualLogoFiles: actualFiles.length,
  missing,
  extra,
  casingMismatches,
  invalidUrls,
  sampleExpectedUrls: Array.from(expectedFiles.values())
    .slice(0, 8)
    .map((entry) => ({ id: entry.id, logoUrl: entry.logoUrl })),
};

console.log(JSON.stringify(summary, null, 2));

if (missing.length || casingMismatches.length || invalidUrls.length) {
  console.error("Set logo verification failed.");
  process.exitCode = 1;
} else {
  console.log(`Set logo verification passed for ${sets.length} sets in ${toPosix(path.relative(repoRoot, logoDir))}.`);
}
