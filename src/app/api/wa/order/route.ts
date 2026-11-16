import { NextResponse } from "next/server";
import { authWaBot, isWaBotEnabled } from "@/lib/wa-bot";
import {
  createOrder,
  DeliveryMethodError,
  InvalidPhoneError,
  OrderForbiddenError,
  OrderLimitError,
  StoreClosedError,
} from "@/lib/order-service";
import { OutOfStockError } from "@/lib/stock";
import { PricingError } from "@/lib/pricing";

/** Crear pedido desde el bot de WhatsApp (endpoint interno).
 *  Exige `WA_BOT_SECRET`. El canal queda `app` (default) y el
 *  payment_method siempre "whatsapp". Las notas se prefijan con "[Bot WA]". */
export async function POST(request: Request) {
  if (!authWaBot(request)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const { vendorId, customerName, customerPhone, customerAddress, method, items, notes, customerId, paymentMethod, deliveryWindow, deliveryZoneId, deliveryOutOfArea, giftcardCode, cashAmount, isPreview, clientKey } = body;

  if (!vendorId || !customerName || !customerPhone || !Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: "Faltan datos requeridos" }, { status: 400 });
  }
  const pmValid = paymentMethod == null || ["whatsapp", "efectivo", "transferencia"].includes(paymentMethod);
  if (!pmValid) {
    return NextResponse.json({ error: "paymentMethod inválido" }, { status: 400 });
  }
  // Idempotencia: el bot manda una clientKey por carrito; un reintento devuelve
  // el pedido existente en vez de duplicarlo.
  const clientKeyFinal =
    typeof clientKey === "string" && clientKey.trim() !== "" ? clientKey.trim().slice(0, 128) : null;

  // Kill switch por comercio (el toggle del admin). Tolerante a tabla sin migrar.
  if (!(await isWaBotEnabled(vendorId))) {
    return NextResponse.json({ error: "Bot de WhatsApp deshabilitado para este comercio" }, { status: 409 });
  }

  try {
    const result = await createOrder({
      vendorId,
      customerName,
      customerPhone,
      customerAddress: customerAddress || null,
      method: method || "delivery",
      paymentMethod: paymentMethod || "whatsapp",
      customerId: customerId || null,
      items,
      notes: notes || null,
      deviceId: null,
      source: "wa-bot",
      deliveryWindow: deliveryWindow || null,
      deliveryZoneId: deliveryZoneId || null,
      deliveryOutOfArea: deliveryOutOfArea || null,
      giftcardCode: giftcardCode || null,
      cashAmount: cashAmount || null,
      isPreview: isPreview || null,
      clientKey: clientKeyFinal,
    });

    return NextResponse.json({ ok: true, orderId: result.orderId, total: result.total, trackToken: result.trackToken, clientKey: clientKeyFinal });
  } catch (e) {
    if (e instanceof InvalidPhoneError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    if (e instanceof OrderForbiddenError) {
      return NextResponse.json({ error: e.message }, { status: 403 });
    }
    if (e instanceof StoreClosedError) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    if (e instanceof OrderLimitError) {
      return NextResponse.json({ error: e.message }, { status: 429 });
    }
    if (e instanceof DeliveryMethodError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    if (e instanceof OutOfStockError) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    if (e instanceof PricingError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    if (e instanceof Error && e.message === "Faltan datos requeridos") {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    throw e;
  }
}