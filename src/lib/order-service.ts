import crypto from "crypto";
import { queryMany, queryOne, withTransaction } from "@/lib/db";
import { sendEmail, newOrderVendorEmail } from "@/lib/email";
import { sendPushToUser } from "@/lib/push";
import { resolveVendorPlan } from "@/lib/plans";
import { adjustStockForItems, OutOfStockError, type StockMove } from "@/lib/stock";
import { logStockMovement } from "@/lib/stock-ledger";
import { isStoreOpen } from "@/lib/open-hours";
import { PricingError, resolveOrderPricing, IncomingOrderItem } from "@/lib/pricing";
import { nextOrderNumber } from "@/lib/order-number";
import { fetchVendorDelivery } from "@/lib/delivery-server";
import { fetchVendorShipZones } from "@/lib/shipping-server";
import type { DeliverySelection } from "@/lib/delivery";
import { toE164 } from "@/lib/phone";
import { upsertCustomerFromOrder } from "@/lib/customers";
import { formatDeliveryWindow } from "@/lib/delivery-schedule";
import type { OrderItem } from "@/types/database";

/**
 * Lógica compartida de creación de pedido (canal "app").
 * La usan tanto la ruta web (`/api/orders`) como el bot de WhatsApp
 * (`/api/wa/order`). Recibe todo por parámetros: NO depende de cookies/request
 * (el `deviceId` lo aporta el llamador, o `null` para fuentes sin navegador).
 *
 * Validaciones (idénticas a la ruta web):
 *  - plan con feature `cart` activa, si no ForbiddenError (403),
 *  - comercio abierto (`isStoreOpen`), si no StoreClosedError (409),
 *  - precios/stock siempre recomputados server-side, OutOfStockError (409).
 */

export type CreateOrderInput = {
  vendorId: string;
  customerName: string;
  customerPhone: string;
  customerAddress?: string | null;
  method?: string | null;
  paymentMethod?: string | null;
  customerId?: string | null;
  items: IncomingOrderItem[];
  notes?: string | null;
  deviceId?: string | null;
  /** "web" (default) | "wa-bot": el bot prefija las notas con "[Bot WA]". */
  source?: string | null;
  /** Zona elegida (modo zones, canal web). Se valida server-side. */
  deliveryZoneId?: string | null;
  /** true = fuera del área habitual: entra a convenir (canal web). */
  deliveryOutOfArea?: boolean | null;
  /** Zona extendida del catálogo del portal elegida (Portal 659 Envíos). */
  shippingZoneId?: string | null;
  /** Turno de entrega elegido (id de slot "YYYY-MM-DD|HH:MM-HH:MM", retail). */
  deliveryWindow?: string | null;
  /** Pedido de prueba (preview): no cuenta en topes ni descuenta stock/CRM. */
  isPreview?: boolean | null;
  /** Token del link ?preview= (valida contra vendors.preview_token). */
  previewToken?: string | null;
  /** Código de giftcard a canjear (checkout online, solo efectivo/transferencia). */
  giftcardCode?: string | null;
  /** "¿Con cuánto abonás?" (efectivo + delivery): monto que dice llevar el cliente. */
  cashAmount?: number | null;
};

export type CreateOrderResult = {
  orderId: string;
  total: number;
  items: OrderItem[];
  pickupNumber: number;
  cashDiscount: number;
  cashPct: number;
  volumeDiscount: number;
  volumeApplied: { groupName: string; label: string; qty: number }[];
  /** Link público de seguimiento: /seguimiento/[token]. */
  trackToken: string;
  /** Envío resuelto server-side (para mostrar el exacto en el resumen). */
  deliveryFee: number;
  deliveryZoneName: string | null;
  deliveryOutOfArea: boolean;
  /** Zona extendida del catálogo (nombre para el resumen/ticket). */
  shippingZoneName: string | null;
  /** Turno de entrega prometido (id de slot, retail delivery). */
  deliveryWindow: string | null;
  /** Canje de giftcard aplicado (0 = sin canje). */
  giftcard_discount?: number;
  /**
   * true = el pedido con kg quedó "pendiente de peso" (modo confirmar): el
   * comercio confirma el peso real y recién ahí se cobra (link MP/transferencia).
   */
  weightPending?: boolean;
  /** Tolerancia % (estimado vs real) configurada por el comercio. */
  weightTolerancePct?: number;
};

/** Negocio: el comercio no acepta pedidos online (plan sin carrito). → 403 */
export class OrderForbiddenError extends Error {
  constructor(message = "Este comercio no acepta pedidos online por ahora.") {
    super(message);
    this.name = "OrderForbiddenError";
  }
}

/** Negocio: el comercio está cerrado. → 409 */
export class StoreClosedError extends Error {
  constructor(message = "El comercio está cerrado en este momento.") {
    super(message);
    this.name = "StoreClosedError";
  }
}

