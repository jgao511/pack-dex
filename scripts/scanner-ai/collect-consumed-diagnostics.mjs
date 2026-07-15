import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const argument = (name, fallback = null) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};
const guideCropComparison = args.includes("--guide-crop-comparison");
const manualPhotoDevelopment = args.includes("--manual-photo-development");
const fixtures = (argument("--fixtures", guideCropComparison
  ? "here-comes-team-rocket-113-108.jpg,diglett-55-108.jpg,gardevoir-ex-111-114.jpg,mega-charizard-x-ex-013-094.jpg"
  : "IMG_6652.jpeg,IMG_6658.jpeg,IMG_6663.jpeg"))
  .split(",").map((value) => value.trim()).filter(Boolean);
const authorizedFixtures = guideCropComparison
  ? ["here-comes-team-rocket-113-108.jpg", "diglett-55-108.jpg", "gardevoir-ex-111-114.jpg", "mega-charizard-x-ex-013-094.jpg"]
  : ["IMG_6652.jpeg", "IMG_6658.jpeg", "IMG_6663.jpeg"];
if (!manualPhotoDevelopment && JSON.stringify(fixtures) !== JSON.stringify(authorizedFixtures)) {
  throw new Error("This development collector is intentionally restricted to the three authorized consumed diagnostic photos.");
}
const outputRoot = path.resolve(root, argument("--output", guideCropComparison ? "artifacts/scanner-ai/reports/pixel-real-guide-crop-development" : "artifacts/scanner-ai/reports/consumed-pixel-diagnostics-stream"));
const freezePath = path.resolve(root, argument("--freeze", "artifacts/scanner-ai/reports/trained-float32-runtime-freeze-webdebug-diagnostics-stream.json"));
const fixtureRoot = path.resolve(root, argument("--fixture-root", guideCropComparison ? "tests/fixtures/scanner/pixel-real" : "tests/fixtures/scanner/local-pixel"));
const adb = argument("--adb", process.env.ADB || path.join(process.env.LOCALAPPDATA || "", "Android", "Sdk", "platform-tools", "adb.exe"));
const port = Number(argument("--port", "9222"));
const runAdb = (...command) => execFileSync(adb, command, { encoding: "utf8" });
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function dataUrlBytes(value) {
  const match = /^data:image\/(?:jpeg|png);base64,(.+)$/i.exec(String(value || ""));
  if (!match) return null;
  return Buffer.from(match[1], "base64");
}
async function connect() {
  const targets = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json());
  const target = targets.find(({ type }) => type === "page");
  if (!target) throw new Error("No debuggable PackDex WebView page was found.");
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  let nextId = 1; const pending = new Map();
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data); const request = pending.get(message.id); if (!request) return;
    pending.delete(message.id);
    if (message.error || message.result?.exceptionDetails) request.reject(new Error(JSON.stringify(message.error || message.result.exceptionDetails)));
    else request.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => { const id = nextId++; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression, awaitPromise = false) => (await send("Runtime.evaluate", { expression, awaitPromise, returnByValue: true })).result?.value;
  return { socket, send, evaluate };
}
async function connectWhenReady() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    let pid = ""; try { pid = runAdb("shell", "pidof", "com.packdex.app").trim().split(/\s+/, 1)[0]; } catch {}
    const socket = pid && (runAdb("shell", "cat", "/proc/net/unix").match(/@webview_devtools_remote_\d+/g) || []).find((value) => value === `@webview_devtools_remote_${pid}`);
    if (socket) {
      try { runAdb("forward", "--remove", `tcp:${port}`); } catch {}
      try { runAdb("forward", `tcp:${port}`, `localabstract:${socket.slice(1)}`); return await connect(); } catch {}
    }
    await sleep(250);
  }
  throw new Error("The active PackDex process did not expose a matching WebView debug socket.");
}

const manifest = manualPhotoDevelopment ? null : JSON.parse(await fs.readFile(path.resolve(root, guideCropComparison ? "tests/fixtures/scanner/pixel-real/manifest.json" : "tests/fixtures/scanner/local-pixel-manifest.json"), "utf8"));
const manifestItems = manualPhotoDevelopment ? fixtures.map((fixture) => ({ fixture })) : (Array.isArray(manifest) ? manifest : manifest.items);
const expected = new Map(manifestItems.filter(({ fixture }) => fixtures.includes(fixture)).map((item) => [item.fixture, item]));
for (const fixture of fixtures) {
  const bytes = await fs.readFile(path.join(fixtureRoot, fixture));
  if (!expected.has(fixture) || (expected.get(fixture)?.sha256 && sha256(bytes) !== expected.get(fixture).sha256)) throw new Error(`Diagnostic fixture checksum failed: ${fixture}`);
}
const installedApk = runAdb("shell", "pm", "path", "com.packdex.app").split(/\r?\n/).map((line) => line.replace("package:", "").trim()).find((value) => value.endsWith("/base.apk"));
if (!installedApk) throw new Error("Could not identify the installed APK.");
const installedSha = runAdb("shell", "sha256sum", installedApk).trim().split(/\s+/, 1)[0];
const freeze = JSON.parse(await fs.readFile(freezePath, "utf8"));
if (installedSha !== freeze.apkSha256) throw new Error("Installed APK does not match the diagnostic-stream freeze; refusing diagnostic submission.");

