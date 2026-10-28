import { getUserId } from "@/lib/auth-utils";
import { queryMany, queryOne } from "@/lib/db";
import { getVendorByRequest } from "@/lib/vendor-utils";
import { resolveVendorPlan, daysLeft, planPriceFor } from "@/lib/plans";
import { getPortalBank, derivePromoFor } from "@/lib/plan-payments";
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

  // Solicitudes del mes (servicios y estética): consultas/presupuestos + turnos no cancelados.
  let quotesThisMonth = 0;
  if (vendor.vertical === "servicio" || vendor.vertical === "estetica") {
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

  // Circuito de pago por transferencia: reclamo pendiente (si existe) +
  // historial de pagos y de recibos X. Todo tolerante a migración sin aplicar.
  let pending = null;
  let payments: unknown[] = [];
  let receipts: unknown[] = [];
  let bank = null;
  try {
    const rows = await queryMany(
      `SELECT p.id, p.amount, p.period_start, p.period_end, p.reference, p.status,
              p.comprobante_url, p.comprobante_name, p.comprobante_at, p.created_at,
              p.review_note, pl.slug AS plan_slug, pl.name AS plan_name
         FROM subscription_payments p
         LEFT JOIN plans pl ON pl.id = p.plan_id
        WHERE p.vendor_id = $1
        ORDER BY p.created_at DESC
        LIMIT 12`,
      [vendor.id]
    );
    payments = rows || [];
    pending = (rows || []).find((r: any) => r.status === "pending") || null;
  } catch {
    /* sin migración: el circuito queda oculto */
  }
  try {
    receipts = (await queryMany(
      `SELECT r.id, r.amount, r.plan_name, r.seq, r.year, r.method, r.issued_at,
              r.period_start, r.period_end, r.promo_pct, r.promo_list_price, r.plan_id
         FROM plan_receipts r
        WHERE r.vendor_id = $1
        ORDER BY r.issued_at DESC
        LIMIT 12`,
      [vendor.id]
    )) || [];
  } catch {
    /* sin migración */
  }
  bank = await getPortalBank().catch(() => null);

  // Recibos viejos sin snapshot de promo: se deriva del vigente si el monto
  // coincide con el precio promo (así el A4 y el PDF muestran el descuento).
  const receiptsOut: unknown[] = [];
  for (const r of receipts as any[]) {
    let promoPct = r.promo_pct ?? null;
    let promoListPrice = r.promo_list_price ?? null;
    if ((promoPct == null || promoListPrice == null) && vendor.plan_id) {
      const derived = await derivePromoFor(vendor.plan_id, Number(r.amount)).catch(() => null);
      if (derived) {
        promoPct = promoPct ?? derived.pct;
        promoListPrice = promoListPrice ?? derived.listPrice;
      }
    }
    receiptsOut.push({
      id: r.id,
      amount: Number(r.amount),
      plan_name: r.plan_name,
      seq: r.seq,
      year: r.year,
      method: r.method,
      issued_at: r.issued_at,
      period_end: r.period_end,
      promo_pct: promoPct,
      promo_list_price: promoListPrice,
    });
  }

  // Precio de hoy del plan actual (promo si está vigente, si no lista).
  const currentPlan = plans.find((p) => p.id === vendor.plan_id) ?? null;
  const priceToday = planPriceFor(currentPlan);

  // Proyección de cierre de mes (predictivo): ritmo actual vs tope del plan.
  const nowDate = new Date();
  const dayOfMonth = nowDate.getDate();
  const daysInMonth = new Date(nowDate.getFullYear(), nowDate.getMonth() + 1, 0).getDate();
  const projectedOrders =
    dayOfMonth > 0 ? Math.round((usage.ordersThisMonth / dayOfMonth) * daysInMonth) : usage.ordersThisMonth;
  const projectedQuotes =
    vendor.vertical === "servicio" || vendor.vertical === "estetica"
      ? dayOfMonth > 0
        ? Math.round((usage.quotesThisMonth / dayOfMonth) * daysInMonth)
        : usage.quotesThisMonth
      : null;

  // Qué se pierde al bajar a Gratuito (evita el downgrade silencioso).
  const freePlan = plans.find((p) => p.slug === "gratuito") ?? null;
  const wouldLose: { key: string; label: string; current: string; free: string }[] = [];
  if (effective.slug !== "gratuito" && effective.plan) {
    const compare: { key: string; label: string; get: (f: any) => unknown }[] = [
      { key: "pos", label: "Mostrador y Caja", get: (f) => f.pos },
      { key: "crm", label: "Clientes (CRM)", get: (f) => f.crm },
      { key: "analytics_days", label: "Estadísticas", get: (f) => f.analytics_days },
      { key: "kds", label: "Comanda (cocina)", get: (f) => f.kds },
      { key: "mesas", label: "Mesas", get: (f) => f.mesas },
      { key: "printer", label: "Impresión", get: (f) => f.printer },
      { key: "reviews_manage", label: "Gestión de reseñas", get: (f) => f.reviews_manage },
      { key: "recipes", label: "Preparación y Costo", get: (f) => f.recipes },
      { key: "fiscal", label: "Facturación", get: (f) => f.fiscal },
      { key: "inventory", label: "Inventario", get: (f) => f.inventory },
      { key: "quotes_respond", label: "Cotizar con precio", get: (f) => f.quotes_respond },
      { key: "deposits", label: "Seña online", get: (f) => f.deposits },
    ];
    const curF = effective.plan.features as any;
    const freeF = (freePlan?.features ?? {}) as any;
    for (const c of compare) {
      const cur = c.get(curF);
      const fre = c.get(freeF);
      if (cur && !fre) {
        const current = c.key === "analytics_days" ? `${cur} días de historial` : "incluido";
        const free = c.key === "analytics_days" ? "sin historial" : "no incluye";
        wouldLose.push({ key: c.key, label: c.label, current, free });
      }
    }
    // Límites: si hoy está por encima de los del plan gratis, se lo dice.
    if (
      freePlan?.max_products != null &&
      usage.products > Number(freePlan.max_products)
    ) {
      wouldLose.push({
        key: "max_products",
        label: "Productos publicados",
        current: `${usage.products} publicados`,
        free: `Gratuito permite ${freePlan.max_products}`,
      });
    }
    if (
      freePlan?.max_orders_month != null &&
      usage.ordersThisMonth > Number(freePlan.max_orders_month)
    ) {
      wouldLose.push({
        key: "max_orders_month",
        label: "Pedidos este mes",
        current: `${usage.ordersThisMonth} pedidos`,
        free: `Gratuito permite ${freePlan.max_orders_month}`,
      });
    }
  }

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
      grace: effective.grace,
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
    planExpiresAt: vendor.plan_expires_at ?? null,
    daysLeftPlan: daysLeft(vendor.plan_expires_at),
    // Precio de hoy (misma fuente que el cobro y los mails).
    priceToday: priceToday
      ? {
          amount: priceToday.amount,
          isPromo: priceToday.isPromo,
          listPrice: priceToday.listPrice,
          offPct: priceToday.offPct,
          months: priceToday.months,
          promoEndsAt: priceToday.promoEndsAt,
        }
      : null,
    projected: {
      orders: projectedOrders,
      ordersLimit: effective.maxOrdersMonth,
      ordersOverProjected:
        effective.maxOrdersMonth != null && projectedOrders > effective.maxOrdersMonth,
      quotes: projectedQuotes,
      quotesLimit: effective.maxQuotesMonth,
      quotesOverProjected:
        effective.maxQuotesMonth != null &&
        projectedQuotes != null &&
        projectedQuotes > effective.maxQuotesMonth,
    },
    monthResetOn: new Date(nowDate.getFullYear(), nowDate.getMonth() + 1, 1).toISOString(),
    wouldLose,
    payments,
    pending,
    receipts: receiptsOut,
    bank: bank
      ? {
          ...bank,
          whatsapp: (bank as { whatsapp?: string | null }).whatsapp ?? null,
        }
      : bank,
  });
}