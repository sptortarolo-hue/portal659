import { createClient, SupabaseClient } from "@supabase/supabase-js";

let supabaseClient: SupabaseClient | null = null;

function getEnv() {
  return {
    url: (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "").trim(),
    key: (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "").trim(),
  };
}

export function getSupabase(accessToken?: string): SupabaseClient | null {
  if (supabaseClient && !accessToken) return supabaseClient;

  try {
    const { url, key } = getEnv();
    if (!url || !key) return null;

    const headers: Record<string, string> = {};
    if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;

    const client = createClient(url, key, {
      global: { headers },
      auth: accessToken
        ? { persistSession: false, autoRefreshToken: false }
        : undefined,
    });

    if (!accessToken) supabaseClient = client;
    return client;
  } catch {
    return null;
  }
}

export function getServiceClient() {
  const { url, key } = getEnv();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
