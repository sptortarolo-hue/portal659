import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryOne, withTransaction } from "@/lib/db";
import { nextOrderNumber } from "@/lib/order-number";
import {
  resolveOrderPricing,
  PricingError,
  type IncomingOrderItem,
} from "@/lib/pricing";
import {
  claimSyncKey,
  getOfflineSyncCaps,
  normalizeClientKey,
  parseOccurredAt,
  releaseSyncKey,
  storeSyncResult,
} from "@/lib/sync-idempotency";
import { NextResponse } from "next/server";

const PAYMENT_METHODS = ["efectivo", "transferencia", "tarjeta", "mixto", "whatsapp"] as const;
type PaymentMethod = (typeof PAYMENT_METHODS)[number];

type MesaOrder = {
  id: string;
  items: { name: string; price: number; qty: number; modifiers?: string[]; requires_prep?: boolean; product_id?: string }[];
  total: number;
};

type TxOut =
  | { ok: false; status: number; error: string }
  | { ok: true; order: Record<string, any>; table: Record<string, any> }
  | { inProgress: true }
  | { replayOrderId: string };

export async function POST(request: Request) {
  const gate = await gateRequest(request, { allowStaff: true });
  if (!gate.ok) return gateError(gate);

  if (!gate.plan.can("mesas")) {
    return NextResponse.json(
      { error: "Las mesas forman parte del plan Gestión integral" },
      { status: 403 }
    );
  }
  // vendorId capturado: el narrowing del gate no entra a funciones anidadas.
  const vendorId = gate.vendor.id;

  const body = await request.json();
  const { tableId, items, total, paymentMethod, notes } = body;

  if (!tableId) return NextResponse.json({ error: "Falta la mesa" }, { status: 400 });
  if (!items || !Array.isArray(items) || items.length === 0 || !total) {
    return NextResponse.json({ error: "Faltan productos o total" }, { status: 400 });
  }

  // Idempotencia del sync offline (Fase 0): la consumición mergea en la
  // cuenta abierta, así que un reintento sin clave duplicaría ítems. Con
  // client_key el reintento devuelve la cuenta ya guardada (dedup:true).
  const caps = await getOfflineSyncCaps();
  const clientKey = caps.syncTable ? normalizeClientKey(body?.client_key) : null;
  const occurredAt = caps.ordersOccurredAt
    ? parseOccurredAt(body?.occurred_at) ?? new Date().toISOString()
    : null;

  const out = await withTransaction(async (tx): Promise<TxOut> => {
    if (clientKey) {
      const claim = await claimSyncKey(tx, gate.vendor.id, clientKey, "consumicion");
      if (!claim.fresh) {
        if (claim.inProgress || !claim.orderId) return { inProgress: true };
        return { replayOrderId: claim.orderId };
      }
    }
    const fail = async (status: number, error: string): Promise<TxOut> => {
      if (clientKey) await releaseSyncKey(tx, gate.vendor.id, clientKey);
      return { ok: false, status, error };
    };

    const table = await tx.queryOne<Record<string, any>>(
      `SELECT id, name, status FROM tables WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
      [tableId, gate.vendor.id]
    );
    if (!table) return fail(404, "Mesa no encontrada");

    // Bloqueo por ventana de turno (estilo Fudo): la mesa solo se bloquea
    // dentro de [reserved_at - lead, reserved_at + tolerancia]. Fuera de la
    // ventana opera normal aunque tenga reservas futuras.
    let blockedByReservation = table.status === "reservada";
    try {
      const cfg = await tx.queryOne<{ lead: number | null; tolerance: number | null }>(
        `SELECT reservation_lead_min AS lead, reservation_tolerance_min AS tolerance
         FROM vendors WHERE id = $1 LIMIT 1`,
        [gate.vendor.id]
      );
      const lead = Math.max(0, Math.min(180, Math.round(Number(cfg?.lead) || 15)));
      const tol = Math.max(0, Math.min(180, Math.round(Number(cfg?.tolerance) || 15)));
      const hit = await tx.queryOne<{ id: string }>(
        `SELECT id FROM reservations
         WHERE vendor_id = $1 AND table_id = $2 AND status = 'pendiente'
           AND reserved_at <= NOW() + ($3 || ' minutes')::interval
           AND reserved_at >= NOW() - ($4 || ' minutes')::interval
         LIMIT 1`,
        [gate.vendor.id, table.id, String(lead), String(tol)]
      );
      blockedByReservation = !!hit;
    } catch {
      // Migración de reservas pendiente: se conserva el bloqueo por estado.
    }
    if (blockedByReservation) {
      return fail(409, "Mesa reservada en este turno: sentá o cancelá la reserva antes de cargar");
    }

    // Si la mesa está libre, se abre automáticamente al cargar la primera consumición
    if (table.status !== "ocupada") {
      await tx.queryVoid(`UPDATE tables SET status = 'ocupada' WHERE id = $1`, [table.id]);
    }

    const payment = (PAYMENT_METHODS as readonly string[]).includes(paymentMethod)
      ? (paymentMethod as PaymentMethod)
      : "efectivo";

    const normalizedItems: { product_id?: any; name: any; price: number; qty: number; modifiers?: any; requires_prep: boolean; manual?: boolean }[] = items.map((i: any) => ({
      product_id: i.product_id || undefined,
      name: i.name,
      price: Number(i.price),
      qty: Number(i.qty) || 1,
      modifiers: Array.isArray(i.modifiers) && i.modifiers.length > 0 ? i.modifiers : undefined,
      requires_prep: i.requires_prep !== false,
      manual: i.manual === true ? true : undefined,
    }));

    // Precios (fuente de verdad): la cuenta de la mesa se resuelve con la
    // misma regla que el canal app (precios de DB + volumen). Así los
    // combinados por pack aplican también en mesa, incluso sumando varias
    // consumiciones. Líneas manuales o sin uuid van al precio declarado.
    const isUuid = (s: unknown): s is string =>
      typeof s === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
    const round2 = (n: number) => Math.round(n * 100) / 100;
    async function resolveTableItems(raw: typeof normalizedItems): Promise<{ items: Record<string, any>[]; total: number; volumeDiscount: number }> {
      const priced: IncomingOrderItem[] = [];
      const pricedPrep: boolean[] = [];
      const passthrough: typeof normalizedItems = [];
      for (const i of raw) {
        if (i.manual === true || !isUuid(i.product_id)) {
          passthrough.push(i);
          continue;
        }
        priced.push({ offerId: i.product_id as string, qty: i.qty, modifiers: i.modifiers });
        pricedPrep.push(i.requires_prep !== false);
      }
      const manualTotal = round2(passthrough.reduce((s, i) => s + (Number(i.price) || 0) * (Number(i.qty) || 1), 0));
      if (priced.length === 0) {
        return { items: passthrough as unknown as Record<string, any>[], total: manualTotal, volumeDiscount: 0 };
      }
      let pricing;
      try {
        pricing = await resolveOrderPricing({
          tx,
          vendorId,
          items: priced,
          method: "pickup",
          paymentMethod: null,
          cashDiscountPct: null,
        });
      } catch (e) {
        if (e instanceof PricingError) return fail(400, e.message) as never;
        throw e;
      }
      pricing.items.forEach((it, idx) => {
        (it as any).requires_prep = pricedPrep[idx] !== false;
      });
      return {
        items: [...(pricing.items as unknown as Record<string, any>[]), ...passthrough] as Record<string, any>[],
        total: round2(pricing.total + manualTotal),
        volumeDiscount: pricing.volumeDiscount,
      };
    }

    // Columna de volumen (tolerante a migración sin aplicar).
    let hasVolumeCol = false;
    try {
      const vc = await tx.queryOne<{ exists: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_name = 'orders' AND column_name = 'volume_discount'
         ) AS exists`
      );
      hasVolumeCol = vc?.exists === true;
    } catch {
      hasVolumeCol = false;
    }

    // Acumular en la cuenta abierta de la mesa: si ya existe una orden "new"
    // (pedido de mesa sin cerrar), le sumamos ítems y total (una sola cuenta en
    // vez de un pedido suelto por cada "Agregar consumición").
    const openOrder = await tx.queryOne<MesaOrder>(
      `SELECT id, items, total FROM orders
       WHERE vendor_id = $1 AND table_id = $2 AND channel = 'mesa' AND status = 'new'
       ORDER BY created_at ASC LIMIT 1`,
      [gate.vendor.id, table.id]
    );

    if (openOrder) {
      const existing = Array.isArray(openOrder.items) ? (openOrder.items as any[]) : [];
      const mergedRaw = [...existing, ...normalizedItems] as typeof normalizedItems;
      const resolved = await resolveTableItems(mergedRaw);
      const order = await tx.queryOne<Record<string, any>>(
        hasVolumeCol
          ? `UPDATE orders SET items = $1, total = $2, volume_discount = $3 WHERE id = $4 RETURNING *`
          : `UPDATE orders SET items = $1, total = $2 WHERE id = $3 RETURNING *`,
        hasVolumeCol
          ? [JSON.stringify(resolved.items), resolved.total, resolved.volumeDiscount, openOrder.id]
          : [JSON.stringify(resolved.items), resolved.total, openOrder.id]
      );
      // La cuenta abierta conserva su occurred_at original (momento en que
      // se abrió la mesa); la consumición queda registrada en el sync log.
      if (clientKey && order) {
        await storeSyncResult(tx, gate.vendor.id, clientKey, order.id as string, {
          orderId: order.id,
          tableId: table.id,
          merged: true,
        });
      }
      return { ok: true, order: order ?? {}, table };
    }

    // En sesión de prueba todo nace marcado como prueba.
    const previewOrder = gate.previewSession === true;
    const resolved = await resolveTableItems(normalizedItems);
    const syncCols = [
      ...(caps.ordersClientKey ? ["client_key"] : []),
      ...(caps.ordersOccurredAt ? ["occurred_at"] : []),
    ];
    const cols = [
      "vendor_id", "customer_name", "customer_phone", "customer_address",
      "method", "payment_method", "items", "total", "status", "channel",
      "table_id", "notes", "pickup_number", "is_preview",
      ...(hasVolumeCol ? ["volume_discount"] : []),
      ...syncCols,
    ];
    const vals: unknown[] = [
      gate.vendor.id,
      table.name,
      gate.vendor.whatsapp || "",
      null,
      "pickup",
      payment,
      JSON.stringify(resolved.items),
      resolved.total,
      "new",
      "mesa",
      table.id,
      notes || null,
      // Número universal de pedido diario (mesas también lo producen).
      await nextOrderNumber(tx, gate.vendor.id),
      previewOrder,
      ...(hasVolumeCol ? [resolved.volumeDiscount] : []),
      ...(caps.ordersClientKey ? [clientKey] : []),
      ...(caps.ordersOccurredAt ? [occurredAt] : []),
    ];
    const order = await tx.queryOne<Record<string, any>>(
      `INSERT INTO orders (${cols.join(", ")}) VALUES (${vals.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING *`,
      vals
    );
    if (clientKey && order) {
      await storeSyncResult(tx, gate.vendor.id, clientKey, order.id as string, {
        orderId: order.id,
        tableId: table.id,
        merged: false,
      });
    }
    return { ok: true, order: order ?? {}, table };
  });

  if ("inProgress" in out) {
    return NextResponse.json(
      { error: "Sincronización en curso, reintentá en unos segundos", code: "sync_in_progress" },
      { status: 409 }
    );
  }
  if ("replayOrderId" in out) {
    const order = await queryOne<Record<string, any>>(
      `SELECT * FROM orders WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
      [out.replayOrderId, gate.vendor.id]
    );
    if (!order) {
      return NextResponse.json({ error: "Pedido no encontrado" }, { status: 404 });
    }
    const table = await queryOne<Record<string, any>>(
      `SELECT id, name, status FROM tables WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
      [(order.table_id as string) ?? tableId, gate.vendor.id]
    );
    return NextResponse.json({ ok: true, orderId: order.id, order, table, dedup: true });
  }
  if (!out.ok) {
    return NextResponse.json({ error: out.error }, { status: out.status });
  }
  return NextResponse.json({ ok: true, orderId: out.order?.id, order: out.order, table: out.table });
}
