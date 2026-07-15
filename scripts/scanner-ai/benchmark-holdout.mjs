import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SCANNER_AI_RUNTIME_CONFIG } from "../../src/lib/cardScanner/aiVisual/scannerAiRuntimeConfig.js";
import { readAndVerifyRuntimeFreeze } from "./runtime-freeze-lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
function argument(name, fallback = null) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}

const combinePaths = argument("--combine");
const preflight = args.includes("--preflight");
const identityOnly = args.includes("--identity-only");
const continuation15 = args.includes("--continuation-15");
const development15 = args.includes("--development-15");
const outputPath = path.resolve(root, argument("--output", combinePaths
  ? "artifacts/scanner-ai/reports/holdout-comparison.json"
  : "artifacts/scanner-ai/reports/holdout-run.json"));
const completionPath = path.resolve(root, argument("--completed", "artifacts/scanner-ai/reports/trained-float32-continuation-completed.json"));

function mean(values) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null; }
function percentile(values, quantile) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * quantile;
  const lower = Math.floor(position); const upper = Math.ceil(position);
  return lower === upper ? sorted[lower] : sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function runtimeIdentityFromReading(reading) {
  return {
    configVersion: reading?.configVersion ?? null,
    runtimeSourceSha256: reading?.runtimeSourceSha256 ?? null,
    indexVersion: reading?.indexMetadata?.indexVersion ?? null,
    vectorSha256: reading?.indexMetadata?.vectorSha256 ?? null,
    modelVersion: reading?.indexMetadata?.modelVersion ?? null,
    modelFileSha256: reading?.indexMetadata?.modelFileSha256 ?? null,
    indexMetadataSha256: reading?.indexMetadata?.indexMetadataSha256 ?? null,
    catalogMetadataSha256: reading?.indexMetadata?.catalogMetadataSha256 ?? null,
    catalogCardsSha256: reading?.indexMetadata?.catalogCardsSha256 ?? null,
    cardIdsSha256: reading?.indexMetadata?.cardIdsSha256 ?? null,
  };
}

function runtimeIdentityMismatches(identity, freeze) {
  const expected = {
    configVersion: freeze.configVersion,
    runtimeSourceSha256: freeze.runtimeSourceSha256,
    indexVersion: freeze.indexVersion,
    vectorSha256: freeze.vectorSha256,
    modelVersion: freeze.modelVersion,
    modelFileSha256: freeze.modelFileSha256,
    indexMetadataSha256: freeze.indexMetadataSha256,
    catalogMetadataSha256: freeze.catalogMetadataSha256,
    catalogCardsSha256: freeze.catalogCardsSha256,
    cardIdsSha256: freeze.cardIdsSha256,
  };
  return Object.entries(expected).flatMap(([field, value]) => identity[field] === value ? [] : [{ field, expected: value, actual: identity[field] }]);
}

function summarize(items) {
  const times = items.map(({ timing }) => timing?.totalMs).filter(Number.isFinite);
  const stageStats = (values) => ({ meanMs: mean(values), medianMs: percentile(values, 0.5), p95Ms: percentile(values, 0.95), maxMs: values.length ? Math.max(...values) : null });
  const stageValues = (selector) => items.map(selector).filter(Number.isFinite);
  return {
    count: items.length,
    correct: items.filter(({ outcome }) => outcome === "correct").length,
    wrong: items.filter(({ outcome }) => outcome === "wrong").length,
    safeNoResult: items.filter(({ outcome }) => outcome === "safe-no-result").length,
    ocrOnlyTop1: items.filter(({ expectedOcrPosition }) => expectedOcrPosition === 1).length,
    aiTop1: items.filter(({ expectedAiRank }) => expectedAiRank === 1).length,
    aiTop3: items.filter(({ expectedAiRank }) => expectedAiRank && expectedAiRank <= 3).length,
    fusedTop1: items.filter(({ finalRank }) => finalRank === 1).length,
    orbRuns: items.filter(({ orbRan }) => orbRan).length,
    externalScanRequests: items.reduce((total, item) => total + item.externalRequests.length, 0),
    meanMs: mean(times),
    medianMs: percentile(times, 0.5),
    p95Ms: percentile(times, 0.95),
    maxMs: times.length ? Math.max(...times) : null,
    stages: {
      preprocessing: stageStats(stageValues(({ timing }) => timing?.preparationMs)),
      ocr: stageStats(stageValues(({ timing }) => timing?.ocrMs)),
      inference: stageStats(stageValues(({ timing }) => timing?.inferenceMs)),
      ranking: stageStats(stageValues(({ timing }) => (timing?.candidateBuildMs || 0) + (timing?.candidateSearchMs || 0) + (timing?.fusionMs || 0) + (timing?.orbMs || 0))),
      total: stageStats(times),
    },
  };
}

