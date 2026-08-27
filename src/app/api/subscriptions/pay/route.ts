import { getAuthSupabase, getUserId } from "@/lib/auth-utils";
import { NextResponse } from "next/server";

const PERIOD_DAYS = 30;
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;

export async function POST(request: Request) {
  const supabase = getAuthSupabase(request);
  if (!supabase) return NextResponse.json({ error: "Error de conexión" }, { status: 503 });

  const userId = await getUserId(supabase);
  if (!userId) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const body = await request.json();
  const planSlug = body?.planSlug === "pedidos" || body?.planSlug === "gestion"
    ? body.planSlug
    : null;

  const { data: vendor } = await supabase
    .from("vendors")
    .select(
      "id, vertical, whatsapp, transfer_cbu, transfer_alias, transfer_qr_url, plan_id, plan_status, plan_expires_at, trial_ends_at"
    )
    .eq("user_id", userId)
    .maybeSingle();

  if (!vendor) return NextResponse.json({ error: "No tenés un local" }, { status: 403 });
  if (vendor.vertical !== "gastronomia") {
    return NextResponse.json(
      { error: "Los planes pagos están disponibles solo para gastronomía por ahora" },
      { status: 400 }
    );
  }

  const { data: plans } = await supabase
    .from("plans")
    .select("*")
    .in("slug", ["pedidos", "gestion"]);

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

  const base = Math.max(
    now,
    vendor.plan_expires_at ? new Date(vendor.plan_expires_at).getTime() : 0
  );
  const periodStart = new Date(base).toISOString();
  const periodEnd = new Date(base + PERIOD_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const externalReference = `portal659_sub_${vendor.id}_${plan.slug}_${Math.floor(base / 1000)}`;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

  // Sin Mercado Pago configurado → transferencia manual (el admin activa con set_plan)
  if (!MP_ACCESS_TOKEN) {
    return NextResponse.json({
      ok: true,
      mode: "transfer",
      order: {
        plan: { id: plan.id, slug: plan.slug, name: plan.name },
        amount: Number(plan.price_monthly),
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
          title: `Portal 659 — Plan ${plan.name} (1 mes)`,
          unit_price: Number(plan.price_monthly),
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
          amount: Number(plan.price_monthly),
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