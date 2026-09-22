import crypto from "crypto";
import { gateRequest } from "@/lib/subscription-gate";
import { queryOne, withTransaction } from "@/lib/db";
import { sendPushToUser } from "@/lib/push";
import { adjustStockForItems, OutOfStockError } from "@/lib/stock";
import { PricingError, resolveOrderPricing } from "@/lib/pricing";
import { nextOrderNumber } from "@/lib/order-number";
import { toE164 } from "@/lib/phone";
import { upsertCustomerFromOrder } from "@/lib/customers";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Crea un apartado / seña (vertical moda, MVP iniciado por el comercio).
 *
 * El pedido nace con is_apartado=true y status='new': reserva stock igual
 * que un pedido normal (se repone al cancelar con el flujo existente).
 * La seña puede venir ya cobrada (efectivo/transferencia en el local) o
 * quedar pendiente (link de Mercado Pago con /apartados/[id]/deposit-link).
 * El saldo se marca cobrado con /apartados/[id]/mark-paid y recién ahí el
 * pedido entra al circuito normal (aceptar → empaquetar → ...).
 */
export async function POST(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  // MVP: solo moda (el flujo y la UI viven en el vertical indumentaria).
  if (gate.vendor.vertical !== "moda") {
    return NextResponse.json(
      { error: "El apartado por ahora está disponible para comercios de indumentaria." },
      { status: 400 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const {
    product_id,
    variant_id,
    qty,
    customer_name,
    customer_phone,
    deposit_pct: depositPctRaw,
    deposit_due_at,
    deposit_method,
    deposit_paid,
    method,
    customer_address,
  } = body as Record<string, unknown>;

  const productId = typeof product_id === "string" ? product_id : "";
  const variantId = typeof variant_id === "string" && variant_id ? variant_id : null;
  const qtyNum = Math.floor(Number(qty));
  const name = typeof customer_name === "string" ? customer_name.trim() : "";
  const phoneRaw = typeof customer_phone === "string" ? customer_phone.trim() : "";
  const pct = Number(
    depositPctRaw ?? (gate.vendor as { deposit_default_pct?: number | null }).deposit_default_pct ?? 30
  );
  const due = typeof deposit_due_at === "string" ? new Date(deposit_due_at) : new Date(NaN);
  const payMethod =
    deposit_method === "efectivo" || deposit_method === "transferencia" || deposit_method === "mercadopago"
      ? deposit_method
      : null;
  const paidNow = deposit_paid === true;
  const fulfillMethod = method === "delivery" ? "delivery" : "pickup";
  const address = fulfillMethod === "delivery" && typeof customer_address === "string" ? customer_address.trim() : null;

  if (!productId) return NextResponse.json({ error: "Elegí el producto a apartar." }, { status: 400 });
  if (!Number.isInteger(qtyNum) || qtyNum < 1) {
    return NextResponse.json({ error: "La cantidad tiene que ser al menos 1." }, { status: 400 });
  }
  if (!name) return NextResponse.json({ error: "Completá el nombre del cliente." }, { status: 400 });
  const phoneE164 = toE164(phoneRaw);
  if (!phoneE164) {
    return NextResponse.json(
      { error: "Ingresá un celular válido con código de área (ej: 11 5555 1234)" },
      { status: 400 }
    );
  }
  if (!Number.isFinite(pct) || pct < 1 || pct > 99) {
    return NextResponse.json({ error: "La seña tiene que estar entre 1% y 99%." }, { status: 400 });
  }
  if (isNaN(due.getTime())) {
    return NextResponse.json({ error: "Elegí la fecha límite del apartado." }, { status: 400 });
  }
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  if (due.getTime() < todayStart.getTime()) {
    return NextResponse.json({ error: "La fecha límite no puede ser pasada." }, { status: 400 });
  }
  if (!payMethod) {
    return NextResponse.json({ error: "Elegí cómo se cobra la seña (efectivo, transferencia o Mercado Pago)." }, { status: 400 });
  }
  if (fulfillMethod === "delivery" && !address) {
    return NextResponse.json({ error: "Para domicilio completá la dirección." }, { status: 400 });
  }

  // Falla rápido y claro si la migración del apartado no está aplicada.
  const apartadoCol = await queryOne<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_name = 'orders' AND column_name = 'is_apartado'
     ) AS exists`
  );
  if (apartadoCol?.exists !== true) {
    return NextResponse.json(
      { error: "Falta aplicar la migración migrate-apartado.sql en la base." },
      { status: 400 }
    );
  }

  const trackToken = crypto.randomBytes(20).toString("hex");
  let orderId: string | undefined;
  let total = 0;
  let depositAmount = 0;
  let pickupNumber = 0;

  try {
    await withTransaction(async (tx) => {
      // El producto tiene que ser del comercio y estar disponible; si tiene
      // variantes, hay que elegir una (igual que en el micrositio).
      const product = await tx.queryOne<{ id: string; has_variants: boolean; available: boolean }>(
        `SELECT id, has_variants, available FROM products WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
        [productId, gate.vendor.id]
      );
      if (!product || product.available === false) {
        throw new PricingError("Ese producto ya no está disponible.");
      }
      if (product.has_variants && !variantId) {
        throw new PricingError("Elegí color y talle para apartar.");
      }

      // Precio/stock siempre desde el servidor (misma resolución que el checkout).
      const pricing = await resolveOrderPricing({
        tx,
        vendorId: gate.vendor.id,
        items: [{ offerId: productId, variantId, qty: qtyNum }],
        method: fulfillMethod,
        deliveryFee: 0,
      });
      total = pricing.total;

      await adjustStockForItems(tx, pricing.items, "decrement");

      pickupNumber = await nextOrderNumber(tx, gate.vendor.id);

      depositAmount = Math.round(total * (pct / 100) * 100) / 100;

      const rows = await tx.query<{ id: string }>(
        `INSERT INTO orders (vendor_id, customer_name, customer_phone, customer_address, method, payment_method, items, total, status, payment_status, pickup_number, track_token, is_preview, is_apartado, deposit_amount, deposit_pct, deposit_status, deposit_due_at, deposit_paid_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'new', 'pending', $9, $10, $11, true, $12, $13, $14, $15, $16)
         RETURNING id`,
        [
          gate.vendor.id,
          name,
          phoneE164,
          address,
          fulfillMethod,
          payMethod,
          JSON.stringify(pricing.items),
          total,
          pickupNumber,
          trackToken,
          gate.previewSession === true,
          depositAmount,
          pct,
          paidNow ? "paid" : null,
          due.toISOString(),
          paidNow ? new Date().toISOString() : null,
        ]
      );
      orderId = rows[0]?.id;

      await upsertCustomerFromOrder(tx, gate.vendor.id, {
        phone: phoneE164,
        name,
        address,
        total,
      });

      if (gate.user.id && !String(gate.user.id).startsWith("preview:")) {
        const remainder = Math.round((total - depositAmount) * 100) / 100;
        await tx.queryVoid(
          `INSERT INTO notifications (user_id, title, body, type, link) VALUES ($1, $2, $3, $4, $5)`,
          [
            gate.user.id,
            "Nuevo apartado 🏷️",
            `Nro. ${pickupNumber} · ${name} apartó por $${total.toLocaleString("es-AR")} (seña $${depositAmount.toLocaleString("es-AR")}${paidNow ? " cobrada" : ""}, saldo $${remainder.toLocaleString("es-AR")})`,
            "order",
            "/vendor/dashboard",
          ]
        );
      }
    });
  } catch (e) {
    if (e instanceof OutOfStockError) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    if (e instanceof PricingError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    throw e;
  }

  if (!orderId) {
    return NextResponse.json({ error: "No se pudo crear el apartado" }, { status: 500 });
  }

  if (gate.user.id && !String(gate.user.id).startsWith("preview:")) {
    const remainder = Math.round((total - depositAmount) * 100) / 100;
    void sendPushToUser(gate.user.id, {
      title: `🏷️ Apartado nuevo #${pickupNumber} · $${total.toLocaleString("es-AR")}`,
      body: `${name} · seña $${depositAmount.toLocaleString("es-AR")}${paidNow ? " cobrada" : ""} · saldo $${remainder.toLocaleString("es-AR")}`,
      link: "/vendor/dashboard",
    }).catch(() => {});
  }

  const order = await queryOne<Record<string, unknown>>(
    `SELECT * FROM orders WHERE id = $1 LIMIT 1`,
    [orderId]
  ).catch(() => null);

  return NextResponse.json({
    order,
    deposit_amount: depositAmount,
    remainder: Math.round((total - depositAmount) * 100) / 100,
  });
}
