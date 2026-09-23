"use client";

/**
 * Sync engine offline (Track Ventas F3).
 *
 * Drena el outbox en FIFO por vendor al reconectar:
 * - Cada acción viaja con su `client_key`: el servidor la ejecuta una sola
 *   vez (Fase 0). Reintento = `dedup:true`, nunca duplicado.
 * - Dependencias: una acción con `__afterLocalId` espera a que la acción
 *   madre esté mapeada (localId → orderId real).
 * - 401 → se frena y se preserva todo (re-login); 409 stock/validación →
 *   se marca con lastError (visible en badge/banner, viewer en F4);
 *   409 sync_pending → se reintenta más tarde; red caída → se frena.
 * - Al terminar emite `portal:sync-completed` con mappings para que
 *   Mostrador/Mesas actualicen su UI optimista.
 */
import {
  emitOutboxChanged,
  idmapGet,
  idmapSet,
  outboxList,
  outboxRemove,
  outboxUpdate,
  purgeDeadOutbox,
  OUTBOX_MAX_ATTEMPTS,
  type OutboxAction,
  type SyncedRef,
} from "./offline-db";

export type SyncSummary = {
  synced: number;
  failed: number;
  dead: number;
  pending: number;
  authError: boolean;
  offline: boolean;
  mappings: Record<string, SyncedRef & { order?: Record<string, any> }>;
  errors: string[];
};

export const SYNC_COMPLETED_EVENT = "portal:sync-completed";
const running = new Set<string>();

type FetchResult = { status: number; data: any };

