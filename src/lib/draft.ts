"use client";

/**
 * Borradores con vencimiento (persistencia ante recargas del SO, crash o
 * deploy a mitad de sesión). localStorage por vendor, 24h de vida.
 * Todo best-effort con try/catch: si el storage falla, la app sigue igual.
 */

const PREFIX = "portal659:draft:";
export const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

type Envelope = { savedAt: number; data: unknown };

function key(vendorId: string, name: string): string {
  return `${PREFIX}${vendorId}:${name}`;
}

export function saveDraft(vendorId: string | null | undefined, name: string, data: unknown): void {
  if (!vendorId) return;
  try {
    const env: Envelope = { savedAt: Date.now(), data };
    window.localStorage.setItem(key(vendorId, name), JSON.stringify(env));
  } catch {
    /* cuota llena o storage bloqueado: se sigue sin persistir */
  }
}

export function loadDraft<T>(vendorId: string | null | undefined, name: string, maxAgeMs = DRAFT_TTL_MS): T | null {
  if (!vendorId) return null;
  try {
    const raw = window.localStorage.getItem(key(vendorId, name));
    if (!raw) return null;
    const env = JSON.parse(raw) as Envelope;
    if (!env || typeof env.savedAt !== "number" || Date.now() - env.savedAt > maxAgeMs) {
      window.localStorage.removeItem(key(vendorId, name));
      return null;
    }
    return env.data as T;
  } catch {
    return null;
  }
}

export function clearDraft(vendorId: string | null | undefined, name: string): void {
  if (!vendorId) return;
  try {
    window.localStorage.removeItem(key(vendorId, name));
  } catch {
    /* noop */
  }
}
