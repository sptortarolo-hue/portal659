/**
 * Multi-cuenta para transferencias (client-safe: no importa `pg`).
 *
 * Hasta 3 cuentas activas por comercio (una principal). Toda interacción
 * manual con la cuenta (compartir datos de pago, registrar un cobro por
 * transferencia) pide elegir cuál cuando hay 2+ activas; con 0/1 no hay
 * fricción (comportamiento de siempre). Los informes (Caja Z/X,
 * consolidado, Analytics) desglosan "Transferencia" por cuenta.
 *
 * Server: `bank-accounts-server.ts`. UI: `bank-account-picker.tsx`
 * (modal) y `bank-accounts-manager.tsx` (ABM en Config).
 */

export type VendorBankAccount = {
  id: string;
  vendor_id: string;
  /** Nombre corto visible ("MP personal", "Banco Nación"). */
  label: string;
  alias: string | null;
  cbu: string | null;
  holder: string | null;
  position: number;
  active: boolean;
  is_default: boolean;
};

/** Tope de cuentas ACTIVAS por comercio (enforceado en la API). */
export const MAX_BANK_ACCOUNTS = 3;

/** Nombre corto para chips/badges: el label, y si falta, el alias/CBU. */
export function bankAccountLabel(
  a: Pick<VendorBankAccount, "label" | "alias" | "cbu"> | null | undefined
): string {
  if (!a) return "";
  return (a.label || a.alias || a.cbu || "").trim();
}

/**
 * Cuenta a usar cuando nadie eligió: la principal activa; si no hay
 * ninguna marcada (estado inconsistente), la primera activa por posición.
 */
export function pickDefaultAccount(
  accounts: VendorBankAccount[] | null | undefined
): VendorBankAccount | null {
  const list = (accounts || []).filter((a) => a.active !== false);
  if (list.length === 0) return null;
  return list.find((a) => a.is_default === true) || list[0];
}

/** ¿Hay que preguntar qué cuenta usar? (2+ activas). */
export function needsAccountPicker(accounts: VendorBankAccount[] | null | undefined): boolean {
  return (accounts || []).filter((a) => a.active !== false).length >= 2;
}

/** Líneas de datos para mensajes de WhatsApp / copys (alias y/o CBU + titular). */
export function bankAccountDataLines(
  a: { alias?: string | null; cbu?: string | null; holder?: string | null } | null | undefined
): string[] {
  if (!a) return [];
  const out: string[] = [];
  if (a.alias) out.push(`Alias: ${a.alias}`);
  if (a.cbu) out.push(`CBU: ${a.cbu}`);
  if (a.holder) out.push(`Titular: ${a.holder}`);
  return out;
}

/**
 * Desglose de transferencias por cuenta (Caja en vivo, Z, consolidado y
 * Analytics). Forma compartida server ↔ UI.
 */
export type TransferByAccountRow = {
  accountId: string;
  /** Label de la cuenta al momento del cálculo (o "Cuenta eliminada"). */
  label: string;
  count: number;
  total: number;
};

/** Snapshot persistido en cash_closings.by_account (jsonb). */
export function parseByAccountSnapshot(raw: unknown): TransferByAccountRow[] {
  if (!raw) return [];
  let list: unknown[] = [];
  if (Array.isArray(raw)) list = raw;
  else if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) list = parsed;
    } catch {
      return [];
    }
  } else if (typeof raw === "object" && Array.isArray((raw as { rows?: unknown[] }).rows)) {
    list = (raw as { rows: unknown[] }).rows;
  }
  const out: TransferByAccountRow[] = [];
  for (const r of list) {
    const o = (r || {}) as Record<string, unknown>;
    const total = Math.round((Number(o.total) || 0) * 100) / 100;
    if (!(total > 0)) continue;
    out.push({
      accountId: String(o.accountId ?? o.account_id ?? ""),
      label: String(o.label || "Cuenta"),
      count: Number(o.count) || 0,
      total,
    });
  }
  return out.sort((a, b) => b.total - a.total);
}
