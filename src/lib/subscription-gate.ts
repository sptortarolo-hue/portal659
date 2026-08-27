import { getAuthSupabase, getUserId } from "@/lib/auth-utils";
import { resolveVendorPlan, type EffectivePlan } from "@/lib/plans";
import type { Plan, Vendor } from "@/types/database";
import type { SupabaseClient } from "@supabase/supabase-js";

export type GateSuccess = {
  ok: true;
  supabase: SupabaseClient;
  user: { id: string };
  vendor: Vendor;
  plans: Plan[];
  plan: EffectivePlan;
};

export type GateFailure = {
  ok: false;
  supabase: SupabaseClient | null;
  error: string;
  status: number;
};

export type GateResult = GateSuccess | GateFailure;

export async function gateRequest(request: Request): Promise<GateResult> {
  const supabase = getAuthSupabase(request);
  if (!supabase) {
    return { ok: false, supabase: null, error: "Error de conexión", status: 503 };
  }

  const userId = await getUserId(supabase);
  if (!userId) {
    return { ok: false, supabase, error: "No autenticado", status: 401 };
  }

  const [vendorRes, plansRes] = await Promise.all([
    supabase.from("vendors").select("*").eq("user_id", userId).maybeSingle(),
    supabase.from("plans").select("*").order("sort", { ascending: true }),
  ]);

  const vendor = vendorRes.data;
  if (!vendor) {
    return { ok: false, supabase, error: "No tenés un local registrado", status: 403 };
  }

  const plans = plansRes.data || [];
  const plan = resolveVendorPlan(vendor, plans);

  return { ok: true, supabase, user: { id: userId }, vendor, plans, plan };
}

export function gateError(result: GateFailure) {
  return new Response(JSON.stringify({ error: result.error || "No autorizado" }), {
    status: result.status || 403,
    headers: { "Content-Type": "application/json" },
  });
}