import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { fileURLToPath, pathToFileURL } from "node:url";
import sharp from "sharp";
import { buildScannerCatalog } from "../src/lib/cardScanner/buildScannerCatalog.js";
import { calculateVisualDescriptorFromRgba } from "../src/lib/cardScanner/localVisual/visualDescriptors.js";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..");
const DEFAULT_OUTPUT_PATH = path.join(projectRoot, "src", "lib", "cardScanner", "generated", "scannerVisualIndex.json");
const DEFAULT_REPORT_PATH = path.join(projectRoot, "reports", "scanner-visual-index.json");
const DEFAULT_CACHE_PATH = path.join(projectRoot, "node_modules", ".cache", "packdex-scanner-visual-index");
const DEFAULT_ASSET_BASE_URL = "https://assets.pack-dex.com/sets";
const DESCRIPTOR_SIZE = 32;
const HASH_WIDTH = 8;

const cosineTable = Array.from({ length: HASH_WIDTH }, (_, frequency) => (
  Float64Array.from({ length: DESCRIPTOR_SIZE }, (_, position) => (
    Math.cos(((2 * position + 1) * frequency * Math.PI) / (2 * DESCRIPTOR_SIZE))
  ))
));

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

function bitsToHex(bits) {
  let result = "";
  for (let offset = 0; offset < bits.length; offset += 4) {
    let value = 0;
    for (let bit = 0; bit < 4; bit += 1) value = (value << 1) | Number(bits[offset + bit]);
    result += value.toString(16);
  }
  return result;
}

function calculatePerceptualHash(grayscale) {
  const rowProjection = Array.from({ length: DESCRIPTOR_SIZE }, () => new Float64Array(HASH_WIDTH));
  for (let y = 0; y < DESCRIPTOR_SIZE; y += 1) {
    for (let frequency = 0; frequency < HASH_WIDTH; frequency += 1) {
      let total = 0;
      for (let x = 0; x < DESCRIPTOR_SIZE; x += 1) {
        total += grayscale[y * DESCRIPTOR_SIZE + x] * cosineTable[frequency][x];
      }
      rowProjection[y][frequency] = total;
    }
  }

  const coefficients = [];
  for (let vertical = 0; vertical < HASH_WIDTH; vertical += 1) {
    for (let horizontal = 0; horizontal < HASH_WIDTH; horizontal += 1) {
      let total = 0;
      for (let y = 0; y < DESCRIPTOR_SIZE; y += 1) {
        total += rowProjection[y][horizontal] * cosineTable[vertical][y];
      }
      coefficients.push(total);
    }
  }
  const threshold = median(coefficients.slice(1));
  return bitsToHex(coefficients.map((value, index) => index === 0 || value >= threshold));
}

function calculateEdgeHash(grayscale) {
  const cellAverages = Array.from({ length: 8 }, () => new Float64Array(9));
  for (let row = 0; row < 8; row += 1) {
    const yStart = Math.floor(row * DESCRIPTOR_SIZE / 8);
    const yEnd = Math.floor((row + 1) * DESCRIPTOR_SIZE / 8);
    for (let column = 0; column < 9; column += 1) {
      const xStart = Math.floor(column * DESCRIPTOR_SIZE / 9);
      const xEnd = Math.max(xStart + 1, Math.floor((column + 1) * DESCRIPTOR_SIZE / 9));
      let total = 0;
      let count = 0;
      for (let y = yStart; y < yEnd; y += 1) {
        for (let x = xStart; x < xEnd; x += 1) {
          total += grayscale[y * DESCRIPTOR_SIZE + x];
          count += 1;
        }
      }
      cellAverages[row][column] = total / count;
    }
  }
  return bitsToHex(cellAverages.flatMap((columns) => (
    Array.from({ length: 8 }, (_, column) => columns[column] < columns[column + 1])
  )));
}

