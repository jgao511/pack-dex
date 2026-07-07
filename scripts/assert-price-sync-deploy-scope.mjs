import fs from "node:fs";
import path from "node:path";

const ROOT_DIR = process.cwd();
const FUNCTION_DIR = path.join(ROOT_DIR, "supabase", "functions", "sync-card-prices");
const INDEX_PATH = path.join(FUNCTION_DIR, "index.ts");
const CATALOG_PATH = path.join(FUNCTION_DIR, "catalog.json");

const indexSource = fs.readFileSync(INDEX_PATH, "utf8");
const forbiddenPatterns = [
  /\.\.\/\.\.\/\.\.\/src\//,
  /\.\.\/\.\.\/\.\.\/public\//,
  /\.\.\/\.\.\/\.\.\/dist\//,
  /card-back\.png/,
  /set-logos\//,
  /assets\/sets\//,
];

const match = forbiddenPatterns.find((pattern) => pattern.test(indexSource));
if (match) {
  throw new Error(`sync-card-prices deploy scope violation: ${match} matched index.ts.`);
}

if (!fs.existsSync(CATALOG_PATH)) {
  throw new Error("Missing sync-card-prices catalog.json. Run npm run build:price-sync-catalog first.");
}

const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8"));
const catalogText = JSON.stringify(catalog);
if (/assets\/sets\/|set-logos\/|\.png|\.jpg|\.webp/i.test(catalogText)) {
  throw new Error("sync-card-prices catalog contains image or asset paths.");
}

console.log("sync-card-prices deploy scope ok: no app/image asset imports.");
