/**
 * Orquestador de emisión: Factura C para un pedido cobrado.
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
  consultarComprobante,
  solicitarCaeC,
  ultimoAutorizado,
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

export async function emitirFacturaC(
  auth: WsfeAuth,
  puntoVenta: number,
  total: number,
  fecha?: Date
): Promise<EmitirFacturaCResult> {
  const when = fecha ?? new Date();
  const ultimo = await ultimoAutorizado(auth, puntoVenta, CBTE_FACTURA_C);
  const cbteNro = ultimo + 1;

  try {
    const r = await solicitarCaeC(auth, { ptoVta: puntoVenta, cbteNro, total, fecha: when });
    return {
      cbteTipo: CBTE_FACTURA_C,
      puntoVenta,
      cbteNro: r.cbteNro,
      cae: r.cae,
      caeVto: r.caeVto,
      qrUrl: buildQrUrl({
        cuit: auth.cuit,
        ptoVta: puntoVenta,
        cbteTipo: CBTE_FACTURA_C,
        cbteNro: r.cbteNro,
        importe: total,
        cae: r.cae,
        fecha: when,
      }),
      recovered: false,
    };
  } catch (e) {
    // Número ya autorizado (corte a mitad de camino o retry): se recupera
    // el CAE existente en vez de facturar duplicado.
    if (e instanceof ArcaError && (e as { duplicate?: boolean }).duplicate === true) {
      const found = await consultarComprobante(auth, puntoVenta, cbteNro);
      if (found) {
        return {
          cbteTipo: CBTE_FACTURA_C,
          puntoVenta,
          cbteNro: found.cbteNro,
          cae: found.cae,
          caeVto: found.caeVto,
          qrUrl: buildQrUrl({
            cuit: auth.cuit,
            ptoVta: puntoVenta,
            cbteTipo: CBTE_FACTURA_C,
            cbteNro: found.cbteNro,
            importe: total,
            cae: found.cae,
            fecha: when,
          }),
          recovered: true,
        };
      }
    }
    throw e;
  }
}