runAdb("shell", "am", "force-stop", "com.packdex.app"); runAdb("shell", "monkey", "-p", "com.packdex.app", "-c", "android.intent.category.LAUNCHER", "1");
let client = await connectWhenReady();
try { await client.evaluate("location.href='https://localhost/?scanner-test=1'"); } catch {}
client.socket.close(); client = await connectWhenReady();
const ready = await client.evaluate("(async()=>{const started=Date.now();while(!globalThis.__PACKDEX_RUN_AI_SCANNER_FILE__&&Date.now()-started<30000)await new Promise(resolve=>setTimeout(resolve,100));return Boolean(globalThis.__PACKDEX_RUN_AI_SCANNER_FILE__);})()", true);
if (!ready) throw new Error("Scanner-AI diagnostic entry point was unavailable.");
const preload = await client.evaluate("globalThis.__PACKDEX_SCANNER_AI_PRELOAD__", true);
if (!preload?.ready) throw new Error(`Scanner-AI preload failed: ${preload?.error || "unknown"}`);
const document = await client.send("DOM.getDocument", { depth: 2, pierce: true });
const input = await client.send("DOM.querySelector", { nodeId: document.root.nodeId, selector: "input[type=file]" });
if (!input.nodeId) throw new Error("Scanner File input was not found.");
const staging = "/data/local/tmp/PackDexConsumedDiagnostics"; const privateRoot = "cache/PackDexConsumedDiagnostics"; const remoteRoot = "/data/user/0/com.packdex.app/cache/PackDexConsumedDiagnostics";
runAdb("shell", "rm", "-rf", staging); runAdb("shell", "mkdir", "-p", staging); runAdb("shell", "run-as", "com.packdex.app", "rm", "-rf", privateRoot); runAdb("shell", "run-as", "com.packdex.app", "mkdir", "-p", privateRoot);
for (const fixture of fixtures) { const staged = `${staging}/${fixture}`; runAdb("push", path.join(fixtureRoot, fixture), staged); runAdb("shell", "chmod", "644", staged); runAdb("shell", "run-as", "com.packdex.app", "cp", staged, `${privateRoot}/${fixture}`); }
const readings = [];
try {
  for (const fixture of fixtures) {
    await client.send("DOM.setFileInputFiles", { nodeId: input.nodeId, files: [`${remoteRoot}/${fixture}`] });
    const strategies = guideCropComparison ? ["boundary", "centered", "guide", "auto"] : ["auto"];
    const item = { fixture, expected: expected.get(fixture), strategies: {} };
    for (const cropStrategy of strategies) {
      const options = guideCropComparison
        ? `(function(){const host=document.getElementById('scanner-camera-preview');const rect=host.getBoundingClientRect();return {previewWidth:rect.width,previewHeight:rect.height,outline:{x:10,y:10,width:rect.width-20,height:rect.height-20}};})()`
        : "null";
      const reading = await client.evaluate(`(async()=>{const previewGeometry=${options};return globalThis.__PACKDEX_RUN_AI_SCANNER_FILE__(document.querySelector('input[type=file]').files[0], {includeDiagnostics:true,includeEmbedding:true,includeCandidateIds:true,cropStrategy:${JSON.stringify(cropStrategy)},foilMode:${JSON.stringify(argument("--foil-mode", false))},...(previewGeometry?{previewGeometry}:{})});})()`, true);
      if (reading?.status !== "scanner-ai-poc" || !Array.isArray(reading?.queryEmbedding) || reading.queryEmbedding.length !== 128) throw new Error(`Diagnostic scan failed for ${fixture}/${cropStrategy}: ${reading?.error || "missing 128-d embedding"}`);
      const directory = path.join(outputRoot, path.basename(fixture, path.extname(fixture)), cropStrategy); await fs.mkdir(directory, { recursive: true });
      const refs = reading.diagnostics?.imageRefs || {};
      const save = async (key, filename) => { if (!key) return null; const image = await client.evaluate(`globalThis.__PACKDEX_READ_AI_SCANNER_DIAGNOSTIC_IMAGE__(${JSON.stringify(key)})`, true); const bytes = dataUrlBytes(image); if (!bytes) return null; await fs.writeFile(path.join(directory, filename), bytes); return filename; };
      const diagnosticFiles = { upright: await save(refs.uprightInput, "upright.jpg"), crop: await save(refs.detectedCardCrop, "crop.jpg"), outline: await save(refs.outlineInput, "outline.jpg"), model: await save(refs.finalModelInput, "model.png"), ocr: [] };
      for (const region of refs.ocrRegions || []) diagnosticFiles.ocr.push({ label: region.label, file: await save(region.imageRef, `ocr-${region.label}.jpg`) });
      reading.diagnosticFiles = diagnosticFiles; delete reading.diagnostics?.imageRefs;
      item.strategies[cropStrategy] = reading;
    }
    readings.push(guideCropComparison ? item : { fixture, ...item.strategies.auto });
  }
} finally {
  runAdb("shell", "rm", "-rf", staging); try { runAdb("shell", "run-as", "com.packdex.app", "rm", "-rf", privateRoot); } catch {}
  await client.evaluate("globalThis.__PACKDEX_RELEASE_AI_SCANNER__?.()", true).catch(() => {}); client.socket.close(); try { runAdb("forward", "--remove", `tcp:${port}`); } catch {}
}
await fs.mkdir(outputRoot, { recursive: true }); await fs.writeFile(path.join(outputRoot, "diagnostics-with-embeddings.json"), `${JSON.stringify(readings, null, 2)}\n`);
console.log(`Captured ${readings.length} authorized ${guideCropComparison ? "guide-crop development" : "diagnostic"} scans with Android embeddings in ${outputRoot}`);
