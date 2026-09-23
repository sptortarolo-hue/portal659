"use client";

/**
 * Persistencia local para el modo offline vendor (Track Ventas F1).
 *
 * Wrapper mínimo sobre IndexedDB nativo (sin dependencias): la DB es por
 * ORIGEN (dominio), así que TODO va namespaced por vendorId
 * (`vendor:{id}:...`). Ver notas multi-usuario abajo.
 *
 * Stores:
 * - kv: snapshots de lectura (vendor, catálogo, mesas) + misceláneo.
 * - outbox: acciones pendientes de sincronizar (F2). Index by-vendor.
 * - prints: trabajos de impresión pendientes (track Impresión). Index by-vendor.
 *
 * Protección multi-usuario (mozos rotando tablet, admin-as):
 * - `clearVendorData(vendorId)` borra SOLO cachés de lectura del vendor.
 * - El outbox/prints con pendientes de OTRO vendor SE PRESERVA (borrarlo
 *   sería perder ventas cobradas). El sync engine (F3) procesa únicamente
 *   el outbox del vendor actualmente autenticado.
 */

const DB_NAME = "portal659-offline";
const DB_VERSION = 1;

export type VendorSnapshot = {
  vendor: Record<string, any>;
  plans: Record<string, any>[];
  staffRole?: string | null;
  cachedAt: number;
};

export type CatalogSnapshot = {
  products: Record<string, any>[];
  categories: { key: string; label: string }[];
  modifiersByProduct: Record<string, Record<string, any>[]>;
  /** Variantes por producto (moda). Opcional: snapshots viejos no la traen. */
  variantsMap?: Record<string, Record<string, any>[]>;
  cashPct: number;
  vertical: string | null;
  cachedAt: number;
};

export type TablesSnapshot = {
  tables: Record<string, any>[];
  orders: Record<string, any>[];
  cachedAt: number;
  cashPct: number;
};

/** Acción encolada (el sync engine de F2/F3 la procesa en FIFO por vendor). */
export type OutboxAction = {
  id?: number;
  vendorId: string;
  /** Ámbito para badges/UI: de qué pestaña es la acción pendiente. */
  scope: "pos" | "mesas" | "orders" | "print";
  type: string;
  payload: Record<string, any>;
  /** Id local (ej. "local-...") para mapear contra el id real del servidor. */
  localId?: string;
  createdAt: number;
  attempts: number;
  lastError?: string | null;
};

export type PrintJob = {
  id?: number;
  vendorId: string;
  orderLocalId: string;
  orderId?: string | null;
  doc: "comanda" | "ticket" | "retiro" | "precuenta" | "despacho";
  payload: Record<string, any>;
  createdAt: number;
  attempts: number;
  printed: boolean;
};

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof indexedDB !== "undefined";
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!isBrowser()) return Promise.reject(new Error("Sin IndexedDB (SSR)"));
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("kv")) {
        db.createObjectStore("kv", { keyPath: "k" });
      }
      if (!db.objectStoreNames.contains("outbox")) {
        const s = db.createObjectStore("outbox", { keyPath: "id", autoIncrement: true });
        s.createIndex("by-vendor", "vendorId", { unique: false });
      }
      if (!db.objectStoreNames.contains("prints")) {
        const s = db.createObjectStore("prints", { keyPath: "id", autoIncrement: true });
        s.createIndex("by-vendor", "vendorId", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error ?? new Error("No se pudo abrir IndexedDB"));
    };
  });
  return dbPromise;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<any>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => reject(req.error ?? new Error("IDB error"));
      })
  );
}

/** Pide persistencia anti-eviction (best-effort, una vez por sesión). */
export function ensurePersisted(): void {
  try {
    (navigator as any)?.storage?.persist?.()?.catch(() => {});
  } catch {
    /* noop */
  }
}

// ---------------------------------------------------------------- KV ---

async function kvGet<T>(key: string): Promise<T | null> {
  try {
    const row = await tx<{ k: string; v: T }>("kv", "readonly", (s) => s.get(key));
    return row ? row.v : null;
  } catch {
    return null;
  }
}

async function kvSet(key: string, value: unknown): Promise<void> {
  try {
    await tx("kv", "readwrite", (s) => s.put({ k: key, v: value }));
  } catch {
    /* sin almacenamiento: la app sigue online-only */
  }
}

