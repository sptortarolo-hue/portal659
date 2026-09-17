import { queryMany, queryOne, withTransaction } from "@/lib/db";
import { sendEmail, orderConfirmationEmail } from "@/lib/email";
import { resolveVendorPlan } from "@/lib/plans";
import { adjustStockForItems, OutOfStockError } from "@/lib/stock";
import { isStoreOpen } from "@/lib/open-hours";
import { PricingError, resolveOrderPricing, IncomingOrderItem } from "@/lib/pricing";
import { nextOrderNumber } from "@/lib/order-number";
import { toE164 } from "@/lib/phone";
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
    method,
    paymentMethod,
    customerId,
    items,
    notes,
    deviceId,
    source,
  } = input;

  if (!vendorId || !customerName || !customerPhone || !items) {
    throw new Error("Faltan datos requeridos");
  }

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

  const paymentMethodNorm = paymentMethod || "whatsapp";
  const notesFinal =
    source === "wa-bot" && notes ? `[Bot WA] ${notes}` : source === "wa-bot" ? "[Bot WA]" : notes || null;

  const vendorRow = await queryOne<Record<string, unknown>>(
    `SELECT vertical, plan_id, plan_status, plan_expires_at, trial_ends_at, hours, open_override, delivery_fee, free_delivery_min, cash_discount_pct FROM vendors WHERE id = $1 LIMIT 1`,
    [vendorId]
  );

  if (vendorRow) {
    const planRows = await queryMany<Record<string, unknown>>(`SELECT * FROM plans`);
    const plan = resolveVendorPlan(vendorRow as any, planRows as any);
    if (!plan.can("cart")) {
      throw new OrderForbiddenError(
        "Este comercio no acepta pedidos online por ahora. Consultalo directamente por WhatsApp."
      );
    }

    const openNow = isStoreOpen(vendorRow as any);
    if (openNow === false) {
      throw new StoreClosedError(
        "El comercio está cerrado en este momento. Probá cuando abra o escribile por WhatsApp."
      );
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

  // Tolerante a migración de volumen sin aplicar: si la columna no existe,
  // el pedido se guarda igual (sin columna de descuento por volumen).
  const volumeCol = await queryOne<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_name = 'orders' AND column_name = 'volume_discount'
     ) AS exists`
  );
  const hasVolumeCol = volumeCol?.exists === true;

  try {
    await withTransaction(async (tx) => {
      const paymentStatus = paymentMethodNorm === "transferencia" ? "pending" : "paid";
      const isPickup = method === "pickup";

      const pricing = await resolveOrderPricing({
        tx,
        vendorId,
        items,
        method: isPickup ? "pickup" : "delivery",
        deliveryFee: (vendorRow as any)?.delivery_fee,
        freeDeliveryMin: (vendorRow as any)?.free_delivery_min,
        // Descuento en efectivo: corre con la misma fórmula que el checkout
        // muestra en pantalla (antes no se aplicaba server-side: el cliente
        // veía un precio y el pedido guardaba otro).
        paymentMethod: paymentMethodNorm,
        cashDiscountPct: (vendorRow as any)?.cash_discount_pct,
      });
      resolvedItems = pricing.items;
      resolvedTotal = pricing.total;
      resolvedItemsCount = pricing.items.reduce((s, i) => s + i.qty, 0);
      resolvedCashDiscount = pricing.cashDiscount;
      resolvedCashPct = pricing.cashPct;
      resolvedVolumeDiscount = pricing.volumeDiscount;
      resolvedVolumeApplied = pricing.volumeApplied;

      await adjustStockForItems(tx, resolvedItems, "decrement");

      pickupNumber = await nextOrderNumber(tx, vendorId);

      const volumeCols = hasVolumeCol ? ", volume_discount" : "";
      const volumeVals = hasVolumeCol ? ", $16" : "";
      const volumeParams: unknown[] = hasVolumeCol ? [pricing.volumeDiscount] : [];
      const rows = await tx.query<{ id: string }>(
        `INSERT INTO orders (vendor_id, customer_id, customer_name, customer_phone, customer_address, method, payment_method, items, total, status, notes, device_id, payment_status, pickup_number, cash_pct, cash_discount${volumeCols})
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'new', $10, $11, $12, $13, $14, $15${volumeVals})
         RETURNING id`,
        [
          vendorId,
          customerId || null,
          customerName,
          customerPhoneE164,
          customerAddress || null,
          isPickup ? "pickup" : "delivery",
          paymentMethodNorm,
          JSON.stringify(resolvedItems),
          resolvedTotal,
          notesFinal,
          deviceId || null,
          paymentStatus,
          pickupNumber,
          pricing.cashPct,
          pricing.cashDiscount,
          ...volumeParams,
        ]
      );
      orderId = rows[0]?.id;

      const vendor = await tx.queryOne<{ user_id: string }>(
        `SELECT user_id FROM vendors WHERE id = $1 LIMIT 1`,
        [vendorId]
      );

      if (vendor?.user_id) {
        const paymentLabel =
          paymentMethod === "efectivo" ? "💵 Efectivo" : paymentMethod === "transferencia" ? "🏦 Transferencia" : "📱 Coordinar";
        await tx.queryVoid(
          `INSERT INTO notifications (user_id, title, body, type, link) VALUES ($1, $2, $3, $4, $5)`,
          [
            vendor.user_id,
            "Nuevo pedido recibido",
            `Nro. ${pickupNumber} · ${customerName} hizo un pedido de ${resolvedItemsCount} producto${resolvedItemsCount > 1 ? "s" : ""} por $${resolvedTotal.toLocaleString("es-AR")} · ${paymentLabel}`,
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
    const userProfile = await queryOne<{ email: string }>(
      `SELECT email FROM profiles WHERE id = $1 LIMIT 1`,
      [vendor.user_id]
    );
    if (userProfile?.email) {
      const emailContent = orderConfirmationEmail(vendor.store_name, resolvedItems as any, resolvedTotal);
      Promise.resolve()
        .then(() => sendEmail({ to: userProfile.email, ...emailContent }))
        .catch(() => {});
    }
  }

  return { orderId, total: resolvedTotal, items: resolvedItems, pickupNumber, cashDiscount: resolvedCashDiscount, cashPct: resolvedCashPct, volumeDiscount: resolvedVolumeDiscount, volumeApplied: resolvedVolumeApplied };
}