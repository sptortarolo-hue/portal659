import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-utils";
import { queryMany, queryOne, query, withTransaction } from "@/lib/db";
import { resolveVendorPlan } from "@/lib/plans";
import type { Plan } from "@/types/database";

export const dynamic = "force-dynamic";

const PAYMENT_METHODS = ["efectivo", "transferencia", "mercadopago"];

export async function GET(request: Request) {
  if (!(await isAdmin(request))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const plans = await queryMany<Plan>(`SELECT * FROM plans ORDER BY sort ASC`);

  const rows = await queryMany<Record<string, unknown>>(
    `SELECT
       v.id AS vendor_id,
       v.store_name,
       v.slug,
       v.vertical,
       v.verified,
       v.plan_id,
       v.plan_status,
       v.plan_expires_at,
       v.trial_ends_at,
       p.slug AS plan_slug,
       p.name AS plan_name,
       sub.id AS subscription_id,
       sub.status AS sub_status,
       sub.current_period_start,
       sub.current_period_end,
       sub.payment_method,
       sub.amount,
       sub.paid_at,
       sub.note
     FROM vendors v
     LEFT JOIN plans p ON p.id = v.plan_id
     LEFT JOIN LATERAL (
       SELECT * FROM vendor_subscriptions s
       WHERE s.vendor_id = v.id
       ORDER BY s.created_at DESC
       LIMIT 1
     ) sub ON true
     ORDER BY v.created_at DESC`
  );

  const result = rows.map((r) => {
    const effective = resolveVendorPlan(r as any, plans);
    const now = Date.now();
    const expiresAt = r.plan_expires_at as string | null;
    const expiresInDays =
      expiresAt && effective.slug !== "gratuito"
        ? Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / (24 * 60 * 60 * 1000)))
        : null;

    return {
      ...r,
      amount: r.amount != null ? Number(r.amount) : null,
      plan_name: r.plan_name ?? "Gratuito",
      plan_slug: r.plan_slug ?? "gratuito",
      effective_status: effective.status,
      active: effective.active,
      expired: effective.expired,
      trialActive: effective.trialActive,
      paid: r.paid_at != null,
      expires_in_days: expiresInDays,
    };
  });

  return NextResponse.json({ subscriptions: result, plans });
}

type UpsertSubParams = {
  vendorId: string;
  planId: string;
  status: "trial" | "active" | "expired" | "cancelled";
  periodStart: string;
  periodEnd: string | null;
  paymentMethod?: string | null;
  amount?: number | null;
  paid?: boolean;
  note?: string | null;
};

