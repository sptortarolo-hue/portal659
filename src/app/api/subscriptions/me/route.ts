import { getUserId } from "@/lib/auth-utils";
import { queryMany, queryOne } from "@/lib/db";
import { getVendorByRequest } from "@/lib/vendor-utils";
import { resolveVendorPlan, daysLeft } from "@/lib/plans";
import { NextResponse } from "next/server";
import type { Plan, Vendor, VendorSubscription } from "@/types/database";

export async function GET(request: Request) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { vendor: resolved, staffRole } = await getVendorByRequest(request);
  // Repartidor: fuera de la suscripción (mismo alcance que antes).
  if (staffRole === "delivery") {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const [vendor, plans, history] = await Promise.all([
    // El vendor resuelto soporta admin-as (modo llave en mano): antes se
    // query-eaba por user_id y el admin impersonado caía 403 "No tenés un local".
    resolved
      ? queryOne<Vendor>(`SELECT * FROM vendors WHERE id = $1 LIMIT 1`, [resolved.id])
      : Promise.resolve(undefined),
    queryMany<Plan>(`SELECT * FROM plans ORDER BY sort ASC`),
    queryMany<VendorSubscription>(
      `SELECT * FROM vendor_subscriptions ORDER BY created_at DESC LIMIT 24`
    ),
  ]);

  if (!vendor) return NextResponse.json({ error: "No tenés un local" }, { status: 403 });

  const effective = resolveVendorPlan(vendor, plans);

  const productCount = await queryOne<{ c: number }>(
    `SELECT count(*)::int AS c FROM products WHERE vendor_id = $1`,
    [vendor.id]
  );
  const count = productCount?.c || 0;

  const monthOrders = await queryOne<{ c: number }>(
    `SELECT count(*)::int AS c FROM orders
      WHERE vendor_id = $1 AND channel = 'app'
        AND status <> 'cancelled'
        AND is_preview = false
        AND created_at >= date_trunc('month', now())`,
    [vendor.id]
  );
  const ordersThisMonth = monthOrders?.c || 0;

  // Solicitudes del mes (servicios): presupuestos + turnos no cancelados.
  let quotesThisMonth = 0;
  if (vendor.vertical === "servicio") {
    try {
      const [q, b] = await Promise.all([
        queryOne<{ c: number }>(
          `SELECT COUNT(*)::int AS c FROM quotes WHERE vendor_id = $1 AND status <> 'cancelled' AND created_at >= date_trunc('month', now())`,
          [vendor.id]
        ),
        queryOne<{ c: number }>(
          `SELECT COUNT(*)::int AS c FROM bookings WHERE vendor_id = $1 AND status <> 'cancelled' AND created_at >= date_trunc('month', now())`,
          [vendor.id]
        ),
      ]);
      quotesThisMonth = (q?.c ?? 0) + (b?.c ?? 0);
    } catch { /* tablas sin migrar: 0 */ }
  }

  const usage = {
    products: count,
    maxProducts: effective.maxProducts,
    overLimit: effective.maxProducts != null && count > effective.maxProducts,
    percent: effective.maxProducts != null
      ? Math.min(100, Math.round((count / effective.maxProducts) * 100))
      : count > 0 ? 100 : 0,
    ordersThisMonth,
    maxOrdersMonth: effective.maxOrdersMonth,
    ordersOverLimit:
      effective.maxOrdersMonth != null && ordersThisMonth >= effective.maxOrdersMonth,
    quotesThisMonth,
    maxQuotesMonth: effective.maxQuotesMonth,
    quotesOverLimit:
      effective.maxQuotesMonth != null && quotesThisMonth >= effective.maxQuotesMonth,
  };

  return NextResponse.json({
    vendorId: vendor.id,
    vertical: vendor.vertical,
    plans,
    effective: {
      slug: effective.slug,
      status: effective.status,
      trialActive: effective.trialActive,
      active: effective.active,
      expired: effective.expired,
      eligibleForPaid: effective.eligibleForPaid,
      name: effective.plan?.name ?? null,
      badge: effective.plan?.badge ?? null,
      priceMonthly: effective.plan?.price_monthly ?? 0,
      analyticsDays: effective.analyticsDays,
    },
    trial: {
      endsAt: effective.trialEndsAt,
      daysLeft: daysLeft(effective.trialEndsAt),
      hasTrial: effective.hasTrial,
    },
    usage,
    history: history || [],
  });
}