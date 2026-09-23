"use client";

/**
 * Acciones offline del vendor (Track Ventas F2).
 *
 * Cada acción que nace sin conexión lleva:
 * - `client_key`: UUID único → el servidor lo usa como idempotencia
 *   (reintento = fila existente + dedup:true, nunca duplicado).
 * - `occurred_at`: hora real de la venta según el dispositivo (el servidor
 *   la guarda en orders.occurred_at para reportes comerciales).
 * - `localId`: id provisorio ("local-...") para la UI optimista y para
 *   encadenar dependientes (un patch referencia el localId del create y el
 *   sync engine lo resuelve tras mapear contra el id real).
 */

import { outboxAdd, printsAdd, emitOutboxChanged, type OutboxAction } from "./offline-db";

export type OfflineActionType =
  | "pos_order"
  | "consumicion"
  | "table_close"
  | "order_status"
  | "order_cancel"
  | "mark_paid";

export function newClientKey(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `ck-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

export function newLocalId(): string {
  return `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Clave día civil AR (YYYYMMDD) para el secuenciador provisorio. */
function todayKeyAR(now = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Argentina/Buenos_Aires",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
    return parts.replace(/\D/g, "");
  } catch {
    return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  }
}

const SEQ_PREFIX = "portal659-localseq:";

/**
 * Número provisorio del día por vendor (P-N). Vive en localStorage (simple,
 * single-active-device): al sincronizar se reemplaza por el pickup_number
 * real del servidor. Nunca se imprime como definitivo.
 */
export function nextProvisionalNumber(vendorId: string): number {
  if (typeof window === "undefined") return 1;
  const key = `${SEQ_PREFIX}${vendorId}:${todayKeyAR()}`;
  try {
    const n = Number(window.localStorage.getItem(key) || 0) + 1;
    window.localStorage.setItem(key, String(n));
    return n;
  } catch {
    return Math.floor(Math.random() * 900) + 100;
  }
}

/** Payload base que toda acción offline manda al servidor. */
export function syncBase(payload: Record<string, any>): Record<string, any> {
  return {
    ...payload,
    client_key: payload.client_key || newClientKey(),
    occurred_at: payload.occurred_at || new Date().toISOString(),
  };
}

export type EnqueueParams = {
  vendorId: string;
  scope: OutboxAction["scope"];
  type: OfflineActionType;
  payload: Record<string, any>;
  localId?: string;
  /** localId de la acción de la que depende (se aplica tras su sync). */
  afterLocalId?: string;
  /** Trabajo de impresión asociado (track Impresión lo consume). */
  print?: {
    doc: "comanda" | "ticket" | "retiro" | "precuenta" | "despacho";
    payload: Record<string, any>;
  };
};

/**
 * Encola una acción offline (+ trabajo de impresión opcional) y avisa a
 * badges/UI. Devuelve el localId (nuevo o el provisto).
 */
export async function enqueueOfflineAction(p: EnqueueParams): Promise<string> {
  const localId = p.localId || newLocalId();
  const payload = syncBase(p.payload);
  if (p.afterLocalId) (payload as any).__afterLocalId = p.afterLocalId;
  await outboxAdd({
    vendorId: p.vendorId,
    scope: p.scope,
    type: p.type,
    payload,
    localId,
  });
  if (p.print) {
    await printsAdd({
      vendorId: p.vendorId,
      orderLocalId: localId,
      doc: p.print.doc,
      payload: p.print.payload,
    });
  }
  emitOutboxChanged();
  return localId;
}

/** ¿El error de fetch es de conectividad (vs. error de negocio del server)? */
export function isNetworkError(e: unknown): boolean {
  if (typeof navigator !== "undefined" && !navigator.onLine) return true;
  return e instanceof TypeError;
}