async function insertSubscription(tx: Parameters<Parameters<typeof withTransaction>[0]>[0], p: UpsertSubParams) {
  const paidAt = p.paid ? new Date().toISOString() : null;
  await tx.queryVoid(
    `INSERT INTO vendor_subscriptions (
       vendor_id, plan_id, status, current_period_start, current_period_end,
       payment_method, amount, paid_at, note
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      p.vendorId,
      p.planId,
      p.status,
      p.periodStart,
      p.periodEnd,
      p.paymentMethod ?? null,
      p.amount != null && p.amount > 0 ? p.amount : null,
      paidAt,
      p.note ?? null,
    ]
  );
}

export async function PATCH(request: Request) {
  if (!(await isAdmin(request))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const body = await request.json();
  const { vendorId, action } = body;

  if (!vendorId || !action) {
    return NextResponse.json({ error: "vendorId y action son requeridos" }, { status: 400 });
  }

  const vendor = await queryOne<{ id: string; plan_expires_at: string | null }>(
    `SELECT id, plan_expires_at FROM vendors WHERE id = $1`,
    [vendorId]
  );
  if (!vendor) return NextResponse.json({ error: "Comercio no encontrado" }, { status: 404 });

  if (action === "set_plan") {
    const { planSlug, days, paymentMethod, amount, paid, note } = body;
    if (!planSlug) return NextResponse.json({ error: "planSlug es requerido" }, { status: 400 });

    const plans = await queryMany<Plan>(
      `SELECT id, slug, name FROM plans WHERE slug = ANY($1)`,
      [["gratuito", "pedidos", "gestion"]]
    );
    const plan = plans.find((p) => p.slug === planSlug);
    if (!plan) return NextResponse.json({ error: "Plan inválido" }, { status: 400 });

    const method = PAYMENT_METHODS.includes(paymentMethod) ? paymentMethod : null;

    if (planSlug === "gratuito") {
      await query(
        `UPDATE vendors SET plan_id = $1, plan_status = 'gratuito', plan_expires_at = NULL, trial_ends_at = NULL WHERE id = $2`,
        [plan.id, vendorId]
      );
      return NextResponse.json({ ok: true, plan: planSlug });
    }

    const periodDays = days && Number(days) > 0 ? Number(days) : 30;
    const base = vendor.plan_expires_at
      ? Math.max(Date.now(), new Date(vendor.plan_expires_at).getTime())
      : Date.now();
    const periodStart = new Date(base).toISOString();
    const periodEnd = new Date(base + periodDays * 24 * 60 * 60 * 1000).toISOString();

    await withTransaction(async (tx) => {
      await tx.queryVoid(
        `UPDATE vendors SET plan_id = $1, plan_status = 'active', plan_expires_at = $2, trial_ends_at = NULL WHERE id = $3`,
        [plan.id, periodEnd, vendorId]
      );
      await insertSubscription(tx, {
        vendorId,
        planId: plan.id,
        status: "active",
        periodStart,
        periodEnd,
        paymentMethod: method,
        amount: amount != null ? Number(amount) : null,
        paid: !!paid,
        note: note || `Activado por administrador (${periodDays} días)`,
      });
    });

    return NextResponse.json({ ok: true, plan: planSlug, periodEnd });
  }

  if (action === "mark_paid") {
    const { subscriptionId, paymentMethod, amount } = body;
    const method = PAYMENT_METHODS.includes(paymentMethod) ? paymentMethod : "transferencia";
    const amountNum = amount != null ? Number(amount) : null;

    const sub = subscriptionId
      ? await queryOne<{ id: string }>(`SELECT id FROM vendor_subscriptions WHERE id = $1 AND vendor_id = $2`, [subscriptionId, vendorId])
      : await queryOne<{ id: string }>(
          `SELECT id FROM vendor_subscriptions WHERE vendor_id = $1 ORDER BY created_at DESC LIMIT 1`,
          [vendorId]
        );

    if (!sub) return NextResponse.json({ error: "Suscripción no encontrada" }, { status: 404 });

    await query(
      `UPDATE vendor_subscriptions SET paid_at = COALESCE(paid_at, now()), payment_method = $1, amount = COALESCE($2, amount) WHERE id = $3`,
      [method, amountNum, sub.id]
    );

    return NextResponse.json({ ok: true, paid: true });
  }

  if (action === "extend") {
    const { days, paymentMethod, amount, paid, note } = body;
    const periodDays = days && Number(days) > 0 ? Number(days) : 30;
    const method = PAYMENT_METHODS.includes(paymentMethod) ? paymentMethod : null;

    const vendorFull = await queryOne<{ plan_id: string | null }>(
      `SELECT plan_id FROM vendors WHERE id = $1`,
      [vendorId]
    );

    if (!vendorFull?.plan_id) {
      return NextResponse.json({ error: "El comercio no tiene un plan asignado" }, { status: 400 });
    }

    const planId = vendorFull.plan_id;
    const base = vendor.plan_expires_at
      ? Math.max(Date.now(), new Date(vendor.plan_expires_at).getTime())
      : Date.now();
    const periodStart = new Date(base).toISOString();
    const periodEnd = new Date(base + periodDays * 24 * 60 * 60 * 1000).toISOString();

    await withTransaction(async (tx) => {
      await tx.queryVoid(
        `UPDATE vendors SET plan_status = 'active', plan_expires_at = $1 WHERE id = $2`,
        [periodEnd, vendorId]
      );
      await insertSubscription(tx, {
        vendorId,
        planId,
        status: "active",
        periodStart,
        periodEnd,
        paymentMethod: method,
        amount: amount != null ? Number(amount) : null,
        paid: !!paid,
        note: note || `Renovación por administrador (${periodDays} días)`,
      });
    });

    return NextResponse.json({ ok: true, periodEnd });
  }

  if (action === "cancel") {
    const { note } = body;
    const vendorFull = await queryOne<{ plan_id: string | null }>(
      `SELECT plan_id FROM vendors WHERE id = $1`,
      [vendorId]
    );

    await withTransaction(async (tx) => {
      await tx.queryVoid(`UPDATE vendors SET plan_status = 'cancelled' WHERE id = $1`, [vendorId]);
      if (vendorFull?.plan_id) {
        await insertSubscription(tx, {
          vendorId,
          planId: vendorFull.plan_id,
          status: "cancelled",
          periodStart: new Date().toISOString(),
          periodEnd: null,
          note: note || "Cancelado por administrador",
        });
      }
    });

    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Acción inválida" }, { status: 400 });
}