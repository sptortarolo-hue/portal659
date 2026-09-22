import { getUserId } from "@/lib/auth-utils";
import { queryMany, queryOne } from "@/lib/db";
import { activePromo } from "@/lib/plans";
import { isMpEnabled } from "@/lib/mp-oauth";
import { getSiteUrl } from "@/lib/site-url";
import { NextResponse } from "next/server";
import type { Plan } from "@/types/database";

const PERIOD_DAYS = 30;
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;

export async function POST(request: Request) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const body = await request.json();
  const planSlug = body?.planSlug === "pedidos" || body?.planSlug === "gestion"
    ? body.planSlug
    : null;

  const vendor = await queryOne<{
    id: string;
    vertical: string;
    whatsapp: string | null;
    transfer_cbu: string | null;
    transfer_alias: string | null;
    transfer_qr_url: string | null;
    plan_id: string | null;
    plan_status: string | null;
    plan_expires_at: string | null;
    trial_ends_at: string | null;
    visible: boolean | null;
  }>(
    `SELECT id, vertical, whatsapp, transfer_cbu, transfer_alias, transfer_qr_url, plan_id, plan_status, plan_expires_at, trial_ends_at, visible FROM vendors WHERE user_id = $1 LIMIT 1`,
    [userId]
  );

  if (!vendor) return NextResponse.json({ error: "No tenés un local" }, { status: 403 });
  // En preview no corre el reloj: primero hay que publicar el comercio.
  if (vendor.visible === false) {
    return NextResponse.json(
      { error: "Publicá tu comercio antes de pagar un plan: en modo prueba ya tenés todo habilitado." },
      { status: 403 }
    );
  }
  if (vendor.vertical !== "gastronomia" && vendor.vertical !== "comercio") {
    return NextResponse.json(
      { error: "Los planes pagos están disponibles para gastronomía y comercios de barrio" },
      { status: 400 }
    );
  }

  const plans = await queryMany<Plan>(
    `SELECT * FROM plans WHERE slug = ANY($1)`,
    [["pedidos", "gestion"]]
  );

  const planList = plans || [];
  const plan = planSlug
    ? planList.find((p) => p.slug === planSlug)
    : planList.find((p) => p.id === vendor.plan_id);

  if (!plan) return NextResponse.json({ error: "Elegí un plan para pagar" }, { status: 400 });

  const now = Date.now();
  const covered =
    (vendor.plan_status === "trial" &&
      vendor.trial_ends_at &&
      new Date(vendor.trial_ends_at).getTime() > now) ||
    (vendor.plan_status === "active" &&
      vendor.plan_expires_at &&
      new Date(vendor.plan_expires_at).getTime() > now);

  if (covered) {
    return NextResponse.json({
      error: "Ya tenés el plan activo. Podés renovar cuando venza.",
    }, { status: 400 });
  }

  const isNewSubscriber = vendor.plan_status !== "active";
  const promo = isNewSubscriber ? activePromo(plan) : null;

  const billedMonths = promo ? promo.months : 1;
  const periodDays = billedMonths * PERIOD_DAYS;
  const chargeAmount = promo ? promo.price * promo.months : Number(plan.price_monthly);

  const base = Math.max(
    now,
    vendor.plan_expires_at ? new Date(vendor.plan_expires_at).getTime() : 0
  );
  const periodStart = new Date(base).toISOString();
  const periodEnd = new Date(base + periodDays * 24 * 60 * 60 * 1000).toISOString();

  const externalReference = `portal659_sub_${vendor.id}_${plan.slug}_${Math.floor(base / 1000)}`;
  const siteUrl = getSiteUrl();

  // Sin Mercado Pago configurado (o con la llave maestra apagada) →
  // transferencia manual (el admin activa con set_plan)
  if (!MP_ACCESS_TOKEN || !isMpEnabled()) {
    return NextResponse.json({
      ok: true,
      mode: "transfer",
      order: {
        plan: { id: plan.id, slug: plan.slug, name: plan.name },
        amount: chargeAmount,
        periodStart,
        periodEnd,
        externalReference,
      },
      transfer: {
        cbu: vendor.transfer_cbu || null,
        alias: vendor.transfer_alias || null,
        qrUrl: vendor.transfer_qr_url || null,
        whatsapp: vendor.whatsapp || null,
      },
      message: "Mercado Pago no está configurado. Pagá por transferencia y avisale al administrador para activar el plan.",
    });
  }

  try {
    const preference = {
      items: [
        {
          title: promo
            ? `Portal 659 — Plan ${plan.name} (${promo.months} ${promo.months === 1 ? "mes" : "meses"} promo)`
            : `Portal 659 — Plan ${plan.name} (1 mes)`,
          unit_price: chargeAmount,
          quantity: 1,
          currency_id: "ARS",
        },
      ],
      payer: { phone: { number: vendor.whatsapp || undefined } },
      metadata: { purpose: "subscription", vendor_id: vendor.id, plan_id: plan.id },
      external_reference: externalReference,
      back_urls: {
        success: `${siteUrl}/vendor/suscripcion?payment=success`,
        failure: `${siteUrl}/vendor/suscripcion?payment=failure`,
        pending: `${siteUrl}/vendor/suscripcion?payment=pending`,
      },
      auto_return: "approved",
      notification_url: `${siteUrl}/api/webhooks/mercadopago`,
    };

    const res = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
      },
      body: JSON.stringify(preference),
    });

    const data = await res.json();

    if (data.id) {
      return NextResponse.json({
        ok: true,
        mode: "mercado_pago",
        preferenceId: data.id,
        initPoint: data.init_point,
        order: {
          plan: { id: plan.id, slug: plan.slug, name: plan.name },
          amount: chargeAmount,
          periodStart,
          periodEnd,
          externalReference,
        },
      });
    }

    return NextResponse.json({ error: data.message || "Error al crear el pago" }, { status: 500 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Error con Mercado Pago" }, { status: 500 });
  }
}