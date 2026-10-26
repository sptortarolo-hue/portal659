import { getUserId } from "@/lib/auth-utils";
import { resolveOwnedVendorId } from "@/lib/vendor-utils";
import { query, queryMany, queryOne } from "@/lib/db";
import { getPortalBank, computeRenewal, buildReference } from "@/lib/plan-payments";
import { getSiteUrl } from "@/lib/site-url";
import { NextResponse } from "next/server";
import type { Plan } from "@/types/database";

export const dynamic = "force-dynamic";

/**
 * Renovación del plan por transferencia: crea el reclamo (pending) con el
 * monto/período calculados y devuelve los datos de cobro DEL PORTAL para que
 * el comercio transfiera y suba el comprobante.
 *
 * POST /api/subscriptions/renew { planSlug, vendorId? }
 *
 * Mientras el reclamo esté pendiente el plan no corta (gracia 'past_due'):
 * el admin aprueba o rechaza desde /admin/suscripciones.
 */
export async function POST(request: Request) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  // Postgres sin la migración: el circuito no existe todavía (mensaje claro,
  // nunca un error opaco).
  try {
    await queryOne(`SELECT id FROM subscription_payments LIMIT 1`);
  } catch {
    return NextResponse.json(
      { error: "Falta aplicar la migración migrate-plan-payments.sql en la base." },
      { status: 503 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const ownedVendorId = await resolveOwnedVendorId(userId, request, body?.vendorId);
  if (!ownedVendorId) return NextResponse.json({ error: "No tenés un local" }, { status: 403 });

  const vendor = await queryOne<{
    id: string;
    vertical: string;
    plan_id: string | null;
    plan_status: string | null;
    plan_expires_at: string | null;
    trial_ends_at: string | null;
    visibility: string | null;
    visible: boolean | null;
  }>(
    `SELECT id, vertical, plan_id, plan_status, plan_expires_at, trial_ends_at, visibility, visible
     FROM vendors WHERE id = $1 AND user_id = $2 LIMIT 1`,
    [ownedVendorId, userId]
  );
  if (!vendor) return NextResponse.json({ error: "No tenés un local" }, { status: 403 });

  const vis = vendor.visibility ?? (vendor.visible ? "public" : "hidden");
  if (vis === "hidden") {
    return NextResponse.json(
      { error: "Publicá tu comercio antes de renovar: en modo prueba ya tenés todo habilitado." },
      { status: 403 }
    );
  }

  // Mismos verticales/planes que el pago MP.
  const allowed =
    vendor.vertical === "servicio"
      ? ["oficios"]
      : vendor.vertical === "estetica"
        ? ["pedidos", "gestion"]
        : ["pedidos", "gestion"];
  if (allowed.length === 0) {
    return NextResponse.json(
      { error: "Los planes pagos están disponibles para gastronomía, comercios, moda, estética y servicios" },
      { status: 400 }
    );
  }

  const plans = await queryMany<Plan>(`SELECT * FROM plans WHERE slug = ANY($1)`, [allowed]);
  const requested = typeof body?.planSlug === "string" ? body.planSlug : null;
  const plan = requested
    ? plans.find((p) => p.slug === requested)
    : plans.find((p) => p.id === vendor.plan_id);
  if (!plan || !allowed.includes(plan.slug)) {
    return NextResponse.json({ error: "Elegí un plan válido para tu rubro" }, { status: 400 });
  }

  // Un solo reclamo pendiente por comercio: evita reclamos duplicados.
  const pending = await queryOne<{ id: string }>(
    `SELECT id FROM subscription_payments WHERE vendor_id = $1 AND status = 'pending' LIMIT 1`,
    [vendor.id]
  );
  if (pending) {
    return NextResponse.json(
      { error: "Ya tenés un pago en revisión. Subí el comprobante desde Mi suscripción.", ok: false, pendingId: pending.id },
      { status: 409 }
    );
  }

  const { amount, periodStart, periodEnd, price } = computeRenewal(vendor, plan);
  if (amount <= 0) {
    return NextResponse.json({ error: "El plan no tiene precio cargado: consultá con el administrador." }, { status: 400 });
  }

  const reference = buildReference(vendor.id, plan.slug, periodStart);
  const row = await queryOne<{ id: string }>(
    `INSERT INTO subscription_payments
      (vendor_id, plan_id, amount, period_start, period_end, reference, method, status, promo_pct, promo_list_price)
     VALUES ($1, $2, $3, $4, $5, $6, 'transferencia', 'pending', $7, $8)
     RETURNING id`,
    [
      vendor.id,
      plan.id,
      amount,
      periodStart,
      periodEnd,
      reference,
      price.isPromo ? price.offPct ?? null : null,
      price.isPromo ? price.listPrice : null,
    ]
  );

  // Si el plan ya había vencido, entra en gracia: no se corta mientras se revisa.
  const expiresMs = vendor.plan_expires_at ? new Date(vendor.plan_expires_at).getTime() : 0;
  if (vendor.plan_status === "expired" || (vendor.plan_status === "active" && expiresMs < Date.now())) {
    await query(`UPDATE vendors SET plan_status = 'past_due' WHERE id = $1`, [vendor.id]).catch(() => undefined);
  }

  return NextResponse.json({
    ok: true,
    payment: {
      id: row?.id,
      amount,
      plan: { id: plan.id, slug: plan.slug, name: plan.name },
      periodStart,
      periodEnd,
      reference,
    },
    price: {
      amount: price.amount,
      isPromo: price.isPromo,
      listPrice: price.listPrice,
      offPct: price.offPct,
      months: price.months,
      promoEndsAt: price.promoEndsAt,
    },
    bank: await getPortalBank(),
    renewUrl: `${getSiteUrl()}/vendor/suscripcion#renovar`,
  });
}
