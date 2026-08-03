import { SupabaseClient } from "@supabase/supabase-js";
import { getSupabase } from "./supabase";

export function extractToken(request: Request): string | undefined {
  return (
    request.headers.get("authorization")?.replace("Bearer ", "") ||
    request.headers.get("cookie")?.match(/sb-access-token=([^;]+)/)?.[1]
  );
}

export function getAuthSupabase(
  request: Request
): SupabaseClient | null {
  return getSupabase(extractToken(request));
}

export async function getUserId(
  supabase: SupabaseClient
): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data?.user?.id || null;
}