async function postJSON(url: string, body: Record<string, any>): Promise<FetchResult> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function patchJSON(url: string, body: Record<string, any>): Promise<FetchResult> {
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function serverOrderRef(data: any): (SyncedRef & { order?: Record<string, any> }) | null {
  const order = data?.order as Record<string, any> | undefined;
  const orderId = (data?.orderId as string | undefined) ?? (order?.id as string | undefined);
  if (!orderId) return null;
  return {
    orderId,
    pickup_number: (order?.pickup_number as number | null | undefined) ?? null,
    total: order?.total != null ? Number(order.total) : null,
    order,
  };
}

/** Resuelve el orderId servidor para PATCHs (id directo o vía dependencia). */
async function resolveOrderId(
  vendorId: string,
  a: OutboxAction
): Promise<{ orderId?: string; blocked?: boolean }> {
  const direct = (a.payload.orderId as string | undefined) || undefined;
  if (direct) return { orderId: direct };
  const after = (a.payload as any).__afterLocalId as string | undefined;
  if (!after) return {};
  const map = await idmapGet(vendorId);
  const ref = map[after];
  if (!ref) return { blocked: true };
  return { orderId: ref.orderId };
}

async function processAction(
  vendorId: string,
  a: OutboxAction
): Promise<
  | { done: true; ref?: SyncedRef & { order?: Record<string, any> }; orderId?: string }
  | { done: false; blocked?: boolean; retry?: boolean; dead?: string; auth?: boolean }
> {
  const p = a.payload;
  try {
    if (a.type === "pos_order") {
      const r = await postJSON("/api/vendor/pos/order", p);
      if (r.status === 401) return { done: false, auth: true };
      if (r.status === 409 && String(r.data?.error || "").includes("Sin stock")) {
        return { done: false, dead: String(r.data.error) };
      }
      if (r.status >= 200 && r.status < 300 && r.data?.ok) {
        return { done: true, ref: serverOrderRef(r.data) ?? undefined };
      }
      if (r.status >= 500) return { done: false, retry: true };
      return { done: false, dead: String(r.data?.error || `Error ${r.status}`) };
    }

    if (a.type === "consumicion") {
      const r = await postJSON("/api/vendor/pos/consumicion", p);
      if (r.status === 401) return { done: false, auth: true };
      if (r.status === 409 && String(r.data?.error || "").includes("Sin stock")) {
        return { done: false, dead: String(r.data.error) };
      }
      if (r.status >= 200 && r.status < 300 && r.data?.ok) {
        return { done: true, ref: serverOrderRef(r.data) ?? undefined };
      }
      if (r.status >= 500) return { done: false, retry: true };
      return { done: false, dead: String(r.data?.error || `Error ${r.status}`) };
    }

    if (a.type === "table_close") {
      const tableId = String(p.tableId || "");
      if (!tableId) return { done: false, dead: "Cierre sin mesa" };
      const r = await postJSON(`/api/vendor/tables/${tableId}/close`, {
        paymentMethod: p.paymentMethod,
        client_key: p.client_key,
        occurred_at: p.occurred_at,
        expected_keys: p.expected_keys,
      });
      if (r.status === 401) return { done: false, auth: true };
      // Faltan consumiciones por sincronizar: se reintenta más tarde (las
      // ADD van antes en FIFO, así que esto es red de seguridad).
      if (r.status === 409 && r.data?.code === "sync_pending") {
        return { done: false, retry: true };
      }
      if (r.status >= 200 && r.status < 300 && r.data?.ok) {
        return { done: true };
      }
      if (r.status >= 500) return { done: false, retry: true };
      return { done: false, dead: String(r.data?.error || `Error ${r.status}`) };
    }

    if (a.type === "order_status" || a.type === "order_cancel" || a.type === "mark_paid") {
      const { orderId, blocked } = await resolveOrderId(vendorId, a);
      if (blocked) return { done: false, blocked: true };
      if (!orderId) return { done: false, dead: "PATCH sin pedido" };
      const body: Record<string, any> =
        a.type === "order_status"
          ? { status: p.status }
          : a.type === "order_cancel"
            ? { status: "cancelled" }
            : { payment_status: "paid" };
      const r = await patchJSON(`/api/vendor/orders/${orderId}`, body);
      if (r.status === 401) return { done: false, auth: true };
      // Reintento ya aplicado (Fase 0 same-state) u OK normal.
      if ((r.status >= 200 && r.status < 300 && (r.data?.order || r.data?.dedup)) || r.data?.dedup) {
        const order = r.data?.order as Record<string, any> | undefined;
        return {
          done: true,
          orderId,
          ref: order ? { orderId, pickup_number: (order.pickup_number as number | null) ?? null, total: Number(order.total) || null, order } : undefined,
        };
      }
      if (r.status >= 500) return { done: false, retry: true };
      return { done: false, dead: String(r.data?.error || `Error ${r.status}`) };
    }

    return { done: false, dead: `Tipo desconocido: ${a.type}` };
  } catch (e) {
    // Caída de red a mitad del drenaje: se frena, lo pendiente queda.
    if (e instanceof TypeError || (typeof navigator !== "undefined" && !navigator.onLine)) {
      throw e;
    }
    return { done: false, retry: true };
  }
}

/**
 * Drena el outbox de un vendor. Seguro de llamar desde múltiples triggers
 * (guard anti-concurrencia por vendor).
 */
export async function syncOutbox(vendorId: string): Promise<SyncSummary> {
  const summary: SyncSummary = {
    synced: 0,
    failed: 0,
    dead: 0,
    pending: 0,
    authError: false,
    offline: false,
    mappings: {},
    errors: [],
  };
  if (!vendorId || running.has(vendorId)) {
    const rest = await outboxList(vendorId).catch(() => []);
    summary.pending = rest.length;
    return summary;
  }
  running.add(vendorId);
  try {
    // Higiene (F4): purga muertos de +30 días antes de drenar.
    try {
      await purgeDeadOutbox(vendorId);
    } catch {
      /* noop */
    }
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      summary.offline = true;
      summary.pending = (await outboxList(vendorId).catch(() => [])).length;
      return summary;
    }
    // Pasadas FIFO con resolución de dependencias: una acción bloqueada por
    // __afterLocalId se saltea en la pasada y se retoma cuando la madre mapea.
    // Orden causal estricto (head-of-line blocking): una acción no-procesable
    // frena la pasada para no aplicar efectos fuera de orden (ej. cerrar una
    // mesa antes de que entren sus consumiciones). Las ya-muertas (terminal)
    // se saltean sin reintentar.
    let stopped = false;
    for (let pass = 0; pass < 5 && !stopped; pass++) {
      const actions = (await outboxList(vendorId)).filter((a) => (a.attempts || 0) < OUTBOX_MAX_ATTEMPTS);
      if (actions.length === 0) break;
      let progressed = false;
      for (const a of actions) {
        if (a.id == null) continue;
        let res;
        try {
          res = await processAction(vendorId, a);
        } catch (e) {
          if (e instanceof TypeError || (typeof navigator !== "undefined" && !navigator.onLine)) {
            summary.offline = true;
            stopped = true;
            break;
          }
          throw e;
        }
        if (res.done) {
          if (a.localId) {
            if (res.ref) {
              await idmapSet(vendorId, a.localId, res.ref);
              summary.mappings[a.localId] = res.ref;
            } else if (res.orderId) {
              summary.mappings[a.localId] = { orderId: res.orderId };
            } else {
              summary.mappings[a.localId] = { orderId: "" };
            }
          }
          await outboxRemove(a.id);
          summary.synced++;
          progressed = true;
          emitOutboxChanged();
          continue;
        }
        if ((res as { blocked?: boolean }).blocked) continue;
        if ((res as { auth?: boolean }).auth) {
          // 401: sesión revocada/vencida. Se frena TODO y se preserva la
          // cola: al re-loguear como el mismo vendor se retoma.
          summary.authError = true;
          stopped = true;
          break;
        }
        if ((res as { dead?: string }).dead) {
          const msg = (res as { dead: string }).dead;
          await outboxUpdate(a.id, { attempts: OUTBOX_MAX_ATTEMPTS, lastError: msg });
          summary.dead++;
          summary.failed++;
          if (summary.errors.length < 3) summary.errors.push(msg);
          progressed = true;
          emitOutboxChanged();
          continue;
        }
        // Reintentable (409 sync_pending, 5xx, 403 plan): cuenta intento y
        // frena la pasada; el próximo trigger retoma. No suma a `failed`
        // (todavía puede sincronizar).
        const attempts = (a.attempts || 0) + 1;
        if (attempts >= OUTBOX_MAX_ATTEMPTS) {
          await outboxUpdate(a.id, { attempts, lastError: "Demasiados reintentos" });
          summary.dead++;
          summary.failed++;
          if (summary.errors.length < 3) summary.errors.push("Demasiados reintentos");
          progressed = true;
          emitOutboxChanged();
          continue;
        }
        await outboxUpdate(a.id, { attempts });
        break;
      }
      if (summary.offline || summary.authError) break;
      if (!progressed) break;
    }
    const rest = await outboxList(vendorId).catch(() => []);
    summary.pending = rest.length;
    if (summary.synced > 0 || summary.failed > 0 || summary.dead > 0) {
      try {
        window.dispatchEvent(
          new CustomEvent(SYNC_COMPLETED_EVENT, {
            detail: {
              mappings: summary.mappings,
              syncedLocalIds: Object.keys(summary.mappings),
              summary: { synced: summary.synced, failed: summary.failed, dead: summary.dead },
            },
          })
        );
      } catch {
        /* noop */
      }
    }
    return summary;
  } finally {
    running.delete(vendorId);
  }
}
