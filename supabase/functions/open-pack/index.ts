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
      error: "This PackDex build is no longer supported. Refresh the site or update the installed app.",
      code: "PACKDEX_CLIENT_UPDATE_REQUIRED",
      retryable: false,
    },
    410,
  );
});
