/**
 * Multi-cuenta para transferencias (server-only: usa `pg`).
 * La contraparte client-safe está en `bank-accounts.ts`.
 *
 * Todo es tolerante a `migrate-bank-accounts.sql` sin aplicar: si la
 * tabla no existe, las funciones devuelven vacío/null y el sistema sigue
 * con la cuenta única de `vendors.transfer_*` (espejo legacy).
 */
import { hasTable, queryMany, queryOne } from "@/lib/db";
import { pickDefaultAccount, type VendorBankAccount } from "@/lib/bank-accounts";

type Querier = {
  query: <T extends Record<string, any>>(sql: string, params?: unknown[]) => Promise<T[]>;
};

/** Adapter del pool a la firma mínima de hasTable/queryMany. */
const POOL: Querier = {
  query: <T extends Record<string, any>>(sql: string, params: unknown[] = []) => queryMany<T>(sql, params),
};

export async function hasBankAccountsTable(q: Querier = POOL): Promise<boolean> {
  try {
    return await hasTable(q, "vendor_bank_accounts");
  } catch {
    return false;
  }
}

/** Todas las cuentas del comercio (activas e inactivas, para el ABM y el picker). */
export async function listVendorBankAccounts(vendorId: string): Promise<VendorBankAccount[]> {
  try {
    if (!(await hasBankAccountsTable())) return [];
    const rows = await queryMany<Record<string, any>>(
      `SELECT id, vendor_id, label, alias, cbu, holder, position, active, is_default
       FROM vendor_bank_accounts
       WHERE vendor_id = $1
       ORDER BY position ASC, created_at ASC`,
      [vendorId]
    );
    return (rows || []).map((r) => ({
      id: String(r.id),
      vendor_id: String(r.vendor_id),
      label: String(r.label || ""),
      alias: r.alias ?? null,
      cbu: r.cbu ?? null,
      holder: r.holder ?? null,
      position: Number(r.position) || 0,
      active: r.active !== false,
      is_default: r.is_default === true,
    }));
  } catch {
    return [];
  }
}

/** La cuenta principal activa (null si no hay ninguna activa). */
export async function getVendorDefaultAccount(vendorId: string): Promise<VendorBankAccount | null> {
  const accounts = await listVendorBankAccounts(vendorId);
  return pickDefaultAccount(accounts.filter((a) => a.active));
}

/** ¿La cuenta pertenece al comercio y está activa? (validación de payloads). */
export async function isUsableAccount(vendorId: string, accountId: string | null | undefined): Promise<boolean> {
  if (!accountId || typeof accountId !== "string") return false;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(accountId)) return false;
  try {
    if (!(await hasBankAccountsTable())) return false;
    const row = await queryOne<{ ok: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM vendor_bank_accounts WHERE id = $1 AND vendor_id = $2 AND active = true) AS ok`,
      [accountId, vendorId]
    );
    return row?.ok === true;
  } catch {
    return false;
  }
}

/** Espejo legacy: la cuenta única vieja de `vendors.transfer_*`. */
export type LegacyTransfer = { alias: string | null; cbu: string | null; holder: string | null };

export async function getVendorLegacyTransfer(vendorId: string): Promise<LegacyTransfer | null> {
  try {
    const row = await queryOne<LegacyTransfer>(
      `SELECT transfer_alias AS alias, transfer_cbu AS cbu, transfer_holder AS holder
       FROM vendors WHERE id = $1 LIMIT 1`,
      [vendorId]
    );
    if (!row || (!row.alias && !row.cbu && !row.holder)) return null;
    return row;
  } catch {
    return null;
  }
}

/**
 * Cuenta efectiva para un cobro/mensaje, en orden de prioridad:
 *  1. la elegida (`preferredId`, si es usable: del comercio y activa),
 *  2. la principal,
 *  3. el espejo legacy (`vendors.transfer_*`),
 *  4. null (sin datos: el mensaje cae a "coordinamos por este chat").
 * Devuelve `id` solo en las ramas 1-2 (el espejo no tiene fila).
 */
export async function resolveEffectiveAccount(
  vendorId: string,
  preferredId?: string | null
): Promise<{ account: VendorBankAccount | null; legacy: LegacyTransfer | null }> {
  const accounts = await listVendorBankAccounts(vendorId);
  const active = accounts.filter((a) => a.active);
  if (preferredId) {
    const chosen = active.find((a) => a.id === preferredId);
    if (chosen) return { account: chosen, legacy: null };
  }
  const def = pickDefaultAccount(active);
  if (def) return { account: def, legacy: null };
  return { account: null, legacy: await getVendorLegacyTransfer(vendorId) };
}

/** Sincroniza el espejo legacy `vendors.transfer_*` con la cuenta principal
 *  activa (o NULL si no hay ninguna). Así los lectores que aún usan las
 *  columnas viejas (wa-bot, transfer-info, weighed-order fallback) siguen
 *  mostrando la cuenta principal sin cambios. Tolerante a migración sin
 *  aplicar. */
export async function syncVendorLegacyMirror(vendorId: string): Promise<void> {
  try {
    if (!(await hasBankAccountsTable())) return;
    const def = await getVendorDefaultAccount(vendorId);
    await queryOne(
      `UPDATE vendors SET transfer_alias = $1, transfer_cbu = $2, transfer_holder = $3 WHERE id = $4`,
      [def?.alias ?? null, def?.cbu ?? null, def?.holder ?? null, vendorId]
    ).catch(() => null);
  } catch {
    /* best-effort */
  }
}
export function normalizeAccountPayload(raw: unknown): {
  ok: boolean;
  error?: string;
  value?: { label: string; alias: string | null; cbu: string | null; holder: string | null };
} {
  const o = (raw || {}) as Record<string, unknown>;
  const label = String(o.label ?? "").trim().slice(0, 40);
  const alias = String(o.alias ?? "").trim().slice(0, 60) || null;
  const cbu = String(o.cbu ?? "").trim().replace(/[^\d]/g, "").slice(0, 40) || null;
  const holder = String(o.holder ?? "").trim().slice(0, 80) || null;
  if (!label) return { ok: false, error: "Ponele un nombre a la cuenta (ej: MP personal, Banco Nación)" };
  if (!alias && !cbu) return { ok: false, error: "Cargá al menos el alias o el CBU/CVU" };
  return { ok: true, value: { label, alias, cbu, holder } };
}
