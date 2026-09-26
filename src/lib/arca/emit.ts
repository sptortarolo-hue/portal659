/**
 * Orquestador de emisión: Factura C y Nota de Crédito C.
 *
 *   auth (cert descifrado) → último autorizado → próximo número →
 *   solicitar CAE → (si 10016/duplicado: consultar y recuperar) → QR.
 *
 * No toca la DB: la persistencia vive en la ruta API (idempotencia por
 * UNIQUE(vendor_id, order_id) en `invoices`).
 */
import { ArcaError } from "./wsaa";
import {
  CBTE_FACTURA_C,
  CBTE_NOTA_CREDITO_C,
  consultarComprobante,
  solicitarCaeC,
  ultimoAutorizado,
  type CbteAsociado,
  type WsfeAuth,
} from "./wsfe";
import { buildQrUrl } from "./qr";

export type EmitirFacturaCResult = {
  cbteTipo: number;
  puntoVenta: number;
  cbteNro: number;
  cae: string;
  /** Vencimiento CAE en YYYYMMDD. */
  caeVto: string;
  qrUrl: string;
  /** true si el CAE se recuperó de ARCA (ya estaba autorizado). */
  recovered: boolean;
};

/** Fila de comprobante (espejo de `invoices` para las rutas API). */
export type FiscalInvoice = {
  id: string;
  order_id: string;
  cbte_tipo: number;
  punto_venta: number;
  cbte_nro: number;
  cae: string;
  cae_vto: string;
  total: number;
  env: string;
  created_at: string;
  asoc_tipo?: number | null;
  asoc_pto?: number | null;
  asoc_nro?: number | null;
};

export type EmitirComprobanteInput = {
  cbteTipo: number;
  puntoVenta: number;
  total: number;
  fecha?: Date;
  cbtesAsoc?: CbteAsociado[];
};

async function emitirComprobante(
  auth: WsfeAuth,
  input: EmitirComprobanteInput
): Promise<EmitirFacturaCResult> {
  const when = input.fecha ?? new Date();
  const ultimo = await ultimoAutorizado(auth, input.puntoVenta, input.cbteTipo);
  const cbteNro = ultimo + 1;

  const qrFor = (nro: number, cae: string) =>
    buildQrUrl({
      cuit: auth.cuit,
      ptoVta: input.puntoVenta,
      cbteTipo: input.cbteTipo,
      cbteNro: nro,
      importe: input.total,
      cae,
      fecha: when,
    });

  try {
    const r = await solicitarCaeC(auth, {
      ptoVta: input.puntoVenta,
      cbteNro,
      total: input.total,
      fecha: when,
      cbteTipo: input.cbteTipo,
      cbtesAsoc: input.cbtesAsoc,
    });
    return {
      cbteTipo: input.cbteTipo,
      puntoVenta: input.puntoVenta,
      cbteNro: r.cbteNro,
      cae: r.cae,
      caeVto: r.caeVto,
      qrUrl: qrFor(r.cbteNro, r.cae),
      recovered: false,
    };
  } catch (e) {
    // Número ya autorizado (corte a mitad de camino o retry): se recupera
    // el CAE existente en vez de facturar duplicado.
    if (e instanceof ArcaError && (e as { duplicate?: boolean }).duplicate === true) {
      const found = await consultarComprobante(auth, input.puntoVenta, input.cbteTipo, cbteNro);
      if (found) {
        return {
          cbteTipo: input.cbteTipo,
          puntoVenta: input.puntoVenta,
          cbteNro: found.cbteNro,
          cae: found.cae,
          caeVto: found.caeVto,
          qrUrl: qrFor(found.cbteNro, found.cae),
          recovered: true,
        };
      }
    }
    throw e;
  }
}

export async function emitirFacturaC(
  auth: WsfeAuth,
  puntoVenta: number,
  total: number,
  fecha?: Date
): Promise<EmitirFacturaCResult> {
  return emitirComprobante(auth, {
    cbteTipo: CBTE_FACTURA_C,
    puntoVenta,
    total,
    fecha,
  });
}

/** Nota de Crédito C por el total, asociada a la factura original. */
export async function emitirNotaCreditoC(
  auth: WsfeAuth,
  puntoVenta: number,
  total: number,
  asociada: CbteAsociado,
  fecha?: Date
): Promise<EmitirFacturaCResult> {
  return emitirComprobante(auth, {
    cbteTipo: CBTE_NOTA_CREDITO_C,
    puntoVenta,
    total,
    fecha,
    cbtesAsoc: [asociada],
  });
}
