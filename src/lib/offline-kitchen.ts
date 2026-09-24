"use client";

/**
 * Circuito de cocina offline (F5).
 *
 * - `enqueueOrderPatch`: encola transiciones de estado/pago/cancelación para
 *   pedidos locales (id `local-…`) o sin red. El sync engine las aplica en
 *   orden con dependencia `__afterLocalId`; el servidor revalida.
 * - `getLocalKitchenOrders`: reconstruye los pedidos pendientes desde el
 *   outbox (replay FIFO: CREATEs + STATUS/CANCEL). Es lo que el KDS mergea
 *   con los pedidos del servidor. Sobrevive reload sin red (el outbox es IDB).
 *
 * Fuera de v1 (solo-online): tildado por ítem, conversión a delivery,
 * modificación de ítems.
 */
import {
  getTablesSnapshot,
  idmapGet,
  outboxList,
  type OutboxAction,
} from "./offline-db";
import { enqueueOfflineAction, newLocalId } from "./offline-actions";
import type { Order, OrderItem, OrderStatus } from "@/types/database";

export function isLocalOrderId(id: string | null | undefined): boolean {
  return typeof id === "string" && id.startsWith("local-");
}

export type PatchKind = "order_status" | "order_cancel" | "mark_paid";

/**
 * Encola un patch de pedido. Para pedidos locales referencia `afterLocalId`
 * (se aplica tras sincronizar el create); para pedidos del servidor sin red
 * lleva el `orderId` directo.
 */
export async function enqueueOrderPatch(opts: {
  vendorId: string;
  orderId: string;
  kind: PatchKind;
  status?: OrderStatus;
}): Promise<{ queued: boolean }> {
  const { vendorId, orderId, kind, status } = opts;
  const local = isLocalOrderId(orderId);
  const payload: Record<string, any> = kind === "order_status" ? { status } : {};
  if (local) {
    await enqueueOfflineAction({
      vendorId,
      scope: "orders",
      type: kind,
      payload,
      afterLocalId: orderId,
    });
  } else {
    await enqueueOfflineAction({
      vendorId,
      scope: "orders",
      type: kind,
      payload: { ...payload, orderId },
      localId: newLocalId(),
    });
  }
  return { queued: true };
}

function normalizeItems(raw: unknown): OrderItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((i: any) => ({
    product_id: typeof i?.product_id === "string" ? i.product_id : undefined,
    variant_id: typeof i?.variant_id === "string" ? i.variant_id : undefined,
    name: String(i?.name || ""),
    price: Number(i?.price) || 0,
    qty: Number(i?.qty) || 1,
    pack_size: Number.isFinite(Number(i?.pack_size)) ? Number(i.pack_size) : undefined,
    modifiers: Array.isArray(i?.modifiers)
      ? i.modifiers.map((m: any) => (typeof m === "string" ? m : String(m?.label || ""))).filter(Boolean)
      : undefined,
    requires_prep: i?.requires_prep !== false,
  }));
}

/**
 * Pedidos de cocina pendientes (para mergear en el KDS). Excluye los ya
 * sincronizados (están en el idmap: el servidor los devuelve).
 *
 * Semántica espejo del servidor:
 * - Mostrador: cada venta = un ticket (igual que online).
 * - Mesa: las consumiciones pendientes de la MISMA mesa se agrupan en UNA
 *   tarjeta (el servidor las mergea en la cuenta abierta). La dependencia
 *   de las transiciones apunta al primer ADD (el que crea la cuenta).
 * - Mesas con cierre offline pendiente no se muestran (la cocina terminó;
 *   el servidor las marca completed al sincronizar).
 */
