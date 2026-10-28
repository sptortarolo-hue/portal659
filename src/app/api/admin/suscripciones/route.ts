import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-utils";
import { getAuthUser } from "@/lib/auth";
import { queryMany, queryOne, query, withTransaction } from "@/lib/db";
import { resolveVendorPlan, planPriceFor } from "@/lib/plans";
import { nextReceiptSeq, getPortalBank, derivePromoFor } from "@/lib/plan-payments";
import { getSiteUrl } from "@/lib/site-url";
import { buildPlanReceiptPdf } from "@/lib/plan-receipt-pdf";
import { planReceiptEmail, planComprobanteReminderEmail, sendEmail } from "@/lib/email";
import { sendPushToUser } from "@/lib/push";
import type { Plan } from "@/types/database";

export const dynamic = "force-dynamic";

const PAYMENT_METHODS = ["efectivo", "transferencia", "mercadopago"];
const SUB_STATUSES = ["trial", "active", "expired", "cancelled"];
const VENDOR_STATUSES = ["gratuito", "trial", "active", "expired", "cancelled", "past_due"];

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
    const payments = await queryMany(
      `SELECT p.id, p.amount, p.period_start, p.period_end, p.reference, p.method, p.status,
              p.comprobante_url, p.comprobante_at, p.created_at, p.reviewed_at, p.review_note,
              pl.name AS plan_name
         FROM subscription_payments p
         LEFT JOIN plans pl ON pl.id = p.plan_id
        WHERE p.vendor_id = $1
        ORDER BY p.created_at DESC
        LIMIT 50`,
      [vendorId]
    ).catch(() => []);
    const receipts = await queryMany(
      `SELECT id, amount, plan_name, method, seq, year, issued_at, emailed_at, period_start, period_end
         FROM plan_receipts WHERE vendor_id = $1 ORDER BY issued_at DESC LIMIT 50`,
      [vendorId]
    ).catch(() => []);
    return NextResponse.json({
      vendor,
      history: history.map((h: Record<string, unknown>) => ({
        ...h,
        amount: h.amount != null ? Number(h.amount) : null,
      })),
      payments,
      receipts,
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

  // Cola de revisión: pendientes (con y sin comprobante) + revisados (30 días).
  const [pending, reviewed, bank] = await Promise.all([
    queryMany<Record<string, unknown>>(
      `SELECT p.id, p.amount, p.period_start, p.period_end, p.reference, p.created_at,
              p.comprobante_url, p.comprobante_name, p.comprobante_at, p.last_nudge_at,
              p.promo_pct, p.promo_list_price, p.plan_id,
              v.id AS vendor_id, v.store_name, v.slug, v.vertical, v.plan_expires_at,
              pl.name AS plan_name, pl.price_monthly AS plan_list_price,
              pl.promo_price AS plan_promo_price, pl.promo_months AS plan_promo_months,
              pl.promo_ends_at AS plan_promo_ends_at
         FROM subscription_payments p
         JOIN vendors v ON v.id = p.vendor_id
         LEFT JOIN plans pl ON pl.id = p.plan_id
        WHERE p.status = 'pending'
        ORDER BY p.comprobante_at NULLS FIRST, p.created_at ASC
        LIMIT 200`
    ).catch(() => [] as Record<string, unknown>[]),
    queryMany<Record<string, unknown>>(
      `SELECT p.id, p.amount, p.period_end, p.reference, p.method, p.status,
              p.reviewed_at, p.review_note, p.comprobante_url,
              v.id AS vendor_id, v.store_name, pl.name AS plan_name
         FROM subscription_payments p
         JOIN vendors v ON v.id = p.vendor_id
         LEFT JOIN plans pl ON pl.id = p.plan_id
        WHERE p.status IN ('approved', 'rejected')
          AND p.reviewed_at > now() - interval '30 days'
        ORDER BY p.reviewed_at DESC
        LIMIT 200`
    ).catch(() => [] as Record<string, unknown>[]),
    queryOne<{ alias: string | null; cbu: string | null; titular: string | null; qr_url: string | null; whatsapp: string | null; notes: string | null }>(
      `SELECT alias, cbu, titular, qr_url, whatsapp, notes FROM portal_bank WHERE id = 1`
    ).catch(() => null),
  ]);

  // Monto esperado hoy por plan: para marcar reclamos que no coincidan.
  const priceOf = (planId: unknown, list: unknown, promo: unknown, months: unknown, ends: unknown): number => {
    const p = planPriceFor(
      {
        id: String(planId || ""),
        price_monthly: Number(list || 0),
        promo_price: promo == null ? null : Number(promo),
        promo_months: months == null ? null : Number(months),
        promo_ends_at: (ends as string | null) ?? null,
        promo_label: null,
        slug: "",
        name: "",
      } as unknown as Plan,
      new Date()
    );
    return p?.amount ?? Number(list || 0);
  };

  const pendingOut = (pending || []).map((p: Record<string, unknown>) => {
    const expected = priceOf(
      p.plan_id,
      p.plan_list_price,
      p.plan_promo_price,
      p.plan_promo_months,
      p.plan_promo_ends_at
    );
    const amount = p.amount != null ? Number(p.amount) : null;
    return {
      ...p,
      amount,
      expected_amount: expected,
      amount_mismatch: amount != null && expected > 0 && Math.abs(amount - expected) > 1,
      age_hours: p.created_at
        ? Math.round((Date.now() - new Date(p.created_at as string).getTime()) / 3600000)
        : null,
    };
  });

  return NextResponse.json({
    subscriptions: result,
    plans,
    // Cola: pendientes primero con comprobante (ya se puede decidir).
    pending: pendingOut.sort((a: any, b: any) => {
      const ax = a.comprobante_at ? 0 : 1;
      const bx = b.comprobante_at ? 0 : 1;
      return ax - bx || (b.age_hours ?? 0) - (a.age_hours ?? 0);
    }),
    reviewed: (reviewed || []).map((p: Record<string, unknown>) => ({
      ...p,
      amount: p.amount != null ? Number(p.amount) : null,
    })),
    bank,
    bankComplete: !!(bank && (bank.alias || bank.cbu)),
  });
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

async function insertSubscription(
  tx: Parameters<Parameters<typeof withTransaction>[0]>[0],
  p: UpsertSubParams
): Promise<{ id: string }> {
  const paidAt = p.paid ? new Date().toISOString() : null;
  const rows = await tx.query<{ id: string }>(
    `INSERT INTO vendor_subscriptions (
       vendor_id, plan_id, status, current_period_start, current_period_end,
       payment_method, amount, paid_at, note
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
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
  return rows[0];
}

/** Datos de contacto del comercio (dueño por email + ficha para el recibo). */
async function loadVendorContact(vendorId: string) {
  return queryOne<{
    user_id: string | null;
    store_name: string;
    address: string | null;
    phone: string | null;
    whatsapp: string | null;
    email: string | null;
  }>(
    `SELECT v.user_id, v.store_name, v.address, v.phone, v.whatsapp, p.email
       FROM vendors v LEFT JOIN profiles p ON p.id = v.user_id
      WHERE v.id = $1`,
    [vendorId]
  );
}

/** Inserta la fila del Recibo X (dentro de la tx de aprobación/emisión). */
async function insertReceipt(
  tx: Parameters<Parameters<typeof withTransaction>[0]>[0],
  p: {
    vendorId: string;
    paymentId: string | null;
    planId: string | null;
    planName: string;
    amount: number;
    periodStart: string | null;
    periodEnd: string | null;
    methodLabel: string;
    promoPct: number | null;
    promoListPrice: number | null;
    seq: number;
    year: number;
  }
): Promise<{ id: string }> {
  const rows = await tx.query<{ id: string }>(
    `INSERT INTO plan_receipts
       (vendor_id, payment_id, plan_id, plan_name, amount, period_start, period_end,
        method, promo_pct, promo_list_price, seq, year)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING id`,
    [
      p.vendorId,
      p.paymentId,
      p.planId,
      p.planName,
      p.amount,
      p.periodStart,
      p.periodEnd,
      p.methodLabel,
      p.promoPct,
      p.promoListPrice,
      p.seq,
      p.year,
    ]
  );
  return rows[0];
}

/**
 * Emite el aviso de un recibo: PDF por mail al dueño + campana/push.
 * Compartido por approve_payment, emit_receipt y resend_receipt.
 */
async function sendReceiptNotice(params: {
  info: Awaited<ReturnType<typeof loadVendorContact>>;
  planName: string;
  receiptNumber: string;
  /** Fila del recibo (approve/emit) o del pago (resend marca emailed igual). */
  receiptId: string;
  amount: number;
  periodStart: string | null;
  periodEnd: string | null;
  methodLabel: string;
  promoPct: number | null;
  promoListPrice: number | null;
  noticeBody: string;
}) {
  const { info, receiptId } = params;
  const title = "¡Pago acreditado!";
  const promoNote =
    params.promoPct && params.promoListPrice
      ? `precio promo −${params.promoPct}% (lista $${Number(params.promoListPrice).toLocaleString("es-AR")})`
      : "precio de lista";

  if (info?.email && process.env.RESEND_API_KEY) {
    try {
      const pdf = await buildPlanReceiptPdf({
        vendor: {
          store_name: info.store_name,
          address: info.address,
          phone: info.phone,
          whatsapp: info.whatsapp,
        },
        receiptNumber: params.receiptNumber,
        issuedAt: new Date().toISOString(),
        planName: params.planName,
        amount: params.amount,
        periodStart: params.periodStart,
        periodEnd: params.periodEnd,
        method: params.methodLabel,
        priceNote: promoNote,
      });
      const mail = planReceiptEmail({
        storeName: info.store_name,
        planName: params.planName,
        receiptNumber: params.receiptNumber,
        amount: params.amount,
        periodEnd: params.periodEnd,
        priceNote: promoNote,
      });
      await sendEmail({
        to: info.email,
        subject: mail.subject,
        html: mail.html,
        attachments: [
          { filename: `recibo-X-${params.receiptNumber.replace("/", "-")}.pdf`, content: pdf.toString("base64") },
        ],
      });
      await query(`UPDATE plan_receipts SET emailed_at = now() WHERE id = $1`, [receiptId]).catch(() => undefined);
    } catch {
      /* mail best-effort */
    }
  }

  if (info?.user_id) {
    await query(
      `INSERT INTO notifications (user_id, title, body, type, link) VALUES ($1, $2, $3, 'payment', '/vendor/suscripcion')`,
      [info.user_id, title, params.noticeBody]
    ).catch(() => undefined);
    try {
      await sendPushToUser(info.user_id, { title, body: params.noticeBody, link: "/vendor/suscripcion" });
    } catch {
      /* push best-effort */
    }
  }
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

  // Usuario admin que ejecuta la acción (auditoría de reviewed_by).
  const adminUser = await getAuthUser(request);
  const adminUserId = adminUser?.id ?? null;

  // Los datos bancarios del portal no dependen de un comercio.
  if (action === "save_bank") {
    const b = body.bank ?? {};
    const clean = (v: unknown, max = 120) => {
      const s = String(v ?? "").trim();
      return s ? s.slice(0, max) : null;
    };
    try {
      await query(
        `UPDATE portal_bank
            SET alias = $1, cbu = $2, titular = $3, qr_url = $4, notes = $5, updated_at = now()
          WHERE id = 1`,
        [
          clean(b.alias, 60),
          clean(b.cbu, 40),
          clean(b.titular, 120),
          clean(b.qr_url, 400),
          clean(b.notes, 500),
        ]
      );
    } catch {
      return NextResponse.json({ error: "Falta aplicar la migración migrate-plan-payments.sql" }, { status: 503 });
    }
    return NextResponse.json({ ok: true });
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

    if (action === "approve_payment") {
    const { paymentId } = body;
    if (!paymentId) return NextResponse.json({ error: "paymentId requerido" }, { status: 400 });

    const payment = await queryOne<{
      id: string;
      vendor_id: string;
      plan_id: string | null;
      amount: number;
      period_start: string;
      period_end: string;
      status: string;
      promo_pct: number | null;
      promo_list_price: number | null;
    }>(
      `SELECT * FROM subscription_payments WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
      [paymentId, vendorId]
    );
    if (!payment) return NextResponse.json({ error: "Pago no encontrado" }, { status: 404 });
    if (payment.status !== "pending") {
      return NextResponse.json({ error: "Este pago ya fue revisado" }, { status: 409 });
    }

    const plan = payment.plan_id
      ? await queryOne<{ id: string; name: string; slug: string }>(
          `SELECT id, name, slug FROM plans WHERE id = $1`,
          [payment.plan_id]
        )
      : null;

    const info = await loadVendorContact(vendorId);

    const year = new Date().getFullYear();
    let receiptId = "";
    let receiptNumber = "";
    let receiptSeq = 0;
    // Snapshot del descuento: el del reclamo, o derivado del promo vigente
    // (reclamos viejos sin la columna siguen mostrando el promo en el recibo).
    const promoSnapshot =
      payment.promo_pct != null && payment.promo_list_price != null
        ? { pct: Number(payment.promo_pct), listPrice: Number(payment.promo_list_price) }
        : await derivePromoFor(payment.plan_id, Number(payment.amount));
    const promoPct = promoSnapshot?.pct ?? null;
    const promoListPrice = promoSnapshot?.listPrice ?? null;

    await withTransaction(async (tx) => {
      receiptSeq = await nextReceiptSeq(tx, year);
      receiptNumber = `${String(receiptSeq).padStart(4, "0")}/${year}`;
      await tx.queryVoid(
        `UPDATE vendors SET plan_id = $1, plan_status = 'active', plan_expires_at = $2, trial_ends_at = NULL WHERE id = $3`,
        [plan?.id ?? null, payment.period_end, vendorId]
      );
      const sub = await insertSubscription(tx, {
        vendorId,
        planId: (plan?.id ?? payment.plan_id) as string,
        status: "active",
        periodStart: payment.period_start,
        periodEnd: payment.period_end,
        paymentMethod: "transferencia",
        amount: Number(payment.amount),
        paid: true,
        note: `Renovación por transferencia (reclamo aprobado)`,
      });
      await tx.queryVoid(
        `UPDATE subscription_payments
            SET status = 'approved', reviewed_at = now(), reviewed_by = $1, subscription_id = $2
          WHERE id = $3`,
        [adminUserId, sub.id, payment.id]
      );
      const rec = await insertReceipt(tx, {
        vendorId,
        paymentId: payment.id,
        planId: plan?.id ?? payment.plan_id,
        planName: plan?.name ?? "Plan",
        amount: Number(payment.amount),
        periodStart: payment.period_start,
        periodEnd: payment.period_end,
        methodLabel: "Transferencia bancaria",
        promoPct,
        promoListPrice,
        seq: receiptSeq,
        year,
      });
      receiptId = rec.id;
    });

    // Fuera de la tx: recibo X en PDF por email + aviso al comercio.
    if (receiptSeq > 0 && receiptId) {
      await sendReceiptNotice({
        info,
        planName: plan?.name ?? "Plan",
        receiptNumber,
        receiptId,
        amount: Number(payment.amount),
        periodStart: payment.period_start,
        periodEnd: payment.period_end,
        methodLabel: "Transferencia bancaria",
        promoPct,
        promoListPrice,
        noticeBody: `Tu plan ${plan?.name ?? "pagado"} está activo hasta el ${new Date(payment.period_end).toLocaleDateString("es-AR")}. Te enviamos el Recibo X ${receiptNumber} por email.`,
      });
    }

    return NextResponse.json({
      ok: true,
      approved: true,
      receipt: receiptSeq > 0 ? { number: receiptNumber, id: receiptId } : null,
    });
  }

  // Recibo emitido a mano (pago por transferencia o en efectivo por fuera de
  // la app). Audita como pago aprobado y, si se pide, renueva el plan.
  if (action === "emit_receipt") {
    const { planId, amount, periodStart, periodEnd, method, renew, note, promoPct, promoListPrice } = body;
    const amountNum = Number(amount);
    if (!planId || !Number.isFinite(amountNum) || amountNum <= 0) {
      return NextResponse.json({ error: "Indicá plan y monto (mayor a 0)" }, { status: 400 });
    }
    const methodValue = method === "efectivo" ? "efectivo" : "transferencia";
    const start = toIsoOrNull(periodStart);
    const end = toIsoOrNull(periodEnd);
    if (!start || !end || new Date(end) <= new Date(start)) {
      return NextResponse.json({ error: "Período inválido (el fin debe ser posterior al inicio)" }, { status: 400 });
    }

    const plan = await queryOne<{ id: string; name: string; slug: string; price_monthly: number }>(
      `SELECT id, name, slug, price_monthly FROM plans WHERE id = $1`,
      [planId]
    );
    if (!plan) return NextResponse.json({ error: "Plan inválido" }, { status: 400 });

    const info = await loadVendorContact(vendorId);
    const year = new Date().getFullYear();
    let seq = 0;
    const methodLabel = methodValue === "efectivo" ? "Efectivo" : "Transferencia bancaria";
    const pct = Number.isFinite(Number(promoPct)) && Number(promoPct) > 0 ? Math.round(Number(promoPct)) : null;
    const listPrice = Number(promoListPrice) > 0 ? Number(promoListPrice) : null;
    // Si no vino el snapshot (modal viejo o emisión por API), se deriva del
    // promo vigente cuando el monto coincida con el precio promo.
    const derived = !pct ? await derivePromoFor(plan.id, amountNum) : null;
    const promoPctFinal = pct ?? derived?.pct ?? null;
    const promoListFinal = listPrice ?? derived?.listPrice ?? null;

    let paymentId = "";
    let receiptId = "";
    let receiptNumber = "";
    await withTransaction(async (tx) => {
      seq = await nextReceiptSeq(tx, year);
      receiptNumber = `${String(seq).padStart(4, "0")}/${year}`;
      const pay = await tx.query<{ id: string }>(
        `INSERT INTO subscription_payments
           (vendor_id, plan_id, amount, period_start, period_end, reference, method, status,
            reviewed_at, reviewed_by, review_note, promo_pct, promo_list_price)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'approved', now(), $8, $9, $10, $11)
         RETURNING id`,
        [
          vendorId,
          plan.id,
          amountNum,
          start,
          end,
          `manual_${vendorId.slice(0, 8)}_${Math.floor(new Date(end).getTime() / 1000)}`,
          methodValue,
          adminUserId,
          (note ? String(note).slice(0, 400) : "Recibo emitido manualmente por administrador").slice(0, 500),
          promoPctFinal,
          promoListFinal,
        ]
      );
      paymentId = pay[0]?.id ?? "";
      if (renew !== false) {
        await tx.queryVoid(
          `UPDATE vendors SET plan_id = $1, plan_status = 'active', plan_expires_at = $2, trial_ends_at = NULL WHERE id = $3`,
          [plan.id, end, vendorId]
        );
        const sub = await insertSubscription(tx, {
          vendorId,
          planId: plan.id,
          status: "active",
          periodStart: start,
          periodEnd: end,
          paymentMethod: methodValue,
          amount: amountNum,
          paid: true,
          note: `Pago ${methodValue === "efectivo" ? "en efectivo" : "por transferencia"} registrado por administrador`,
        });
        await tx.queryVoid(`UPDATE subscription_payments SET subscription_id = $1 WHERE id = $2`, [sub.id, paymentId]);
      }
      const rec = await insertReceipt(tx, {
        vendorId,
        paymentId,
        planId: plan.id,
        planName: plan.name,
        amount: amountNum,
        periodStart: start,
        periodEnd: end,
        methodLabel,
        promoPct: promoPctFinal,
        promoListPrice: promoListFinal,
        seq,
        year,
      });
      receiptId = rec.id;
    });

    if (info && receiptId) {
      await sendReceiptNotice({
        info,
        planName: plan.name,
        receiptNumber,
        receiptId,
        amount: amountNum,
        periodStart: start,
        periodEnd: end,
        methodLabel,
        promoPct: promoPctFinal,
        promoListPrice: promoListFinal,
        noticeBody:
          renew === false
            ? `Emitimos tu Recibo X ${receiptNumber} por $${amountNum.toLocaleString("es-AR")}.`
            : `Acreditamos tu pago del plan ${plan.name} por $${amountNum.toLocaleString("es-AR")}: está activo hasta el ${new Date(end).toLocaleDateString("es-AR")}. Recibo X ${receiptNumber}.`,
      });
    }

    return NextResponse.json({ ok: true, approved: true, receipt: { number: receiptNumber, id: receiptId } });
  }

  // Reenvío de un recibo ya emitido (regenera el PDF y lo manda por mail).
  if (action === "resend_receipt") {
    const { receiptId } = body;
    if (!receiptId) return NextResponse.json({ error: "receiptId requerido" }, { status: 400 });

    const receipt = await queryOne<{
      id: string;
      vendor_id: string;
      plan_name: string | null;
      amount: number;
      period_start: string | null;
      period_end: string | null;
      seq: number;
      year: number;
      promo_pct: number | null;
      promo_list_price: number | null;
    }>(
      `SELECT id, vendor_id, plan_name, amount, period_start, period_end, seq, year, promo_pct, promo_list_price
         FROM plan_receipts WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
      [receiptId, vendorId]
    );
    if (!receipt) return NextResponse.json({ error: "Recibo no encontrado" }, { status: 404 });

    const info = await loadVendorContact(vendorId);
    const receiptNumber = `${String(receipt.seq).padStart(4, "0")}/${receipt.year}`;
    await sendReceiptNotice({
      info,
      planName: receipt.plan_name || "Plan",
      receiptNumber,
      receiptId: receipt.id,
      amount: Number(receipt.amount),
      periodStart: receipt.period_start,
      periodEnd: receipt.period_end,
      methodLabel: "Transferencia bancaria",
      promoPct: receipt.promo_pct ?? null,
      promoListPrice: receipt.promo_list_price ?? null,
      noticeBody: `Te reenviamos el Recibo X ${receiptNumber} del plan ${receipt.plan_name || ""}.`,
    });

    return NextResponse.json({ ok: true, resent: true, receipt: { number: receiptNumber } });
  }

  // Recordatorio al comercio: falta subir el comprobante (idempotente por día).
  if (action === "nudge_pending") {
    const { paymentId } = body;
    if (!paymentId) return NextResponse.json({ error: "paymentId requerido" }, { status: 400 });

    const payment = await queryOne<{
      id: string;
      amount: number;
      reference: string;
      status: string;
      comprobante_at: string | null;
      last_nudge_at: string | null;
    }>(
      `SELECT id, amount, reference, status, comprobante_at, last_nudge_at
         FROM subscription_payments WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
      [paymentId, vendorId]
    );
    if (!payment) return NextResponse.json({ error: "Pago no encontrado" }, { status: 404 });
    if (payment.status !== "pending" || payment.comprobante_at) {
      return NextResponse.json({ error: "Este pago no está esperando comprobante" }, { status: 409 });
    }
    if (payment.last_nudge_at && Date.now() - new Date(payment.last_nudge_at).getTime() < 23 * 3600 * 1000) {
      return NextResponse.json({ error: "Ya se le recordó hace menos de un día" }, { status: 409 });
    }

    const info = await loadVendorContact(vendorId);
    const bank = await getPortalBank().catch(() => null);
    const renewUrl = `${getSiteUrl()}/vendor/suscripcion#renovar`;
    const planName = (await queryOne<{ name: string }>(
      `SELECT p.name FROM subscription_payments s LEFT JOIN plans p ON p.id = s.plan_id WHERE s.id = $1`,
      [payment.id]
    ))?.name ?? "tu plan";

    let mailed = false;
    if (info?.email && process.env.RESEND_API_KEY) {
      try {
        const mail = planComprobanteReminderEmail({
          storeName: info.store_name,
          planName,
          amount: Number(payment.amount),
          reference: payment.reference,
          renewUrl,
          bank: {
            alias: bank?.alias ?? null,
            cbu: bank?.cbu ?? null,
            titular: bank?.titular ?? null,
            qrUrl: bank?.qr_url ?? null,
          },
        });
        mailed = await sendEmail({ to: info.email, subject: mail.subject, html: mail.html });
      } catch {
        mailed = false;
      }
    }
    if (info?.user_id) {
      const title = "Falta tu comprobante";
      const bodyTxt = `Todavía no recibimos el comprobante de la renovación de ${planName}. Subilo desde Mi suscripción.`;
      await query(
        `INSERT INTO notifications (user_id, title, body, type, link) VALUES ($1, $2, $3, 'payment', '/vendor/suscripcion')`,
        [info.user_id, title, bodyTxt]
      ).catch(() => undefined);
      try {
        await sendPushToUser(info.user_id, { title, body: bodyTxt, link: "/vendor/suscripcion" });
      } catch {
        /* push best-effort */
      }
    }

    await query(`UPDATE subscription_payments SET last_nudge_at = now() WHERE id = $1`, [payment.id]).catch(() => undefined);
    return NextResponse.json({ ok: true, mailed });
  }

  if (action === "reject_payment") {
    const { paymentId, note, reasonPreset } = body;
    const preset = String(reasonPreset ?? "").trim();
    const extra = String(note ?? "").trim();
    const reason = [preset, extra].filter(Boolean).join(" — ") || extra;
    if (!paymentId) return NextResponse.json({ error: "paymentId requerido" }, { status: 400 });
    if (!reason) return NextResponse.json({ error: "Indicá el motivo del rechazo (se le envía al comercio)" }, { status: 400 });

    const payment = await queryOne<{ id: string; vendor_id: string; status: string; plan_id: string | null }>(
      `SELECT id, vendor_id, status, plan_id FROM subscription_payments WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
      [paymentId, vendorId]
    );
    if (!payment) return NextResponse.json({ error: "Pago no encontrado" }, { status: 404 });
    if (payment.status !== "pending") {
      return NextResponse.json({ error: "Este pago ya fue revisado" }, { status: 409 });
    }

    const other = await queryOne<{ c: number }>(
      `SELECT count(*)::int AS c FROM subscription_payments WHERE vendor_id = $1 AND status = 'pending' AND id <> $2`,
      [vendorId, payment.id]
    ).catch(() => ({ c: 0 }));

    const info = await queryOne<{ user_id: string | null; store_name: string; plan_status: string | null; plan_expires_at: string | null }>(
      `SELECT user_id, store_name, plan_status, plan_expires_at FROM vendors WHERE id = $1`,
      [vendorId]
    );

    await withTransaction(async (tx) => {
      await tx.queryVoid(
        `UPDATE subscription_payments
            SET status = 'rejected', reviewed_at = now(), reviewed_by = $1, review_note = $2
          WHERE id = $3`,
        [adminUserId, reason.slice(0, 500), payment.id]
      );
      // Si era el único reclamo pendiente y el plan estaba en gracia, corta:
      // sin reclamo no hay razón para no cortar.
      if ((other?.c ?? 0) === 0 && info?.plan_status === "past_due") {
        const expiresMs = info.plan_expires_at ? new Date(info.plan_expires_at).getTime() : 0;
        await tx.queryVoid(
          `UPDATE vendors SET plan_status = $1 WHERE id = $2`,
          [expiresMs > Date.now() ? "active" : "expired", vendorId]
        );
      }
    });

    if (info?.user_id) {
      const title = "Pago rechazado";
      const bodyTxt = `No pudimos acreditar tu pago: ${reason.slice(0, 200)}. Podés subir un nuevo comprobante desde Mi suscripción.`;
      await query(
        `INSERT INTO notifications (user_id, title, body, type, link) VALUES ($1, $2, $3, 'payment', '/vendor/suscripcion')`,
        [info.user_id, title, bodyTxt]
      ).catch(() => undefined);
      try {
        await sendPushToUser(info.user_id, { title, body: bodyTxt, link: "/vendor/suscripcion" });
      } catch {
        /* push best-effort */
      }
    }

    return NextResponse.json({ ok: true, rejected: true, reason });
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
