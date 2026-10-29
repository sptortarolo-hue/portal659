import { getAuthUser } from "@/lib/auth";
import { query, queryMany, queryOne } from "@/lib/db";
import { getPortalBank, computeRenewal, buildReference } from "@/lib/plan-payments";
import { resolveCarrierPlan } from "@/lib/carrier-plans";
import { NextResponse } from "next/server";
import type { Plan } from "@/types/database";

export const dynamic = "force-dynamic";

/**
 * Suscripción de la logística (Modelo B: mensual por transferencia).
 *
 * GET  → estado actual del plan + datos de renovación.
 * POST { planSlug } → crea el reclamo (pending) con monto/período y
 * devuelve los datos de cobro DEL PORTAL para que la logística transfiera
 * y suba el comprobante. El admin aprueba/rechaza desde /admin/suscripciones.
 */
export async function GET(request: Request) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  // Resolver el carrier del perfil (operador dueño).
  const carrier = await queryOne<{ id: string; name: string; plan_id: string | null; plan_status: string | null; plan_expires_at: string | null; trial_ends_at: string | null }>(
    `SELECT c.id, c.name, c.plan_id, c.plan_status, c.plan_expires_at, c.trial_ends_at
       FROM carriers c
       JOIN carrier_operators o ON o.carrier_id = c.id
      WHERE o.profile_id = $1 AND o.active = true AND c.active = true
      ORDER BY c.created_at ASC
      LIMIT 1`,
    [user.id]
  ).catch(() => undefined);
  if (!carrier) {
    return NextResponse.json({ error: "No sos operador de ninguna logística" }, { status: 403 });
  }

  const effective = await resolveCarrierPlan(carrier.id);

  // Planes disponibles para logísticas.
  let plans: Plan[] = [];
  try {
    plans = await queryMany<Plan>(`SELECT * FROM plans WHERE target = 'carrier' ORDER BY price_monthly ASC`);
  } catch {
    plans = [];
  }

  return NextResponse.json({
    carrier: { id: carrier.id, name: carrier.name },
    plan: effective.plan,
    status: effective.status,
    expiresAt: effective.expiresAt,
    trialEndsAt: effective.trialEndsAt,
    analyticsDays: effective.analyticsDays,
    maxShipmentsMonth: effective.maxShipmentsMonth,
    active: effective.active,
    availablePlans: plans,
  });
}

export async function POST(request: Request) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  // Migración aplicada?
  try {
    await queryOne(`SELECT id FROM subscription_payments LIMIT 1`);
  } catch {
    return NextResponse.json(
      { error: "Falta aplicar la migración migrate-plan-payments.sql en la base." },
      { status: 503 }
    );
  }
  // subscription_payments soporta carrier_id?
  try {
    await queryOne(`SELECT carrier_id FROM subscription_payments LIMIT 1`);
  } catch {
    return NextResponse.json(
      { error: "Falta aplicar la migración migrate-carrier-subscription.sql en la base." },
      { status: 503 }
    );
  }

  const carrier = await queryOne<{
    id: string;
    plan_id: string | null;
    plan_status: string | null;
    plan_expires_at: string | null;
  }>(
    `SELECT c.id, c.plan_id, c.plan_status, c.plan_expires_at
       FROM carriers c
       JOIN carrier_operators o ON o.carrier_id = c.id
      WHERE o.profile_id = $1 AND o.active = true AND c.active = true
      ORDER BY c.created_at ASC
      LIMIT 1`,
    [user.id]
  );
  if (!carrier) return NextResponse.json({ error: "No sos operador de ninguna logística" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const planSlug = typeof body?.planSlug === "string" ? body.planSlug : null;
  if (!planSlug) return NextResponse.json({ error: "Falta el plan" }, { status: 400 });

  const plan = await queryOne<Plan>(`SELECT * FROM plans WHERE slug = $1 AND target = 'carrier'`, [planSlug]);
  if (!plan) return NextResponse.json({ error: "Plan no encontrado" }, { status: 404 });

  // Solo un reclamo pendiente por logística.
  const pending = await queryOne<{ id: string }>(
    `SELECT id FROM subscription_payments WHERE carrier_id = $1 AND status IN ('pending','reviewing') LIMIT 1`,
    [carrier.id]
  );
  if (pending) {
    return NextResponse.json(
      { error: "Ya tenés un pago pendiente de revisión. Subí el comprobante o esperá la respuesta del admin." },
      { status: 409 }
    );
  }

  const { amount, periodStart, periodEnd } = computeRenewal(
    { plan_expires_at: carrier.plan_expires_at },
    plan
  );
  const reference = buildReference(carrier.id, planSlug, periodStart);

  // Crear el reclamo.
  const payment = await queryOne<{ id: string }>(
    `INSERT INTO subscription_payments
       (carrier_id, plan_id, amount, period_start, period_end, reference, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending')
     RETURNING id`,
    [carrier.id, plan.id, amount, periodStart, periodEnd, reference]
  );

  const bank = await getPortalBank();
  return NextResponse.json({
    ok: true,
    paymentId: payment?.id,
    plan: { slug: plan.slug, name: plan.name, price: amount },
    amount,
    periodStart,
    periodEnd,
    reference,
    bank,
  });
}
