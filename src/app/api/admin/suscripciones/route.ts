import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-utils";
import { queryMany, queryOne, query, withTransaction } from "@/lib/db";
import { resolveVendorPlan } from "@/lib/plans";
import type { Plan } from "@/types/database";

export const dynamic = "force-dynamic";

const PAYMENT_METHODS = ["efectivo", "transferencia", "mercadopago"];
const SUB_STATUSES = ["trial", "active", "expired", "cancelled"];
const VENDOR_STATUSES = ["gratuito", "trial", "active", "expired", "cancelled"];

async function findPlan(planSlug?: unknown, planId?: unknown): Promise<Plan | null> {
  if (planId) {
    const byId = await queryOne<Plan>(`SELECT * FROM plans WHERE id = $1`, [planId]);
    if (byId) return byId;
  }
  if (planSlug) {
    const bySlug = await queryOne<Plan>(`SELECT * FROM plans WHERE slug = $1`, [planSlug]);
    if (bySlug) return bySlug;
  }
  return null;
}

function toIsoOrNull(v: unknown): string | null {
  if (v == null || v === "") return null;
  const d = new Date(v as string);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function toAmountOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

export async function GET(request: Request) {
  if (!(await isAdmin(request))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const plans = await queryMany<Plan>(`SELECT * FROM plans ORDER BY sort ASC`);

  const url = new URL(request.url);
  const vendorId = url.searchParams.get("vendorId");
  if (vendorId) {
    const vendor = await queryOne(`SELECT id, store_name, slug, plan_id, plan_status, plan_expires_at, trial_ends_at FROM vendors WHERE id = $1`, [vendorId]);
    if (!vendor) return NextResponse.json({ error: "Comercio no encontrado" }, { status: 404 });
    const history = await queryMany(
      `SELECT s.*, p.slug AS plan_slug, p.name AS plan_name
       FROM vendor_subscriptions s
       LEFT JOIN plans p ON p.id = s.plan_id
       WHERE s.vendor_id = $1
       ORDER BY s.created_at DESC`,
      [vendorId]
    );
    return NextResponse.json({
      vendor,
      history: history.map((h: Record<string, unknown>) => ({
        ...h,
        amount: h.amount != null ? Number(h.amount) : null,
      })),
      plans,
    });
  }

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
        v.visible,
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

  // Edición manual total: actualiza vendors + una fila de vendor_subscriptions
  // (existente o nueva) en una sola transacción.
  if (action === "save_manual") {
    const v = body.vendor ?? {};
    const s = body.subscription ?? null;
    const createNew = !!body.createNew;
    const subscriptionId = body.subscriptionId ?? s?.id ?? null;
    const syncVendor = body.syncVendor !== false;

    const vendorPlan = v.planSlug || v.planId ? await findPlan(v.planSlug, v.planId) : null;
    if ((v.planSlug || v.planId) && !vendorPlan) {
      return NextResponse.json({ error: "Plan del comercio inválido" }, { status: 400 });
    }
    if (v.planStatus && !VENDOR_STATUSES.includes(v.planStatus)) {
      return NextResponse.json({ error: "planStatus inválido" }, { status: 400 });
    }
    const planExpiresAt = v.planExpiresAt !== undefined ? toIsoOrNull(v.planExpiresAt) : undefined;
    const trialEndsAt = v.trialEndsAt !== undefined ? toIsoOrNull(v.trialEndsAt) : undefined;
    if ((v.planExpiresAt && planExpiresAt === null) || (v.trialEndsAt && trialEndsAt === null)) {
      return NextResponse.json({ error: "Fecha del comercio inválida" }, { status: 400 });
    }

    let subPlan: Plan | null = null;
    let subStatus: string | null = null;
    let periodStart: string | null = null;
    let periodEnd: string | null | undefined = undefined;
    let paymentMethod: string | null | undefined = undefined;
    let amount: number | null | undefined = undefined;
    let paidAt: string | null | undefined = undefined;
    let note: string | null | undefined = undefined;

    if (s) {
      subPlan = s.planSlug || s.planId ? await findPlan(s.planSlug, s.planId) : null;
      if ((s.planSlug || s.planId) && !subPlan) {
        return NextResponse.json({ error: "Plan de la suscripción inválido" }, { status: 400 });
      }
      if (s.status && !SUB_STATUSES.includes(s.status)) {
        return NextResponse.json({ error: "status de suscripción inválido" }, { status: 400 });
      }
      if (s.periodStart) {
        periodStart = toIsoOrNull(s.periodStart);
        if (!periodStart) return NextResponse.json({ error: "Inicio de período inválido" }, { status: 400 });
      } else if (createNew) {
        return NextResponse.json({ error: "El inicio del período es requerido" }, { status: 400 });
      }
      if (s.periodEnd !== undefined) {
        periodEnd = s.periodEnd ? toIsoOrNull(s.periodEnd) : null;
        if (s.periodEnd && periodEnd === null) {
          return NextResponse.json({ error: "Fin de período inválido" }, { status: 400 });
        }
      }
      if (periodStart && periodEnd && new Date(periodEnd) <= new Date(periodStart)) {
        return NextResponse.json({ error: "El fin del período debe ser posterior al inicio" }, { status: 400 });
      }
      if (s.paymentMethod !== undefined) {
        paymentMethod = s.paymentMethod ? (PAYMENT_METHODS.includes(s.paymentMethod) ? s.paymentMethod : null) : null;
        if (s.paymentMethod && paymentMethod === null) {
          return NextResponse.json({ error: "paymentMethod inválido" }, { status: 400 });
        }
      }
      if (s.amount !== undefined) {
        if (s.amount === null || s.amount === "") amount = null;
        else {
          const n = Number(s.amount);
          if (!Number.isFinite(n) || n < 0) return NextResponse.json({ error: "Monto inválido" }, { status: 400 });
          amount = n;
        }
      }
      if (s.paid !== undefined || s.paidAt !== undefined) {
        const paid = s.paid !== undefined ? !!s.paid : !!s.paidAt;
        if (!paid) paidAt = null;
        else if (s.paidAt) {
          paidAt = toIsoOrNull(s.paidAt);
          if (!paidAt) return NextResponse.json({ error: "Fecha de pago inválida" }, { status: 400 });
        } else {
          paidAt = new Date().toISOString();
        }
      }
      if (s.note !== undefined) note = s.note ? String(s.note) : null;
      subStatus = s.status ?? null;

      if (!createNew && !subscriptionId) {
        return NextResponse.json({ error: "subscriptionId es requerido para editar" }, { status: 400 });
      }
      if (!createNew && subscriptionId) {
        const existing = await queryOne<{ id: string }>(
          `SELECT id FROM vendor_subscriptions WHERE id = $1 AND vendor_id = $2`,
          [subscriptionId, vendorId]
        );
        if (!existing) return NextResponse.json({ error: "Suscripción no encontrada" }, { status: 404 });
      }
    }

    await withTransaction(async (tx) => {
      let subPlanId: string | null = null;
      let subPeriodEnd: string | null | undefined = undefined;

      if (s) {
        if (createNew) {
          if (!subPlan) throw new Error("Plan de la suscripción requerido");
          if (!subStatus) throw new Error("Estado de la suscripción requerido");
          if (!periodStart) throw new Error("Inicio del período requerido");
          const finalPaidAt = paidAt !== undefined ? paidAt : null;
          await tx.queryVoid(
            `INSERT INTO vendor_subscriptions (
               vendor_id, plan_id, status, current_period_start, current_period_end,
               payment_method, amount, paid_at, note
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              vendorId,
              subPlan.id,
              subStatus,
              periodStart,
              periodEnd ?? null,
              paymentMethod ?? null,
              amount ?? null,
              finalPaidAt,
              note ?? null,
            ]
          );
          subPlanId = subPlan.id as string;
          subPeriodEnd = periodEnd ?? null;
        } else {
          const sets: string[] = [];
          const vals: unknown[] = [];
          const push = (sql: string, val: unknown) => {
            vals.push(val);
            sets.push(`${sql} = $${vals.length}`);
          };
          if (subPlan) push("plan_id", subPlan.id);
          if (subStatus) push("status", subStatus);
          if (periodStart) push("current_period_start", periodStart);
          if (periodEnd !== undefined) push("current_period_end", periodEnd);
          if (paymentMethod !== undefined) push("payment_method", paymentMethod);
          if (amount !== undefined) push("amount", amount);
          if (paidAt !== undefined) push("paid_at", paidAt);
          if (note !== undefined) push("note", note);
          if (sets.length > 0) {
            vals.push(subscriptionId, vendorId);
            await tx.queryVoid(
              `UPDATE vendor_subscriptions SET ${sets.join(", ")} WHERE id = $${vals.length - 1} AND vendor_id = $${vals.length}`,
              vals
            );
          }
          const cur = await tx.queryOne<Record<string, unknown>>(
            `SELECT plan_id, current_period_end, status FROM vendor_subscriptions WHERE id = $1`,
            [subscriptionId]
          );
          subPlanId = (cur?.plan_id as string) ?? null;
          subPeriodEnd = (cur?.current_period_end as string | null) ?? null;
        }
      }

      // vendors: campos explícitos del modal; si syncVendor y se tocó suscripción,
      // el vencimiento sigue al fin del período salvo que el modal fije otro.
      const vSets: string[] = [];
      const vVals: unknown[] = [];
      const vPush = (sql: string, val: unknown) => {
        vVals.push(val);
        vSets.push(`${sql} = $${vVals.length}`);
      };
      if (vendorPlan) vPush("plan_id", vendorPlan.id);
      if (v.planStatus) vPush("plan_status", v.planStatus);
      if (planExpiresAt !== undefined) vPush("plan_expires_at", planExpiresAt);
      else if (syncVendor && s && subPeriodEnd !== undefined) vPush("plan_expires_at", subPeriodEnd);
      if (trialEndsAt !== undefined) vPush("trial_ends_at", trialEndsAt);
      if (syncVendor && s && subPlanId && !vendorPlan) {
        // Si no se eligió plan de comercio explícito, hereda el de la suscripción.
        if (!vSets.some((x) => x.startsWith("plan_id"))) vPush("plan_id", subPlanId);
        if (!v.planStatus && subStatus) {
          vPush("plan_status", subStatus === "cancelled" ? "cancelled" : subStatus === "expired" ? "expired" : subStatus === "trial" ? "trial" : "active");
        }
      }
      if (vSets.length > 0) {
        vVals.push(vendorId);
        await tx.queryVoid(`UPDATE vendors SET ${vSets.join(", ")} WHERE id = $${vVals.length}`, vVals);
      }
    });

    return NextResponse.json({ ok: true });
  }

  if (action === "sync_vendor_from_subscription") {
    const { subscriptionId } = body;
    if (!subscriptionId) return NextResponse.json({ error: "subscriptionId es requerido" }, { status: 400 });
    const sub = await queryOne<Record<string, unknown>>(
      `SELECT s.*, p.slug AS plan_slug FROM vendor_subscriptions s LEFT JOIN plans p ON p.id = s.plan_id WHERE s.id = $1 AND s.vendor_id = $2`,
      [subscriptionId, vendorId]
    );
    if (!sub) return NextResponse.json({ error: "Suscripción no encontrada" }, { status: 404 });
    const status = sub.status as string;
    const planStatus = status === "cancelled" ? "cancelled" : status === "expired" ? "expired" : status === "trial" ? "trial" : "active";
    await query(
      `UPDATE vendors SET plan_id = $1, plan_status = $2, plan_expires_at = $3, trial_ends_at = CASE WHEN $2 = 'trial' THEN COALESCE(trial_ends_at, $3) ELSE NULL END WHERE id = $4`,
      [sub.plan_id, sub.plan_slug === "gratuito" ? "gratuito" : planStatus, sub.current_period_end ?? null, vendorId]
    );
    return NextResponse.json({ ok: true });
  }

  if (action === "set_plan") {
    const { planSlug, days, paymentMethod, amount, paid, note } = body;
    if (!planSlug) return NextResponse.json({ error: "planSlug es requerido" }, { status: 400 });

    const plan = await findPlan(planSlug);
    if (!plan) return NextResponse.json({ error: "Plan inválido" }, { status: 400 });

    const method = PAYMENT_METHODS.includes(paymentMethod) ? paymentMethod : null;

    if ((plan as Plan).slug === "gratuito") {
      await query(
        `UPDATE vendors SET plan_id = $1, plan_status = 'gratuito', plan_expires_at = NULL, trial_ends_at = NULL WHERE id = $2`,
        [(plan as Plan).id, vendorId]
      );
      return NextResponse.json({ ok: true, plan: (plan as Plan).slug });
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
        [(plan as Plan).id, periodEnd, vendorId]
      );
      await insertSubscription(tx, {
        vendorId,
        planId: (plan as Plan).id,
        status: "active",
        periodStart,
        periodEnd,
        paymentMethod: method,
        amount: amount != null ? Number(amount) : null,
        paid: !!paid,
        note: note || `Activado por administrador (${periodDays} días)`,
      });
    });

    return NextResponse.json({ ok: true, plan: (plan as Plan).slug, periodEnd });
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

export async function DELETE(request: Request) {
  if (!(await isAdmin(request))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const { vendorId, subscriptionId } = body;
  if (!vendorId || !subscriptionId) {
    return NextResponse.json({ error: "vendorId y subscriptionId son requeridos" }, { status: 400 });
  }
  const sub = await queryOne<{ id: string }>(
    `SELECT id FROM vendor_subscriptions WHERE id = $1 AND vendor_id = $2`,
    [subscriptionId, vendorId]
  );
  if (!sub) return NextResponse.json({ error: "Suscripción no encontrada" }, { status: 404 });
  await query(`DELETE FROM vendor_subscriptions WHERE id = $1`, [subscriptionId]);
  return NextResponse.json({ ok: true });
}
