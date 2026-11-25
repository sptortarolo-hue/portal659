import { createHash } from "crypto";
import { queryMany, queryOne } from "./db";

export type DuplicateType = "exact_file" | "strong" | "possible";

export type DuplicateInfo = {
  type: DuplicateType;
  purchase_id: string;
  purchased_at: string | null;
  receipt_number: string | null;
  total: number;
};

export function fileSha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export function normalizeReceiptNumber(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .replace(/^0+(?=\d)/, "");
}

type DedupeInput = {
  vendorId: string;
  supplierId?: string | null;
  receiptNumber?: string | null;
  total: number;
  purchasedAt?: string | null;
  fileHash?: string | null;
};

async function hasColumn(column: string): Promise<boolean> {
  const r = await queryOne<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name='purchases' AND column_name=$1
     ) AS exists`,
    [column]
  ).catch(() => null);
  return r?.exists === true;
}

/**
 * Busca compras ya registradas que puedan ser la misma factura.
 * - exact_file: mismo archivo (hash) → señal más confiable.
 * - strong: proveedor + n° normalizado + monto exacto.
 * - possible: proveedor + monto ±3% + fecha dentro de 30 días.
 */
export async function findDuplicatePurchase(input: DedupeInput): Promise<DuplicateInfo | null> {
  const hashCol = await hasColumn("source_hash");

  if (input.fileHash && hashCol) {
    const rows = await queryMany<Record<string, unknown>>(
      `SELECT id, purchased_at, receipt_number, total
         FROM purchases WHERE vendor_id=$1 AND source_hash=$2
        ORDER BY created_at DESC LIMIT 1`,
      [input.vendorId, input.fileHash]
    ).catch(() => []);
    const r = rows?.[0];
    if (r) {
      return {
        type: "exact_file",
        purchase_id: String(r.id),
        purchased_at: r.purchased_at ? String(r.purchased_at).slice(0, 10) : null,
        receipt_number: r.receipt_number ? String(r.receipt_number) : null,
        total: Number(r.total) || 0,
      };
    }
  }

  const nro = normalizeReceiptNumber(input.receiptNumber);
  if (input.supplierId && nro) {
    const rows = await queryMany<Record<string, unknown>>(
      `SELECT id, purchased_at, receipt_number, total
         FROM purchases
        WHERE vendor_id=$1 AND supplier_id=$2
          AND lower(regexp_replace(coalesce(receipt_number,''),'[^a-zA-Z0-9]','','g'))=$3
          AND round(total::numeric,2)=round($4::numeric,2)
        ORDER BY created_at DESC LIMIT 1`,
      [input.vendorId, input.supplierId, nro, input.total]
    ).catch(() => []);
    const r = rows?.[0];
    if (r) {
      return {
        type: "strong",
        purchase_id: String(r.id),
        purchased_at: r.purchased_at ? String(r.purchased_at).slice(0, 10) : null,
        receipt_number: r.receipt_number ? String(r.receipt_number) : null,
        total: Number(r.total) || 0,
      };
    }
  }

  if (input.supplierId && input.purchasedAt && input.total > 0) {
    const rows = await queryMany<Record<string, unknown>>(
      `SELECT id, purchased_at, receipt_number, total
         FROM purchases
        WHERE vendor_id=$1 AND supplier_id=$2
          AND abs(total - $3) <= greatest(abs(total), abs($3)) * 0.03
          AND purchased_at BETWEEN ($4::date - interval '30 days') AND ($4::date + interval '30 days')
        ORDER BY created_at DESC LIMIT 1`,
      [input.vendorId, input.supplierId, input.total, input.purchasedAt]
    ).catch(() => []);
    const r = rows?.[0];
    if (r) {
      return {
        type: "possible",
        purchase_id: String(r.id),
        purchased_at: r.purchased_at ? String(r.purchased_at).slice(0, 10) : null,
        receipt_number: r.receipt_number ? String(r.receipt_number) : null,
        total: Number(r.total) || 0,
      };
    }
  }

  return null;
}
