import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryMany, queryOne, withTransaction } from "@/lib/db";
import { fetchVendorDelivery } from "@/lib/delivery-server";
import { resolveDeliveryFee, type DeliverySelection } from "@/lib/delivery";
import { nextOrderNumber } from "@/lib/order-number";
import { cashDiscountForItems } from "@/lib/cash-discount";
import { isRetailVendor } from "@/lib/plans";
import { adjustStockForItems, OutOfStockError, type StockMove } from "@/lib/stock";
import { logStockMovement } from "@/lib/stock-ledger";
import { upsertCustomerFromOrder, isRealCustomerPhone } from "@/lib/customers";
import { validateFiadoPhone, fiadoTableReady } from "@/lib/fiados";
import { toE164 } from "@/lib/phone";
import {
  findOrderByClientKey,
  getOfflineSyncCaps,
  normalizeClientKey,
  parseOccurredAt,
} from "@/lib/sync-idempotency";
import { NextResponse } from "next/server";

const PAYMENT_METHODS = ["efectivo", "transferencia", "tarjeta", "mixto", "whatsapp", "fiado"] as const;
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
    deliveryZoneId,
    deliveryOutOfArea,
    deliveryManualFee,
  } = body;

  // Venta directa (retail pickup): el comercio de barrio vende en el acto,
  // sin generar pedido (solo delivery genera pedido con flow). Solo retail.
  const direct = body?.direct === true && isRetailVendor(gate.vendor);
  const caps = await getOfflineSyncCaps();
  const clientKey = caps.ordersClientKey ? normalizeClientKey((body as any)?.client_key) : null;
  const occurredAt = caps.ordersOccurredAt
    ? parseOccurredAt((body as any)?.occurred_at) ?? new Date().toISOString()
    : null;
  if (clientKey) {
    try {
      const existing = await findOrderByClientKey(gate.vendor.id, clientKey);
      if (existing) {
        return NextResponse.json({ ok: true, orderId: existing.id, order: existing, dedup: true });
      }
    } catch {
      /* columna sin migrar: se sigue sin idempotencia */
    }
  }

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

  // Fiado: exige cliente identificado con teléfono real (cuaderno sin
  // teléfono no existe). Sin descuento en efectivo (es crédito, no cash).
  let fiadoPhone: string | null = null;
  if (payment === "fiado") {
    const fullVendor = await queryOne<{ whatsapp: string | null }>(
      `SELECT whatsapp FROM vendors WHERE id = $1 LIMIT 1`,
      [gate.vendor.id]
    ).catch(() => null);
    fiadoPhone = validateFiadoPhone(customerPhoneClean, (fullVendor as any)?.whatsapp || null);
    if (!fiadoPhone) {
      return NextResponse.json(
        { error: "El fiado requiere nombre y celular real del cliente" },
        { status: 400 }
      );
    }
    if (!customerName?.trim()) {
      return NextResponse.json(
        { error: "El fiado requiere el nombre del cliente" },
        { status: 400 }
      );
    }
  }

  const normalizedItems: { product_id?: any; variant_id?: any; name: any; price: number; qty: number; modifiers?: any; requires_prep: boolean; pack_size?: number; unit?: string; manual?: boolean }[] = items.map((i: any) => ({
    product_id: i.product_id || undefined,
    variant_id: i.variant_id || undefined,
    name: i.name,
    price: Number(i.price),
    qty: Number(i.qty) || 1,
    modifiers: Array.isArray(i.modifiers) && i.modifiers.length > 0 ? i.modifiers : undefined,
    requires_prep: i.requires_prep !== false,
    unit: i.unit === "kg" ? "kg" : undefined,
    manual: i.manual === true ? true : undefined,
  }));

  // Packs: validación de múltiplo. Después normalizo el ítem a formato
  // pack-native: `price` = PRECIO DEL PAQUETE y `pack_size` presente (mismo
  // formato que el canal app — así cierre de mesa, tickets y cash lo entienden).
  // Líneas manuales ("manual:...") no son uuid: se excluyen de los lookups.
  const isUuid = (s: unknown): s is string =>
    typeof s === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
  {
    const pids = Array.from(new Set(normalizedItems.map((i) => i.product_id).filter(isUuid)));
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
  // Venta directa retail: nace cerrada (no genera pedido).
  const needsKitchen = normalizedItems.some((i) => i.requires_prep !== false);
  const status = direct ? "completed" : needsKitchen || isDelivery ? "preparing" : "new";

  const now = new Date().toISOString();

  // Descuento en efectivo: se recalcula server-side (nunca se confía en el
  // total del cliente). Misma fórmula que el micrositio: % sobre la unidad
  // (con modificadores), promos excluidas por el comercio no reciben descuento.
  const pctSource = gate.vendor.cash_discount_pct;
  let cashDiscount = 0;
  let cashPct = 0;
  if (payment === "efectivo") {
    const ids = Array.from(new Set(normalizedItems.map((i) => i.product_id).filter(isUuid)));
    const vids = Array.from(new Set(normalizedItems.map((i) => i.variant_id).filter(isUuid)));
    const prows = ids.length
      ? await queryMany<{ id: string; promo_price: number | null; cash_discount_excluded: boolean | null }>(
          `SELECT id, promo_price, cash_discount_excluded FROM products WHERE vendor_id = $1 AND id = ANY($2)`,
          [gate.vendor.id, ids]
        )
      : [];
    // product_variants no tiene vendor_id: se filtra por el producto dueño.
    const vrows = vids.length
      ? await queryMany<{ id: string; product_id: string; promo: number | null }>(
          `SELECT v.id, v.product_id, v.promo FROM product_variants v JOIN products p ON p.id = v.product_id WHERE p.vendor_id = $1 AND v.id = ANY($2)`,
          [gate.vendor.id, vids]
        )
      : [];
    const pmap = new Map((prows || []).map((p) => [p.id, p]));
    const vmap = new Map((vrows || []).map((v) => [v.id, v]));
    const res = cashDiscountForItems(
      normalizedItems.map((i) => {
        const p = i.product_id ? pmap.get(i.product_id) : undefined;
        const v = i.variant_id ? vmap.get(i.variant_id) : undefined;
        // Con pack ya normalizado: price = precio del paquete; el cash corre
        // por paquetes (qty/pack) → sin drift de decimales.
        const pack = ((i as any).pack_size as number) >= 2 ? ((i as any).pack_size as number) : 0;
        return {
          unitPrice: i.price,
          qty: pack ? i.qty / pack : i.qty,
          hasPromo: v ? v.promo != null : (p ? p.promo_price != null : false),
          excluded: p?.cash_discount_excluded ?? null,
        };
      }),
      pctSource
    );
    cashDiscount = res.cashDiscount;
    cashPct = res.cashPct;
  }
  // Envío por zona (el comerciante es autoridad: admite monto manual fuera
  // de zona). El fee se suma al total; el espejo del mostrador ya lo mostró.
  const deliveryCfg = isDelivery ? await fetchVendorDelivery(gate.vendor.id) : null;
  const subtotalNum = Number(total) || 0;
  let deliveryResolved = { fee: 0, zoneId: null as string | null, zoneName: null as string | null, outOfArea: false, freeShipping: false };
  if (isDelivery && deliveryCfg) {
    const sel: DeliverySelection = deliveryOutOfArea === true
      ? { kind: "out_of_area", manualFee: Number(deliveryManualFee) || null }
      : deliveryCfg.mode === "zones" && typeof deliveryZoneId === "string" && deliveryZoneId
        ? { kind: "zone", zoneId: deliveryZoneId }
        : { kind: "in_area" };
    deliveryResolved = resolveDeliveryFee({
      mode: deliveryCfg.mode,
      baseFee: deliveryCfg.baseFee,
      freeMin: deliveryCfg.freeMin,
      zones: deliveryCfg.zones,
      selection: sel,
      netSubtotal: subtotalNum,
      allowManual: true,
    });
  }
  const finalTotal = Math.max(0, Math.round((subtotalNum - cashDiscount + deliveryResolved.fee) * 100) / 100);

  // Número de pedido diario universal (mostrador/delivery): además de
  // referenciarlo a la caja, el pedido queda con su número de oraculo en tickets.
  // En sesión de prueba todo nace marcado como prueba.
  const previewOrder = gate.previewSession === true;
  const customerE164 = toE164(customerPhoneClean);
  // Columnas offline (solo si la migración está aplicada): client_key para
  // idempotencia + occurred_at (hora real de la venta según el dispositivo).
  const syncCols = [
    ...(caps.ordersClientKey ? ["client_key"] : []),
    ...(caps.ordersOccurredAt ? ["occurred_at"] : []),
  ];
  // Columnas de zona (tolerante a migración sin aplicar).
  let hasZoneCols = false;
  if (isDelivery) {
    try {
      const zc = await queryOne<{ exists: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_name = 'orders' AND column_name = 'delivery_zone_id'
         ) AS exists`
      );
      hasZoneCols = zc?.exists === true;
    } catch {
      hasZoneCols = false;
    }
  }
  // closed_at (venta directa nace cerrada): tolerante a migración sin aplicar.
  let hasClosedAt = false;
  if (direct) {
    try {
      const cc = await queryOne<{ exists: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_name = 'orders' AND column_name = 'closed_at'
         ) AS exists`
      );
      hasClosedAt = cc?.exists === true;
    } catch {
      hasClosedAt = false;
    }
  }
  let order: Record<string, any> | null = null;
  try {
    order = await withTransaction(async (tx) => {
    // Stock: la venta de mostrador descuenta igual que el canal app (la
    // función es no-op para productos sin stock_control — gastro no nota el
    // cambio). Ítems por peso (kg) y líneas manuales no tocan stock.
    // Al cancelar el pedido se repone (orders/[id]).
    // Pedidos de prueba (preview) no tocan el stock real.
    let movedStock: StockMove[] = [];
    if (!previewOrder) {
      // Por peso y líneas manuales ("Varios", sin product_id) no tocan stock.
      movedStock = await adjustStockForItems(tx, normalizedItems.filter((i) => i.unit !== "kg" && !(i as any).manual && (i.product_id || (i as any).variant_id)), "decrement");
    }

    const pickupNumber = await nextOrderNumber(tx, gate.vendor.id);
    // payment_status: tolerante a migración sin aplicar.
    let hasPayStatus = false;
    try {
      const pc = await tx.queryOne<{ exists: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'payment_status') AS exists`
      );
      hasPayStatus = pc?.exists === true;
    } catch {
      hasPayStatus = false;
    }
    const cols = [
      "vendor_id", "customer_name", "customer_phone", "customer_address",
      "method", "payment_method", "items", "total", "status", "channel",
      "paid_at", "notes", "pickup_number", "is_preview", "cash_pct",
      "cash_discount",
      ...(direct && hasClosedAt ? ["closed_at"] : []),
      ...(hasPayStatus ? ["payment_status"] : []),
      ...syncCols,
      ...(hasZoneCols ? ["delivery_zone_id", "delivery_zone_name", "delivery_out_of_area", "delivery_fee"] : []),
    ];
    const vals: unknown[] = [
      gate.vendor.id,
      customerName?.trim() || "Mostrador",
      customerPhoneClean,
      isDelivery ? (customerAddress?.trim() || null) : null,
      isDelivery ? "delivery" : "pickup",
      payment,
      JSON.stringify(normalizedItems),
      finalTotal,
      status,
      "mostrador",
      // Fiado: impago (no entra al Z hasta cubrirse).
      payment === "fiado" ? null : now,
      notes || null,
      pickupNumber,
      previewOrder,
      cashPct,
      cashDiscount,
      ...(direct && hasClosedAt ? [now] : []),
      ...(hasPayStatus ? [payment === "fiado" ? "pending" : "paid"] : []),
      ...(caps.ordersClientKey ? [clientKey] : []),
      ...(caps.ordersOccurredAt ? [occurredAt] : []),
      ...(hasZoneCols ? [deliveryResolved.zoneId, deliveryResolved.zoneName, deliveryResolved.outOfArea, deliveryResolved.fee] : []),
    ];
    const placeholders = vals.map((_, i) => `$${i + 1}`).join(", ");
    const order = await tx.queryOne<Record<string, any>>(
      `INSERT INTO orders (${cols.join(", ")}) VALUES (${placeholders}) RETURNING *`,
      vals
    );

    // Kardex: la venta de mostrador mueve stock (lo que adjust descontó).
    if (!previewOrder && order?.id) {
      for (const m of movedStock) {
        await logStockMovement(tx, {
          vendorId: gate.vendor.id,
          product_id: m.product_id,
          variant_id: m.variant_id,
          qty_delta: -m.qty,
          reason: "venta",
          ref_order: order.id,
        });
      }
    }

    // CRM: con teléfono real del cliente → ficha (delivery y retiro con
    // teléfono cargado; el pickup anónimo no genera ficha; tampoco si
    // pusieron el WA del comercio).
    if (customerE164 && isRealCustomerPhone(customerPhoneClean, gate.vendor.whatsapp) && !previewOrder) {
      await upsertCustomerFromOrder(tx, gate.vendor.id, {
        phone: customerE164,
        name: customerName?.trim() || null,
        address: customerAddress?.trim() || null,
        total: finalTotal,
        at: now,
      });
    }

    // Fiado: cargo en cuenta corriente (tolerante a migración sin aplicar).
    if (payment === "fiado" && order?.id && fiadoPhone && !previewOrder) {
      try {
        await tx.queryVoid(
          `INSERT INTO account_moves (vendor_id, customer_phone, kind, amount, ref_order)
           VALUES ($1, $2, 'charge', $3, $4)`,
          [gate.vendor.id, fiadoPhone, finalTotal, order.id]
        );
      } catch {
        /* sin tabla: la venta igual queda */
      }
    }

    return order ?? null;
  });
  } catch (e) {
    if (e instanceof OutOfStockError) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    // Carrera de reintentos con la misma client_key (el pre-chequeo pasó en
    // paralelo): el índice único frenó el duplicado → devolver el existente.
    if (clientKey && caps.ordersClientKey && (e as { code?: string })?.code === "23505") {
      try {
        const existing = await findOrderByClientKey(gate.vendor.id, clientKey);
        if (existing) {
          return NextResponse.json({ ok: true, orderId: existing.id, order: existing, dedup: true });
        }
      } catch {
        /* sigue al throw original */
      }
    }
    const { logApiError } = await import("@/lib/api-error");
    logApiError("pos/order", e);
    throw e;
  }

  return NextResponse.json({ ok: true, orderId: order?.id, order });
}