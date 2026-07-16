import { getAuthenticatedUser } from "../_shared/auth.ts";
import { corsHeaders, jsonResponse } from "../_shared/http.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);

  let step = "authenticate";

  try {
    // The target identity is intentionally never accepted from the client.
    const { admin, user } = await getAuthenticatedUser(req);

    step = "delete_account_data";
    const { error: dataError } = await admin.rpc("delete_packdex_account_data", {
      target_user_id: user.id,
    });
    if (dataError) throw dataError;

    step = "delete_auth_user";
    const { error: authError } = await admin.auth.admin.deleteUser(user.id);
    if (authError) throw authError;

    console.info("PackDex account deleted", { step });
    return jsonResponse({ deleted: true });
  } catch (error) {
    console.error("PackDex account deletion failed", { step });
    return jsonResponse({ error: "Unable to delete this PackDex account.", step }, 500);
  }
});
