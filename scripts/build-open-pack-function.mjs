import { stat } from "node:fs/promises";
import { build } from "rolldown";

const input = "supabase/function-sources/open-pack/index.ts";
const output = "supabase/functions/open-pack/index.ts";

await build({
  input,
  external: /^https:\/\//,
  output: {
    file: output,
    format: "esm",
    minify: true,
  },
});

const { size } = await stat(output);
console.log(`Built scoped open-pack function: ${output} (${Math.ceil(size / 1024)} KiB)`);
