import { NextResponse } from "next/server";
import { authWaBot } from "@/lib/wa-bot";
import { queryOne, withTransaction } from "@/lib/db";
import { PricingError, resolveOrderPricing, type IncomingOrderItem, type PricingQuerier } from "@/lib/pricing";

/** Cotizador compartido para el bot de WhatsApp.
 *  Llama al mismo motor de precios que usa el micrositio (resolveOrderPricing),
 *  así el total que ve el cliente por WA es exactamente el que se cobra.
 *  Exige WA_BOT_SECRET. Todo opcional salvo vendorId + items.
 */
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

  const { vendorId, items, method, paymentMethod } = body;
  if (!vendorId || !Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: "Faltan datos requeridos" }, { status: 400 });
  }

  try {
    const result = await withTransaction(async (tx: PricingQuerier) => {
      const vendorRow = await queryOne<{
        delivery_fee: number | null;
        free_delivery_min: number | null;
        cash_discount_pct: number | null;
      }>(`SELECT delivery_fee, free_delivery_min, cash_discount_pct FROM vendors WHERE id = $1 LIMIT 1`, [vendorId]);

      const pricing = await resolveOrderPricing({
        tx,
        vendorId,
        items: items as IncomingOrderItem[],
        method: method || "pickup",
        deliveryFee: vendorRow?.delivery_fee ?? null,
        freeDeliveryMin: vendorRow?.free_delivery_min ?? null,
        paymentMethod: paymentMethod || null,
        cashDiscountPct: vendorRow?.cash_discount_pct ?? null,
      });

      const freeMin = Number(vendorRow?.free_delivery_min || 0);
      const missingForFreeShipping =
        pricing.deliveryFreeShipping || method === "pickup" ? 0 : Math.max(0, freeMin - pricing.subtotal);

      return {
        ok: true,
        subtotal: pricing.subtotal,
        cashDiscount: pricing.cashDiscount,
        deliveryFee: pricing.deliveryFee,
        total: pricing.total,
        missingForFreeShipping,
        items: pricing.items.map((i) => ({
          productId: i.product_id,
          name: i.name,
          qty: i.qty,
          price: i.price,
          lineTotal: Number(i.price) * Number(i.qty),
        })),
      };
    });

    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof PricingError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    throw e;
  }
}
