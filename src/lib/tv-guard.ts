/**
 * Guard común de las rutas /api/vendor/tv-screens/*: resuelve el comercio
 * activo, el plan efectivo y el estado de la migración.
 *
 * Devuelve un Response listo para devolver (401/403/503) o el contexto si está
 * todo en orden. Centralizarlo evita que una ruta nueva se olvide del gate.
 */

import { NextResponse } from "next/server";
import { getVendorByRequest } from "./vendor-utils";
import { queryMany, queryOne } from "./db";
import { hasTvScreens } from "./tv-data";
import { resolveVendorPlan } from "./plans";
import type { Plan, Vendor } from "@/types/database";

export type TvGuardContext = {
  vendorId: string;
  vendor: any;
  maxScreens: number;
  planScreens: boolean;
};

export async function guardTvScreens(
  request: Request
): Promise<{ ok: true; ctx: TvGuardContext } | { ok: false; response: NextResponse }> {
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) {
    return { ok: false, response: NextResponse.json({ error: "No autenticado" }, { status: 401 }) };
  }

  // Sin la migración, las rutas del panel responden 503 nombrándola: nunca
  // guardan silenciosamente nada (patrón del resto de los módulos).
  if (!(await hasTvScreens().catch(() => false))) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Falta aplicar supabase/self-host/migrate-tv-screens.sql" },
        { status: 503 }
      ),
    };
  }

  const full = await queryOne<any>(`SELECT * FROM vendors WHERE id = $1 LIMIT 1`, [vendor.id]).catch(() => null);
  if (!full) {
    return { ok: false, response: NextResponse.json({ error: "Comercio no encontrado" }, { status: 404 }) };
  }

  let plans: Plan[] = [];
  try {
    plans = (await queryMany<Plan>(`SELECT * FROM plans ORDER BY sort ASC`)) || [];
  } catch {
    plans = [];
  }
  const plan = resolveVendorPlan(full as Pick<Vendor, "vertical" | "plan_id" | "plan_status" | "plan_expires_at" | "trial_ends_at" | "visible">, plans);

  if (!plan.can("screens")) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Tu plan no incluye Pantalla TV", code: "plan_locked" },
        { status: 403 }
      ),
    };
  }

  return {
    ok: true,
    ctx: {
      vendorId: vendor.id,
      vendor: full,
      maxScreens: Number(plan.maxScreens ?? 0),
      planScreens: plan.can("screens"),
    },
  };
}
