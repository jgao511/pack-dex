import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { INDEXABLE_PUBLIC_PATHS, PACKDEX_SITE_ORIGIN } from "../src/lib/publicRoutes.js";
import { canonicalSetCatalog } from "../src/lib/publicSetRoutes.js";

export { PACKDEX_SITE_ORIGIN };
export const SITEMAP_STATIC_PATHS = INDEXABLE_PUBLIC_PATHS;

export function getSitemapPaths() {
  return [
    ...SITEMAP_STATIC_PATHS,
    ...canonicalSetCatalog.map((entry) => entry.path),
  ];
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function renderSitemapXml(paths = getSitemapPaths(), origin = PACKDEX_SITE_ORIGIN) {
  const normalizedOrigin = String(origin).replace(/\/+$/, "");
  const uniquePaths = [...new Set(paths)];
  const urlEntries = uniquePaths
    .map((pathname) => `  <url>\n    <loc>${escapeXml(`${normalizedOrigin}${pathname}`)}</loc>\n  </url>`)
    .join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    urlEntries,
    "</urlset>",
    "",
  ].join("\n");
}

export async function writeSitemap({
  destination = path.join(process.cwd(), "public", "sitemap.xml"),
  origin = PACKDEX_SITE_ORIGIN,
} = {}) {
  const sitemapPaths = getSitemapPaths();
  if (sitemapPaths.length !== new Set(sitemapPaths).size) {
    throw new Error("Sitemap generation found duplicate canonical paths");
  }

  await fs.writeFile(destination, renderSitemapXml(sitemapPaths, origin), "utf8");
  return { destination, urlCount: sitemapPaths.length, setUrlCount: canonicalSetCatalog.length };
}

const isDirectRun = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectRun) {
  const result = await writeSitemap();
  console.log(
    `Generated ${result.urlCount} canonical URLs (${result.setUrlCount} sets) in ${path.relative(process.cwd(), result.destination)}.`
  );
}
