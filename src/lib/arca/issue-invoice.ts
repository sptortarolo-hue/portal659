/**
 * Emite una Factura C (ARCA) y la guarda en `invoices`, vinculada a un
 * pedido (order_id) o a un turno (booking_id). Usado tanto por
 * `POST /api/vendor/fiscal/emitir` (pedidos/mesas) como por el cobro de
 * turnos (`POST /api/vendor/bookings/[id]/cobro`).
 *
 * No valida plan ni config fiscal: el caller lo hace (403/409). Arroja
 * FiscalIssueError con { status, code, message, hint?, detail? }.
 */
import { queryOne } from "@/lib/db";
import { decryptFiscalSecret, isValidCuit } from "@/lib/arca/crypto";
import { ArcaError } from "@/lib/arca/wsaa";
import { explainArcaFault } from "@/lib/arca/faults";
import { parseArcaObs } from "@/lib/arca/wsfe";
import { emitirFacturaC, type EmitirFacturaCResult, type FiscalInvoice } from "@/lib/arca/emit";
import type { ReceptorFiscal } from "@/lib/arca/wsfe";
import type { Vendor } from "@/types/database";

export class FiscalIssueError extends Error {
  status: number;
  code: string;
  hint?: string;
  detail?: string;
  constructor(message: string, { status = 500, code = "fiscal_error", hint, detail }: { status?: number; code?: string; hint?: string; detail?: string } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.hint = hint;
    this.detail = detail;
  }
}

type IssueInput = {
  vendor: Vendor;
  total: number;
  orderId: string | null;
  bookingId: string | null;
  receptor: ReceptorFiscal | undefined;
  receptorNombre: string | null;
};

export async function issueFiscalInvoice(input: IssueInput): Promise<{ invoice: FiscalInvoice; qrUrl: string; recovered: boolean }> {
  const { vendor, total, orderId, bookingId, receptor, receptorNombre } = input;

  const cuit = (vendor.cuit || "").replace(/\D/g, "");
  const ptoVta = Number(vendor.fiscal_punto_venta);
  if (!cuit || !isValidCuit(cuit) || !Number.isInteger(ptoVta) || ptoVta <= 0) {
    throw new FiscalIssueError("Configurá CUIT y punto de venta en la sección Fiscal", { status: 409, code: "fiscal_config" });
  }
  if (!vendor.fiscal_cert || !vendor.fiscal_key) {
    throw new FiscalIssueError("Subí el certificado y la clave ARCA en la sección Fiscal", { status: 409, code: "fiscal_config" });
  }
  let certPem: string;
  let keyPem: string;
  try {
    certPem = decryptFiscalSecret(vendor.fiscal_cert);
    keyPem = decryptFiscalSecret(vendor.fiscal_key);
  } catch {
    throw new FiscalIssueError("No se pudo leer el certificado (revisá FISCAL_KEY y volvé a subirlo)", { status: 500, code: "fiscal_config" });
  }
  const env = vendor.fiscal_env === "prod" ? "prod" : "homo";
  const t0 = Date.now();
  const flog = (stage: string, extra?: string) =>
    console.log(`[fiscal] vendor=${vendor.id} ref=${orderId || bookingId} env=${env} stage=${stage} +${Date.now() - t0}ms${extra ? ` ${extra}` : ""}`);
  flog("start", `ptoVta=${ptoVta} total=${total}`);

  let r: EmitirFacturaCResult;
  try {
    r = await emitirFacturaC({ env, cuit, certPem, keyPem }, ptoVta, total, undefined, receptor);
    flog("cae-ok", `cbte=${r.puntoVenta}-${r.cbteNro}${r.recovered ? " recovered" : ""}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error de ARCA";
    const code = e instanceof ArcaError ? "arca_error" : "fiscal_error";
    const detail = e instanceof ArcaError ? (e as { detail?: string }).detail || "" : "";
    flog("error", `${code}: ${msg.slice(0, 200)}${detail && !msg.includes(detail.slice(0, 40)) ? ` | ${detail}` : ""}`);
    const hint = explainArcaFault(msg);
    const obs = e instanceof ArcaError ? parseArcaObs(detail) : [];
    const fullMsg = obs.length > 0 ? `${msg} (${obs.join(" | ").slice(0, 500)})` : msg;
    throw new FiscalIssueError(fullMsg, { status: 502, code, hint: hint ?? undefined, detail });
  }

  const hasReceptorCols = await queryOne<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_name = 'invoices' AND column_name = 'receptor_nombre'
     ) AS exists`
  );
  const receptorCols = hasReceptorCols?.exists === true ? ", receptor_nombre, receptor_cond_iva" : "";
  const receptorVals = hasReceptorCols?.exists === true ? [receptorNombre, receptor?.condicionIva] : [];

  let saved!: FiscalInvoice;
  try {
    saved = (await queryOne<FiscalInvoice>(
      `INSERT INTO invoices (vendor_id, order_id, booking_id, cbte_tipo, punto_venta, cbte_nro, cae, cae_vto, total, receptor_doc_tipo, receptor_doc_nro, env${receptorCols})
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12${receptorVals.map((_, i) => `, $${13 + i}`).join("")})
       RETURNING *`,
      [
        vendor.id,
        orderId ?? null,
        bookingId ?? null,
        r.cbteTipo,
        r.puntoVenta,
        r.cbteNro,
        r.cae,
        r.caeVto,
        total,
        receptor?.docTipo,
        receptor?.docNro,
        env,
        ...receptorVals,
      ]
    ))!;
  } catch {
    // Carrera: otro request lo guardó primero → devolver el existente.
    const raced = await queryOne<FiscalInvoice>(
      `SELECT * FROM invoices WHERE vendor_id = $1 AND COALESCE(booking_id, order_id) = $2 LIMIT 1`,
      [vendor.id, bookingId ?? orderId]
    );
    if (raced) return { invoice: raced, qrUrl: r.qrUrl, recovered: true };
    throw new FiscalIssueError("No se pudo guardar el comprobante", { status: 500, code: "arca_error" });
  }
  return { invoice: saved, qrUrl: r.qrUrl, recovered: r.recovered };
}
