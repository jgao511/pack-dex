import {
  corsHeaders,
  jsonResponse,
} from "../_shared/http.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  return jsonResponse(
    {
      error: "This endpoint has been retired. Submit completed packs through the atomic collection RPC.",
      code: "PACK_WRITE_PATH_RETIRED",
      retryable: false,
    },
    410,
  );
});
