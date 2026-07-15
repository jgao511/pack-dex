import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(root, "tests", "fixtures", "scanner", "local-pixel-manifest.json");
const fixtureRoot = path.join(root, "tests", "fixtures", "scanner", "local-pixel");
const outputPath = path.resolve(process.argv[2] || path.join(root, "reports", "scanner-local-pixel-results.json"));
const adb = process.env.ADB || path.join(process.env.LOCALAPPDATA || "", "Android", "Sdk", "platform-tools", "adb.exe");
const stagingRoot = "/data/local/tmp/PackDexScannerFixtures";
const privateRelativeRoot = "cache/PackDexScannerFixtures";
const remoteRoot = "/data/user/0/com.packdex.app/cache/PackDexScannerFixtures";
const port = 9222;
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const runAdb = (...command) => execFileSync(adb, command, { encoding: "utf8" });
const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));

function compactOcrNames(candidates = [], expectedName = "") {
  const expectedTokens = String(expectedName)
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/gi, " ")
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length > 2 && !["radiant", "break"].includes(token));
  const raw = [...new Set(candidates
    .map((candidate) => String(candidate?.raw || candidate || "").trim())
    .filter((value) => value && value.length <= 80))];
  const matched = raw.filter((value) => {
    const normalized = value.normalize("NFKD").replace(/[^a-z0-9]+/gi, " ").toLowerCase();
    return expectedTokens.some((token) => normalized.includes(token));
  });
  return [...new Set([...matched.slice(0, 3), ...raw.slice(0, 3)])].slice(0, 5);
}

function compactOcrNumbers(candidates = []) {
  return [...new Set(candidates
    .map((candidate) => String(candidate?.raw || candidate || "").trim())
    .filter(Boolean))].slice(0, 5);
}

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
await client.evaluate(`(async()=>{const started=Date.now();while((!globalThis.__PACKDEX_SCANNER_PREWARM__||!globalThis.__PACKDEX_RUN_LOCAL_SCANNER_FILE__)&&Date.now()-started<20000)await new Promise(resolve=>setTimeout(resolve,100));return Boolean(globalThis.__PACKDEX_RUN_LOCAL_SCANNER_FILE__);})()`, true);

const document = await client.send("DOM.getDocument", { depth: 2, pierce: true });
const input = await client.send("DOM.querySelector", { nodeId: document.root.nodeId, selector: "input[type=file]" });
if (!input.nodeId) throw new Error("Scanner file input was not found.");
const results = [];
try {
  for (let index = 0; index < manifest.items.length; index += 1) {
    const expected = manifest.items[index];
    await client.send("DOM.setFileInputFiles", { nodeId: input.nodeId, files: [`${remoteRoot}/${expected.fixture}`] });
    let reading;
    try {
      reading = await client.evaluate("globalThis.__PACKDEX_RUN_LOCAL_SCANNER_FILE__(document.querySelector('input[type=file]').files[0])", true);
    } catch (error) {
      reading = {
        error: error.message, ocrNames: [], ocrNumbers: [], selectedProposalId: null, selectedProposalSource: null,
        proposals: [], lightweightCandidates: [], orbShortlist: [], orbCandidates: [], timing: null,
        result: { confidence: "low", results: [] },
      };
    }
    const finalRank = reading.result.results.findIndex(({ cardId }) => cardId === expected.cardId) + 1;
    const visualRank = reading.lightweightCandidates.findIndex(({ cardId }) => cardId === expected.cardId) + 1;
    const orbRank = reading.orbCandidates.findIndex(({ cardId }) => cardId === expected.cardId) + 1;
    const reachedOrb = reading.orbShortlist.includes(expected.cardId);
    const status = finalRank === 1 ? "correct" : reading.result.results.length ? "wrong" : "no-result";
    const item = {
      fixture: expected.fixture,
      expected: { cardId: expected.cardId, name: expected.name, set: expected.set, collectorNumber: expected.collectorNumber },
      ocrNameEvidence: compactOcrNames(reading.ocrNames, expected.name),
      ocrNumberEvidence: compactOcrNumbers(reading.ocrNumbers),
      selectedProposalId: reading.selectedProposalId,
      selectedProposalSource: reading.selectedProposalSource,
      proposalsProcessed: reading.timing?.proposalsProcessed ?? reading.proposals.filter(({ processingState }) => processingState === "completed").length,
      visualRank: visualRank || null,
      visualRankDisplay: visualRank || ">40/not retained",
      reachedOrb,
      orbRank: orbRank || null,
      finalRank: finalRank || null,
      confidence: reading.result.confidence,
      totalMs: reading.timing?.totalMs ?? null,
      status,
      error: reading.error || null,
      topResults: reading.result.results.slice(0, 3).map(({ cardId, name, setName, score, confidence }) => ({ cardId, name, setName, score, confidence })),
    };
    results.push(item);
    console.log(`${index + 1}/${manifest.items.length} ${expected.fixture}: ${status} in ${Math.round(item.totalMs || 0)} ms`);
  }
} finally {
  client.socket.close();
  runAdb("shell", "rm", "-rf", stagingRoot);
  runAdb("shell", "run-as", "com.packdex.app", "rm", "-rf", privateRelativeRoot);
}

const times = results.map(({ totalMs }) => totalMs).filter(Number.isFinite).sort((left, right) => left - right);
const percentile = (fraction) => times[Math.min(times.length - 1, Math.max(0, Math.ceil(times.length * fraction) - 1))] ?? null;
const report = {
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  device: { model: runAdb("shell", "getprop", "ro.product.model").trim(), product: runAdb("shell", "getprop", "ro.product.device").trim() },
  exactPath: "adb-pushed device file -> browser File input -> createTemporaryImage object URL -> prepareCardImage -> ML Kit OCR -> compact visual index -> ORB -> fusion",
  expectedIdsInjectedIntoRecognition: false,
  fixtureImagesBundled: false,
  summary: {
    attachedFileCount: results.length,
    top1: results.filter(({ finalRank }) => finalRank === 1).length,
    top3: results.filter(({ finalRank }) => finalRank > 0 && finalRank <= 3).length,
    wrong: results.filter(({ status }) => status === "wrong").length,
    safeNoResult: results.filter(({ status }) => status === "no-result").length,
    meanMs: times.length ? times.reduce((total, value) => total + value, 0) / times.length : null,
    p95Ms: percentile(.95),
  },
  items: results,
};
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Wrote ${outputPath}`);