/** Negocio: el comercio llegó al tope mensual de pedidos de su plan. → 429 */
export class OrderLimitError extends Error {
  constructor(
    message = "Este comercio llegó al tope de pedidos online del mes. Escribile por WhatsApp."
  ) {
    super(message);
    this.name = "OrderLimitError";
  }
}

/** Negocio: falta el "¿con cuánto abonás?" o es menor al total (efectivo + delivery). → 400 */
export class CashAmountError extends Error {
  constructor(message = "Indicá con cuánto abonás (tiene que ser igual o mayor al total).") {
    super(message);
    this.name = "CashAmountError";
  }
}

/** Negocio: el método elegido (retiro/delivery) no está habilitado por el comercio. → 400 */
export class DeliveryMethodError extends Error {
  constructor(message = "El comercio no ofrece ese método de entrega.") {
    super(message);
    this.name = "DeliveryMethodError";
  }
}

/** Entrada: el teléfono del cliente no es un celular argentino (WhatsApp). → 400 */
export class InvalidPhoneError extends Error {
  constructor(message = "Ingresá un celular válido con código de área (ej: 11 5555 1234)") {
    super(message);
    this.name = "InvalidPhoneError";
  }
}

export async function createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
  const {
    vendorId,
    customerName,
    customerPhone,
    customerAddress,
    method: methodIn,
    paymentMethod,
    customerId,
    items,
    notes,
    deviceId,
    source,
    deliveryZoneId,
    deliveryOutOfArea,
    shippingZoneId,
    deliveryWindow,
    giftcardCode,
    previewToken,
    cashAmount,
  } = input;

  if (!vendorId || !customerName || !customerPhone || !items) {
    throw new Error("Faltan datos requeridos");
  }

  // Modo prueba (preview del micrositio): el pedido no cuenta en topes ni
  // descuenta stock/CRM ni manda mails. Tolerante a migración sin aplicar.
  const isPreview =
    input.isPreview === true ||
    (await (async () => {
      try {
        const { isPreviewTokenForVendor } = await import("@/lib/preview-flag");
        return await isPreviewTokenForVendor(vendorId, input.previewToken);
      } catch {
        return false;
      }
    })());
  // Nota: arriba resolví el preview token; abajo lo uso en canje (sin tocar
  // el destructure que ya trae isPreview).

  // Teléfono del cliente: celular argentino válido (WhatsApp), normalizado a
  // E.164 sin "+" (549...). Misma validación que el registro de usuarios —
  // de acá salen los links wa.me del comercio, así que tiene que ser real.
  // Excepción wa-bot: el chat puede venir como LID (id opaco de WhatsApp de
  // no-contactos, sin teléfono disponible). Se guarda como "lid:<id>" para
  // identificarlo igual; no sirve para escribirle por fuera del chat.
  let customerPhoneE164: string;
  if (source === "wa-bot" && customerPhone.startsWith("lid:")) {
    customerPhoneE164 = customerPhone;
  } else {
    const normalized = toE164(customerPhone);
    if (!normalized) {
      throw new InvalidPhoneError();
    }
    customerPhoneE164 = normalized;
  }

  // Giftcards 100% digitales: sin retiro ni delivery — se entregan por
  // WhatsApp al teléfono del comprador (validado arriba, siempre exigido).
  // Se fuerza pickup (sin fee ni turnos) aunque manden otro método.
  let method = methodIn;
  let giftDigital = false;
  try {
    let grows = await queryMany<{ id: string }>(
      `SELECT id FROM products WHERE vendor_id = $1 AND (sku LIKE 'GC-%' OR lower(category) = 'giftcards')`,
      [vendorId]
    ).catch(() => [] as { id: string }[]);
    if (grows.length === 0) {
      grows = await queryMany<{ id: string }>(
        `SELECT id FROM products WHERE vendor_id = $1 AND lower(category) = 'giftcards'`,
        [vendorId]
      ).catch(() => [] as { id: string }[]);
    }
    const gset = new Set((grows || []).map((r) => String(r.id)));
    const pids = ((items as any[]) || [])
      .map((i) => String(i?.product_id ?? i?.offerId ?? ""))
      .filter(Boolean);
    if (pids.length > 0 && pids.every((p) => gset.has(p))) {
      method = "pickup";
      giftDigital = true;
    }
  } catch {
    /* sin match: flow normal */
  }

  const paymentMethodNorm = paymentMethod || "whatsapp";
  const notesFinal =
    source === "wa-bot" && notes ? `[Bot WA] ${notes}` : source === "wa-bot" ? "[Bot WA]" : notes || null;

  const vendorRow = await queryOne<Record<string, unknown>>(
    `SELECT vertical, plan_id, plan_status, plan_expires_at, trial_ends_at, hours, open_override, delivery_fee, free_delivery_min, cash_discount_pct, accepts_online_orders, delivery_options, transfer_expiry_hours, cash_ask_amount FROM vendors WHERE id = $1 LIMIT 1`,
    [vendorId]
  );

  // Modo de cobro de productos pesables (migrate-weight-confirm.sql, tolerante
  // sin aplicar): 'estimado' = se cobra el declarado (como siempre);
  // 'confirmar' = el pedido con kg nace pendiente de pago hasta que el
  // comercio pesa y confirma el total real.
  const weightCfg = await queryOne<{ weight_confirm_mode: string | null; weight_tolerance_pct: number | null }>(
    `SELECT weight_confirm_mode, weight_tolerance_pct FROM vendors WHERE id = $1 LIMIT 1`
  ).catch(() => null);
  const weightConfirmMode = weightCfg?.weight_confirm_mode === "confirmar" ? "confirmar" : "estimado";
  const weightTolerancePct =
    Number.isFinite(Number(weightCfg?.weight_tolerance_pct)) && Number(weightCfg?.weight_tolerance_pct) > 0
      ? Math.min(100, Math.floor(Number(weightCfg?.weight_tolerance_pct)))
      : 20;

  if (vendorRow) {
    const planRows = await queryMany<Record<string, unknown>>(`SELECT * FROM plans`);
    const plan = resolveVendorPlan(vendorRow as any, planRows as any);
    if (!plan.can("cart")) {
      throw new OrderForbiddenError(
        "Este comercio no acepta pedidos online por ahora. Consultalo directamente por WhatsApp."
      );
    }

    // Opt-out del comercio (toggle "Vender online" del panel). El gate del
    // carrito vive en la UI; acá se enforcea para que un POST directo o el
    // bot no puedan crear pedidos igual.
    if ((vendorRow as any).accepts_online_orders === false) {
      throw new OrderForbiddenError(
        "Este comercio desactivó la venta online temporalmente. Escribile por WhatsApp."
      );
    }

    const openNow = isStoreOpen(vendorRow as any);
    if (openNow === false) {
      throw new StoreClosedError(
        "El comercio está cerrado en este momento. Probá cuando abra o escribile por WhatsApp."
      );
    }

    // Método de entrega habilitado por el comercio ("ambos" | "retiro" | "domicilio").
    // Giftcards digitales: no usan entrega física, van por WhatsApp.
    const deliveryOptions = ((vendorRow as any).delivery_options as string | null) || "ambos";
    const wantsDelivery = method !== "pickup";
    if (!giftDigital && deliveryOptions === "retiro" && wantsDelivery) {
      throw new DeliveryMethodError("Este comercio solo trabaja con retiro en el local.");
    }
    if (!giftDigital && deliveryOptions === "domicilio" && !wantsDelivery) {
      throw new DeliveryMethodError("Este comercio solo entrega a domicilio.");
    }

    // Tope mensual de pedidos del plan gratuito (canal app, mes calendario,
    // no cancelados). Un plan pago vigente resuelve maxOrdersMonth = null.
    if (plan.maxOrdersMonth != null) {
      const countRow = await queryOne<{ c: number }>(
        `SELECT COUNT(*)::int AS c FROM orders
         WHERE vendor_id = $1 AND channel = 'app' AND status <> 'cancelled'
           AND COALESCE(is_preview, false) = false
           AND created_at >= date_trunc('month', now())`,
        [vendorId]
      ).catch(() =>
        // Columna is_preview aún no migrada: contar igual que antes.
        queryOne<{ c: number }>(
          `SELECT COUNT(*)::int AS c FROM orders
           WHERE vendor_id = $1 AND channel = 'app' AND status <> 'cancelled'
             AND created_at >= date_trunc('month', now())`,
          [vendorId]
        )
      );
      if ((countRow?.c ?? 0) >= plan.maxOrdersMonth) {
        throw new OrderLimitError();
      }
    }
  }

  let orderId: string | undefined;
  let resolvedItems: OrderItem[] = [];
  let resolvedTotal = 0;
  let resolvedItemsCount = 0;
  let pickupNumber = 0;
  let resolvedCashDiscount = 0;
  let resolvedCashPct = 0;
  let resolvedVolumeDiscount = 0;
  let resolvedVolumeApplied: { groupName: string; label: string; qty: number }[] = [];
  let resolvedDeliveryFee = 0;
  let resolvedZoneName: string | null = null;
  let resolvedOutOfArea = false;
  let resolvedShipName: string | null = null;
  let resolvedWeightPending = false;

  // Token público del link de seguimiento (/seguimiento/[token]). Se genera
  // acá y viaja en el mensaje de WhatsApp del pedido.
  const trackToken = crypto.randomBytes(20).toString("hex");

  // Config de envío por zona (tolerante a migración sin aplicar: default flat).
  const deliveryCfg = await fetchVendorDelivery(vendorId);
  const isPickupOrder = method === "pickup";
  // Zonas extendidas del catálogo (migración portal-shipments: sin aplicar → []).
  const extZones = await fetchVendorShipZones(vendorId);
  const extZoneSelected =
    !isPickupOrder &&
    typeof shippingZoneId === "string" &&
    shippingZoneId !== "" &&
    extZones.some((z) => String(z.id) === String(shippingZoneId))
      ? String(shippingZoneId)
      : null;
  const deliverySelection: DeliverySelection = isPickupOrder
    ? { kind: "pickup" }
    : extZoneSelected
      ? { kind: "extends_zone", zoneId: extZoneSelected }
      : deliveryOutOfArea === true
        ? { kind: "out_of_area" }
        : deliveryCfg.mode === "zones" && deliveryZoneId
          ? { kind: "zone", zoneId: String(deliveryZoneId) }
          : { kind: "in_area" };
  // Zona extendida (Portal 659 Envíos): el courier no cobra en efectivo ni usa
  // WhatsApp de pago — solo transferencia (o MP por WebCheckout). Se normaliza
  // server-side para que un POST directo no genere un pedido impagable.
  const paymentMethodFinal =
    deliverySelection.kind === "extends_zone"
      ? (paymentMethodNorm === "mercadopago" ? "mercadopago" : "transferencia")
      : paymentMethodNorm;

  // Turno de entrega (retail delivery): el cliente elige entre los próximos
  // slots; si manda uno inválido/vacío (o viene de un canal sin UI, ej. bot),
  // se auto-asigna el próximo. Fuera de horario NO se bloquea: el pedido
  // entra con el próximo turno (el checkout ya lo avisó con cartel amable).
  // Con "Se coordina" no hay turnos: el horario se arregla por WhatsApp.
  let resolvedWindow: string | null = null;
  {
    const vertical = String((vendorRow as any)?.vertical || "");
    const isRetail = vertical === "moda" || vertical === "comercio";
    // Con zona extendida (Portal 659 Envíos) el horario lo maneja la
    // logística (eta del carrier): no se promete el turno del local.
    if (vendorRow && isRetail && !isPickupOrder && !extZoneSelected && !deliveryCfg.deliveryCoordinar) {
      try {
        const { nextDeliverySlots, isValidDeliveryWindow } = await import(
          "@/lib/delivery-schedule"
        );
        const slots = nextDeliverySlots(
          {
            hours: (vendorRow as any).hours ?? null,
            delivery_hours: deliveryCfg.deliveryHours,
            open_override: (vendorRow as any).open_override ?? null,
            delivery_override: deliveryCfg.deliveryOverride,
            delivery_paused_until: deliveryCfg.deliveryPausedUntil,
            delivery_pause_reason: deliveryCfg.deliveryPauseReason,
            delivery_extra_days: deliveryCfg.deliveryExtraDays,
          },
          { timeZone: "America/Argentina/Buenos_Aires", count: 3 }
        );
        if (slots.length > 0) {
          resolvedWindow =
            typeof deliveryWindow === "string" && isValidDeliveryWindow(deliveryWindow, slots)
              ? deliveryWindow
              : slots[0].id;
        }
      } catch {
        resolvedWindow = null;
      }
    }
  }

  // Tolerante a migración de volumen sin aplicar: si la columna no existe,
  // el pedido se guarda igual (sin columna de descuento por volumen).
  const volumeCol = await queryOne<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_name = 'orders' AND column_name = 'volume_discount'
     ) AS exists`
  );
  const hasVolumeCol = volumeCol?.exists === true;

  // Tolerante a migración de zonas sin aplicar: si las columnas no existen,
  // el pedido se guarda igual (sin detalle de zona).
  const zoneCol = await queryOne<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_name = 'orders' AND column_name = 'delivery_zone_id'
     ) AS exists`
  );
  const hasZoneCols = zoneCol?.exists === true;

  // Tolerante a migración portal-shipments sin aplicar: sin columnas, el
  // pedido se guarda igual (sin zona extendida; el flujo sigue como hoy).
  const shipCol = await queryOne<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_name = 'orders' AND column_name = 'shipping_zone_id'
     ) AS exists`
  ).catch(() => null);
  const hasShipCols = shipCol?.exists === true;

  // Tolerante a migración de franjas sin aplicar: si la columna no existe,
  // el pedido se guarda igual (sin turno prometido).
  const windowCol = await queryOne<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_name = 'orders' AND column_name = 'delivery_window'
     ) AS exists`
  );
  const hasWindowCol = windowCol?.exists === true;

  // Tolerante a migración de preview sin aplicar: si la columna no existe, el
  // pedido se guarda igual (sin flag de prueba).
  const previewCol = await queryOne<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_name = 'orders' AND column_name = 'is_preview'
     ) AS exists`
  );
  const hasPreviewCol = previewCol?.exists === true;
  // Canje de giftcard (tolerante a migración sin aplicar).
  const giftcardCol = await queryOne<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_name = 'orders' AND column_name = 'giftcard_discount'
     ) AS exists`
  ).catch(() => null);
  const hasGiftcardCols = giftcardCol?.exists === true;

  // Vencimiento de transferencias (tolerante a migración sin aplicar): el
  // pedido nace con deadline si el comercio tiene el vencimiento activo.
  const deadlineCol = await queryOne<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_name = 'orders' AND column_name = 'transfer_deadline_at'
     ) AS exists`
  ).catch(() => null);
  const hasDeadlineCol = deadlineCol?.exists === true;
  const expiryHours = Number((vendorRow as any)?.transfer_expiry_hours) || 0;
  // Modo "confirmar" + carrito con kg: la transferencia se paga después de que
  // el comercio pese (total real) → el deadline NO nace al crear; lo sella el
  // PATCH al confirmar el peso.
  let incomingHasKg = (items as any[]).some((i) => (i as any)?.unit === "kg");
  if (!incomingHasKg) {
    try {
      const pids = ((items as any[]) || []).map((i) => String(i?.product_id ?? i?.offerId ?? "")).filter(Boolean);
      if (pids.length > 0) {
        const kgRows = await queryMany<{ id: string }>(
          'SELECT id FROM products WHERE id = ANY(::uuid[]) AND unit = ' + "'kg'",
          [pids]
        ).catch(() => [] as { id: string }[]);
        if (kgRows.length > 0) incomingHasKg = true;
      }
    } catch {
      /* sin match: flow normal */
    }
  }
  // Modo "confirmar" + carrito con kg: el pedido entra en el flujo de pesada
  // con CUALQUIER método de pago. Lo que cambia por método es solo el cobro:
  // transferencia/MP quedan "pending" (se cobra el total real tras pesar) y
  // efectivo/coordinar siguen "paid" (se cobra al entregar o retirar).
  // El deadline de transferencia NO nace al crear: lo sella el PATCH al confirmar.
  const weightDeferredTransfer =
    !isPreview && weightConfirmMode === "confirmar" && incomingHasKg;
  const transferDeadlineAt =
    hasDeadlineCol && !isPreview && paymentMethodFinal === "transferencia" && !weightDeferredTransfer && expiryHours > 0 && expiryHours <= 168
      ? new Date(Date.now() + expiryHours * 3_600_000).toISOString()
      : null;

  // "¿Con cuánto abonás?" (migrate-order-cash-amount.sql, tolerante sin aplicar).
  const cashAmountCol = await queryOne<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_name = 'orders' AND column_name = 'cash_amount'
     ) AS exists`
  ).catch(() => null);
  const hasCashAmountCol = cashAmountCol?.exists === true;

  // Pesables (migrate-weight-confirm.sql, tolerante sin aplicar): snapshot del
  // estimado + sello de confirmación de peso.
  const weightCol = await queryOne<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_name = 'orders' AND column_name = 'weight_estimated_total'
     ) AS exists`
  ).catch(() => null);
  const hasWeightCols = weightCol?.exists === true;
  // Se pide solo en efectivo + delivery, si el comercio no lo apagó. En pruebas
  // (preview) no se exige para no trabar el recorrido, pero se guarda igual.
  const cashAmountRequired =
    paymentMethodFinal === "efectivo" && method === "delivery" && !isPreview &&
    (vendorRow ? (vendorRow as any).cash_ask_amount !== false : false);
  const cashAmountFinal =
    typeof cashAmount === "number" && Number.isFinite(cashAmount) && cashAmount > 0
      ? Math.round(cashAmount * 100) / 100
      : null;

  // Canje de giftcard (checkout online, efectivo/transferencia): se consume
  // DENTRO de la tx principal, sobre el total recién calculado (si falla se
  // hace rollback de todo: sin pedido ni consumo). MP va por propia ruta.
  let giftcardApplied = 0;
  let giftcardCodeFinal: string | null = null;
  const wantsGiftcard =
    typeof giftcardCode === "string" && giftcardCode.trim() !== "" && !isPreview &&
    paymentMethodFinal !== "mercadopago";

  try {
    await withTransaction(async (tx) => {
      const isPickup = method === "pickup";

      const pricing = await resolveOrderPricing({
        tx,
        vendorId,
        items,
        method: isPickup ? "pickup" : "delivery",
        deliveryFee: (vendorRow as any)?.delivery_fee ?? deliveryCfg.baseFee,
        freeDeliveryMin: (vendorRow as any)?.free_delivery_min ?? deliveryCfg.freeMin,
        deliveryMode: deliveryCfg.mode,
        deliveryZones: deliveryCfg.zones,
        // Zonas extendidas del catálogo: la selección kind "extends_zone" se
        // resuelve contra estas (fee = precio del catálogo, sin gratis-desde).
        extendedZones: extZones.map((z) => ({ id: z.id, name: z.name, fee: z.price, description: null })),
        deliverySelection,
        // Descuento en efectivo: corre con la misma fórmula que el checkout
        // muestra en pantalla (antes no se aplicaba server-side: el cliente
        // veía un precio y el pedido guardaba otro).
        paymentMethod: paymentMethodFinal,
        cashDiscountPct: (vendorRow as any)?.cash_discount_pct,
      });
      resolvedItems = pricing.items;
      resolvedTotal = pricing.total;
      resolvedItemsCount = pricing.items.reduce((s, i) => s + i.qty, 0);
      resolvedCashDiscount = pricing.cashDiscount;
      resolvedCashPct = pricing.cashPct;
      resolvedVolumeDiscount = pricing.volumeDiscount;
      resolvedVolumeApplied = pricing.volumeApplied;
      resolvedDeliveryFee = pricing.deliveryFee;
      resolvedZoneName = pricing.deliveryZoneName;
      resolvedOutOfArea = pricing.deliveryOutOfArea;
      resolvedShipName = extZoneSelected
        ? extZones.find((z) => z.id === extZoneSelected)?.name ?? null
        : null;

      // MP diferido (modo "confirmar" + carrito con kg): el pedido nace
      // pendiente de pago; el comercio pesa y después se cobra el total real
      // (link MP desde el panel/seguimiento). Sin kg o modo estimado: como
      // siempre. Un pedido de prueba nunca difiere (no se cobra igual).
      // Cualquier método guarda el estimado: el flujo de "confirmar peso" y el
      // aviso al cliente aplican también a efectivo/coordinar (cobro al entregar).
      const hasKgItems = resolvedItems.some((i) => (i as any)?.unit === "kg");
      const deferMpPayment =
        !isPreview &&
        weightConfirmMode === "confirmar" &&
        hasKgItems &&
        paymentMethodFinal === "mercadopago";
      resolvedWeightPending = !isPreview && weightConfirmMode === "confirmar" && (incomingHasKg || hasKgItems);
      const paymentStatus =
        paymentMethodFinal === "transferencia" || deferMpPayment ? "pending" : "paid";

      // Canje de giftcard (efectivo/transferencia): sobre el total recién
      // calculado, dentro de la misma tx (si falla se hace rollback de todo).
      if (wantsGiftcard) {
        const { consumeGiftcard } = await import("@/lib/giftcards");
        const applied = await consumeGiftcard(tx, {
          vendorId,
          code: giftcardCode!.trim().toUpperCase(),
          maxAmount: pricing.total,
          note: `Pedido online`,
        });
        if (!applied) {
          throw new Error("Giftcard sin saldo, vencida o no válida");
        }
        giftcardApplied = applied.applied;
        giftcardCodeFinal = applied.code;
        resolvedTotal = Math.max(0, Math.round((pricing.total - giftcardApplied) * 100) / 100);
      }

      // "¿Con cuánto abonás?": validado contra el total final (con descuento
      // de efectivo, envío y giftcard ya aplicados). El vuelto no se guarda:
      // se calcula donde se muestra (cash_amount - total).
      if (cashAmountRequired && (!cashAmountFinal || cashAmountFinal < resolvedTotal)) {
        throw new CashAmountError();
      }

      const movedStock: StockMove[] = isPreview
        ? []
        : await adjustStockForItems(tx, resolvedItems.filter((i) => (i as any).unit !== "kg"), "decrement");
      pickupNumber = await nextOrderNumber(tx, vendorId);

      // $16 = track_token; después van las columnas opcionales con
      // numeración dinámica (volumen y/o zona pueden faltar sin migrar).
      let nextParam = 17;
      const volumeCols = hasVolumeCol ? ", volume_discount" : "";
      const volumeVals = hasVolumeCol ? `, $${nextParam++}` : "";
      const volumeParams: unknown[] = hasVolumeCol ? [pricing.volumeDiscount] : [];
      // Columnas de zona (si la migración está aplicada).
      const zoneCols = hasZoneCols ? ", delivery_zone_id, delivery_zone_name, delivery_out_of_area, delivery_fee" : "";
      const zoneVals = hasZoneCols ? `, $${nextParam++}, $${nextParam++}, $${nextParam++}, $${nextParam++}` : "";
      const zoneParams: unknown[] = hasZoneCols
        // Zonas extendidas del catálogo: su id vive en shipping_zones y NO
        // entra en delivery_zone_id (FK a delivery_zones → 500 si se coloca).
        ? [deliverySelection.kind === "extends_zone" ? null : pricing.deliveryZoneId, pricing.deliveryZoneName, pricing.deliveryOutOfArea, pricing.deliveryFee]
        : [];
      // Zonas extendidas del catálogo (migración portal-shipments).
      const shipCols = hasShipCols ? ", shipping_zone_id, shipping_zone_name" : "";
      const shipVals = hasShipCols ? `, $${nextParam++}, $${nextParam++}` : "";
      const shipParams: unknown[] = hasShipCols ? [extZoneSelected, resolvedShipName] : [];
      // Turno de entrega prometido (migración de franjas).
      const windowCols = hasWindowCol ? ", delivery_window" : "";
      const windowVals = hasWindowCol ? `, $${nextParam++}` : "";
      const windowParams: unknown[] = hasWindowCol ? [resolvedWindow] : [];
      // Flag de prueba (migrate-service-preview.sql).
      const previewCols = hasPreviewCol ? ", is_preview" : "";
      const previewVals = hasPreviewCol ? `, $${nextParam++}` : "";
      const previewParams: unknown[] = hasPreviewCol ? [isPreview] : [];
      // Canje de giftcard (migración de giftcards).
      const giftcardCols = hasGiftcardCols ? ", giftcard_code, giftcard_discount" : "";
      const giftcardVals = hasGiftcardCols ? `, $${nextParam++}, $${nextParam++}` : "";
      const giftcardParams: unknown[] = hasGiftcardCols ? [giftcardCodeFinal, giftcardApplied] : [];
      // Vencimiento de transferencia ("Pago vencido", M4.2).
      const deadlineCols = transferDeadlineAt ? ", transfer_deadline_at" : "";
      const deadlineVals = transferDeadlineAt ? `, $${nextParam++}` : "";
      const deadlineParams: unknown[] = transferDeadlineAt ? [transferDeadlineAt] : [];
      // "¿Con cuánto abonás?" (efectivo + delivery).
      const cashAmountCols = hasCashAmountCol ? ", cash_amount" : "";
      const cashAmountVals = hasCashAmountCol ? `, $${nextParam++}` : "";
      const cashAmountParams: unknown[] = hasCashAmountCol ? [cashAmountFinal] : [];
      // Pesables (migrate-weight-confirm.sql): snapshot del estimado (para la
      // diferencia que ve el cliente). weight_confirmed_at nace NULL.
      const weightCols = hasWeightCols && resolvedWeightPending ? ", weight_estimated_total" : "";
      const weightVals = hasWeightCols && resolvedWeightPending ? `, $${nextParam++}` : "";
      const weightParams: unknown[] =
        hasWeightCols && resolvedWeightPending ? [Math.round(resolvedTotal * 100) / 100] : [];
      const rows = await tx.query<{ id: string }>(
        `INSERT INTO orders (vendor_id, customer_id, customer_name, customer_phone, customer_address, method, payment_method, items, total, status, notes, device_id, payment_status, pickup_number, cash_pct, cash_discount, track_token${volumeCols}${zoneCols}${shipCols}${windowCols}${previewCols}${giftcardCols}${deadlineCols}${cashAmountCols}${weightCols})
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'new', $10, $11, $12, $13, $14, $15, $16${volumeVals}${zoneVals}${shipVals}${windowVals}${previewVals}${giftcardVals}${deadlineVals}${cashAmountVals}${weightVals})
         RETURNING id`,
        [
          vendorId,
          customerId || null,
          customerName,
          customerPhoneE164,
          customerAddress || null,
          isPickup ? "pickup" : "delivery",
          paymentMethodFinal,
          JSON.stringify(resolvedItems),
          resolvedTotal,
          notesFinal,
          deviceId || null,
          paymentStatus,
          pickupNumber,
          pricing.cashPct,
          pricing.cashDiscount,
          trackToken,
          ...volumeParams,
          ...zoneParams,
          ...shipParams,
          ...windowParams,
          ...previewParams,
          ...giftcardParams,
          ...deadlineParams,
          ...cashAmountParams,
          ...weightParams,
        ]
      );
      orderId = rows[0]?.id;

      // Kardex: lo reservado por la venta. En pruebas no se descuenta stock.
      if (orderId && !isPreview) {
        for (const m of movedStock) {
          await logStockMovement(tx, {
            vendorId,
            product_id: m.product_id,
            variant_id: m.variant_id,
            qty_delta: -m.qty,
            reason: "venta",
            ref_order: orderId,
          });
        }
      }

      if (!isPreview && customerPhoneE164 && !customerPhoneE164.startsWith("lid:")) {
        await upsertCustomerFromOrder(tx, vendorId, {
          phone: customerPhoneE164,
          name: customerName,
          address: customerAddress || null,
          total: resolvedTotal,
        });
      }

      const vendor = await tx.queryOne<{ user_id: string }>(
        `SELECT user_id FROM vendors WHERE id = $1 LIMIT 1`,
        [vendorId]
      );

      if (vendor?.user_id) {
        const paymentLabel =
          paymentMethod === "efectivo" ? "💵 Efectivo" : paymentMethod === "transferencia" ? "🏦 Transferencia" : "📱 Coordinar";
        const abonaLabel =
          paymentMethod === "efectivo" && cashAmountFinal
            ? ` · abona $${cashAmountFinal.toLocaleString("es-AR")} (vuelto $${Math.max(0, Math.round((cashAmountFinal - resolvedTotal) * 100) / 100).toLocaleString("es-AR")})`
            : "";
        await tx.queryVoid(
          `INSERT INTO notifications (user_id, title, body, type, link) VALUES ($1, $2, $3, $4, $5)`,
          [
            vendor.user_id,
            "Nuevo pedido recibido",
            `${isPreview ? "🧪 [PRUEBA] " : ""}${resolvedWeightPending ? "⚖️ Pendiente de peso · " : ""}Nro. ${pickupNumber} · ${customerName} hizo un pedido de ${resolvedItemsCount} producto${resolvedItemsCount > 1 ? "s" : ""} por $${resolvedTotal.toLocaleString("es-AR")} · ${paymentLabel}${abonaLabel}`,
            "order",
            "/vendor/dashboard",
          ]
        );
      }
    });
  } catch (e) {
    if (e instanceof OutOfStockError) throw e;
    if (e instanceof PricingError) throw e;
    throw e;
  }

  if (!orderId) {
    throw new Error("Error al crear el pedido");
  }

  const vendor = await queryOne<{ user_id: string; store_name: string }>(
    `SELECT user_id, store_name FROM vendors WHERE id = $1 LIMIT 1`,
    [vendorId]
  );

  if (vendor?.user_id) {
    // Push al dueño (en todo pedido nuevo): el comercio no depende de que el
    // cliente mande el WhatsApp. Campañita "paymentLabel" e itemsCount igual
    // que la notificación in-app de la tx.
    const paymentLabel =
      paymentMethodFinal === "efectivo"
        ? "💵 Efectivo"
        : paymentMethodFinal === "transferencia"
          ? "🏦 Transferencia"
          : "📱 Coordinar";
    const abonaLabel =
      paymentMethodFinal === "efectivo" && cashAmountFinal
        ? ` · abona $${cashAmountFinal.toLocaleString("es-AR")} (vuelto $${Math.max(0, Math.round((cashAmountFinal - resolvedTotal) * 100) / 100).toLocaleString("es-AR")})`
        : "";
    void sendPushToUser(vendor.user_id, {
      title: `${isPreview ? "🧪 " : resolvedWeightPending ? "⚖️ " : "🛎️ "}Pedido nuevo #${pickupNumber} · $${resolvedTotal.toLocaleString("es-AR")}`,
      body: `${customerName} · ${resolvedItemsCount} producto${resolvedItemsCount !== 1 ? "s" : ""} · ${paymentLabel}${abonaLabel}${resolvedWeightPending ? " · pesá y confirmá el total real" : ""}`,
      link: "/vendor/dashboard",
      // Tag único por pedido: no colapsa con otros y renotify hace que
      // cada pedido suene/vibre aunque haya notificaciones visibles.
      // requireInteraction: queda fija hasta tocarla (celu bloqueado).
      tag: `new-order-${orderId}`,
      renotify: true,
      requireInteraction: true,
      urgency: "high",
      ttl: 86400,
    }).catch(() => {});

    const userProfile = await queryOne<{ email: string }>(
      `SELECT email FROM profiles WHERE id = $1 LIMIT 1`,
      [vendor.user_id]
    );
    if (!isPreview && userProfile?.email) {
      const emailContent = newOrderVendorEmail({
        storeName: vendor.store_name,
        orderNumber: pickupNumber,
        customerName,
        customerPhone: customerPhoneE164,
        paymentLabel,
        items: resolvedItems,
        total: resolvedTotal,
        method: method || null,
        address: customerAddress,
        deliveryWindow: resolvedWindow ? formatDeliveryWindow(resolvedWindow) : null,
        deliveryCoordinar: deliveryCfg.deliveryCoordinar === true,
        giftcard: giftcardApplied > 0 ? { code: giftcardCodeFinal, discount: giftcardApplied } : null,
      });
      Promise.resolve()
        .then(() => sendEmail({ to: userProfile.email, ...emailContent }))
        .catch(() => {});
    }
  }

  return { orderId, total: resolvedTotal, items: resolvedItems, pickupNumber, cashDiscount: resolvedCashDiscount, cashPct: resolvedCashPct, volumeDiscount: resolvedVolumeDiscount, volumeApplied: resolvedVolumeApplied, trackToken, deliveryFee: resolvedDeliveryFee, deliveryZoneName: resolvedZoneName, deliveryOutOfArea: resolvedOutOfArea, shippingZoneName: resolvedShipName, deliveryWindow: resolvedWindow, giftcard_discount: giftcardApplied, weightPending: resolvedWeightPending, weightTolerancePct };
}
