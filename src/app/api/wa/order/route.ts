import { NextResponse } from "next/server";
import { authWaBot, isWaBotEnabled } from "@/lib/wa-bot";
import {
  createOrder,
  OrderForbiddenError,
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

  const { vendorId, customerName, customerPhone, customerAddress, method, items, notes, customerId } = body;

  if (!vendorId || !customerName || !customerPhone || !Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: "Faltan datos requeridos" }, { status: 400 });
  }

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
      paymentMethod: "whatsapp",
      customerId: customerId || null,
      items,
      notes: notes || null,
      deviceId: null,
      source: "wa-bot",
    });

    return NextResponse.json({ ok: true, orderId: result.orderId, total: result.total });
  } catch (e) {
    if (e instanceof OrderForbiddenError) {
      return NextResponse.json({ error: e.message }, { status: 403 });
    }
    if (e instanceof StoreClosedError) {
      return NextResponse.json({ error: e.message }, { status: 409 });
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