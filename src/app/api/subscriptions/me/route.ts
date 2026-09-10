import { getUserId } from "@/lib/auth-utils";
import { queryMany, queryOne } from "@/lib/db";
import { resolveVendorPlan, daysLeft } from "@/lib/plans";
import { NextResponse } from "next/server";
import type { Plan, Vendor, VendorSubscription } from "@/types/database";

export async function GET(request: Request) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const [vendor, plans, history] = await Promise.all([
    queryOne<Vendor>(`SELECT * FROM vendors WHERE user_id = $1 LIMIT 1`, [userId]),
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
        AND created_at >= date_trunc('month', now())`,
    [vendor.id]
  );
  const ordersThisMonth = monthOrders?.c || 0;

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