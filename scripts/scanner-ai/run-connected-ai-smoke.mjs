import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const manifestPath = path.join(root, "tests", "fixtures", "scanner", "local-pixel-manifest.json");
const fixtureRoot = path.join(root, "tests", "fixtures", "scanner", "local-pixel");
const smokeCardsPath = path.join(root, "artifacts", "scanner-ai", "generated", "smoke-card-list.json");
const outputPath = path.resolve(process.argv[2] || path.join(root, "artifacts", "scanner-ai", "reports", "connected-ai-smoke-results.json"));
const adb = process.env.ADB || path.join(process.env.LOCALAPPDATA || "", "Android", "Sdk", "platform-tools", "adb.exe");
const stagingRoot = "/data/local/tmp/PackDexScannerAiFixtures";
const privateRelativeRoot = "cache/PackDexScannerAiFixtures";
const remoteRoot = "/data/user/0/com.packdex.app/cache/PackDexScannerAiFixtures";
const port = 9222;
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const runAdb = (...command) => execFileSync(adb, command, { encoding: "utf8" });
const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
const smokeCards = JSON.parse(await fs.readFile(smokeCardsPath, "utf8"));
const smokeCardById = new Map(smokeCards.cards.map((card) => [card.cardId, card]));

async function connect() {
  const targets = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json());
  const target = targets.find(({ type }) => type === "page");
  if (!target) throw new Error("No debuggable PackDex WebView page was found.");
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", () => reject(new Error("Could not connect to the PackDex WebView.")), { once: true });
  });
  let nextId = 1;
  const pending = new Map();
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error || message.result?.exceptionDetails) request.reject(new Error(JSON.stringify(message.error || message.result.exceptionDetails)));
    else request.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression, awaitPromise = false) => {
    const response = await send("Runtime.evaluate", { expression, awaitPromise, returnByValue: true });
    return response.result?.value;
  };
  return { socket, send, evaluate };
}

function cosine(a, b) {
  let score = 0;
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) score += a[index] * b[index];
  return score;
}

for (const item of manifest.items) await fs.access(path.join(fixtureRoot, item.fixture));
runAdb("shell", "rm", "-rf", stagingRoot);
runAdb("shell", "mkdir", "-p", stagingRoot);
runAdb("shell", "run-as", "com.packdex.app", "rm", "-rf", privateRelativeRoot);
runAdb("shell", "run-as", "com.packdex.app", "mkdir", "-p", privateRelativeRoot);
for (const item of manifest.items) {
  const staged = `${stagingRoot}/${item.fixture}`;
  runAdb("push", path.join(fixtureRoot, item.fixture), staged);
  runAdb("shell", "chmod", "644", staged);
  runAdb("shell", "run-as", "com.packdex.app", "cp", staged, `${privateRelativeRoot}/${item.fixture}`);
}

runAdb("shell", "am", "force-stop", "com.packdex.app");
runAdb("shell", "monkey", "-p", "com.packdex.app", "-c", "android.intent.category.LAUNCHER", "1");
await sleep(2_000);
const sockets = runAdb("shell", "cat", "/proc/net/unix").match(/@webview_devtools_remote_\d+/g) || [];
if (!sockets.length) throw new Error("The connected PackDex WebView did not expose a debug socket.");
try { runAdb("forward", "--remove", `tcp:${port}`); } catch {}
runAdb("forward", `tcp:${port}`, `localabstract:${sockets.at(-1).slice(1)}`);

let client = await connect();
try { await client.evaluate("location.href='https://localhost/?scanner-test=1'"); } catch {}
client.socket.close();
await sleep(2_000);
client = await connect();
await client.evaluate(`(async()=>{const started=Date.now();while((!globalThis.__PACKDEX_RUN_AI_SCANNER_FILE__||!globalThis.__PACKDEX_BUILD_AI_SMOKE_INDEX__)&&Date.now()-started<30000)await new Promise(resolve=>setTimeout(resolve,100));return Boolean(globalThis.__PACKDEX_RUN_AI_SCANNER_FILE__&&globalThis.__PACKDEX_BUILD_AI_SMOKE_INDEX__);})()`, true);

const document = await client.send("DOM.getDocument", { depth: 2, pierce: true });
const input = await client.send("DOM.querySelector", { nodeId: document.root.nodeId, selector: "input[type=file]" });
if (!input.nodeId) throw new Error("Scanner file input was not found.");

