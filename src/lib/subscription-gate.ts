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
  const resolved = await getVendorByRequest(request);
  if (resolved.previewSession && resolved.vendor) {
    const [vendor, plans] = await Promise.all([
      queryOne<Vendor>(`SELECT * FROM vendors WHERE id = $1 LIMIT 1`, [resolved.vendor.id]),
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

  // Repartidores (y staff): fuera de las rutas gated (mismo alcance que antes,
  // cuando solo pasaba el dueño por user_id).
  if (resolved.staffRole !== null) {
    return { ok: false, error: "No autorizado", status: 403 };
  }

  // El vendor resuelto por getVendorByRequest soporta la cookie admin-as
  // (modo llave en mano): antes se re-query-eaba por user_id y el admin
  // impersonado caía 403 "No tenés un local" en todas las rutas gated.
  const vendor = resolved.vendor
    ? await queryOne<Vendor>(`SELECT * FROM vendors WHERE id = $1 LIMIT 1`, [resolved.vendor.id])
    : undefined;

  if (!vendor) {
    return { ok: false, error: "No tenés un local registrado", status: 403 };
  }

  const plans = await queryMany<Plan>(`SELECT * FROM plans ORDER BY sort ASC`);
  const plan = resolveVendorPlan(vendor, plans);

  return { ok: true, user: { id: authUser.id }, vendor, plans, plan };
}

export function gateError(result: GateFailure) {
  return new Response(JSON.stringify({ error: result.error || "No autorizado" }), {
    status: result.status || 403,
    headers: { "Content-Type": "application/json" },
  });
}