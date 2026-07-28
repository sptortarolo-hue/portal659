import { createClient, SupabaseClient } from "@supabase/supabase-js";

let supabaseClient: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (supabaseClient) return supabaseClient;

  try {
    const url = (
      process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || ""
    ).trim();
    const key = (
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      process.env.SUPABASE_ANON_KEY ||
      ""
    ).trim();

    if (!url || !key) {
      console.warn(
        "[supabase] Faltan variables de entorno",
        { url: !!url, key: !!key }
      );
      return null;
    }

    supabaseClient = createClient(url, key);
    return supabaseClient;
  } catch (e) {
    console.error("[supabase] Error al crear cliente:", e);
    return null;
  }
}