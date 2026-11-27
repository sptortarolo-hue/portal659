/**
 * Emisión de Factura C sin Request: helper compartido por el endpoint manual
 * (`/api/vendor/fiscal/emitir`) y por los disparos automáticos del servidor
 * (webhook de Mercado Pago, polling del QR de mostrador).
 *
 * Idempotente en tres niveles: pre-check por referencia, UNIQUE en `invoices`
 * (con recupero en `issue-invoice.ts`) y recupero del CAE 10016 en `emit.ts`.
 * NUNCA lanza hacia el webhook: un 500 haría reintentar a MP y duplicar pedidos.
 */
import { queryMany, queryOne } from "@/lib/db";
import { resolveVendorPlan } from "@/lib/plans";
import { isValidCuit } from "@/lib/arca/crypto";
import { normalizeReceptorFiscal } from "@/lib/arca/wsfe";
import { issueFiscalInvoice, FiscalIssueError } from "@/lib/arca/issue-invoice";
import type { FiscalInvoice } from "@/lib/arca/emit";
import type { Order, Plan, Vendor } from "@/types/database";

export type FiscalEmitInput = {
  vendorId: string;
  orderId?: string | null;
  /** Cuentas de mesa: se suman los totales y se factura contra el más nuevo. */
  orderIds?: string[];
  bookingId?: string | null;
  /** Total ya calculado (ej. `payment.transaction_amount`); si no, se lee de DB. */
  total?: number | null;
  receptorDocTipo?: unknown;
  receptorDocNro?: unknown;
  receptorCondIva?: unknown;
  receptorNombre?: string | null;
  /** Exige `vendors.fiscal_auto_emit = true` (emisiones automáticas con MP). */
  requireAutoEmit?: boolean;
};

export type FiscalEmitOutcome = {
  ok: boolean;
  invoice?: FiscalInvoice;
  qrUrl?: string;
  recovered?: boolean;
  skipped?:
    | "plan"
    | "auto_disabled"
    | "not_found"
    | "cancelled"
    | "preview"
    | "duplicate"
    | "invalid_total";
  error?: string;
  code?: string;
  status?: number;
  hint?: string;
  detail?: string;
};

export async function emitFiscalForOrder(input: FiscalEmitInput): Promise<FiscalEmitOutcome> {
  const vendor = await queryOne<Vendor>(
    `SELECT * FROM vendors WHERE id = $1 LIMIT 1`,
    [input.vendorId]
  );
  if (!vendor) return { ok: false, skipped: "not_found" };

  if (input.requireAutoEmit && (vendor as { fiscal_auto_emit?: boolean }).fiscal_auto_emit !== true) {
    return { ok: false, skipped: "auto_disabled" };
  }

  const plans = await queryMany<Plan>(`SELECT * FROM plans`);
  if (!resolveVendorPlan(vendor, plans || []).can("fiscal")) {
    return { ok: false, skipped: "plan" };
  }

  let receptor;
  try {
    receptor = normalizeReceptorFiscal(
      input.receptorDocTipo,
      input.receptorDocNro,
      input.receptorCondIva,
      isValidCuit
    );
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Receptor inválido", code: "invalid_receptor" };
  }
  const receptorNombre =
    typeof input.receptorNombre === "string" && input.receptorNombre.trim()
      ? input.receptorNombre.trim().slice(0, 120)
      : null;

  let total = input.total == null ? 0 : Number(input.total);
  let orderId: string | null = null;
  let bookingId: string | null = null;

  const bookingIdRaw = String(input.bookingId || "");
  const ids = Array.isArray(input.orderIds)
    ? [...new Set(input.orderIds.map(String).filter(Boolean))].slice(0, 50)
    : input.orderId
      ? [String(input.orderId)]
      : [];

  if (bookingIdRaw) {
    const b = await queryOne<{
      id: string; vendor_id: string; status: string | null; service_price: number | null;
    }>(
      `SELECT id, vendor_id, status, service_price::numeric AS service_price FROM bookings WHERE id = $1 LIMIT 1`,
      [bookingIdRaw]
    );
    if (!b || b.vendor_id !== vendor.id) return { ok: false, skipped: "not_found" };
    if (b.status === "cancelled") return { ok: false, skipped: "cancelled" };
    bookingId = b.id;
    if (input.total == null) total = Math.round((Number(b.service_price) || 0) * 100) / 100;
  } else {
    if (ids.length === 0) return { ok: false, skipped: "not_found" };
    const orders = await queryMany<Order>(
      `SELECT * FROM orders WHERE id = ANY($1::uuid[]) AND vendor_id = $2`,
      [ids, vendor.id]
    );
    if (orders.length !== ids.length) return { ok: false, skipped: "not_found" };
    if (orders.some((o) => o.status === "cancelled")) return { ok: false, skipped: "cancelled" };
    if (orders.some((o) => (o as { is_preview?: boolean }).is_preview === true)) {
      return { ok: false, skipped: "preview" };
    }
    const principal = [...orders].sort((a, b) =>
      String(a.created_at) < String(b.created_at) ? -1 : 1
    ).slice(-1)[0];
    orderId = principal.id;
    if (input.total == null) {
      total = Math.round(orders.reduce((s, o) => s + (Number(o.total) || 0), 0) * 100) / 100;
    }
  }

  if (!Number.isFinite(total) || total <= 0) return { ok: false, skipped: "invalid_total" };

  // Un solo comprobante por referencia (pedido principal o turno).
  const refId = bookingId || orderId;
  const existing = await queryOne<FiscalInvoice>(
    `SELECT * FROM invoices WHERE vendor_id = $1 AND COALESCE(booking_id, order_id) = $2 LIMIT 1`,
    [vendor.id, refId]
  ).catch(() => null);
  if (existing) return { ok: true, invoice: existing, recovered: true };

  try {
    const r = await issueFiscalInvoice({
      vendor,
      total: Math.round(total * 100) / 100,
      orderId,
      bookingId,
      receptor,
      receptorNombre,
    });
    return { ok: true, invoice: r.invoice, qrUrl: r.qrUrl, recovered: r.recovered };
  } catch (e) {
    if (e instanceof FiscalIssueError) {
      return {
        ok: false,
        error: e.message,
        code: e.code,
        status: e.status,
        hint: e.hint,
        detail: e.detail?.slice(0, 2000),
      };
    }
    return { ok: false, error: e instanceof Error ? e.message : "Error al facturar" };
  }
}