const snapKey = (vendorId: string, what: "snapshot" | "catalog" | "tables") =>
  `vendor:${vendorId}:${what}`;

export function saveVendorSnapshot(vendorId: string, snap: Omit<VendorSnapshot, "cachedAt">): Promise<void> {
  return kvSet(snapKey(vendorId, "snapshot"), { ...snap, cachedAt: Date.now() });
}

export function getVendorSnapshot(vendorId: string): Promise<VendorSnapshot | null> {
  return kvGet<VendorSnapshot>(snapKey(vendorId, "snapshot"));
}

export function saveCatalogSnapshot(vendorId: string, snap: Omit<CatalogSnapshot, "cachedAt">): Promise<void> {
  return kvSet(snapKey(vendorId, "catalog"), { ...snap, cachedAt: Date.now() });
}

export function getCatalogSnapshot(vendorId: string): Promise<CatalogSnapshot | null> {
  return kvGet<CatalogSnapshot>(snapKey(vendorId, "catalog"));
}

export function saveTablesSnapshot(vendorId: string, snap: Omit<TablesSnapshot, "cachedAt">): Promise<void> {
  return kvSet(snapKey(vendorId, "tables"), { ...snap, cachedAt: Date.now() });
}

export function getTablesSnapshot(vendorId: string): Promise<TablesSnapshot | null> {
  return kvGet<TablesSnapshot>(snapKey(vendorId, "tables"));
}

export function isFresh(cachedAt: number | undefined, ttlMs: number, now = Date.now()): boolean {
  return typeof cachedAt === "number" && now - cachedAt < ttlMs;
}

/** TTLs de lectura (stale-while-revalidate: pasado el TTL se sigue mostrando). */
export const SNAP_TTL = {
  vendor: 24 * 60 * 60 * 1000,
  catalog: 60 * 60 * 1000,
  tables: 5 * 60 * 1000,
};

// ------------------------------------------------------- Outbox ---

export async function outboxAdd(action: Omit<OutboxAction, "id" | "createdAt" | "attempts">): Promise<number | null> {
  try {
    const id = await tx<number>("outbox", "readwrite", (s) =>
      s.add({ ...action, createdAt: Date.now(), attempts: 0 } as OutboxAction)
    );
    return typeof id === "number" ? id : null;
  } catch {
    return null;
  }
}

export async function outboxCount(vendorId: string, scope?: OutboxAction["scope"]): Promise<number> {
  try {
    const db = await openDb();
    const rows: OutboxAction[] = await new Promise((resolve, reject) => {
      const out: OutboxAction[] = [];
      const t = db.transaction("outbox", "readonly");
      const idx = t.objectStore("outbox").index("by-vendor");
      const req = idx.openCursor(IDBKeyRange.only(vendorId));
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) return resolve(out);
        out.push(cur.value as OutboxAction);
        cur.continue();
      };
      req.onerror = () => reject(req.error ?? new Error("IDB error"));
    });
    return scope ? rows.filter((r) => r.scope === scope).length : rows.length;
  } catch {
    return 0;
  }
}

// ------------------------------------------------------- Prints ---

export async function printsAdd(job: Omit<PrintJob, "id" | "createdAt" | "attempts" | "printed">): Promise<number | null> {
  try {
    const id = await tx<number>("prints", "readwrite", (s) =>
      s.add({ ...job, createdAt: Date.now(), attempts: 0, printed: false } as PrintJob)
    );
    return typeof id === "number" ? id : null;
  } catch {
    return null;
  }
}

// ------------------------------------------- Limpieza multi-usuario ---

/**
 * Limpia los datos de UN vendor al cambiar de usuario/impersonación.
 * Borra cachés de lectura; el outbox y prints pendientes SE PRESERVAN
 * (son ventas cobradas: se sincronizan al volver a entrar como ese vendor).
 */
export async function clearVendorData(vendorId: string): Promise<void> {
  if (!isBrowser()) return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction("kv", "readwrite");
      const store = t.objectStore("kv");
      const prefix = `vendor:${vendorId}:`;
      const req = store.openCursor();
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) return resolve();
        if (typeof cur.key === "string" && cur.key.startsWith(prefix)) cur.delete();
        cur.continue();
      };
      req.onerror = () => reject(req.error ?? new Error("IDB error"));
    });
  } catch {
    /* noop */
  }
}
