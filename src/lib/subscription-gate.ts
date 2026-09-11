import { getAuthUser } from "./auth";
import { queryMany, queryOne } from "./db";
import { getVendorByRequest } from "./vendor-utils";
import { resolveVendorPlan, type EffectivePlan } from "@/lib/plans";
import type { Plan, Vendor } from "@/types/database";

export type GateSuccess = {
  ok: true;
  user: { id: string };
  vendor: Vendor;
  plans: Plan[];
  plan: EffectivePlan;
  /** Sesión de prueba (link compartido, sin cuenta): todo queda marcado. */
  previewSession?: boolean;
};

export type GateFailure = {
  ok: false;
  error: string;
  status: number;
};

export type GateResult = GateSuccess | GateFailure;

export async function gateRequest(request: Request): Promise<GateResult> {
  // Sesión de prueba (link compartido, sin cuenta): acceso total temporal
  // al panel de UN comercio. Todo lo que cree queda marcado como prueba.
  const preview = await getVendorByRequest(request);
  if (preview.previewSession && preview.vendor) {
    const [vendor, plans] = await Promise.all([
      queryOne<Vendor>(`SELECT * FROM vendors WHERE id = $1 LIMIT 1`, [preview.vendor.id]),
      queryMany<Plan>(`SELECT * FROM plans ORDER BY sort ASC`),
    ]);
    if (!vendor) {
      return { ok: false, error: "Comercio no encontrado", status: 404 };
    }
    const plan = resolveVendorPlan(vendor, plans);
    return { ok: true, user: { id: `preview:${vendor.id}` }, vendor, plans, plan, previewSession: true };
  }

  const authUser = await getAuthUser(request);
  if (!authUser) {
    return { ok: false, error: "No autenticado", status: 401 };
  }

  const userId = authUser.id;

  const [vendor, plans] = await Promise.all([
    queryOne<Vendor>(`SELECT * FROM vendors WHERE user_id = $1 LIMIT 1`, [userId]),
    queryMany<Plan>(`SELECT * FROM plans ORDER BY sort ASC`),
  ]);

  if (!vendor) {
    return { ok: false, error: "No tenés un local registrado", status: 403 };
  }

  const plan = resolveVendorPlan(vendor, plans);

  return { ok: true, user: { id: userId }, vendor, plans, plan };
}

export function gateError(result: GateFailure) {
  return new Response(JSON.stringify({ error: result.error || "No autorizado" }), {
    status: result.status || 403,
    headers: { "Content-Type": "application/json" },
  });
}