import { getAuthSupabase, getUserId } from "./auth-utils";

export async function isAdmin(request: Request): Promise<boolean> {
  const supabase = getAuthSupabase(request);
  if (!supabase) return false;
  const userId = await getUserId(supabase);
  if (!userId) return false;
  const { data } = await supabase
    .from("vendors")
    .select("is_admin")
    .eq("user_id", userId)
    .maybeSingle();
  return data?.is_admin === true;
}

export async function requireAdmin(request: Request) {
  if (!(await isAdmin(request))) {
    throw new Error("No autorizado");
  }
}
