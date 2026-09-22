import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryMany, withTransaction } from "@/lib/db";
import { nextOrderNumber } from "@/lib/order-number";
import { cashDiscountForItems } from "@/lib/cash-discount";
import { adjustStockForItems, OutOfStockError } from "@/lib/stock";
import { upsertCustomerFromOrder, isRealCustomerPhone } from "@/lib/customers";
import { toE164 } from "@/lib/phone";
import { NextResponse } from "next/server";

const PAYMENT_METHODS = ["efectivo", "transferencia", "tarjeta", "mixto", "whatsapp"] as const;
type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export async function POST(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);

  if (!gate.plan.can("pos")) {
    return NextResponse.json(
      { error: "El mostrador forma parte del plan Gestión integral" },
      { status: 403 }
    );
  }

  const body = await request.json();
  const {
    items,
    total,
    paymentMethod,
    customerName,
    customerPhone,
    customerAddress,
    method,
    notes,
  } = body;

  if (!items || !Array.isArray(items) || items.length === 0 || !total) {
    return NextResponse.json({ error: "Faltan productos o total" }, { status: 400 });
  }

  const isDelivery = method === "delivery";
  const customerPhoneClean = typeof customerPhone === "string" ? customerPhone.trim() : "";

  if (isDelivery && !customerPhoneClean) {
    return NextResponse.json({ error: "El envío a domicilio requiere el teléfono del cliente" }, { status: 400 });
  }

  const payment = (PAYMENT_METHODS as readonly string[]).includes(paymentMethod)
    ? (paymentMethod as PaymentMethod)
    : "efectivo";

  const normalizedItems: { product_id?: any; name: any; price: number; qty: number; modifiers?: any; requires_prep: boolean; pack_size?: number }[] = items.map((i: any) => ({
    product_id: i.product_id || undefined,
    name: i.name,
    price: Number(i.price),
    qty: Number(i.qty) || 1,
    modifiers: Array.isArray(i.modifiers) && i.modifiers.length > 0 ? i.modifiers : undefined,
    requires_prep: i.requires_prep !== false,
  }));

  // Packs: validación de múltiplo. Después normalizo el ítem a formato
  // pack-native: `price` = PRECIO DEL PAQUETE y `pack_size` presente (mismo
  // formato que el canal app — así cierre de mesa, tickets y cash lo entienden).
  {
    const pids = Array.from(new Set(normalizedItems.map((i) => i.product_id).filter(Boolean))) as string[];
    if (pids.length > 0) {
      try {
        const prows = await queryMany<{ id: string; name: string; pack_size: number | null }>(
          `SELECT id, name, pack_size FROM products WHERE vendor_id = $1 AND id = ANY($2)`,
          [gate.vendor.id, pids]
        );
        const ppack = new Map((prows || []).map((p) => [p.id, p]));
        for (let idx = 0; idx < normalizedItems.length; idx++) {
          const i = normalizedItems[idx];
          const pack = i.product_id ? Math.floor(Number(ppack.get(i.product_id)?.pack_size || 0)) : 0;
          if (pack >= 2) {
            if (i.qty % pack !== 0) {
              return NextResponse.json(
                { error: `"${i.name}" se vende de a ${pack} unidades` },
                { status: 400 }
              );
            }
            // Normalizado pack-native: price = precio del PAQUETE (el cliente
            // mandó la unidad full-precision). qty sigue en unidades; la línea
            // se computa como price × (qty/pack) via orderLineTotal.
            normalizedItems[idx] = {
              ...i,
              price: Math.round(i.price * pack * 100) / 100,
              pack_size: pack,
            };
          }
        }
      } catch {
        // columna sin migrar: se omite la validación
      }
    }
  }

  // Pedidos CON cocina o delivery nacen en "preparing" y entran al flow
  // normal de la comanda (hay que prepararlos/despacharlos). Pedidos de
  // mostrador/mesa SIN nada de cocina (solo bebidas/packs) no van a la
  // comanda y usan el flow corto de 2 pasos: new → ready ("Listo").
  const needsKitchen = normalizedItems.some((i) => i.requires_prep !== false);
  const status = needsKitchen || isDelivery ? "preparing" : "new";

  const now = new Date().toISOString();

  // Descuento en efectivo: se recalcula server-side (nunca se confía en el
  // total del cliente). Misma fórmula que el micrositio: % sobre la unidad
  // (con modificadores), promos excluidas por el comercio no reciben descuento.
  const pctSource = gate.vendor.cash_discount_pct;
  let cashDiscount = 0;
  let cashPct = 0;
  if (payment === "efectivo") {
    const ids = Array.from(new Set(normalizedItems.map((i) => i.product_id).filter(Boolean))) as string[];
    const prows = ids.length
      ? await queryMany<{ id: string; promo_price: number | null; cash_discount_excluded: boolean | null }>(
          `SELECT id, promo_price, cash_discount_excluded FROM products WHERE vendor_id = $1 AND id = ANY($2)`,
          [gate.vendor.id, ids]
        )
      : [];
    const pmap = new Map((prows || []).map((p) => [p.id, p]));
    const res = cashDiscountForItems(
      normalizedItems.map((i) => {
        const p = i.product_id ? pmap.get(i.product_id) : undefined;
        // Con pack ya normalizado: price = precio del paquete; el cash corre
        // por paquetes (qty/pack) → sin drift de decimales.
        const pack = ((i as any).pack_size as number) >= 2 ? ((i as any).pack_size as number) : 0;
        return {
          unitPrice: i.price,
          qty: pack ? i.qty / pack : i.qty,
          hasPromo: p ? p.promo_price != null : false,
          excluded: p?.cash_discount_excluded ?? null,
        };
      }),
      pctSource
    );
    cashDiscount = res.cashDiscount;
    cashPct = res.cashPct;
  }
  const finalTotal = Math.max(0, Math.round((Number(total) - cashDiscount) * 100) / 100);

  // Número de pedido diario universal (mostrador/delivery): además de
  // referenciarlo a la caja, el pedido queda con su número de oraculo en tickets.
  // En sesión de prueba todo nace marcado como prueba.
  const previewOrder = gate.previewSession === true;
  const customerE164 = toE164(customerPhoneClean);
  let order: Record<string, any> | null = null;
  try {
    order = await withTransaction(async (tx) => {
    // Stock: la venta de mostrador descuenta igual que el canal app (la
    // función es no-op para productos sin stock_control — gastro no nota el
    // cambio). Al cancelar el pedido se repone (orders/[id]).
    // Pedidos de prueba (preview) no tocan el stock real.
    if (!previewOrder) {
      await adjustStockForItems(tx, normalizedItems, "decrement");
    }

    const pickupNumber = await nextOrderNumber(tx, gate.vendor.id);
    const order = await tx.queryOne<Record<string, any>>(
      `INSERT INTO orders (vendor_id, customer_name, customer_phone, customer_address, method, payment_method, items, total, status, channel, paid_at, notes, pickup_number, is_preview, cash_pct, cash_discount)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'mostrador', $10, $11, $12, $13, $14, $15)
       RETURNING *`,
      [
        gate.vendor.id,
        customerName?.trim() || "Mostrador",
        isDelivery ? customerPhoneClean : "",
        isDelivery ? (customerAddress?.trim() || null) : null,
        isDelivery ? "delivery" : "pickup",
        payment,
        JSON.stringify(normalizedItems),
        finalTotal,
        status,
        now,
        notes || null,
        pickupNumber,
        previewOrder,
        cashPct,
        cashDiscount,
      ]
    );

    // CRM: el delivery lleva teléfono del cliente → ficha (el pickup guarda
    // el WA del comercio, no genera ficha; tampoco si pusieron su propio WA).
    if (isDelivery && customerE164 && isRealCustomerPhone(customerPhoneClean, gate.vendor.whatsapp) && !previewOrder) {
      await upsertCustomerFromOrder(tx, gate.vendor.id, {
        phone: customerE164,
        name: customerName?.trim() || null,
        address: customerAddress?.trim() || null,
        total: finalTotal,
        at: now,
      });
    }

    return order ?? null;
  });
  } catch (e) {
    if (e instanceof OutOfStockError) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    throw e;
  }

  return NextResponse.json({ ok: true, orderId: order?.id, order });
}