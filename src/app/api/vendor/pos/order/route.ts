import { gateRequest, gateError } from "@/lib/subscription-gate";
import {
  hasOrderPaymentsTable,
  insertOrderPayments,
  normalizeSplitPayments,
  primaryMethod,
  type SplitPayment,
} from "@/lib/order-payments";
import { hasTable, hasColumn, queryMany, queryOne, withTransaction } from "@/lib/db";
import { fetchVendorDelivery } from "@/lib/delivery-server";
import { resolveDeliveryFee, type DeliverySelection } from "@/lib/delivery";
import { nextOrderNumber } from "@/lib/order-number";
import { cashDiscountForItems, normalizeCashPct } from "@/lib/cash-discount";
import { CASH_METHOD_LABELS } from "@/lib/cash-methods";
import {
  resolveOrderPricing,
  PricingError,
  type IncomingOrderItem,
  type ResolvedPricing,
} from "@/lib/pricing";
import type { OrderItem } from "@/types/database";
import { adjustStockForItems, stockItemsForMovement, OutOfStockError, type StockMove } from "@/lib/stock";
import { logStockMovement } from "@/lib/stock-ledger";
import { upsertCustomerFromOrder, isRealCustomerPhone } from "@/lib/customers";
import { getOpenShift } from "@/lib/cash-closing";
import { validateFiadoPhone } from "@/lib/fiados";
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

