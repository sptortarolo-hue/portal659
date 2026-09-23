"use client";

/**
 * Plan offline del lado cliente (Track Ventas F1).
 *
 * El gate del servidor (`subscription-gate.ts`) es inalcanzable sin
 * conexión, así que la autorización offline se resuelve ACÁ con el vendor
 * row + plans cacheados en IndexedDB. `resolveVendorPlan` es portable
 * (solo importa types) y el servidor revalida todo al sincronizar.
 */
import { resolveVendorPlan } from "./plans";
import type { Plan } from "@/types/database";
import { getVendorSnapshot } from "./offline-db";

/** Ventana durante la cual se puede vender offline tras el último check. */
export const OFFLINE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

export type OfflinePlan = {
  canPos: boolean;
  canMesas: boolean;
  canPrinter: boolean;
  status: string;
  /** ms desde la última verificación exitosa (para "verificado hace X"). */
  ageMs: number;
  /** true si pasó el grace period: POS/Mesas bloqueados hasta reconectar. */
  expired: boolean;
};

export function resolveOfflinePlan(
  vendor: Record<string, any> | null | undefined,
  plans: Record<string, any>[] | null | undefined,
  cachedAt: number | undefined,
  now = Date.now()
): OfflinePlan | null {
  if (!vendor || !Array.isArray(plans) || plans.length === 0 || typeof cachedAt !== "number") {
    return null;
  }
  try {
    const eff = resolveVendorPlan(
      vendor as {
        vertical: any;
        plan_id: string | null;
        plan_status: any;
        plan_expires_at: string | null;
        trial_ends_at: string | null;
        visible?: boolean;
      },
      plans as Plan[]
    );
    const ageMs = Math.max(0, now - cachedAt);
    return {
      canPos: eff.can("pos"),
      canMesas: eff.can("mesas"),
      canPrinter: eff.can("printer"),
      status: eff.status,
      ageMs,
      expired: ageMs > OFFLINE_GRACE_MS,
    };
  } catch {
    return null;
  }
}

/** "verificado hace X" en lenguaje humano (para el banner offline). */
export function ageLabel(ageMs: number): string {
  const mins = Math.floor(ageMs / 60000);
  if (mins < 1) return "recién";
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `hace ${hours} h`;
  return `hace ${Math.floor(hours / 24)} días`;
}

export type OfflineGate =
  | { allowed: true; plan: OfflinePlan }
  | { allowed: false; reason: "no-snapshot" | "grace-expired"; ageMs: number | null };

/**
 * Gate de acciones offline (F4): vender sin red exige snapshot con plan
 * dentro del grace period. Sin snapshot no hay catálogo (nada que vender);
 * con grace vencido se bloquea hasta reconectar. El servidor revalida todo
 * al sincronizar de todos modos.
 */
export async function checkOfflineAllowed(vendorId: string): Promise<OfflineGate> {
  const snap = await getVendorSnapshot(vendorId).catch(() => null);
  if (!snap) return { allowed: false, reason: "no-snapshot", ageMs: null };
  const plan = resolveOfflinePlan(snap.vendor, snap.plans, snap.cachedAt);
  if (!plan) return { allowed: false, reason: "no-snapshot", ageMs: null };
  if (plan.expired) return { allowed: false, reason: "grace-expired", ageMs: plan.ageMs };
  return { allowed: true, plan };
}

/** Mensaje humano para un gate denegado (se muestra en el msg de la pestaña). */
export function offlineDeniedMsg(gate: Extract<OfflineGate, { allowed: false }>): string {
  if (gate.reason === "grace-expired") {
    return `Sin conexión y con plan sin verificar (${ageLabel(gate.ageMs ?? OFFLINE_GRACE_MS)}): reconectá para seguir vendiendo`;
  }
  return "Sin conexión y sin datos guardados de este comercio: conectate una vez para habilitar el modo offline";
}