function markdownForReport(report) {
  const lines = [
    `# ${report.system} ${report.mode === "locked-holdout-continuation-15" ? "15-photo continuation" : "locked holdout"}`, "",
    `- Runtime config: ${report.runtimeFreeze?.configVersion || "existing validated scanner"}`,
    `- Correct / wrong / safe no-result: ${report.summary.correct} / ${report.summary.wrong} / ${report.summary.safeNoResult}`,
    `- AI top-1 / top-3: ${report.summary.aiTop1} / ${report.summary.aiTop3}`,
    `- Mean / median / p95 / max: ${[report.summary.meanMs, report.summary.medianMs, report.summary.p95Ms, report.summary.maxMs].map((value) => value == null ? "n/a" : `${Math.round(value)} ms`).join(" / ")}`,
    `- ORB runs: ${report.summary.orbRuns}`,
    `- External scan-time requests: ${report.summary.externalScanRequests}`,
    "",
    "| Photo | Expected | OCR pos | AI rank | Cosine | Margin | ORB | Final | Confidence | Prep | OCR | Inference | Ranking | Total | Outcome |",
    "|---|---|---:|---:|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|---|",
  ];
  for (const item of report.items) lines.push(`| ${item.fixture} | ${item.expected.cardId} | ${item.expectedOcrPosition ?? "-"} | ${item.expectedAiRank ?? "-"} | ${item.cosineSimilarity?.toFixed(4) ?? "-"} | ${item.secondPlaceMargin?.toFixed(4) ?? "-"} | ${item.orbRan ? "yes" : "no"} | ${item.finalRank ?? "-"} | ${item.confidence || "-"} | ${Math.round(item.timing?.preparationMs || 0)} ms | ${Math.round(item.timing?.ocrMs || 0)} ms | ${Math.round(item.timing?.inferenceMs || 0)} ms | ${Math.round(((item.timing?.candidateBuildMs || 0) + (item.timing?.candidateSearchMs || 0) + (item.timing?.fusionMs || 0) + (item.timing?.orbMs || 0)))} ms | ${Math.round(item.timing?.totalMs || 0)} ms | ${item.outcome} |`);
  return `${lines.join("\n")}\n`;
}

async function writeReport(report) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  await fs.writeFile(outputPath.replace(/\.json$/i, ".md"), markdownForReport(report));
  console.log(`Wrote ${outputPath}`);
}

async function writeJsonAtomically(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
  await fs.rename(temporaryPath, filePath);
}