/** Adapter del pool a la firmina mínima de hasColumn (columnas en pre-tx). */
const POOL_QUERIER = {
  query: <T extends Record<string, any>>(sql: string, params: unknown[] = []) => queryMany<T>(sql, params),
};

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
    cashAmount,
    payments,
    bankAccountId,
    deferPayment,
    fiscal,
  } = body;

  // Venta directa (mostrador, todos los verticales): vende en el acto sin
  // generar pedido (solo delivery/retiro generan pedido con flow).
  // `directIn` = lo que pidió el cliente; más abajo la venta de un ajuste
  // post-cierre se fuerza directa (la plata ya entró: no hay pedido que seguir).
  const directIn = body?.direct === true;
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

  // "¿Con cuánto paga?" (mostrador, efectivo): monto con el que abona el
  // cliente. Se valida contra el total REAL más abajo (el servidor lo
  // recalcula: cash, volumen, giftcard, envío y descuento manual). Es
  // opcional y tolerante: vacío, no numérico o faltante → no se guarda nada.
  const cashAmountIn = Number(cashAmount);
  // Pago combinado (split payments): se normaliza más abajo contra el total
  // real y viaja en la respuesta para que el panel muestre el desglose.
  let resolvedSplit: SplitPayment[] | null = null;

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

  // Descuento manual por venta ($ o % con motivo). Se valida y se calcula
  // acá; el monto final se resta dentro de la tx (base = neto mercadería).
  type ManualDiscountIn = { kind: "amount" | "percent"; value: number; reason: string | null };
  let manualIn: ManualDiscountIn | null = null;
  const mdRaw = (body as any)?.manualDiscount;
  if (mdRaw != null && typeof mdRaw === "object") {
    const kind = mdRaw.kind === "percent" ? "percent" : mdRaw.kind === "amount" ? "amount" : null;
    const value = Number(mdRaw.value);
    const reason = String(mdRaw.reason || "").trim().slice(0, 120) || null;
    if (kind && Number.isFinite(value) && value > 0) {
      if (kind === "percent" && value > 100) {
        return NextResponse.json({ error: "El porcentaje no puede superar el 100%" }, { status: 400 });
      }
      manualIn = { kind, value, reason };
    } else {
      return NextResponse.json({ error: "Descuento manual inválido" }, { status: 400 });
    }
  }
  if (manualIn && payment === "fiado") {
    return NextResponse.json({ error: "El descuento manual no aplica al fiado" }, { status: 400 });
  }

  // Los ids "manual:..." del mostrador NO son uuids: se limpian al
  // normalizar para que no contaminen "Lo más pedido" (el flag `manual`,
  // el nombre y el precio se conservan para ticket/totales).
  const isUuid = (s: unknown): s is string =>
    typeof s === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
  const normalizedItems: { product_id?: any; variant_id?: any; name: any; price: number; qty: number; modifiers?: any; requires_prep: boolean; pack_size?: number; unit?: string; manual?: boolean; combo_members?: any[] }[] = items.map((i: any) => ({
    product_id: isUuid(i.product_id) ? i.product_id : undefined,
    variant_id: isUuid(i.variant_id) ? i.variant_id : undefined,
    name: i.name,
    price: Number(i.price),
    qty: Number(i.qty) || 1,
    modifiers: Array.isArray(i.modifiers) && i.modifiers.length > 0 ? i.modifiers : undefined,
    requires_prep: i.requires_prep !== false,
    unit: i.unit === "kg" ? "kg" : undefined,
    manual: i.manual === true ? true : undefined,
    // Armado por unidad de combos: el server lo valida (pricing).
    combo_members: Array.isArray(i.combo_members) ? i.combo_members.slice(0, 60) : undefined,
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
      combo_members: i.combo_members,
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

  // Columna de volumen (tolerante a migración sin aplicar; hasColumn nunca
  // lanza — un catch dejaría la tx envenenada más adelante).
  const hasVolumeCol = await hasColumn(POOL_QUERIER, "orders", "volume_discount");

  // Columnas de descuento manual (tolerante a migración sin aplicar).
  const hasManualCol = await hasColumn(POOL_QUERIER, "orders", "manual_discount");
  // Columna "con cuánto abona" (migrate-order-cash-amount.sql, tolerante a
  // migración sin aplicar): sin la columna el mostrador funciona igual, solo
  // no queda registrado el vuelto en el pedido/ticket.
  const hasCashAmountCol = await hasColumn(POOL_QUERIER, "orders", "cash_amount");
  // Desglose de pago combinado (migrate-order-payments.sql, tolerante a
  // migración sin aplicar): sin la tabla la venta sale con medio único.
  const hasPaymentsTable = await hasOrderPaymentsTable();
  // Multi-cuenta: la columna puede no existir si la migración no se aplicó.
  const hasBankAccountCol = await hasColumn(POOL_QUERIER, "orders", "bank_account_id");

  const now = new Date().toISOString();

  // Ajuste post-cierre (migrate-cash-adjustments / -orders): la venta que
  // faltaba se registra retrospectivamente dentro del cierre elegido. Se
  // estampa con la fecha del cierre (no con "ahora") para que Historial y
  // Analytics la ubiquen ese día; el rastro de cuándo se cargó queda en la
  // fila del ajuste.
  const adjustClosingId =
    typeof (body as any)?.adjust_closing_id === "string"
      ? String((body as any).adjust_closing_id).trim()
      : "";
  const adjustReasonIn =
    typeof (body as any)?.adjust_reason === "string"
      ? String((body as any).adjust_reason).trim().slice(0, 240)
      : "";
  let adjustClosing: { id: string; closed_at: string } | null = null;
  if (adjustClosingId) {
    // Requiere la tabla base y el vínculo con el pedido: sin ellas el ajuste
    // sería un número suelto (y esta venta entraría al próximo Z).
    const adjTable = await queryOne<{ ok: boolean }>(
      `SELECT to_regclass('public.cash_closing_adjustments') IS NOT NULL AS ok`
    ).catch(() => null);
    if (!adjTable?.ok) {
      return NextResponse.json(
        {
          error: "Falta aplicar migrate-cash-adjustments.sql (ajustes de caja)",
          code: "migration_missing",
        },
        { status: 503 }
      );
    }
    const adjCol = await queryOne<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_name = 'cash_closing_adjustments' AND column_name = 'order_id'
       ) AS exists`
    ).catch(() => null);
    if (adjCol?.exists !== true) {
      return NextResponse.json(
        {
          error: "Falta aplicar migrate-cash-adjustments-orders.sql (venta del ajuste)",
          code: "migration_missing",
        },
        { status: 503 }
      );
    }
    adjustClosing =
      (await queryOne<{ id: string; closed_at: string }>(
        `SELECT id, closed_at FROM cash_closings WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
        [adjustClosingId, gate.vendor.id]
      ).catch(() => null)) || null;
    if (!adjustClosing) {
      return NextResponse.json({ error: "El cierre del ajuste no existe" }, { status: 404 });
    }
    // El ajuste representa plata que entró: una venta fiada o con pago diferido
    // no tiene cobro que corregir.
    if (payment === "fiado" || deferPayment === true) {
      return NextResponse.json(
        { error: "El ajuste registra una venta cobrada: elegí un medio de pago (no fiado ni diferido)" },
        { status: 400 }
      );
    }
  }
  const stampAt = adjustClosing ? new Date(adjustClosing.closed_at).toISOString() : now;
  const occurredAtFinal = adjustClosing ? stampAt : occurredAt;
  // La venta del ajuste es una venta que YA ocurrió: nace directa (cerrada y
  // con closed_at) aunque el cliente no mande `direct`. Si no, quedaría como
  // pedido pendiente de un cierre ya cerrado.
  const direct = directIn || adjustClosing != null;

  // Número de pedido universal (mostrador/delivery): además de
  // referenciarlo a la caja, el pedido queda con su número de oraculo en tickets.
  // Diario en gastronomía, correlativo continuo en el resto (ver order-number.ts).
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
  let hasGiftcardCols = false;
  try {
    const gc = await queryOne<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_name = 'orders' AND column_name = 'giftcard_discount'
       ) AS exists`
    );
    if (gc?.exists === true) hasGiftcardCols = true;
  } catch {
    hasGiftcardCols = false;
  }
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
  let adjustmentRows = 0;
  let giftcardIssued: { id: string; code: string; amount: number }[] = [];
  let resolvedVolumeApplied: ResolvedPricing["volumeApplied"] = [];
  let resolvedManualDiscount = 0;
  let fiscalResult:
    | { ok: boolean; invoice?: unknown; error?: string; hint?: string; code?: string; skipped?: string }
    | null = null;
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
    let manualDiscountAmount = 0;
    // Descuento manual: % o $ sobre el neto de mercadería (subtotal con
    // volumen + manuales, sin envío). Capado a la base; el total nunca es < 0.
    const manualAmountFor = (base: number): number => {
      if (!manualIn) return 0;
      const b = Math.max(0, round2(base));
      if (manualIn.kind === "percent") return Math.min(b, round2((b * manualIn.value) / 100));
      return Math.min(b, round2(manualIn.value));
    };
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
        // La balanza del mostrador manda: el peso puede no ser múltiplo del
        // configurado (etiqueta de 0,324 kg) y no debe rebotar.
        skipWeightRules: true,
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
      manualDiscountAmount = manualAmountFor(pricing.subtotal - pricing.volumeDiscount + manualTotal);
      finalTotal = Math.max(0, round2(pricing.total + manualTotal - cashManual - manualDiscountAmount));
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
      manualDiscountAmount = manualAmountFor(manualTotal);
      finalTotal = Math.max(0, round2(manualTotal - cashDiscount + deliveryResolved.fee - manualDiscountAmount));
    }

    // Pedidos CON cocina o delivery nacen en "preparing" y entran al flow
    // normal de la comanda (hay que prepararlos/despacharlos). Pedidos de
    // mostrador/mesa SIN nada de cocina (solo bebidas/packs) no van a la
    // comanda y usan el flow corto de 2 pasos: new → ready ("Listo").
    // Venta directa retail: nace cerrada (no genera pedido).
    const needsKitchen = finalItems.some((i) => i.requires_prep !== false);
    const status = direct && !deferPayment ? "completed" : needsKitchen || isDelivery ? "preparing" : "new";

    // Stock: la venta de mostrador descuenta igual que el canal app (la
    // función es no-op para productos sin stock_control — gastro no nota el
    // cambio). Ítems por peso (kg) y líneas manuales no tocan stock.
    // Al cancelar el pedido se repone (orders/[id]).
    // Pedidos de prueba (preview) no tocan el stock real.
    let movedStock: StockMove[] = [];
    if (!previewOrder) {
      // Envasado: líneas kg de productos "cuento paquetes" viajan como 1
      // paquete por línea (ver stockItemsForMovement). No se bloquea la
      // venta por stock: la bolsa ya salió físicamente.
      const packItems = await stockItemsForMovement(tx, gate.vendor.id, finalItems);
      movedStock = await adjustStockForItems(
        tx,
        packItems.filter((i) => (i as any)?.unit !== "kg"),
        "decrement",
        // Venta retrospectiva (ajuste post-cierre): el producto ya salió, así
        // que se permite dejar el stock en negativo en vez de bloquear.
        { allowNegative: adjustClosing != null }
      );
      const packMoves = await adjustStockForItems(
        tx,
        packItems.filter((i) => (i as any)?.unit === "kg"),
        "decrement",
        { allowNegative: true }
      );
      movedStock = [...movedStock, ...packMoves];
    }

    // Canje de giftcard en mostrador: DENTRO de la tx y ANTES del INSERT,
    // sobre el total recién calculado (si falla se hace rollback de todo:
    // sin venta ni consumo). Espeja order-service.ts (canal online): el
    // descuento queda persistido en giftcard_code/giftcard_discount.
    let giftcardApplied = 0;
    let giftcardCodeFinal: string | null = null;
    const giftcardCodeBody = typeof body?.giftcardCode === "string" ? body.giftcardCode.trim() : "";
    if (giftcardCodeBody && !previewOrder) {
      const { consumeGiftcard } = await import("@/lib/giftcards");
      const applied = await consumeGiftcard(tx, {
        vendorId: gate.vendor.id,
        code: giftcardCodeBody,
        maxAmount: finalTotal,
        note: "Venta de mostrador",
      });
      if (!applied) {
        throw new PricingError("Giftcard sin saldo, vencida o no válida");
      }
      giftcardApplied = applied.applied;
      giftcardCodeFinal = applied.code;
      finalTotal = Math.max(0, round2(finalTotal - giftcardApplied));
    }

    const pickupNumber = await nextOrderNumber(tx, gate.vendor.id);
    // "¿Con cuánto paga?" (mostrador, efectivo): valido contra el total FINAL
    // recién calculado (cash + volumen + giftcard + descuento manual + envío).
    // Opcional y tolerante: si no alcanza, si no es efectivo o si falta la
    // columna, no se guarda (nunca rompe la venta).
    const cashAmountFinal =
      hasCashAmountCol &&
      payment === "efectivo" &&
      Number.isFinite(cashAmountIn) &&
      cashAmountIn > 0 &&
      cashAmountIn >= finalTotal - 0.001
        ? Math.round(cashAmountIn * 100) / 100
        : null;
    // Pago combinado (split): se valida contra el total FINAL recién calculado
    // (mismo total que cashAmountFinal). Si no cierra con el real (o falta la
    // tabla) se ignora y la venta sale con el medio único de la pastilla.
    const split = hasPaymentsTable ? normalizeSplitPayments(payments, finalTotal) : null;
    resolvedSplit = split;
    // Con desglose, `orders.payment_method` guarda el medio de mayor monto
    // (Kanban/tickets/analytics siguen leyendo un valor único como siempre).
    const paymentMethodDb = split ? primaryMethod(split) : payment;
    // payment_status: tolerante a migración sin aplicar (hasColumn nunca
    // lanza; un catch acá envenenaría la tx con 25P02).
    const hasPayStatus = await hasColumn(tx, "orders", "payment_status");
const entries: Array<[string, unknown]> = [
      ["vendor_id", gate.vendor.id],
      ["customer_name", customerName?.trim() || "Mostrador"],
      ["customer_phone", customerPhoneClean],
      ["customer_address", isDelivery ? (customerAddress?.trim() || null) : null],
      ["method", isDelivery ? "delivery" : "pickup"],
      ["payment_method", paymentMethodDb],
      ["items", JSON.stringify(finalItems)],
      ["total", finalTotal],
      ["status", status],
      ["channel", "mostrador"],
      ["paid_at", (deferPayment === true || payment === "fiado") ? null : stampAt],
      ["notes", notes || null],
      ["pickup_number", pickupNumber],
      ["is_preview", previewOrder],
      ["cash_pct", cashPct],
      ["cash_discount", cashDiscount],
    ];
    if (hasVolumeCol) entries.push(["volume_discount", volumeDiscount]);
    if (hasManualCol) {
      entries.push(["manual_discount", manualDiscountAmount]);
      entries.push(["manual_discount_kind", manualIn ? manualIn.kind : null]);
      entries.push(["manual_discount_reason", manualIn ? manualIn.reason : null]);
      entries.push(["manual_discount_value", manualIn ? manualIn.value : null]);
    }
    if (direct && !deferPayment && hasClosedAt) entries.push(["closed_at", stampAt]);
    if (direct && !deferPayment && hasDirectCol) entries.push(["is_direct", true]);
    if (hasPayStatus) entries.push(["payment_status", deferPayment === true ? "pending" : (payment === "fiado" ? "pending" : "paid")]);
    if (caps.ordersClientKey) entries.push(["client_key", clientKey]);
    if (caps.ordersOccurredAt) entries.push(["occurred_at", occurredAtFinal]);
    // La venta del ajuste se ubica en el día del cierre (Historial/Analytics
    // filtran por created_at); el ajuste guarda la fecha real de la carga.
    if (adjustClosing) entries.push(["created_at", stampAt]);
    if (hasZoneCols) {
      entries.push(["delivery_zone_id", deliveryResolved.zoneId]);
      entries.push(["delivery_zone_name", deliveryResolved.zoneName]);
      entries.push(["delivery_out_of_area", deliveryResolved.outOfArea]);
      entries.push(["delivery_fee", deliveryResolved.fee]);
    }
    if (hasGiftcardCols) {
      entries.push(["giftcard_code", giftcardCodeFinal]);
      entries.push(["giftcard_discount", giftcardApplied]);
    }
    if (hasCashAmountCol) entries.push(["cash_amount", cashAmountFinal]);
    if (hasBankAccountCol && payment === "transferencia") entries.push(["bank_account_id", bankAccountId || null]);

    const cols = entries.map(([c]) => c);
    const vals = entries.map(([, v]) => v);
    const placeholders = vals.map((_, i) => `$${i + 1}`).join(", ");
    const order = await tx.queryOne<Record<string, any>>(
      `INSERT INTO orders (${cols.join(", ")}) VALUES (${placeholders}) RETURNING *`,
      vals
    );

    // Pago combinado: una fila por medio, en la MISMA transacción (si algo
    // falla, la venta entera se descarta: nunca queda cobro sin desglose).
    if (split && order?.id) {
      await insertOrderPayments(tx, {
        vendorId: gate.vendor.id,
        orderId: String(order.id),
        payments: split as SplitPayment[],
        clientKey: clientKey ?? null,
        createdBy: gate.previewSession ? null : gate.user?.id ?? null,
      });
      // Con desglose, el pedido no se cuenta por payment_method (la Caja usa
      // las filas): se marca para no duplicar. Tolerante a migración sin
      // columna: hasColumn nunca lanza y envenenaría la tx si lanzara.
      if (await hasColumn(tx, "orders", "paid_via_payments")) {
        await tx.queryVoid(`UPDATE orders SET paid_via_payments = true WHERE id = $1`, [order.id]);
      }
    }

    // Ajuste post-cierre con venta (faltante): la venta recién creada se
    // vincula al cierre ya cerrado y se registra el ajuste de caja en la
    // MISMA transacción (si algo falla no queda ni venta ni ajuste). Con pago
    // combinado va una fila por medio para que el arqueo por medio cuadre.
    if (adjustClosing && order?.id && !previewOrder) {
      const adjRows: { method: string; amount: number }[] = split
        ? split.map((p) => ({ method: p.method, amount: Number(p.amount) || 0 }))
        : [{ method: paymentMethodDb || "efectivo", amount: finalTotal }];
      for (const r of adjRows) {
        if (!(r.amount > 0)) continue;
        await tx.queryVoid(
          `INSERT INTO cash_closing_adjustments
             (vendor_id, closing_id, amount, method, kind, reason, order_id, created_by)
           VALUES ($1, $2, $3, $4, 'venta_faltante', $5, $6, $7)`,
          [
            gate.vendor.id,
            adjustClosing.id,
            Math.round(r.amount * 100) / 100,
            r.method in CASH_METHOD_LABELS ? r.method : "efectivo",
            adjustReasonIn || "Venta faltante registrada desde el ajuste post-cierre",
            order.id,
            gate.previewSession ? null : gate.user?.id ?? null,
          ]
        );
        adjustmentRows++;
      }
    }

    // Emisión automática de giftcards vendidas (F2): al cobrar en el acto
    // (fiado queda pendiente → se emiten al cubrirse o a mano desde el
    // detalle). Idempotente por (pedido, producto, unidad); preview nunca.
    if (order?.id && !previewOrder && payment !== "fiado") {
      const { issueGiftcardsForOrder } = await import("@/lib/giftcards");
      // Sin try/catch-and-continue: un fallo acá se re-lanza para rollback
      // limpio de la venta (un catch que sigue usando la tx la envenena:
      // 25P02 en toda query posterior).
      giftcardIssued = await issueGiftcardsForOrder(tx, {
        vendorId: gate.vendor.id,
        orderId: String(order.id),
        items: (finalItems || []) as any[],
        customerName: customerName?.trim() || null,
        customerPhone: customerPhoneClean || null,
        isPreview: false,
        note: `Venta mostrador #${pickupNumber ?? order.id.slice(0, 8)}`,
      });
    }

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
    // pusieron el WA del comercio). Tolerante a migración sin aplicar: la
    // venta no muere porque falte migrate-crm.sql.
    if (
      customerE164 &&
      isRealCustomerPhone(customerPhoneClean, gate.vendor.whatsapp) &&
      !previewOrder &&
      (await hasTable(tx, "customers"))
    ) {
      await upsertCustomerFromOrder(tx, gate.vendor.id, {
        phone: customerE164,
        name: customerName?.trim() || null,
        address: customerAddress?.trim() || null,
        total: finalTotal,
        at: stampAt,
      });
    }

    // Fiado: cargo en cuenta corriente (tolerante a migración: sin tabla no
    // se inserta — un catch-and-continue envenenaría la tx y mataría la venta).
    if (payment === "fiado" && order?.id && fiadoPhone && !previewOrder && (await hasTable(tx, "account_moves"))) {
      await tx.queryVoid(
        `INSERT INTO account_moves (vendor_id, customer_phone, kind, amount, ref_order)
         VALUES ($1, $2, 'charge', $3, $4)`,
        [gate.vendor.id, fiadoPhone, finalTotal, order.id]
      );
    }
    resolvedVolumeApplied = volumeApplied;
    resolvedManualDiscount = manualDiscountAmount;

    return order ?? null;
  });

  // Factura C al contado: el cliente manda el opt-in (`fiscal`) junto con el
  // cobro. Emitir acá —y no desde el navegador— evita que una venta cobrada
  // quede sin comprobante si se cierra la pestaña. Best-effort: ARCA nunca
  // debe hacer fallar una venta ya registrada.
  if (order?.id && fiscal && deferPayment !== true) {
    try {
      const { emitFiscalForOrder } = await import("@/lib/arca/emit-for-order");
      fiscalResult = await emitFiscalForOrder({
        vendorId: gate.vendor.id,
        orderId: order.id,
        total: Number((order as any)?.total ?? 0) || undefined,
        receptorDocTipo: fiscal.receptorDocTipo,
        receptorDocNro: fiscal.receptorDocNro,
        receptorNombre: fiscal.receptorNombre,
        receptorCondIva: fiscal.receptorCondIva,
      });
    } catch (e) {
      const { logApiError } = await import("@/lib/api-error");
      logApiError("pos/order/fiscal", e);
      fiscalResult = { ok: false, error: "No se pudo emitir el comprobante" };
    }
  }
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
    // Surface the real cause instead of a generic 500: the panel needs to
    // know why the sale failed (FK, CHECK, missing column, etc.) instead of
    // showing "No se pudo registrar el pedido" forever.
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Error interno al registrar el pedido" },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, orderId: order?.id, order, volumeDiscount: (order as any)?.volume_discount ?? 0, volumeApplied: resolvedVolumeApplied, manualDiscount: resolvedManualDiscount, giftcardIssued, payments: resolvedSplit, adjustmentRows, adjustClosingId: adjustClosing?.id ?? null, fiscal: fiscalResult, store: { name: gate.vendor.store_name, logo: ((gate.vendor as any)?.logo_url ?? null) as string | null } });
}