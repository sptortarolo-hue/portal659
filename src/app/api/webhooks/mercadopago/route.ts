import { query, queryOne, queryMany, withTransaction } from "@/lib/db";
import { logApiError } from "@/lib/api-error";
import { adjustStockForItems } from "@/lib/stock";
import { sendPushToUser } from "@/lib/push";
import { sendEmail, newOrderVendorEmail } from "@/lib/email";
import { getVendorMpToken } from "@/lib/mp-oauth";
import { dispatchPrint, type PrinterVendor } from "@/lib/thermal-printer";
import { upsertCustomerFromOrder } from "@/lib/customers";
import { toE164 } from "@/lib/phone";
import { resolveVendorPlan } from "@/lib/plans";
import { orderNeedsKitchen } from "@/lib/order-utils";
import { NextResponse } from "next/server";
import crypto from "crypto";

/**
 * Verificación de firma de webhooks de Mercado Pago (esquema v1).
 * Header: `x-signature: ts=<ts>,v1=<sha256hex>`.
 * MP NO firma el body: firma el manifiesto
 *   `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`
 * con HMAC-SHA256 usando el secret del panel (Docs MP → Webhooks → "Validar
 * firma"). Por eso la parseamos por clave/valor y comparamos timing-safe.
 */
function verifyMercadoPagoSignature(
  signatureHeader: string | null,
  requestId: string | null,
  dataId: string | null,
  webhookSecret: string
): boolean {
  if (!signatureHeader || !requestId || !dataId) return false;
  const parsed: Record<string, string> = {};
  for (const part of signatureHeader.split(",")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    parsed[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  const ts = parsed["ts"];
  const v1 = parsed["v1"];
  if (!ts || !v1) return false;
  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
  const expected = crypto.createHmac("sha256", webhookSecret).update(manifest).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(v1, "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const bodyText = await request.text();
  const MP_WEBHOOK_SECRET = process.env.MP_WEBHOOK_SECRET;
  const body = JSON.parse(bodyText);

  if (MP_WEBHOOK_SECRET) {
    const signature = request.headers.get("x-signature");
    const requestId = request.headers.get("x-request-id");
    const url = new URL(request.url);
    const dataId =
      url.searchParams.get("data.id") ||
      (body?.data?.id != null ? String(body.data.id) : null);
    if (!verifyMercadoPagoSignature(signature, requestId, dataId, MP_WEBHOOK_SECRET)) {
      console.warn(
        `[mp-webhook] firma rechazada (data.id=${dataId || "?"}, request-id=${requestId || "?"})`
      );
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
  }

  if (body.type === "payment") {
    const paymentId = body.data?.id;
    if (!paymentId) return NextResponse.json({ ok: true });

    // Multi-tenant: responder con el token del comercio al que pertenece el pago.
    // El checkeo de email a vendors.mp_user_id nos dice qué cuenta de MP cobró.
    const mpUserId = body.user_id != null ? Number(body.user_id) : null;

    let accessToken: string | null = null;

    if (mpUserId != null) {
      const matched = await queryOne<{
        id: string;
        mp_user_id: number | null;
        mp_access_token: string | null;
        mp_refresh_token: string | null;
        mp_public_key: string | null;
        mp_expires_at: string | null;
        mp_connected_at: string | null;
      }>(
        `SELECT id, mp_user_id, mp_access_token, mp_refresh_token, mp_public_key, mp_expires_at, mp_connected_at
         FROM vendors WHERE mp_user_id = $1 LIMIT 1`,
        [mpUserId]
      );
      if (matched) {
        accessToken = await getVendorMpToken(matched);
      }
    }

    // Fallback: el token global (suscripciones del portal y recibos sin comercio MP conectado).
    if (!accessToken) {
      accessToken = process.env.MP_ACCESS_TOKEN || null;
    }

    if (!accessToken) {
      return NextResponse.json({ ok: true });
    }

    try {
      const res = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const payment = await res.json();

      if (payment.status === "approved") {
        const externalRef = payment.external_reference;

        // Rama suscripción: portal659_sub_{vendorId}_{planSlug}_{periodStart}
        if (externalRef?.startsWith("portal659_sub_")) {
          const parts = externalRef.split("_");
          const vendorId = parts[2];
          const planSlug = parts[3];
          if (vendorId && planSlug) {
            const plan = await queryOne<{ id: string; name: string }>(
              `SELECT id, name FROM plans WHERE slug = $1 LIMIT 1`,
              [planSlug]
            );

            if (plan) {
              const vendor = await queryOne<{ user_id: string; plan_expires_at: string | null }>(
                `SELECT user_id, plan_expires_at FROM vendors WHERE id = $1 LIMIT 1`,
                [vendorId]
              );

              const base = vendor?.plan_expires_at
                ? Math.max(Date.now(), new Date(vendor.plan_expires_at).getTime())
                : Date.now();
              const periodStart = new Date(base).toISOString();
              const periodEnd = new Date(base + 30 * 24 * 60 * 60 * 1000).toISOString();

              await query(
                `UPDATE vendors SET plan_id = $1, plan_status = 'active', plan_expires_at = $2 WHERE id = $3`,
                [plan.id, periodEnd, vendorId]
              );

              await query(
                `INSERT INTO vendor_subscriptions (vendor_id, plan_id, status, current_period_start, current_period_end, note)
                 VALUES ($1, $2, 'active', $3, $4, $5)`,
                [vendorId, plan.id, periodStart, periodEnd, `Pago Mercado Pago aprobado — 1 mes ${plan.name}`]
              );

              if (vendor?.user_id) {
                const title = "¡Suscripción activada!";
                const body = `Tu plan ${plan.name} está activo por 1 mes (pago MP).`;
                await query(
                  `INSERT INTO notifications (user_id, title, body, type, link)
                   VALUES ($1, $2, $3, 'payment', '/vendor/suscripcion')`,
                  [vendor.user_id, title, body]
                );
                await sendPushToUser(vendor.user_id, { title, body, link: "/vendor/suscripcion" });
              }
            }
          }

          return NextResponse.json({ ok: true });
        }

        // Rama seña de servicio: portal659_sena_{quoteId}_{ts}. Marca la seña
        // como pagada y acepta el presupuesto (plan Oficios).
        if (externalRef?.startsWith("portal659_sena_")) {
          const quoteId = externalRef.split("_")[2];
          if (quoteId) {
            const quote = await queryOne<{
              id: string;
              vendor_id: string;
              customer_name: string;
              customer_phone: string;
              quoted_price: number | null;
              deposit_amount: number | null;
              deposit_status: string | null;
            }>(
              `SELECT id, vendor_id, customer_name, customer_phone, quoted_price, deposit_amount, deposit_status
               FROM quotes WHERE id = $1 LIMIT 1`,
              [quoteId]
            );
            if (quote && quote.deposit_status !== "paid") {
              const paidAmount = Number(payment.transaction_amount) || 0;
              const expected = Number(quote.deposit_amount) || 0;
              // Tolerancia de $1 por redondeo; si difiere mucho igual se marca
              // (la plata entró) pero se avisa en la notificación.
              const mismatch = expected > 0 && Math.abs(paidAmount - expected) > 1;
              await query(
                `UPDATE quotes SET deposit_status = 'paid', status = 'accepted', mp_payment_id = $1, accepted_at = now()
                 WHERE id = $2`,
                [String(payment.id || ""), quoteId]
              );
              const vrow = await queryOne<{ user_id: string; store_name: string }>(
                `SELECT user_id, store_name FROM vendors WHERE id = $1 LIMIT 1`,
                [quote.vendor_id]
              );
              if (vrow?.user_id) {
                const title = "¡Seña pagada!";
                const body = `${quote.customer_name} pagó $${paidAmount.toLocaleString("es-AR")} de seña${mismatch ? ` (difiere de $${expected.toLocaleString("es-AR")}, revisar)` : ""}. Presupuesto aceptado.`;
                await query(
                  `INSERT INTO notifications (user_id, title, body, type, link)
                   VALUES ($1, $2, $3, 'payment', '/vendor/dashboard')`,
                  [vrow.user_id, title, body]
                );
                try {
                  const { sendPushToUser } = await import("@/lib/push");
                  await sendPushToUser(vrow.user_id, { title, body, link: "/vendor/dashboard" });
                } catch { /* best-effort */ }
              }
              try {
                const { notifyServiceClient } = await import("@/lib/service-notify");
                await notifyServiceClient(quote.customer_phone, {
                  title: `Seña recibida — ${quote.customer_name.split(" ")[0] || "gracias"}`,
                  body: "Tu seña fue acreditada. El profesional coordina el trabajo con vos.",
                });
              } catch { /* best-effort */ }
              console.log(`[mp-webhook] seña ok quote=${quoteId} amount=${paidAmount} mismatch=${mismatch}`);
            }
          }
          return NextResponse.json({ ok: true });
        }

        // Rama seña de apartado (moda): portal659_apartado_{orderId}_{ts}.
        // Marca la seña como cobrada; el saldo se cobra aparte y el pedido
        // sigue en 'new' hasta que el comercio lo acepta por el flujo normal.
        if (externalRef?.startsWith("portal659_apartado_")) {
          const orderId = externalRef.split("_")[2];
          if (orderId) {
            const order = await queryOne<{
              id: string;
              vendor_id: string;
              customer_name: string;
              total: number | null;
              is_apartado: boolean | null;
              deposit_amount: number | null;
              deposit_status: string | null;
              remainder_paid_at: string | null;
            }>(
              `SELECT id, vendor_id, customer_name, total, is_apartado, deposit_amount, deposit_status, remainder_paid_at
               FROM orders WHERE id = $1 LIMIT 1`,
              [orderId]
            ).catch(() => undefined);
            if (order && order.is_apartado && order.deposit_status !== "paid" && !order.remainder_paid_at) {
              const paidAmount = Number(payment.transaction_amount) || 0;
              const expected = Number(order.deposit_amount) || 0;
              const mismatch = expected > 0 && Math.abs(paidAmount - expected) > 1;
              await query(
                `UPDATE orders SET deposit_status = 'paid', deposit_paid_at = now(), mp_payment_id = $1 WHERE id = $2`,
                [String(payment.id || ""), orderId]
              ).catch(() => {});
              const vrow = await queryOne<{ user_id: string; store_name: string }>(
                `SELECT user_id, store_name FROM vendors WHERE id = $1 LIMIT 1`,
                [order.vendor_id]
              );
              if (vrow?.user_id) {
                const title = "¡Seña de apartado pagada! 🏷️";
                const body = `${order.customer_name} pagó $${paidAmount.toLocaleString("es-AR")} de seña${mismatch ? ` (difiere de $${expected.toLocaleString("es-AR")}, revisar)` : ""}. Falta cobrar el saldo.`;
                await query(
                  `INSERT INTO notifications (user_id, title, body, type, link)
                   VALUES ($1, $2, $3, 'payment', '/vendor/dashboard')`,
                  [vrow.user_id, title, body]
                );
                try {
                  const { sendPushToUser } = await import("@/lib/push");
                  await sendPushToUser(vrow.user_id, { title, body, link: "/vendor/dashboard" });
                } catch { /* best-effort */ }
              }
              console.log(`[mp-webhook] apartado ok order=${orderId} amount=${paidAmount} mismatch=${mismatch}`);
            }
          }
          return NextResponse.json({ ok: true });
        }

        const parts = externalRef.split("_");
        const vendorId = parts[1];

        const metadata = payment.metadata || {};
        const isPickup = metadata.delivery_method === "pickup";
        const customerPhone = metadata.customer_phone || payment.payer?.phone?.number || "";
        const customerAddress = metadata.customer_address || null;

        // Número de retiro correlativo por día (solo si es retiro en local).
        let pickupNumber: number | null = null;
        if (isPickup) {
          const todayStart = new Date();
          todayStart.setHours(0, 0, 0, 0);
          const lastRow = await queryOne<{ n: number }>(
            `SELECT COALESCE(MAX(pickup_number), 0)::int AS n
             FROM orders
             WHERE vendor_id = $1 AND pickup_number IS NOT NULL AND created_at >= $2`,
            [vendorId, todayStart.toISOString()]
          );
          pickupNumber = (lastRow?.n ?? 0) + 1;
        }

        const items = payment.additional_info?.items || [];
        const customerE164 = toE164(customerPhone);
        const trackToken = crypto.randomBytes(20).toString("hex");
        const orderItems = items.map((i: any) => ({
          name: i.title,
          price: Number(i.unit_price),
          qty: Number(i.quantity),
        }));
        let order: any = null;
        await withTransaction(async (tx) => {
          const inserted = await tx.query<{ id: string }>(
            `INSERT INTO orders (vendor_id, customer_name, customer_phone, customer_address, method, items, total, status, pickup_number, payment_method, payment_status, track_token)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'new', $8, 'mercadopago', 'paid', $9)
             RETURNING id`,
            [
              vendorId,
              payment.payer?.first_name || "Cliente MP",
              customerPhone,
              customerAddress,
              isPickup ? "pickup" : "delivery",
              JSON.stringify(orderItems),
              payment.transaction_amount,
              pickupNumber,
              trackToken,
            ]
          );
          order = {
            id: inserted[0]?.id,
            vendor_id: vendorId,
            customer_name: payment.payer?.first_name || "Cliente MP",
            customer_phone: customerPhone,
            customer_address: customerAddress,
            method: isPickup ? "pickup" : "delivery",
            items: orderItems,
            total: payment.transaction_amount,
            status: "new",
            payment_method: "mercadopago",
            payment_status: "paid",
            pickup_number: pickupNumber,
            track_token: trackToken,
            paid_at: new Date().toISOString(),
          };

          // CRM: el pago MP trae el teléfono del cliente → ficha.
          if (customerE164) {
            await upsertCustomerFromOrder(tx, vendorId, {
              phone: customerE164,
              name: payment.payer?.first_name || null,
              address: customerAddress,
              total: Number(payment.transaction_amount),
            });
          }

          // Reservar stock (viene en metadata de la preferencia). Si no alcanza,
          // el pedido entra igual: el pago ya fue aprobado por MP.
          try {
            const raw = (metadata as Record<string, unknown>).stock_items;
            const stockItems = typeof raw === "string" ? JSON.parse(raw) : [];
            await adjustStockForItems(tx, stockItems, "decrement");
          } catch (e) {
            // best-effort: ver nota arriba (se loguea para no perderlo en silencio)
            logApiError("mp-webhook/stock", e);
          }
        });

        const vendor = await queryOne<{ user_id: string; store_name: string }>(
          `SELECT user_id, store_name FROM vendors WHERE id = $1 LIMIT 1`,
          [vendorId]
        );

        if (vendor?.user_id) {
          const title = "¡Pago aprobado! Nuevo pedido";
          const body = `Nuevo pedido pagado de $${Number(payment.transaction_amount).toLocaleString("es-AR")} vía Mercado Pago${pickupNumber ? ` · Pedido #${pickupNumber}` : ""}`;
          await query(
            `INSERT INTO notifications (user_id, title, body, type, link)
             VALUES ($1, $2, $3, 'payment', '/vendor/dashboard')`,
            [vendor.user_id, title, body]
          );
          await sendPushToUser(vendor.user_id, { title, body, link: "/vendor/dashboard" });

          // Email al comercio (mismo respaldo que los pedidos web).
          try {
            const profile = await queryOne<{ email: string }>(
              `SELECT email FROM profiles WHERE id = $1 LIMIT 1`,
              [vendor.user_id]
            );
            if (profile?.email && order) {
              const emailContent = newOrderVendorEmail({
                storeName: vendor.store_name || "Tu comercio",
                orderNumber: pickupNumber,
                customerName: order.customer_name,
                customerPhone: customerPhone,
                paymentLabel: "💳 Mercado Pago (online)",
                items: orderItems,
                total: payment.transaction_amount,
                method: isPickup ? "pickup" : "delivery",
                address: customerAddress,
              });
              await sendEmail({ to: profile.email, ...emailContent });
            }
          } catch (e) {
            logApiError("mp-webhook/email", e);
          }
        }

        // Comanda automática al aprobar el pago: solo con auto_print ON y plan
        // con impresora. Best-effort; un fallo no rompe el webhook ni el pedido.
        try {
          if (order?.id) {
            const printerVendor = await queryOne<PrinterVendor & { auto_print?: boolean; vertical?: string | null }>(
              `SELECT id, store_name, logo_url, address, phone, whatsapp, instagram, facebook,
                      printer_ip, printer_port, paper_size, print_mode, print_token,
                      print_logo, print_address, print_phone, print_social, auto_print,
                      vertical, plan_id, plan_status, plan_expires_at, trial_ends_at
               FROM vendors WHERE id = $1 LIMIT 1`,
              [vendorId]
            );
            if (printerVendor?.auto_print) {
              const planRows = await queryMany<any>(`SELECT * FROM plans`);
              if (resolveVendorPlan(printerVendor as any, planRows || []).can("printer")) {
                // Sin ítems de cocina: retail (comercio/moda) imprime el
                // comprobante de venta; el resto, el stub de retiro.
                const isRetailVendor =
                  printerVendor?.vertical === "moda" || printerVendor?.vertical === "comercio";
                const printType = orderNeedsKitchen(order) ? "comanda" : isRetailVendor ? "ticket" : "retiro";
                const printed = await dispatchPrint({
                  vendor: printerVendor,
                  order,
                  type: printType,
                  ...(printType === "ticket" && isRetailVendor
                    ? { extra: { docTitle: "COMPROBANTE", retail: true } }
                    : {}),
                });
                if (!printed.ok) logApiError("mp-webhook/print", new Error(printed.error || "print falló"));
              }
            }
          }
        } catch (e) {
          logApiError("mp-webhook/print", e);
        }
      }
    } catch (e) {
      // Mercado Pago reintenta, no fallar (pero se loguea: un fallo acá es plata sin pedido)
      logApiError("mp-webhook", e);
    }
  }

  return NextResponse.json({ ok: true });
}