async function loadContinuationLedger(freeze) {
  let ledger;
  try { ledger = JSON.parse(await fs.readFile(completionPath, "utf8")); }
  catch (error) {
    if (error?.code !== "ENOENT") throw error;
    ledger = {
      schemaVersion: 1,
      mode: "locked-holdout-continuation-15",
      consumedFixtures: ["IMG_6651.jpeg"],
      runtimeFreezeSha256: createHash("sha256").update(await fs.readFile(argument("--freeze"))).digest("hex"),
      runtimeFreezeApkSha256: freeze.apkSha256,
      completedItems: [],
      inFlightFixture: null,
    };
    await writeJsonAtomically(completionPath, ledger);
  }
  if (ledger.schemaVersion !== 1 || ledger.mode !== "locked-holdout-continuation-15"
    || JSON.stringify(ledger.consumedFixtures) !== JSON.stringify(["IMG_6651.jpeg"])
    || ledger.runtimeFreezeApkSha256 !== freeze.apkSha256
    || ledger.inFlightFixture) {
    throw new Error("Continuation completion ledger is incompatible or records an already-submitted fixture; refusing to retry any photo.");
  }
  if (!Array.isArray(ledger.completedItems) || new Set(ledger.completedItems.map(({ fixture }) => fixture)).size !== ledger.completedItems.length) {
    throw new Error("Continuation completion ledger has invalid completed fixture state.");
  }
  return ledger;
}

