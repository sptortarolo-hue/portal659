import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryMany, queryOne, withTransaction } from "@/lib/db";
import { fetchVendorDelivery } from "@/lib/delivery-server";
import { resolveDeliveryFee, type DeliverySelection } from "@/lib/delivery";
import { nextOrderNumber } from "@/lib/order-number";
import { cashDiscountForItems, normalizeCashPct } from "@/lib/cash-discount";
import {
  resolveOrderPricing,
  PricingError,
  type IncomingOrderItem,
  type ResolvedPricing,
} from "@/lib/pricing";
import type { OrderItem } from "@/types/database";
import { adjustStockForItems, OutOfStockError, type StockMove } from "@/lib/stock";
import { logStockMovement } from "@/lib/stock-ledger";
import { upsertCustomerFromOrder, isRealCustomerPhone } from "@/lib/customers";
import { getOpenShift } from "@/lib/cash-closing";
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
  const gate = await gateRequest(request, { allowStaff: true });
  if (!gate.ok) return gateError(gate);

  if (!gate.plan.can("pos")) {
    return NextResponse.json(
      { error: "El mostrador forma parte del plan Gestión integral" },
      { status: 403 }
    );
  }

  // Switch "exigir caja abierta": sin turno abierto no se cobra en el
  // mostrador (tolerante a migración sin aplicar: el flag resuelve false).
  if (gate.vendor.require_open_shift === true) {
    const shift = await getOpenShift(gate.vendor.id);
    if (!shift) {
      return NextResponse.json(
        { error: "Abrí la caja para cobrar en el mostrador", code: "shift_required" },
        { status: 409 }
      );
    }
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

  // Venta directa (mostrador, todos los verticales): vende en el acto sin
  // generar pedido (solo delivery/retiro generan pedido con flow).
  const direct = body?.direct === true;
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

  // Los ids "manual:..." del mostrador NO son uuids: se limpian al
  // normalizar para que no contaminen "Lo más pedido" (el flag `manual`,
  // el nombre y el precio se conservan para ticket/totales).
  const isUuid = (s: unknown): s is string =>
    typeof s === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
  const normalizedItems: { product_id?: any; variant_id?: any; name: any; price: number; qty: number; modifiers?: any; requires_prep: boolean; pack_size?: number; unit?: string; manual?: boolean }[] = items.map((i: any) => ({
    product_id: isUuid(i.product_id) ? i.product_id : undefined,
    variant_id: isUuid(i.variant_id) ? i.variant_id : undefined,
    name: i.name,
    price: Number(i.price),
    qty: Number(i.qty) || 1,
    modifiers: Array.isArray(i.modifiers) && i.modifiers.length > 0 ? i.modifiers : undefined,
    requires_prep: i.requires_prep !== false,
    unit: i.unit === "kg" ? "kg" : undefined,
    manual: i.manual === true ? true : undefined,
  }));

  // Packs y precios por volumen: se resuelven server-side con la misma
  // regla que el canal app (resolveOrderPricing: precios de DB, múltiplo de
  // pack, modificadores vigentes, volumen, cash sobre neto, envío sobre
  // neto). Nunca se confía en el `price`/`total` del cliente.
  // Líneas manuales ("manual:...") o sin uuid no van a pricing: se cobran
  // al precio declarado (tolerancia para catálogos viejos en el snapshot).
  const pricedInput: IncomingOrderItem[] = [];
  const pricedPrep: boolean[] = [];
  const passthrough: typeof normalizedItems = [];
  for (const i of normalizedItems) {
    if (i.manual === true || (!isUuid(i.product_id) && !isUuid(i.variant_id))) {
      passthrough.push(i);
      continue;
    }
    pricedInput.push({
      offerId: (i.product_id as string) || undefined,
      variantId: (i.variant_id as string) || undefined,
      qty: i.qty,
      modifiers: i.modifiers,
    });
    pricedPrep.push(i.requires_prep !== false);
  }
  const manualTotal = Math.round(passthrough.reduce((s, i) => s + i.price * i.qty, 0) * 100) / 100;

  // Config de envío (el comerciante es autoridad: admite monto manual fuera
  // de zona). La resuelve pricing sobre el neto con volumen.
  const deliveryCfg = isDelivery ? await fetchVendorDelivery(gate.vendor.id) : null;
  const deliverySel: DeliverySelection = !isDelivery
    ? { kind: "pickup" }
    : deliveryOutOfArea === true
      ? { kind: "out_of_area", manualFee: Number(deliveryManualFee) || null }
      : deliveryCfg && deliveryCfg.mode === "zones" && typeof deliveryZoneId === "string" && deliveryZoneId
        ? { kind: "zone", zoneId: deliveryZoneId }
        : { kind: "in_area" };

  // Columna de volumen (tolerante a migración sin aplicar).
  let hasVolumeCol = false;
  try {
    const vc = await queryOne<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_name = 'orders' AND column_name = 'volume_discount'
       ) AS exists`
    );
    hasVolumeCol = vc?.exists === true;
  } catch {
    hasVolumeCol = false;
  }

  const now = new Date().toISOString();

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
  // closed_at (venta directa nace cerrada) + is_direct: tolerantes a
  // migración sin aplicar.
  let hasClosedAt = false;
  let hasDirectCol = false;
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
    try {
      const dc = await queryOne<{ exists: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_name = 'orders' AND column_name = 'is_direct'
         ) AS exists`
      );
      hasDirectCol = dc?.exists === true;
    } catch {
      hasDirectCol = false;
    }
  }
  let order: Record<string, any> | null = null;
  let resolvedVolumeApplied: ResolvedPricing["volumeApplied"] = [];
  try {
    order = await withTransaction(async (tx) => {
    // Stock: la venta de mostrador descuenta igual que el canal app (la
    // función es no-op para productos sin stock_control — gastro no nota el
    // cambio). Ítems por peso (kg) y líneas manuales no tocan stock.
    // Al cancelar el pedido se repone (orders/[id]).
    // Pedidos de prueba (preview) no tocan el stock real.
    // Precios (fuente de verdad): primero pricing sobre los ítems con
    // producto, después se suman las líneas manuales al precio declarado.
    // El cash de las manuales corre igual que antes (sin promo ni exclusión).
    const round2 = (n: number) => Math.round(n * 100) / 100;
    let finalItems: OrderItem[] = [];
    let finalTotal = 0;
    let cashDiscount = 0;
    let cashPct = 0;
    let volumeDiscount = 0;
    let volumeApplied: ResolvedPricing["volumeApplied"] = [];
    let deliveryResolved = { fee: 0, zoneId: null as string | null, zoneName: null as string | null, outOfArea: false, freeShipping: false };
    if (pricedInput.length > 0) {
      const pricing = await resolveOrderPricing({
        tx,
        vendorId: gate.vendor.id,
        items: pricedInput,
        method: isDelivery ? "delivery" : "pickup",
        deliveryFee: deliveryCfg?.baseFee ?? null,
        freeDeliveryMin: deliveryCfg?.freeMin ?? null,
        deliveryMode: deliveryCfg?.mode ?? "flat",
        deliveryZones: deliveryCfg?.zones ?? [],
        deliverySelection: deliverySel,
        deliveryAllowManual: true,
        paymentMethod: payment,
        cashDiscountPct: (gate.vendor as any)?.cash_discount_pct,
      });
      pricing.items.forEach((it, idx) => {
        (it as any).requires_prep = pricedPrep[idx] !== false;
      });
      const cashManual =
        payment === "efectivo"
          ? cashDiscountForItems(
              passthrough.map((i) => ({ unitPrice: i.price, qty: i.qty, hasPromo: false, excluded: null })),
              (gate.vendor as any)?.cash_discount_pct
            ).cashDiscount
          : 0;
      finalItems = [...pricing.items, ...(passthrough as unknown as OrderItem[])];
      finalTotal = Math.max(0, round2(pricing.total + manualTotal - cashManual));
      cashDiscount = round2(pricing.cashDiscount + cashManual);
      cashPct = pricing.cashPct;
      volumeDiscount = pricing.volumeDiscount;
      volumeApplied = pricing.volumeApplied;
      deliveryResolved = {
        fee: pricing.deliveryFee,
        zoneId: pricing.deliveryZoneId,
        zoneName: pricing.deliveryZoneName,
        outOfArea: pricing.deliveryOutOfArea,
        freeShipping: pricing.deliveryFreeShipping,
      };
    } else {
      // Solo líneas manuales: delivery sobre el total manual (comportamiento previo).
      if (isDelivery && deliveryCfg) {
        deliveryResolved = resolveDeliveryFee({
          mode: deliveryCfg.mode,
          baseFee: deliveryCfg.baseFee,
          freeMin: deliveryCfg.freeMin,
          zones: deliveryCfg.zones,
          selection: deliverySel,
          netSubtotal: manualTotal,
          allowManual: true,
        });
      }
      cashDiscount =
        payment === "efectivo"
          ? cashDiscountForItems(
              passthrough.map((i) => ({ unitPrice: i.price, qty: i.qty, hasPromo: false, excluded: null })),
              (gate.vendor as any)?.cash_discount_pct
            ).cashDiscount
          : 0;
      cashPct = payment === "efectivo" ? normalizeCashPct((gate.vendor as any)?.cash_discount_pct) : 0;
      finalItems = [...passthrough];
      finalTotal = Math.max(0, round2(manualTotal - cashDiscount + deliveryResolved.fee));
    }

    // Pedidos CON cocina o delivery nacen en "preparing" y entran al flow
    // normal de la comanda (hay que prepararlos/despacharlos). Pedidos de
    // mostrador/mesa SIN nada de cocina (solo bebidas/packs) no van a la
    // comanda y usan el flow corto de 2 pasos: new → ready ("Listo").
    // Venta directa retail: nace cerrada (no genera pedido).
    const needsKitchen = finalItems.some((i) => i.requires_prep !== false);
    const status = direct ? "completed" : needsKitchen || isDelivery ? "preparing" : "new";

    // Stock: la venta de mostrador descuenta igual que el canal app (la
    // función es no-op para productos sin stock_control — gastro no nota el
    // cambio). Ítems por peso (kg) y líneas manuales no tocan stock.
    // Al cancelar el pedido se repone (orders/[id]).
    // Pedidos de prueba (preview) no tocan el stock real.
    let movedStock: StockMove[] = [];
    if (!previewOrder) {
      movedStock = await adjustStockForItems(tx, finalItems.filter((i) => i.unit !== "kg" && !i.manual && (i.product_id || i.variant_id)), "decrement");
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
      ...(hasVolumeCol ? ["volume_discount"] : []),
      ...(direct && hasClosedAt ? ["closed_at"] : []),
      ...(direct && hasDirectCol ? ["is_direct"] : []),
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
      JSON.stringify(finalItems),
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
      ...(hasVolumeCol ? [volumeDiscount] : []),
      ...(direct && hasClosedAt ? [now] : []),
      ...(direct && hasDirectCol ? [true] : []),
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
    resolvedVolumeApplied = volumeApplied;

    return order ?? null;
  });
  } catch (e) {
    if (e instanceof OutOfStockError) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    if (e instanceof PricingError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
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

  return NextResponse.json({ ok: true, orderId: order?.id, order, volumeDiscount: (order as any)?.volume_discount ?? 0, volumeApplied: resolvedVolumeApplied });
}