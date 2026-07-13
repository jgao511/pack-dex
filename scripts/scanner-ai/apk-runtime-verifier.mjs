import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function requireRange(bytes, offset, length, label) {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > bytes.length) {
    throw new Error(`Scanner-AI APK has an invalid ${label} range.`);
  }
}

function findEndOfCentralDirectory(bytes) {
  const minimum = Math.max(0, bytes.length - 65_557);
  for (let offset = bytes.length - 22; offset >= minimum; offset -= 1) {
    if (bytes.readUInt32LE(offset) === EOCD_SIGNATURE) return offset;
  }
  throw new Error("Scanner-AI APK ZIP end-of-central-directory record was not found.");
}

export function readApkEntries(apkBytes, requestedNames) {
  const bytes = Buffer.isBuffer(apkBytes) ? apkBytes : Buffer.from(apkBytes);
  const requested = new Set(requestedNames);
  const found = new Map();
  const eocd = findEndOfCentralDirectory(bytes);
  requireRange(bytes, eocd, 22, "end-of-central-directory");
  const disk = bytes.readUInt16LE(eocd + 4);
  const centralDisk = bytes.readUInt16LE(eocd + 6);
  const entryCount = bytes.readUInt16LE(eocd + 10);
  const centralSize = bytes.readUInt32LE(eocd + 12);
  const centralOffset = bytes.readUInt32LE(eocd + 16);
  if (disk !== 0 || centralDisk !== 0 || entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new Error("Scanner-AI APK uses an unsupported multi-disk or ZIP64 layout.");
  }
  requireRange(bytes, centralOffset, centralSize, "central-directory");

  let offset = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    requireRange(bytes, offset, 46, "central entry");
    if (bytes.readUInt32LE(offset) !== CENTRAL_SIGNATURE) throw new Error("Scanner-AI APK central directory is malformed.");
    const flags = bytes.readUInt16LE(offset + 8);
    const method = bytes.readUInt16LE(offset + 10);
    const compressedSize = bytes.readUInt32LE(offset + 20);
    const uncompressedSize = bytes.readUInt32LE(offset + 24);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const localOffset = bytes.readUInt32LE(offset + 42);
    const recordLength = 46 + nameLength + extraLength + commentLength;
    requireRange(bytes, offset, recordLength, "central entry");
    const name = bytes.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    offset += recordLength;
    if (!requested.has(name)) continue;
    if (found.has(name)) throw new Error(`Scanner-AI APK contains a duplicate runtime entry: ${name}`);
    if ((flags & 1) !== 0) throw new Error(`Scanner-AI APK runtime entry is encrypted: ${name}`);
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) {
      throw new Error(`Scanner-AI APK runtime entry requires unsupported ZIP64 metadata: ${name}`);
    }
    requireRange(bytes, localOffset, 30, `local header for ${name}`);
    if (bytes.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) throw new Error(`Scanner-AI APK local header is malformed: ${name}`);
    const localNameLength = bytes.readUInt16LE(localOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    requireRange(bytes, dataOffset, compressedSize, `compressed data for ${name}`);
    const compressed = bytes.subarray(dataOffset, dataOffset + compressedSize);
    const content = method === 0 ? Buffer.from(compressed)
      : method === 8 ? inflateRawSync(compressed, { maxOutputLength: uncompressedSize })
        : null;
    if (!content) throw new Error(`Scanner-AI APK runtime entry uses unsupported compression method ${method}: ${name}`);
    if (content.length !== uncompressedSize) throw new Error(`Scanner-AI APK runtime entry has an invalid expanded size: ${name}`);
    found.set(name, content);
  }
  if (offset !== centralOffset + centralSize) throw new Error("Scanner-AI APK central-directory size does not validate.");
  for (const name of requested) if (!found.has(name)) throw new Error(`Scanner-AI APK is missing frozen runtime entry: ${name}`);
  return found;
}

export function verifyScannerAiApkRuntime(apkBytes, expectedEntries, expectedRuntimeSourceSha256) {
  const entries = readApkEntries(apkBytes, expectedEntries.map(({ name }) => name));
  for (const expected of expectedEntries) {
    const content = entries.get(expected.name);
    if (content.length !== expected.bytes || sha256(content) !== expected.sha256) {
      throw new Error(`Scanner-AI APK runtime entry does not match the loose freeze input: ${expected.name}`);
    }
  }
  const markerName = "assets/public/scanner-ai-build.json";
  let marker;
  try { marker = JSON.parse(entries.get(markerName).toString("utf8")); }
  catch (error) { throw new Error(`Scanner-AI APK build marker is invalid JSON: ${error.message}`); }
  if (marker.scannerAiPoc !== true || marker.runtimeSourceSha256 !== expectedRuntimeSourceSha256) {
    throw new Error("Scanner-AI APK build marker does not match the frozen runtime source.");
  }
  return marker;
}
