import { createClient } from "@supabase/supabase-js";

const viteEnv = import.meta.env || {};
const supabaseUrl = String(viteEnv.VITE_SUPABASE_URL || "").trim();
const supabaseAnonKey = String(viteEnv.VITE_SUPABASE_ANON_KEY || "").trim();
const missingSupabaseEnvVars = [
  !supabaseUrl ? "VITE_SUPABASE_URL" : null,
  !supabaseAnonKey ? "VITE_SUPABASE_ANON_KEY" : null,
].filter(Boolean);

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);
export const missingSupabaseEnv = missingSupabaseEnvVars;

export const supabase = isSupabaseConfigured ? createClient(supabaseUrl, supabaseAnonKey) : null;

if (viteEnv.DEV) {
  console.info("[PackDex mobile] Supabase env status", {
    urlPresent: Boolean(supabaseUrl),
    anonKeyPresent: Boolean(supabaseAnonKey),
    anonKeyLength: supabaseAnonKey.length,
  });
}

if (viteEnv.DEV && missingSupabaseEnvVars.length > 0) {
  console.warn(
    `[PackDex mobile] Supabase is not configured. Missing ${missingSupabaseEnvVars.join(
      ", "
    )}. Add them to mobile-app/.env and restart npm run dev.`
  );
}