if (combinePaths) {
  const paths = combinePaths.split(",").map((value) => path.resolve(root, value.trim()));
  if (paths.length !== 3) throw new Error("--combine requires existing,generic-hybrid,trained-hybrid report paths.");
  const reports = await Promise.all(paths.map(async (reportPath) => JSON.parse(await fs.readFile(reportPath, "utf8"))));
  const expectedSystems = ["existing", "generic-hybrid", "trained-hybrid"];
  for (const system of expectedSystems) if (!reports.some((report) => report.system === system)) throw new Error(`Combined report is missing ${system}.`);
  const ordered = expectedSystems.map((system) => reports.find((report) => report.system === system));
  const fixtures = ordered[0].items.map(({ fixture }) => fixture);
  for (const report of ordered.slice(1)) if (JSON.stringify(report.items.map(({ fixture }) => fixture)) !== JSON.stringify(fixtures)) throw new Error("Holdout reports do not contain the same ordered fixtures.");
  const comparison = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    mode: "locked-holdout-comparison",
    systems: ordered.map(({ system, summary, runtimeFreeze }) => ({ system, summary, runtimeFreeze })),
    items: fixtures.map((fixture, index) => ({
      fixture,
      expected: ordered[0].items[index].expected,
      systems: Object.fromEntries(ordered.map((report) => [report.system, {
        outcome: report.items[index].outcome,
        finalCardId: report.items[index].finalCardId,
        finalRank: report.items[index].finalRank,
        confidence: report.items[index].confidence,
        totalMs: report.items[index].timing?.totalMs,
      }])),
    })),
  };
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(comparison, null, 2)}\n`);
  console.log(`Wrote ${outputPath}`);
  process.exit(0);
}

const system = argument("--system");
if (!["existing", "generic-hybrid", "trained-hybrid"].includes(system)) throw new Error("Use --system existing, generic-hybrid, or trained-hybrid.");
const manifestPath = path.resolve(root, argument("--manifest", "tests/fixtures/scanner/local-pixel-manifest.json"));
const fixtureRoot = path.resolve(root, argument("--fixtures", "tests/fixtures/scanner/local-pixel"));

let runtimeFreeze = null;
if (system !== "existing") {
  const freezePath = argument("--freeze");
  if (!freezePath) throw new Error("Hybrid holdout runs require --freeze metadata created before opening the photos.");
  runtimeFreeze = await readAndVerifyRuntimeFreeze(path.resolve(root, freezePath), SCANNER_AI_RUNTIME_CONFIG, { root });
}

const adb = argument("--adb", process.env.ADB || path.join(process.env.LOCALAPPDATA || "", "Android", "Sdk", "platform-tools", "adb.exe"));
const stagingRoot = "/data/local/tmp/PackDexScannerAiFixtures";
const privateRelativeRoot = "cache/PackDexScannerAiFixtures";
const remoteRoot = "/data/user/0/com.packdex.app/cache/PackDexScannerAiFixtures";
const port = Number(argument("--port", "9222"));
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const runAdb = (...command) => execFileSync(adb, command, { encoding: "utf8" });
const installedApkPath = runAdb("shell", "pm", "path", "com.packdex.app").split(/\r?\n/)
  .map((line) => line.trim()).find((line) => line.startsWith("package:") && line.endsWith("/base.apk"))?.slice("package:".length);
if (!installedApkPath) throw new Error("Could not locate the installed PackDex base APK before holdout access.");
const installedApkSha256 = runAdb("shell", "sha256sum", installedApkPath).trim().split(/\s+/, 1)[0]?.toLowerCase();
if (!/^[a-f0-9]{64}$/.test(installedApkSha256 || "")) throw new Error("Could not hash the installed PackDex APK before holdout access.");
if (runtimeFreeze && installedApkSha256 !== runtimeFreeze.apkSha256) {
  throw new Error("Installed scanner-AI APK does not match the pre-holdout freeze.");
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
  const listeners = new Map();
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    if (!message.id) {
      for (const listener of listeners.get(message.method) || []) listener(message.params || {});
      return;
    }
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
  const on = (method, listener) => {
    const values = listeners.get(method) || [];
    values.push(listener); listeners.set(method, values);
  };
  return { socket, send, evaluate, on };
}

async function connectWhenWebViewReady() {
  const deadline = Date.now() + 30_000;
  let lastError = null;
  while (Date.now() < deadline) {
    let appPid = "";
    try { appPid = runAdb("shell", "pidof", "com.packdex.app").trim().split(/\s+/, 1)[0]; } catch {}
    const sockets = appPid
      ? (runAdb("shell", "cat", "/proc/net/unix").match(/@webview_devtools_remote_\d+/g) || []).filter((socket) => socket === `@webview_devtools_remote_${appPid}`)
      : [];
    if (sockets.length === 1) {
      try {
        try { runAdb("forward", "--remove", `tcp:${port}`); } catch {}
        runAdb("forward", `tcp:${port}`, `localabstract:${sockets[0].slice(1)}`);
        return await connect();
      } catch (error) {
        lastError = error;
      }
    }
    await sleep(250);
  }
  throw new Error(`The current com.packdex.app process did not expose a ready matching WebView debug socket within 30 seconds${lastError ? `: ${lastError.message}` : "."}`);
}

async function verifyRuntimeIdentity(client, context) {
  if (!runtimeFreeze) return null;
  const reading = await client.evaluate(`(async()=>{
    const canvas=document.createElement('canvas'); canvas.width=640; canvas.height=480;
    const context=canvas.getContext('2d'); context.fillStyle='#808080'; context.fillRect(0,0,640,480);
    const blob=await new Promise((resolve)=>canvas.toBlob(resolve,'image/jpeg',0.8));
    const probe=new File([blob],'packdex-runtime-identity-probe.jpg',{type:'image/jpeg'});
    return globalThis.__PACKDEX_RUN_AI_SCANNER_FILE__(probe,{includeCandidateIds:false});
  })()`, true);
  const identity = runtimeIdentityFromReading(reading);
  const mismatches = runtimeIdentityMismatches(identity, runtimeFreeze);
  if (mismatches.length) throw new Error(`Runtime/freeze identity mismatch before ${context}: ${JSON.stringify({ mismatches, status: reading?.status ?? null, error: reading?.error ?? null })}`);
  return identity;
}

runAdb("shell", "am", "force-stop", "com.packdex.app");
runAdb("shell", "monkey", "-p", "com.packdex.app", "-c", "android.intent.category.LAUNCHER", "1");
let client = await connectWhenWebViewReady();
try { await client.evaluate("location.href='https://localhost/?scanner-test=1'"); } catch {}
client.socket.close();
client = await connectWhenWebViewReady();
const requiredGlobal = system === "existing" ? "__PACKDEX_RUN_LOCAL_SCANNER_FILE__" : "__PACKDEX_RUN_AI_SCANNER_FILE__";
const ready = await client.evaluate(`(async()=>{const started=Date.now();while(!globalThis.${requiredGlobal}&&Date.now()-started<30000)await new Promise(resolve=>setTimeout(resolve,100));return Boolean(globalThis.${requiredGlobal});})()`, true);
if (!ready) throw new Error(`${requiredGlobal} was not available in the installed APK.`);
if (system !== "existing") {
  const preload = await client.evaluate("globalThis.__PACKDEX_SCANNER_AI_PRELOAD__", true);
  if (!preload?.ready) throw new Error(`Scanner-AI preload failed before holdout access: ${preload?.error || "unknown error"}`);
}
if (identityOnly) {
  if (system === "existing") throw new Error("--identity-only is only meaningful for a frozen scanner-AI runtime.");
  const identity = await verifyRuntimeIdentity(client, "the no-fixture identity probe");
  await client.evaluate("globalThis.__PACKDEX_RELEASE_AI_SCANNER__?.()", true).catch(() => {});
  client.socket.close();
  try { runAdb("forward", "--remove", `tcp:${port}`); } catch {}
  console.log(JSON.stringify({ mode: "no-fixture-runtime-identity", identity }, null, 2));
  process.exit(0);
}
if (preflight) {
  if (system === "existing") throw new Error("--preflight is only meaningful for a frozen scanner-AI runtime.");
  await client.evaluate("globalThis.__PACKDEX_RELEASE_AI_SCANNER__?.()", true).catch(() => {});
  client.socket.close();
  try { runAdb("forward", "--remove", `tcp:${port}`); } catch {}
  console.log("Scanner-AI preflight passed before any locked fixture manifest or image was read.");
  process.exit(0);
}

const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
if (!Array.isArray(manifest.items) || manifest.items.length !== 16) throw new Error("Locked benchmark requires the complete 16-photo manifest.");
if (continuation15 && development15) throw new Error("Choose either --continuation-15 or --development-15, not both.");
let continuationLedger = null;
let runItems = manifest.items;
if (continuation15) {
  if (system !== "trained-hybrid") throw new Error("The 15-photo continuation only permits the trained hybrid runtime.");
  continuationLedger = await loadContinuationLedger(runtimeFreeze);
  const consumed = new Set(continuationLedger.consumedFixtures);
  const eligible = manifest.items.filter(({ fixture }) => !consumed.has(fixture));
  if (eligible.length !== 15 || eligible.some(({ fixture }) => fixture === "IMG_6651.jpeg")) throw new Error("Continuation manifest must exclude only the already-consumed IMG_6651.jpeg fixture.");
  const completed = new Set(continuationLedger.completedItems.map(({ fixture }) => fixture));
  runItems = eligible.filter(({ fixture }) => !completed.has(fixture));
  if (!runItems.length && continuationLedger.completedItems.length !== 15) throw new Error("Continuation ledger has no pending fixtures but is not complete.");
} else if (development15) {
  if (system !== "trained-hybrid") throw new Error("The development 15-photo benchmark only permits the trained hybrid runtime.");
  runItems = manifest.items.filter(({ fixture }) => fixture !== "IMG_6651.jpeg");
  if (runItems.length !== 15) throw new Error("Development benchmark must exclude only the historically consumed IMG_6651.jpeg fixture.");
}
for (const item of runItems) {
  const bytes = await fs.readFile(path.join(fixtureRoot, item.fixture));
  const checksum = createHash("sha256").update(bytes).digest("hex");
  if (checksum !== item.sha256) throw new Error(`Locked fixture checksum changed: ${item.fixture}`);
}
runAdb("shell", "rm", "-rf", stagingRoot);
runAdb("shell", "mkdir", "-p", stagingRoot);
runAdb("shell", "run-as", "com.packdex.app", "rm", "-rf", privateRelativeRoot);
runAdb("shell", "run-as", "com.packdex.app", "mkdir", "-p", privateRelativeRoot);
for (const item of runItems) {
  const staged = `${stagingRoot}/${item.fixture}`;
  runAdb("push", path.join(fixtureRoot, item.fixture), staged);
  runAdb("shell", "chmod", "644", staged);
  runAdb("shell", "run-as", "com.packdex.app", "cp", staged, `${privateRelativeRoot}/${item.fixture}`);
}

await client.send("Network.enable");
let activeFixture = null;
const requestsByFixture = new Map();
client.on("Network.requestWillBeSent", ({ request }) => {
  if (!activeFixture) return;
  const url = String(request?.url || "");
  if (/^https?:/i.test(url) && !/^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?\//i.test(url)) {
    const values = requestsByFixture.get(activeFixture) || [];
    values.push({ url, method: request.method, resourceType: request.type || null });
    requestsByFixture.set(activeFixture, values);
  }
});

const document = await client.send("DOM.getDocument", { depth: 2, pierce: true });
const input = await client.send("DOM.querySelector", { nodeId: document.root.nodeId, selector: "input[type=file]" });
if (!input.nodeId) throw new Error("Scanner File input was not found.");

const items = continuationLedger ? [...continuationLedger.completedItems] : [];
try {
  for (let index = 0; index < runItems.length; index += 1) {
    const expected = runItems[index];
    const runtimeIdentityBefore = await verifyRuntimeIdentity(client, `submitting ${expected.fixture}`);
    if (continuationLedger) {
      continuationLedger.inFlightFixture = expected.fixture;
      await writeJsonAtomically(completionPath, continuationLedger);
    }
    await client.send("DOM.setFileInputFiles", { nodeId: input.nodeId, files: [`${remoteRoot}/${expected.fixture}`] });
    activeFixture = expected.fixture;
    const expression = system === "existing"
      ? "globalThis.__PACKDEX_RUN_LOCAL_SCANNER_FILE__(document.querySelector('input[type=file]').files[0])"
      : "globalThis.__PACKDEX_RUN_AI_SCANNER_FILE__(document.querySelector('input[type=file]').files[0], {includeCandidateIds:true})";
    const reading = await client.evaluate(expression, true);
    activeFixture = null;
    const externalRequests = requestsByFixture.get(expected.fixture) || [];
    let item;
    if (system === "existing") {
      const finalCardId = reading.result?.primaryCardId || null;
      const finalRank = reading.result?.results?.findIndex(({ cardId }) => cardId === expected.cardId) + 1 || null;
      item = {
        fixture: expected.fixture,
        expected,
        ocrNameEvidence: reading.ocrNames || [],
        ocrCollectorEvidence: reading.ocrNumbers || [],
        candidatePoolSize: reading.result?.results?.length || 0,
        expectedOcrPosition: finalRank,
        expectedAiRank: null,
        cosineSimilarity: null,
        secondPlaceMargin: null,
        orbRan: Boolean(reading.orbCandidates?.length),
        orbReason: reading.orbCandidates?.length ? "existing-full-orb-path" : "not-run",
        finalRank,
        finalCardId,
        confidence: reading.result?.confidence || "low",
        timing: {
          ocrMs: reading.timing?.ocrBridgeAndDetectMs ?? null,
          inferenceMs: null,
          candidateSearchMs: reading.timing?.visualMs ?? null,
          orbMs: reading.timing?.orbMs ?? null,
          totalMs: reading.timing?.totalMs ?? null,
        },
        externalRequests,
      };
    } else {
      const runtimeIdentityAfter = runtimeIdentityFromReading(reading);
      const identityMismatches = runtimeIdentityMismatches(runtimeIdentityAfter, runtimeFreeze);
      if (identityMismatches.length) throw new Error(`Runtime/freeze identity mismatch after ${expected.fixture}: ${JSON.stringify(identityMismatches)}`);
      const candidateIds = reading.candidatePool?.candidateIds || [];
      const expectedOcrPosition = candidateIds.indexOf(expected.cardId) + 1 || null;
      const expectedAiRank = reading.visualRanking?.findIndex(({ cardId }) => cardId === expected.cardId) + 1 || null;
      const expectedVisual = expectedAiRank ? reading.visualRanking[expectedAiRank - 1] : null;
      const finalRank = reading.result?.results?.findIndex(({ cardId }) => cardId === expected.cardId) + 1 || null;
      item = {
        fixture: expected.fixture,
        expected,
        ocrNameEvidence: reading.ocr?.nameCandidates || [],
        ocrCollectorEvidence: reading.ocr?.collectorNumbers || [],
        candidatePoolSize: reading.candidatePool?.size || 0,
        expectedOcrPosition,
        expectedAiRank,
        cosineSimilarity: expectedVisual?.visualScore ?? null,
        secondPlaceMargin: reading.retrieval?.margin ?? null,
        orbRan: Boolean(reading.orb?.ran),
        orbReason: reading.orb?.reason || null,
        finalRank,
        finalCardId: reading.result?.confirmedCardId || null,
        confirmation: {
          confirmedCardId: reading.result?.confirmedCardId || null,
          safeNoResult: Boolean(reading.result?.safeNoResult),
        },
        confidence: reading.result?.confidence || "low",
        runtimeIdentityBefore,
        runtimeIdentityAfter,
        timing: {
          preparationMs: reading.timing?.preparationMs ?? null,
          ocrMs: reading.timing?.ocrMs ?? null,
          inferenceMs: reading.timing?.inferenceMs ?? null,
          candidateBuildMs: reading.timing?.candidateBuildMs ?? null,
          candidateSearchMs: reading.timing?.candidateSearchMs ?? null,
          fusionMs: reading.timing?.fusionMs ?? null,
          orbMs: reading.timing?.orbMs ?? null,
          totalMs: reading.timing?.totalMs ?? null,
        },
        externalRequests,
      };
    }
    item.outcome = item.finalCardId === expected.cardId ? "correct" : item.finalCardId ? "wrong" : "safe-no-result";
    if (continuationLedger) {
      continuationLedger.completedItems.push(item);
      continuationLedger.inFlightFixture = null;
      await writeJsonAtomically(completionPath, continuationLedger);
    }
    items.push(item);
    console.log(`${items.length}/${continuation15 || development15 ? 15 : manifest.items.length} ${expected.fixture}: ${item.outcome} (${Math.round(item.timing.totalMs || 0)} ms)`);
  }
} finally {
  activeFixture = null;
  if (system !== "existing") await client.evaluate("globalThis.__PACKDEX_RELEASE_AI_SCANNER__?.()", true).catch(() => {});
  client.socket.close();
  runAdb("shell", "rm", "-rf", stagingRoot);
  runAdb("shell", "run-as", "com.packdex.app", "rm", "-rf", privateRelativeRoot);
}

const report = {
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  mode: continuation15 ? "locked-holdout-continuation-15" : development15 ? "consumed-photo-development-15" : "locked-holdout",
  system,
  device: {
    model: runAdb("shell", "getprop", "ro.product.model").trim(),
    product: runAdb("shell", "getprop", "ro.product.device").trim(),
  },
  installedApk: { path: installedApkPath, sha256: installedApkSha256 },
  ordinaryInputPath: "ADB run-as fixture -> DOM.setFileInputFiles -> browser File -> createTemporaryImage -> scanner runtime",
  expectedIdsInjectedIntoRecognition: false,
  consumedFixtures: continuationLedger?.consumedFixtures || (development15 ? ["IMG_6651.jpeg"] : []),
  completionLedger: continuationLedger ? path.relative(root, completionPath).replaceAll(path.sep, "/") : null,
  runtimeFreeze,
  summary: summarize(items),
  items,
};
if (continuation15 && items.length !== 15) throw new Error("15-photo continuation did not complete every untouched fixture.");
if (development15 && items.length !== 15) throw new Error("Development 15-photo benchmark did not complete every authorized photo.");
await writeReport(report);
if (system !== "existing" && report.summary.externalScanRequests > 0) {
  throw new Error(`Hybrid scan issued ${report.summary.externalScanRequests} external request(s); see the report.`);
}
