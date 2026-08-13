import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

async function collectSourceFiles(directoryUrl, label) {
  const files = [];
  for (const entry of await readdir(directoryUrl, { withFileTypes: true })) {
    const entryUrl = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directoryUrl);
    const entryLabel = `${label}/${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...await collectSourceFiles(entryUrl, entryLabel));
    } else if (/\.(?:js|jsx|mjs)$/.test(entry.name)) {
      files.push({ label: entryLabel, source: await readFile(entryUrl, "utf8") });
    }
  }
  return files;
}

test("mobile reuses the root Supabase singleton without creating another GoTrue client", async () => {
  const [rootClient, mobileClient] = await Promise.all([
    read("../src/lib/supabaseClient.js"),
    read("../mobile-app/src/lib/supabaseClient.js"),
  ]);

  assert.match(rootClient, /import \{ createClient \} from "@supabase\/supabase-js"/);
  assert.equal((rootClient.match(/\bcreateClient\s*\(/g) || []).length, 1);

  assert.match(mobileClient, /from "\.\.\/\.\.\/\.\.\/src\/lib\/supabaseClient\.js"/);
  assert.match(mobileClient, /export \{ isSupabaseConfigured, supabase \}/);
  assert.doesNotMatch(mobileClient, /@supabase\/supabase-js|\bcreateClient\s*\(/);

  const applicationSources = [
    ...await collectSourceFiles(new URL("../src/", import.meta.url), "src"),
    ...await collectSourceFiles(new URL("../mobile-app/src/", import.meta.url), "mobile-app/src"),
  ];
  const clientFactories = applicationSources
    .filter(({ source }) => /@supabase\/supabase-js|\bcreateClient\s*\(/.test(source))
    .map(({ label }) => label);
  assert.deepEqual(clientFactories, ["src/lib/supabaseClient.js"]);
});

test("the mobile wrapper preserves missing-environment reporting and development diagnostics", async () => {
  const mobileClient = await read("../mobile-app/src/lib/supabaseClient.js");

  assert.match(mobileClient, /export const missingSupabaseEnv = missingSupabaseEnvVars/);
  assert.match(mobileClient, /VITE_SUPABASE_URL/);
  assert.match(mobileClient, /VITE_SUPABASE_ANON_KEY/);
  assert.match(mobileClient, /\[PackDex mobile\] Supabase env status/);
  assert.match(mobileClient, /Supabase is not configured\. Missing/);
});
