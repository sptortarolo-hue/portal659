import { createClient, SupabaseClient } from "@supabase/supabase-js";

let supabaseClient: SupabaseClient | null = null;
let initError: string | null = null;

export function getSupabase(): SupabaseClient | null {
  if (supabaseClient) return supabaseClient;
  if (initError) return null;

  try {
    const url =
      process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
    const key =
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      process.env.SUPABASE_ANON_KEY ||
      "";

    if (!url || !key) {
      initError = `Falta ${!url ? "SUPABASE_URL" : ""}${!url && !key ? " y " : ""}${!key ? "ANON_KEY" : ""}`;
      return null;
    }

    supabaseClient = createClient(url, key);
    return supabaseClient;
  } catch (e) {
    initError = e instanceof Error ? e.message : "Error desconocido";
    return null;
  }
}