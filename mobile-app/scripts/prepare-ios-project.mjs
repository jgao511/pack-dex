import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { validateIosProject } from "./validate-ios-project.mjs";

const packageFile = fileURLToPath(new URL("../ios/App/CapApp-SPM/Package.swift", import.meta.url));
const source = await readFile(packageFile, "utf8");
const normalized = source.replace(/path: "([^"]+)"/g, (_match, value) => `path: "${value.replaceAll("\\", "/")}"`);
if (normalized !== source) await writeFile(packageFile, normalized);

await validateIosProject();
