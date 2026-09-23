import { queryMany, queryOne, type Tx } from "./db";

/**
 * Idempotencia del sync offline (Fase 0 servidor).
 *
 * El cliente genera un UUID por acción (`client_key`) y lo manda con el
 * request. Un reintento tras un timeout devuelve el resultado guardado con
 * `dedup: true` en vez de re-ejecutar (sin esto, el sync duplicaría ventas
 * y descontaría stock dos veces).
 *
 * Tolerante a migración sin aplicar: si las columnas/tabla
 * (`migrate-offline-sync.sql`) no existen, todo se comporta como antes
 * (sin idempotencia, sin `occurred_at`).
 */

export type SyncAction = "pos_order" | "consumicion" | "table_close";

type Caps = {
  ordersClientKey: boolean;
  ordersOccurredAt: boolean;
  syncTable: boolean;
};

let capsCache: Caps | null = null;

/** Capacidades reales de la DB (columnas/tabla de la migración offline). */
export async function getOfflineSyncCaps(): Promise<Caps> {
  if (capsCache) return capsCache;
  const fallback: Caps = { ordersClientKey: false, ordersOccurredAt: false, syncTable: false };
  try {
    const rows = await queryMany<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'orders' AND column_name IN ('client_key', 'occurred_at')`
    );
    const cols = new Set((rows || []).map((r) => r.column_name));
    let syncTable = false;
    try {
      const t = await queryOne<{ exists: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sync_idempotency') AS exists`
      );
      syncTable = t?.exists === true;
    } catch {
      syncTable = false;
    }
    capsCache = {
      ordersClientKey: cols.has("client_key"),
      ordersOccurredAt: cols.has("occurred_at"),
      syncTable,
    };
    return capsCache;
  } catch {
    return fallback;
  }
}

/** Solo tests: invalida el caché de capacidades. */
export function resetOfflineSyncCapsCache(): void {
  capsCache = null;
}

/** Busca un pedido por (vendor, client_key). Solo llamar con caps ok. */
export async function findOrderByClientKey(
  vendorId: string,
  clientKey: string
): Promise<Record<string, unknown> | undefined> {
  return queryOne<Record<string, unknown>>(
    `SELECT * FROM orders WHERE vendor_id = $1 AND client_key = $2 LIMIT 1`,
    [vendorId, clientKey]
  );
}

/**
 * Valida la hora real enviada por el cliente (`occurred_at`).
 * Devuelve ISO o null (null = el servidor usa now()). Se rechazan fechas
 * absurdas (más de 1h en el futuro o más de 60 días atrás: reloj roto).
 */
export function parseOccurredAt(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const ms = new Date(raw).getTime();
  if (!Number.isFinite(ms)) return null;
  const now = Date.now();
  if (ms > now + 60 * 60 * 1000) return null;
  if (ms < now - 60 * 24 * 60 * 60 * 1000) return null;
  return new Date(ms).toISOString();
}

export type SyncClaim =
  | { fresh: true }
  | { fresh: false; inProgress: boolean; orderId: string | null; result: Record<string, unknown> | null };

/**
 * Reserva atómica de una clave de idempotencia para acciones SIN pedido
 * propio (consumición mergeada, cierre de mesa). Debe correrse DENTRO de
 * una transacción: si la clave ya existe, el llamador devuelve el resultado
 * guardado (o 409 `sync_in_progress` si el dueño aún no terminó).
 */
export async function claimSyncKey(
  tx: Tx,
  vendorId: string,
  clientKey: string,
  action: SyncAction
): Promise<SyncClaim> {
  const inserted = await tx.query<{ vendor_id: string }>(
    `INSERT INTO sync_idempotency (vendor_id, client_key, action)
     VALUES ($1, $2, $3)
     ON CONFLICT (vendor_id, client_key) DO NOTHING
     RETURNING vendor_id`,
    [vendorId, clientKey, action]
  );
  if (inserted.length > 0) return { fresh: true };
  const existing = await tx.queryOne<{ order_id: string | null; result: Record<string, unknown> | null }>(
    `SELECT order_id, result FROM sync_idempotency WHERE vendor_id = $1 AND client_key = $2 LIMIT 1`,
    [vendorId, clientKey]
  );
  if (!existing || existing.result == null) {
    return { fresh: false, inProgress: true, orderId: null, result: null };
  }
  return { fresh: false, inProgress: false, orderId: existing.order_id, result: existing.result };
}

/** Guarda el resultado de una acción (para futuros reintentos). */
export async function storeSyncResult(
  tx: Tx,
  vendorId: string,
  clientKey: string,
  orderId: string | null,
  result: Record<string, unknown>
): Promise<void> {
  await tx.queryVoid(
    `UPDATE sync_idempotency SET order_id = $3, result = $4 WHERE vendor_id = $1 AND client_key = $2`,
    [vendorId, clientKey, orderId, JSON.stringify(result)]
  );
}

/** Libera una reserva (validación fallida: el reintento corregido puede pasar). */
export async function releaseSyncKey(tx: Tx, vendorId: string, clientKey: string): Promise<void> {
  await tx.queryVoid(`DELETE FROM sync_idempotency WHERE vendor_id = $1 AND client_key = $2`, [
    vendorId,
    clientKey,
  ]);
}

/**
 * Verifica que una lista de client_keys ya esté sincronizada (existe en
 * sync_idempotency con resultado, o como orders.client_key). Para el gate
 * `expected_keys` del cierre de mesa: si falta alguna, el close responde
 * 409 `sync_pending` y el cliente sincroniza esas acciones primero.
 */
export async function findMissingSyncKeys(
  vendorId: string,
  keys: string[]
): Promise<string[]> {
  if (keys.length === 0) return [];
  const have = new Set<string>();
  try {
    const srows = await queryMany<{ client_key: string }>(
      `SELECT client_key FROM sync_idempotency
        WHERE vendor_id = $1 AND client_key = ANY($2) AND result IS NOT NULL`,
      [vendorId, keys]
    );
    for (const r of srows || []) have.add(r.client_key);
  } catch {
    /* tabla sin migrar: se sigue con orders */
  }
  const rest = keys.filter((k) => !have.has(k));
  if (rest.length === 0) return [];
  try {
    const orows = await queryMany<{ client_key: string }>(
      `SELECT client_key FROM orders WHERE vendor_id = $1 AND client_key = ANY($2)`,
      [vendorId, rest]
    );
    for (const r of orows || []) have.add(r.client_key);
  } catch {
    /* columna sin migrar: todo lo restante se considera pendiente */
  }
  return keys.filter((k) => !have.has(k));
}

/** Normaliza una client_key del body: string no vacío o null. */
export function normalizeClientKey(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const k = raw.trim().slice(0, 64);
  return k ? k : null;
}