function calculateColorHistogram(rgb) {
  const histogram = new Uint32Array(24);
  const pixels = rgb.length / 3;
  for (let offset = 0; offset < rgb.length; offset += 3) {
    histogram[Math.min(7, rgb[offset] >> 5)] += 1;
    histogram[8 + Math.min(7, rgb[offset + 1] >> 5)] += 1;
    histogram[16 + Math.min(7, rgb[offset + 2] >> 5)] += 1;
  }
  const quantized = Uint8Array.from(histogram, (count) => Math.round(count * 255 / pixels));
  return Buffer.from(quantized).toString("base64");
}

export async function calculateVisualDescriptor(image) {
  const { data, info } = await sharp(image)
    .rotate()
    .ensureAlpha()
    .toColourspace("srgb")
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.channels !== 4) throw new Error(`Expected four RGBA channels; received ${info.channels}.`);
  return calculateVisualDescriptorFromRgba(data, info.width, info.height);
}

export function resolveCatalogImageUrl(imageUrl, assetBaseUrl = DEFAULT_ASSET_BASE_URL) {
  if (/^https?:\/\//i.test(String(imageUrl || ""))) return String(imageUrl);
  const normalized = String(imageUrl || "").trim().replace(/\\/g, "/").replace(/^\/+/, "")
    .replace(/^assets\/sets\//i, "").replace(/^sets\//i, "");
  return normalized ? `${assetBaseUrl.replace(/\/+$/, "")}/${normalized}` : "";
}

function cacheFileName(source) {
  const pathname = (() => { try { return new URL(source).pathname; } catch { return source; } })();
  const extension = path.extname(pathname).replace(/[^.a-z0-9]/gi, "").slice(0, 8) || ".img";
  return `${crypto.createHash("sha256").update(source).digest("hex")}${extension}`;
}

export function createCachedImageLoader({ cachePath = DEFAULT_CACHE_PATH, offline = false } = {}) {
  const stats = { cacheHits: 0, downloads: 0 };
  return {
    stats,
    async load(source) {
      if (!/^https?:\/\//i.test(source)) return fs.readFile(source);
      const cachedPath = path.join(cachePath, cacheFileName(source));
      try {
        const cached = await fs.readFile(cachedPath);
        stats.cacheHits += 1;
        return cached;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      if (offline) throw new Error("Image is not cached and --offline was requested.");
      const response = await fetch(source, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      if (!buffer.length) throw new Error("Downloaded image is empty.");
      await fs.mkdir(cachePath, { recursive: true });
      const temporaryPath = `${cachedPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
      await fs.writeFile(temporaryPath, buffer);
      try {
        await fs.rename(temporaryPath, cachedPath);
      } catch (error) {
        await fs.rm(temporaryPath, { force: true });
        if (error.code !== "EEXIST") throw error;
      }
      stats.downloads += 1;
      return buffer;
    },
  };
}

export async function generateVisualIndex({ entries, loadImage, concurrency = 12, onProgress } = {}) {
  if (!Array.isArray(entries)) throw new TypeError("entries must be an array.");
  const cards = {};
  const failures = [];
  let nextIndex = 0;
  let processed = 0;
  const workerCount = Math.max(1, Math.min(Number(concurrency) || 1, entries.length || 1));

  async function work() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= entries.length) return;
      const entry = entries[index];
      try {
        if (!entry.cardId || !entry.source) throw new Error("Trusted cardId or image source is missing.");
        cards[entry.cardId] = await calculateVisualDescriptor(await loadImage(entry.source, entry));
      } catch (error) {
        failures.push({ cardId: entry.cardId || null, source: entry.source || null, error: error.message });
      } finally {
        processed += 1;
        onProgress?.({ processed, total: entries.length, failures: failures.length });
      }
    }
  }
  await Promise.all(Array.from({ length: workerCount }, work));

  const sortedCards = Object.fromEntries(Object.entries(cards).sort(([left], [right]) => left.localeCompare(right)));
  return {
    manifest: {
      version: 1,
      descriptor: { pHash: "64-bit hex", edgeHash: "64-bit hex", colorHistogram: "24-byte base64" },
      cards: sortedCards,
    },
    failures: failures.sort((left, right) => String(left.cardId).localeCompare(String(right.cardId))),
  };
}

function parseArguments(argv) {
  const options = {};
  for (const argument of argv) {
    if (argument === "--offline") options.offline = true;
    else if (argument === "--strict") options.strict = true;
    else {
      const match = argument.match(/^--([^=]+)=(.*)$/);
      if (!match) throw new Error(`Unknown argument: ${argument}`);
      options[match[1]] = match[2];
    }
  }
  return options;
}

function resolveFromProject(value, fallback) {
  return value ? path.resolve(projectRoot, value) : fallback;
}

async function loadFixtureEntries(fixtureManifestPath, trustedById) {
  const fixtureRoot = path.dirname(fixtureManifestPath);
  const fixtures = JSON.parse(await fs.readFile(fixtureManifestPath, "utf8"));
  return fixtures.map((fixture) => {
    if (!trustedById.has(fixture.cardId)) throw new Error(`Fixture is not in the trusted catalog: ${fixture.cardId}`);
    return { cardId: fixture.cardId, source: path.resolve(fixtureRoot, fixture.fixture) };
  });
}

export async function runCli(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  const outputPath = resolveFromProject(options.output, DEFAULT_OUTPUT_PATH);
  const reportPath = resolveFromProject(options.report, DEFAULT_REPORT_PATH);
  const cachePath = resolveFromProject(options.cache, DEFAULT_CACHE_PATH);
  const trustedCatalog = buildScannerCatalog();
  const trustedById = new Map(trustedCatalog.map((card) => [card.cardId, card]));
  let entries;
  if (options.fixtures) {
    entries = await loadFixtureEntries(resolveFromProject(options.fixtures), trustedById);
  } else {
    entries = trustedCatalog.map((card) => ({
      cardId: card.cardId,
      source: resolveCatalogImageUrl(card.imageUrl, options["asset-base"] || DEFAULT_ASSET_BASE_URL),
    }));
  }
  if (options["card-id"]) entries = entries.filter((entry) => entry.cardId === options["card-id"]);
  if (options.limit) entries = entries.slice(0, Math.max(0, Number(options.limit) || 0));
  if (!entries.length) throw new Error("No trusted catalog cards matched the requested index selection.");

  const loader = createCachedImageLoader({ cachePath, offline: options.offline });
  let lastProgress = 0;
  const startedAt = performance.now();
  const result = await generateVisualIndex({
    entries,
    loadImage: loader.load,
    concurrency: options.concurrency || 12,
    onProgress({ processed, total, failures }) {
      if (processed === total || processed - lastProgress >= 250) {
        lastProgress = processed;
        process.stdout.write(`Indexed ${processed}/${total}; failures ${failures}\n`);
      }
    },
  });
  const serialized = `${JSON.stringify(result.manifest)}\n`;
  const rawBytes = Buffer.byteLength(serialized);
  const gzipBytes = gzipSync(serialized, { level: 9 }).byteLength;
  const report = {
    generatedAt: new Date().toISOString(),
    scannerTestOnly: true,
    trustedCatalogCardCount: trustedCatalog.length,
    requestedCardCount: entries.length,
    indexedCardCount: Object.keys(result.manifest.cards).length,
    missingOrUnreadableCount: result.failures.length,
    coverage: Object.keys(result.manifest.cards).length / entries.length,
    rawBytes,
    gzipBytes,
    cacheHits: loader.stats.cacheHits,
    downloads: loader.stats.downloads,
    durationMs: performance.now() - startedAt,
    outputPath: path.relative(projectRoot, outputPath).replaceAll("\\", "/"),
    failures: result.failures,
  };
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(outputPath, serialized);
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (options.strict && result.failures.length) throw new Error(`${result.failures.length} catalog images could not be indexed.`);
  return report;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) {
  runCli().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
