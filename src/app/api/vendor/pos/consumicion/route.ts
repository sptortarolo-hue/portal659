import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryOne, withTransaction } from "@/lib/db";
import { nextOrderNumber } from "@/lib/order-number";
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
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);

  if (!gate.plan.can("mesas")) {
    return NextResponse.json(
      { error: "Las mesas forman parte del plan Gestión integral" },
      { status: 403 }
    );
  }

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

    // Si la mesa está libre, se abre automáticamente al cargar la primera consumición
    if (table.status !== "ocupada") {
      await tx.queryVoid(`UPDATE tables SET status = 'ocupada' WHERE id = $1`, [table.id]);
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

    // Packs: validación de múltiplo + normalización a formato pack-native
    // (price = precio del paquete, pack_size presente — igual que canal app).
    {
      const pids = Array.from(new Set(normalizedItems.map((i) => i.product_id).filter(Boolean))) as string[];
      if (pids.length > 0) {
        try {
          const prows = await tx.query<{ id: string; name: string; pack_size: number | null }>(
            `SELECT id, name, pack_size FROM products WHERE vendor_id = $1 AND id = ANY($2)`,
            [gate.vendor.id, pids]
          );
          const ppack = new Map((prows || []).map((p) => [p.id, p]));
          for (let idx = 0; idx < normalizedItems.length; idx++) {
            const i = normalizedItems[idx];
            const pack = i.product_id ? Math.floor(Number(ppack.get(i.product_id)?.pack_size || 0)) : 0;
            if (pack >= 2) {
              if (i.qty % pack !== 0) {
                return fail(400, `"${i.name}" se vende de a ${pack} unidades`);
              }
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
      const mergedItems = [...existing, ...normalizedItems];
      const newTotal = Number(openOrder.total) + Number(total);
      const order = await tx.queryOne<Record<string, any>>(
        `UPDATE orders SET items = $1, total = $2 WHERE id = $3 RETURNING *`,
        [JSON.stringify(mergedItems), newTotal, openOrder.id]
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
    const syncCols = [
      ...(caps.ordersClientKey ? ["client_key"] : []),
      ...(caps.ordersOccurredAt ? ["occurred_at"] : []),
    ];
    const cols = [
      "vendor_id", "customer_name", "customer_phone", "customer_address",
      "method", "payment_method", "items", "total", "status", "channel",
      "table_id", "notes", "pickup_number", "is_preview",
      ...syncCols,
    ];
    const vals: unknown[] = [
      gate.vendor.id,
      table.name,
      gate.vendor.whatsapp || "",
      null,
      "pickup",
      payment,
      JSON.stringify(normalizedItems),
      Number(total),
      "new",
      "mesa",
      table.id,
      notes || null,
      // Número universal de pedido diario (mesas también lo producen).
      await nextOrderNumber(tx, gate.vendor.id),
      previewOrder,
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
