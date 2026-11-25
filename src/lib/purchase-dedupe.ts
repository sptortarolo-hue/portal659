import { createHash } from "crypto";
import { queryMany, queryOne } from "./db";
import {
  EXACT_FILE_REASON,
  POSSIBLE_DAYS,
  POSSIBLE_AMOUNT_PCT,
  STRONG_REASON,
  isPossibleDuplicate,
  normalizeReceiptNumber,
  possibleReason,
  type DedupeCandidate,
  type DedupeLine,
  type DuplicateInfo,
} from "./purchase-dedupe-core";

export type { DedupeLine, DuplicateInfo, DuplicateType } from "./purchase-dedupe-core";
export { normalizeReceiptNumber, normalizeUnit, lineIdentity, linesCompatible, receiptNumbersDiffer } from "./purchase-dedupe-core";

export function fileSha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

type DedupeInput = {
  vendorId: string;
  supplierId?: string | null;
  receiptNumber?: string | null;
  total: number;
  purchasedAt?: string | null;
  fileHash?: string | null;
  /** Líneas de la compra entrante (id de catálogo o descripción). Opcional. */
  lines?: DedupeLine[];
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

/** Líneas de una compra ya guardada (tolerante a migrate-inventory sin aplicar). */
async function fetchCandidateLines(purchaseId: string): Promise<DedupeLine[]> {
  let rows = await queryMany<Record<string, unknown>>(
    `SELECT ingredient_id, product_id, variant_id, qty, unit, line_total
       FROM purchase_items WHERE purchase_id=$1 ORDER BY position, created_at`,
    [purchaseId]
  ).catch(() => null);
  if (!rows) {
    // Base sin columnas de mercadería en purchase_items: solo insumos.
    rows = await queryMany<Record<string, unknown>>(
      `SELECT ingredient_id, NULL::text AS product_id, NULL::text AS variant_id, qty, unit, line_total
         FROM purchase_items WHERE purchase_id=$1 ORDER BY position, created_at`,
      [purchaseId]
    ).catch(() => []);
  }
  return (rows || [])
    .map((r) => ({
      key: String(r.ingredient_id || r.product_id || r.variant_id || ""),
      qty: Number(r.qty) || 0,
      unit: String(r.unit || "u"),
      total: Number(r.line_total) || 0,
    }))
    .filter((l) => l.key.length > 0);
}

/**
 * Busca compras ya registradas que puedan ser la misma factura.
 *
 * - exact_file: mismo hash de archivo → señal dura. Devuelve el tipo con el
 *   que el llamador decide (hoy: único que bloquea).
 * - strong: proveedor + n° normalizado + monto exacto → ADVERTENCIA.
 * - possible: proveedor + monto ±3% + fecha ±3 días → ADVERTENCIA. Se
 *   descarta si los números difieren o las líneas no cuadran, para que una
 *   compra recurrente (mismos productos y monto) no se confunda con un
 *   comprobante ya cargado.
 */
export async function findDuplicatePurchase(input: DedupeInput): Promise<DuplicateInfo | null> {
  const hashCol = await hasColumn("source_hash");

  // 1) Mismo archivo (subir dos veces el PDF/foto) — la única señal dura.
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
        reason: EXACT_FILE_REASON,
        purchase_id: String(r.id),
        purchased_at: r.purchased_at ? String(r.purchased_at).slice(0, 10) : null,
        receipt_number: r.receipt_number ? String(r.receipt_number) : null,
        total: Number(r.total) || 0,
      };
    }
  }

  const nro = normalizeReceiptNumber(input.receiptNumber);

  // 2) Mismo proveedor + mismo n° + mismo monto (normalización idéntica a JS).
  if (input.supplierId && nro) {
    const rows = await queryMany<Record<string, unknown>>(
      `SELECT id, purchased_at, receipt_number, total
         FROM purchases
        WHERE vendor_id=$1 AND supplier_id=$2
          AND lower(regexp_replace(regexp_replace(coalesce(receipt_number,''),'[^a-zA-Z0-9]','','g'),'^0+(?=[0-9])',''))=$3
          AND round(total::numeric,2)=round($4::numeric,2)
        ORDER BY created_at DESC LIMIT 1`,
      [input.vendorId, input.supplierId, nro, input.total]
    ).catch(() => []);
    const r = rows?.[0];
    if (r) {
      return {
        type: "strong",
        reason: STRONG_REASON,
        purchase_id: String(r.id),
        purchased_at: r.purchased_at ? String(r.purchased_at).slice(0, 10) : null,
        receipt_number: r.receipt_number ? String(r.receipt_number) : null,
        total: Number(r.total) || 0,
      };
    }
  }

  // 3) Posible: candidatos por proveedor + monto/fecha, filtrados con la
  //    lógica pura (n° distinto o líneas distintas ⇒ no es duplicado).
  if (input.supplierId && input.total > 0) {
    const rows = await queryMany<Record<string, unknown>>(
      `SELECT id, purchased_at, receipt_number, total
         FROM purchases
        WHERE vendor_id=$1 AND supplier_id=$2
          AND abs(total - $3) <= greatest(abs(total), abs($3)) * $5::numeric
          AND ($4::date IS NULL OR purchased_at BETWEEN ($4::date - interval '${POSSIBLE_DAYS} days') AND ($4::date + interval '${POSSIBLE_DAYS} days'))
        ORDER BY created_at DESC LIMIT 10`,
      [input.vendorId, input.supplierId, input.total, input.purchasedAt || null, POSSIBLE_AMOUNT_PCT]
    ).catch(() => []);

    for (const r of rows || []) {
      const candidate: DedupeCandidate = {
        id: String(r.id),
        purchased_at: r.purchased_at ? String(r.purchased_at).slice(0, 10) : null,
        receipt_number: r.receipt_number ? String(r.receipt_number) : null,
        total: Number(r.total) || 0,
        lines: input.lines?.length ? await fetchCandidateLines(String(r.id)) : [],
      };
      if (
        !isPossibleDuplicate(
          {
            receiptNumber: input.receiptNumber,
            total: input.total,
            purchasedAt: input.purchasedAt,
            lines: input.lines,
          },
          candidate
        )
      ) {
        continue;
      }
      return {
        type: "possible",
        reason: possibleReason(input.receiptNumber, candidate),
        purchase_id: candidate.id,
        purchased_at: candidate.purchased_at,
        receipt_number: candidate.receipt_number,
        total: candidate.total,
      };
    }
  }

  return null;
}
