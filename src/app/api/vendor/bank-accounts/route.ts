import { NextResponse } from "next/server";
import { getVendorByRequest } from "@/lib/vendor-utils";
import { withTransaction } from "@/lib/db";
import { MAX_BANK_ACCOUNTS } from "@/lib/bank-accounts";
import {
  hasBankAccountsTable,
  listVendorBankAccounts,
  normalizeAccountPayload,
  syncVendorLegacyMirror,
} from "@/lib/bank-accounts-server";

export const dynamic = "force-dynamic";

const MIGRATION = "migrate-bank-accounts.sql";

/**
 * GET /api/vendor/bank-accounts — cuentas del comercio (activas e
 * inactivas). La lee cualquier sesión del local (el picker del cobro la
 * usa también el Empleado) y la vista prueba.
 */
export async function GET(request: Request) {
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  if (!(await hasBankAccountsTable())) {
    return NextResponse.json({ accounts: [], migration: MIGRATION });
  }
  const accounts = await listVendorBankAccounts(vendor.id);
  return NextResponse.json({ accounts, max: MAX_BANK_ACCOUNTS });
}

/**
 * POST /api/vendor/bank-accounts — alta de cuenta (máx 3 activas).
 * Solo el dueño / Encargado (misma regla que editar la configuración).
 * Body: { label, alias?, cbu?, holder?, is_default? }.
 */
export async function POST(request: Request) {
  const { vendor, staffRole, staffLevel } = await getVendorByRequest(request);
  if (!vendor) return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  if (staffRole === "delivery") return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  if (staffRole === "staff" && staffLevel !== "admin") {
    return NextResponse.json({ error: "Tu nivel de usuario no puede cambiar la configuración" }, { status: 403 });
  }
  if (!(await hasBankAccountsTable())) {
    return NextResponse.json(
      { error: `Falta aplicar la migración ${MIGRATION} en la base de datos`, code: "migration_pending" },
      { status: 503 }
    );
  }
  const body = await request.json().catch(() => ({}));
  const parsed = normalizeAccountPayload(body);
  if (!parsed.ok || !parsed.value) {
    return NextResponse.json({ error: parsed.error || "Datos inválidos" }, { status: 400 });
  }
  const makeDefault = body?.is_default === true;

  try {
    const account = await withTransaction(async (tx) => {
      const counts = await tx.queryOne<{ active: number; nextPos: number }>(
        `SELECT COUNT(*) FILTER (WHERE active)::int AS active,
                COALESCE(MAX(position), -1) + 1 AS "nextPos"
         FROM vendor_bank_accounts WHERE vendor_id = $1`,
        [vendor.id]
      );
      const activeCount = Number(counts?.active) || 0;
      if (activeCount >= MAX_BANK_ACCOUNTS) {
        return { error: "max", activeCount } as const;
      }
      // La primera cuenta del comercio nace como principal.
      const isDefault = makeDefault || activeCount === 0;
      if (isDefault) {
        await tx.queryVoid(
          `UPDATE vendor_bank_accounts SET is_default = false WHERE vendor_id = $1 AND is_default = true`,
          [vendor.id]
        );
      }
      const v = parsed.value!;
      const row = await tx.queryOne<Record<string, unknown>>(
        `INSERT INTO vendor_bank_accounts (vendor_id, label, alias, cbu, holder, position, active, is_default)
         VALUES ($1, $2, $3, $4, $5, $6, true, $7)
         RETURNING id, vendor_id, label, alias, cbu, holder, position, active, is_default`,
        [vendor.id, v.label, v.alias, v.cbu, v.holder, Number(counts?.nextPos) || 0, isDefault]
      );
      return { row } as const;
    });
    if ("error" in account && account.error === "max") {
      return NextResponse.json(
        { error: `Máximo ${MAX_BANK_ACCOUNTS} cuentas activas. Desactivá una para cargar otra.`, code: "max_bank_accounts" },
        { status: 409 }
      );
    }
    await syncVendorLegacyMirror(vendor.id);
    return NextResponse.json({ ok: true, account: (account as { row: Record<string, unknown> }).row });
  } catch (e) {
    const { logApiError } = await import("@/lib/api-error");
    logApiError("vendor/bank-accounts", e);
    return NextResponse.json({ error: "No se pudo guardar la cuenta" }, { status: 500 });
  }
}