const indexBuildStarted = Date.now();
const smokeIndex = await client.evaluate(`(async()=>{globalThis.__PACKDEX_AI_SMOKE_INDEX__=await globalThis.__PACKDEX_BUILD_AI_SMOKE_INDEX__(${JSON.stringify(smokeCards.cards)});return {cards:globalThis.__PACKDEX_AI_SMOKE_INDEX__.cards,dimensions:globalThis.__PACKDEX_AI_SMOKE_INDEX__.dimensions,totalMs:globalThis.__PACKDEX_AI_SMOKE_INDEX__.totalMs,errors:globalThis.__PACKDEX_AI_SMOKE_INDEX__.errors};})()`, true);
const indexBuildMs = Date.now() - indexBuildStarted;
const results = [];
let deterministic = null;
try {
  for (let index = 0; index < manifest.items.length; index += 1) {
    const expected = manifest.items[index];
    await client.send("DOM.setFileInputFiles", { nodeId: input.nodeId, files: [`${remoteRoot}/${expected.fixture}`] });
    let reading;
    try {
      reading = await client.evaluate("globalThis.__PACKDEX_RUN_AI_SCANNER_FILE__(document.querySelector('input[type=file]').files[0], { index: globalThis.__PACKDEX_AI_SMOKE_INDEX__, includeEmbedding: true })", true);
    } catch (error) {
      reading = { error: error.message, result: { results: [] }, retrieval: {}, timing: {} };
    }
    if (index === 0) {
      const again = await client.evaluate("globalThis.__PACKDEX_RUN_AI_SCANNER_FILE__(document.querySelector('input[type=file]').files[0], { index: globalThis.__PACKDEX_AI_SMOKE_INDEX__, includeEmbedding: true })", true);
      deterministic = {
        identicalCosine: cosine(reading.queryEmbedding || [], again.queryEmbedding || []),
        differentCosine: null,
        dimensions: reading.queryEmbedding?.length || 0,
        norm: Math.sqrt((reading.queryEmbedding || []).reduce((sum, value) => sum + value * value, 0)),
      };
    } else if (index === 1 && deterministic) {
      deterministic.differentCosine = cosine(results[0]?.queryEmbedding || [], reading.queryEmbedding || []);
    }
    const aiRank = reading.result.results.findIndex(({ cardId }) => cardId === expected.cardId) + 1;
    const item = {
      fixture: expected.fixture,
      expected: { cardId: expected.cardId, name: expected.name, set: expected.set, collectorNumber: expected.collectorNumber },
      resolvedReferenceUrl: smokeCardById.get(expected.cardId)?.imageUrl || null,
      aiRank: aiRank || null,
      cosineSimilarity: aiRank ? reading.result.results[aiRank - 1]?.visualScore ?? null : null,
      margin: reading.retrieval?.margin ?? null,
      modelInitMs: reading.timing?.modelInitMs ?? null,
      inferenceMs: reading.timing?.inferenceMs ?? null,
      indexSearchMs: reading.timing?.indexSearchMs ?? null,
      preparationMs: reading.timing?.preparationMs ?? null,
      totalAiPathMs: reading.timing?.totalMs ?? null,
      error: reading.error || null,
      topResults: reading.result.results.slice(0, 3),
      queryEmbedding: reading.queryEmbedding || [],
    };
    results.push(item);
    console.log(`${index + 1}/${manifest.items.length} ${expected.fixture}: rank ${item.aiRank || "not found"} in ${item.totalAiPathMs ?? "?"} ms`);
  }
} finally {
  await client.evaluate("globalThis.__PACKDEX_RELEASE_AI_SCANNER__?.()", true).catch(() => {});
  client.socket.close();
  runAdb("shell", "rm", "-rf", stagingRoot);
  runAdb("shell", "run-as", "com.packdex.app", "rm", "-rf", privateRelativeRoot);
}

for (const item of results) delete item.queryEmbedding;
const times = results.map(({ totalAiPathMs }) => totalAiPathMs).filter(Number.isFinite);
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  device: {
    model: runAdb("shell", "getprop", "ro.product.model").trim(),
    product: runAdb("shell", "getprop", "ro.product.device").trim(),
  },
  path: "browser File input -> createTemporaryImage -> prepareCardImage(rectifyCanvas) -> PackDexAiEmbedderPlugin -> MediaPipe ImageEmbedder -> cosine search over 128-card smoke index",
  expectedIdsInjectedIntoRanking: false,
  ocrUsed: false,
  orbUsed: false,
  smokeIndex: {
    cardCount: smokeIndex.cards?.length || 0,
    dimensions: smokeIndex.dimensions || 0,
    buildMs: indexBuildMs,
    embedMs: smokeIndex.totalMs || null,
    errors: smokeIndex.errors || [],
  },
  deterministic,
  summary: {
    count: results.length,
    top1: results.filter(({ aiRank }) => aiRank === 1).length,
    top3: results.filter(({ aiRank }) => aiRank && aiRank <= 3).length,
    notFound: results.filter(({ aiRank }) => !aiRank).length,
    meanMs: times.length ? times.reduce((sum, value) => sum + value, 0) / times.length : null,
  },
  items: results,
};
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Wrote ${outputPath}`);
