import { getServiceClient } from "@/lib/supabase";
import { NextResponse } from "next/server";
import crypto from "crypto";

function verifyMercadoPagoSignature(
  body: string,
  signatureHeader: string | null,
  webhookSecret: string
): boolean {
  if (!signatureHeader) return false;
  const parts = signatureHeader.split(",");
  if (parts.length < 3) return false;
  const hash = parts[2];
  const expected = crypto
    .createHmac("sha256", webhookSecret)
    .update(body)
    .digest("hex");
  return hash === expected;
}

export async function POST(request: Request) {
  const bodyText = await request.text();
  const MP_WEBHOOK_SECRET = process.env.MP_WEBHOOK_SECRET;

  if (MP_WEBHOOK_SECRET) {
    const signature = request.headers.get("x-signature");
    if (!verifyMercadoPagoSignature(bodyText, signature, MP_WEBHOOK_SECRET)) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
  }

  const body = JSON.parse(bodyText);

  if (body.type === "payment") {
    const paymentId = body.data?.id;
    if (!paymentId) return NextResponse.json({ ok: true });

    const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
    if (!MP_ACCESS_TOKEN) return NextResponse.json({ ok: true });

    try {
      const res = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
        headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` },
      });
      const payment = await res.json();

      if (payment.status === "approved") {
        const supabase = getServiceClient();
        if (!supabase) return NextResponse.json({ ok: true });

        const externalRef = payment.external_reference;

        // Rama suscripción: portal659_sub_{vendorId}_{planSlug}_{periodStart}
        if (externalRef?.startsWith("portal659_sub_")) {
          const parts = externalRef.split("_");
          const vendorId = parts[2];
          const planSlug = parts[3];
          if (vendorId && planSlug) {
            const { data: plan } = await supabase
              .from("plans")
              .select("id, name")
              .eq("slug", planSlug)
              .single();

            if (plan) {
              const { data: vendor } = await supabase
                .from("vendors")
                .select("user_id, plan_expires_at")
                .eq("id", vendorId)
                .single();

              const base = vendor?.plan_expires_at
                ? Math.max(Date.now(), new Date(vendor.plan_expires_at).getTime())
                : Date.now();
              const periodStart = new Date(base).toISOString();
              const periodEnd = new Date(base + 30 * 24 * 60 * 60 * 1000).toISOString();

              await supabase
                .from("vendors")
                .update({
                  plan_id: plan.id,
                  plan_status: "active",
                  plan_expires_at: periodEnd,
                })
                .eq("id", vendorId);

              await supabase.from("vendor_subscriptions").insert({
                vendor_id: vendorId,
                plan_id: plan.id,
                status: "active",
                current_period_start: periodStart,
                current_period_end: periodEnd,
                note: `Pago Mercado Pago aprobado — 1 mes ${plan.name}`,
              });

              if (vendor?.user_id) {
                await supabase.from("notifications").insert({
                  user_id: vendor.user_id,
                  title: "¡Suscripción activada!",
                  body: `Tu plan ${plan.name} está activo por 1 mes (pago MP).`,
                  type: "payment",
                  link: "/vendor/suscripcion",
                });
              }
            }
          }

          return NextResponse.json({ ok: true });
        }

        const parts = externalRef.split("_");
        const vendorId = parts[1];

          const items = payment.additional_info?.items || [];
          await supabase.from("orders").insert({
            vendor_id: vendorId,
            customer_name: payment.payer?.first_name || "Cliente MP",
            customer_phone: payment.payer?.phone?.number || "",
            customer_address: null,
            method: "delivery",
            items: items.map((i: any) => ({
              name: i.title,
              price: Number(i.unit_price),
              qty: Number(i.quantity),
            })),
            total: payment.transaction_amount,
            status: "confirmed",
          });

          const { data: vendor } = await supabase
            .from("vendors")
            .select("user_id, store_name")
            .eq("id", vendorId)
            .single();

          if (vendor?.user_id) {
            await supabase.from("notifications").insert({
              user_id: vendor.user_id,
              title: "¡Pago aprobado!",
              body: `Nuevo pago de $${Number(payment.transaction_amount).toLocaleString("es-AR")} vía Mercado Pago`,
              type: "payment",
              link: "/vendor/dashboard",
            });
          }
      }
    } catch {
      // Mercado Pago reintenta, no fallar
    }
  }

  return NextResponse.json({ ok: true });
}
