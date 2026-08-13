import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { activeSets } from "../src/data/sets.js";
import { createCanonicalSetPath, createCanonicalSetSlug } from "../src/lib/setSlug.js";
import { getPullableCollectionCards } from "../src/utils/collectionStorage.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const destination = path.join(repoRoot, "src", "data", "generated", "setCatalogMetadata.json");

export function buildSetCatalogMetadata(sets = activeSets) {
  return sets.map((set) => ({
    id: String(set.id),
    name: set.name,
    era: set.era || "Other",
    releaseDate: set.releaseDate || null,
    setFolder: set.setFolder || set.id,
    logoPath: set.logoPath || `${set.setFolder || set.id}/logo.png`,
    packArtPath: set.packArtPath || "",
    isNew: Boolean(set.isNew),
    cardCount: getPullableCollectionCards(set).length,
    slug: createCanonicalSetSlug(set),
    path: createCanonicalSetPath(set),
  }));
}

export async function generateSetCatalogMetadata({ check = false } = {}) {
  const metadata = buildSetCatalogMetadata();
  const serialized = `${JSON.stringify(metadata, null, 2)}\n`;

  if (check) {
    const current = await fs.readFile(destination, "utf8").catch(() => "");
    if (current !== serialized) {
      throw new Error("Generated set catalog metadata is stale. Run npm run generate:set-catalog.");
    }
    return { destination, count: metadata.length, changed: false };
  }

  await fs.mkdir(path.dirname(destination), { recursive: true });
  const current = await fs.readFile(destination, "utf8").catch(() => "");
  if (current !== serialized) await fs.writeFile(destination, serialized, "utf8");
  return { destination, count: metadata.length, changed: current !== serialized };
}

const isDirectRun = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectRun) {
  const result = await generateSetCatalogMetadata({ check: process.argv.includes("--check") });
  console.log(`${result.changed ? "Generated" : "Verified"} ${result.count} lightweight set catalog entries.`);
}