export async function getLocalKitchenOrders(vendorId: string): Promise<Order[]> {
  let actions: OutboxAction[] = [];
  try {
    actions = await outboxList(vendorId);
  } catch {
    return [];
  }
  let idmap: Record<string, { orderId: string }> = {};
  try {
    idmap = await idmapGet(vendorId);
  } catch {
    /* sin mapeos: todo lo local sigue pendiente */
  }
  let tableNames = new Map<string, string>();
  try {
    const tab = await getTablesSnapshot(vendorId);
    tableNames = new Map((tab?.tables || []).map((t: any) => [String(t.id), String(t.name || "Mesa")]));
  } catch {
    /* sin snapshot de mesas */
  }

  const creates = actions.filter(
    (a) => (a.type === "pos_order" || a.type === "consumicion") && !!a.localId && !idmap[a.localId as string]
  );
  // Mesas ya cerradas offline: su cuenta sale del KDS (igual que completed).
  const closedTables = new Set(
    actions
      .filter((a) => a.type === "table_close")
      .map((a) => String((a.payload as Record<string, any>)?.tableId || ""))
      .filter(Boolean)
  );

  const buildView = (
    c: OutboxAction,
    extraItems: OrderItem[] = [],
    extraTotal = 0
  ): Order | null => {
    const localId = c.localId as string;
    const p = (c.payload || {}) as Record<string, any>;
    if (c.type === "consumicion" && closedTables.has(String(p.tableId || ""))) return null;
    const items = [...normalizeItems(p.items), ...extraItems];
    const needsKitchen = items.some((i) => i.requires_prep !== false);
    const isDelivery = p.method === "delivery";
    let status: OrderStatus =
      c.type === "consumicion" ? "new" : needsKitchen || isDelivery ? "preparing" : "new";
    // Fold en orden FIFO: el último STATUS/CANCEL que referencie a este
    // grupo (cualquiera de sus ADDs) gana.
    const groupIds = new Set<string>([localId, ...(((c as any).__groupIds as string[] | undefined) || [])]);
    for (const s of actions) {
      const sp = (s.payload || {}) as Record<string, any>;
      if (!sp.__afterLocalId || !groupIds.has(String(sp.__afterLocalId))) continue;
      if (s.type === "order_status" && typeof sp.status === "string") status = sp.status as OrderStatus;
      if (s.type === "order_cancel") status = "cancelled";
    }
    const createdAt = new Date(Number(c.createdAt) || Date.now()).toISOString();
    const tableId = typeof p.tableId === "string" ? p.tableId : null;
    return {
      id: localId,
      vendor_id: vendorId,
      customer_id: null,
      customer_name: String(
        p.customerName || (tableId ? tableNames.get(tableId) || "Mesa" : "") || "Mostrador"
      ),
      customer_phone: String(p.customerPhone || ""),
      customer_address: (p.customerAddress as string) ?? null,
      method: (isDelivery ? "delivery" : "pickup") as Order["method"],
      payment_method: (p.paymentMethod || "efectivo") as Order["payment_method"],
      items,
      total: (Number(p.total) || 0) + extraTotal,
      status,
      notes: (p.notes as string) ?? null,
      modification_notes: null,
      estimated_minutes: null,
      channel: (c.type === "consumicion" ? "mesa" : "mostrador") as Order["channel"],
      table_id: tableId,
      paid_at: createdAt,
      payment_status: "paid",
      pickup_number: null,
      pending: true,
      provisional: Number((p as any).__provisional) || null,
      created_at: createdAt,
      updated_at: createdAt,
    };
  };

  const out: Order[] = [];
  // Mostrador: un ticket por venta. Mesa: un ticket por mesa (agrupa ADDs).
  const mesaGroups = new Map<string, OutboxAction[]>();
  for (const c of creates) {
    if (c.type !== "consumicion") {
      const v = buildView(c);
      if (v) out.push(v);
      continue;
    }
    const tid = String((c.payload as Record<string, any>)?.tableId || "");
    if (!mesaGroups.has(tid)) mesaGroups.set(tid, []);
    mesaGroups.get(tid)!.push(c);
  }
  for (const [, group] of mesaGroups) {
    const [first, ...rest] = group;
    // Las transiciones de cualquier ADD del grupo aplican a la tarjeta:
    // se registran los ids del grupo para el fold.
    (first as any).__groupIds = group.map((g) => g.localId as string);
    const extraItems = rest.flatMap((g) => normalizeItems((g.payload as Record<string, any>)?.items));
    const extraTotal = rest.reduce((s, g) => s + (Number((g.payload as Record<string, any>)?.total) || 0), 0);
    const v = buildView(first, extraItems, extraTotal);
    if (v) out.push(v);
  }
  return out;
}
