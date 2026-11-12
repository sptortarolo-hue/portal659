import { NextResponse } from "next/server";
import { getVendorByRequest } from "@/lib/vendor-utils";
import { withTransaction } from "@/lib/db";
import { MAX_BANK_ACCOUNTS } from "@/lib/bank-accounts";
import { hasBankAccountsTable, normalizeAccountPayload, syncVendorLegacyMirror } from "@/lib/bank-accounts-server";

export const dynamic = "force-dynamic";

const MIGRATION = "migrate-bank-accounts.sql";

async function guard(request: Request) {
  const { vendor, staffRole, staffLevel } = await getVendorByRequest(request);
  if (!vendor) return { error: NextResponse.json({ error: "No autorizado" }, { status: 403 }) };
  if (staffRole === "delivery") return { error: NextResponse.json({ error: "No autorizado" }, { status: 403 }) };
  if (staffRole === "staff" && staffLevel !== "admin") {
    return {
      error: NextResponse.json(
        { error: "Tu nivel de usuario no puede cambiar la configuración" },
        { status: 403 }
      ),
    };
  }
  if (!(await hasBankAccountsTable())) {
    return {
      error: NextResponse.json(
        { error: `Falta aplicar la migración ${MIGRATION} en la base de datos`, code: "migration_pending" },
        { status: 503 }
      ),
    };
  }
  return { vendor };
}

/**
 * PATCH /api/vendor/bank-accounts/[id] — edición (label/alias/cbu/holder),
 * `{ action: "set_default" }` (marcar principal) y `{ active: true }`
 * (reactivar, respeta el tope de 3 activas).
 */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const g = await guard(request);
  if ("error" in g) return g.error;
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const vendor = g.vendor!;

  try {
    const result = await withTransaction(async (tx) => {
      const current = await tx.queryOne<{ id: string; is_default: boolean; active: boolean }>(
        `SELECT id, is_default, active FROM vendor_bank_accounts WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
        [id, vendor.id]
      );
      if (!current) return { error: "not_found" } as const;

      if (body?.action === "set_default") {
        if (!current.active) return { error: "inactive" } as const;
        await tx.queryVoid(
          `UPDATE vendor_bank_accounts SET is_default = false WHERE vendor_id = $1 AND is_default = true`,
          [vendor.id]
        );
        await tx.queryVoid(
          `UPDATE vendor_bank_accounts SET is_default = true WHERE id = $1 AND vendor_id = $2`,
          [id, vendor.id]
        );
      } else {
        // Reactivación explícita (active:true estando inactiva): respeta el tope.
        if (body?.active === true && !current.active) {
          const c = await tx.queryOne<{ n: number }>(
            `SELECT COUNT(*)::int AS n FROM vendor_bank_accounts WHERE vendor_id = $1 AND active = true`,
            [vendor.id]
          );
          if ((Number(c?.n) || 0) >= MAX_BANK_ACCOUNTS) return { error: "max" } as const;
        }
        if (body?.active !== undefined) {
          await tx.queryVoid(
            `UPDATE vendor_bank_accounts SET active = $1 WHERE id = $2 AND vendor_id = $3`,
            [body.active === true, id, vendor.id]
          );
        }
        if (body?.label !== undefined || body?.alias !== undefined || body?.cbu !== undefined || body?.holder !== undefined) {
          const parsed = normalizeAccountPayload(body);
          if (!parsed.ok || !parsed.value) return { error: "invalid", message: parsed.error } as const;
          const v = parsed.value;
          await tx.queryVoid(
            `UPDATE vendor_bank_accounts SET label = $1, alias = $2, cbu = $3, holder = $4 WHERE id = $5 AND vendor_id = $6`,
            [v.label, v.alias, v.cbu, v.holder, id, vendor.id]
          );
        }
      }

      const row = await tx.queryOne<Record<string, unknown>>(
        `SELECT id, vendor_id, label, alias, cbu, holder, position, active, is_default
         FROM vendor_bank_accounts WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
        [id, vendor.id]
      );
      return { row } as const;
    });

    if ("error" in result) {
      if (result.error === "not_found") return NextResponse.json({ error: "Cuenta no encontrada" }, { status: 404 });
      if (result.error === "inactive") return NextResponse.json({ error: "Reactivá la cuenta para marcarla como principal" }, { status: 409 });
      if (result.error === "max") {
        return NextResponse.json(
          { error: `Máximo ${MAX_BANK_ACCOUNTS} cuentas activas. Desactivá una para reactivar esta.`, code: "max_bank_accounts" },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: (result as { message?: string }).message || "Datos inválidos" }, { status: 400 });
    }
    await syncVendorLegacyMirror(vendor.id);
    return NextResponse.json({ ok: true, account: result.row });
  } catch (e) {
    const { logApiError } = await import("@/lib/api-error");
    logApiError("vendor/bank-accounts/[id]", e);
    return NextResponse.json({ error: "No se pudo guardar la cuenta" }, { status: 500 });
  }
}

/**
 * DELETE /api/vendor/bank-accounts/[id] — baja LÓGICA (active=false):
 * los cobros históricos siguen apuntando a la cuenta para el desglose de
 * los informes. Si era la principal, la más vieja activa pasa a serlo.
 */
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const g = await guard(request);
  if ("error" in g) return g.error;
  const { id } = await context.params;
  const vendor = g.vendor!;

  try {
    const result = await withTransaction(async (tx) => {
      const current = await tx.queryOne<{ id: string; is_default: boolean; active: boolean }>(
        `SELECT id, is_default, active FROM vendor_bank_accounts WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
        [id, vendor.id]
      );
      if (!current) return { error: "not_found" } as const;
      await tx.queryVoid(
        `UPDATE vendor_bank_accounts SET active = false, is_default = false WHERE id = $1 AND vendor_id = $2`,
        [id, vendor.id]
      );
      if (current.is_default) {
        await tx.queryVoid(
          `UPDATE vendor_bank_accounts SET is_default = true
           WHERE id = (
             SELECT id FROM vendor_bank_accounts
             WHERE vendor_id = $1 AND active = true
             ORDER BY position ASC, created_at ASC LIMIT 1
           ) AND vendor_id = $1`,
          [vendor.id]
        );
      }
      return { ok: true } as const;
    });
    if ("error" in result) return NextResponse.json({ error: "Cuenta no encontrada" }, { status: 404 });
    await syncVendorLegacyMirror(vendor.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const { logApiError } = await import("@/lib/api-error");
    logApiError("vendor/bank-accounts/[id]", e);
    return NextResponse.json({ error: "No se pudo eliminar la cuenta" }, { status: 500 });
  }
}
