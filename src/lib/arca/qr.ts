/**
 * QR fiscal ARCA (obligatorio en el comprobante).
 * Payload JSON → base64url → URL de verificación.
 */
import { arFechaISO } from "./fecha.ts";

export type QrPayload = {
  cuit: string;
  ptoVta: number;
  cbteTipo: number;
  cbteNro: number;
  importe: number;
  cae: string;
  fecha: Date;
  /** Receptor identificado. Default 99 / "0" = consumidor final. */
  receptorDocTipo?: number | null;
  receptorDocNro?: string | null;
};

export function buildQrPayload(p: QrPayload): Record<string, number | string> {
  const tipoDocRec = Number(p.receptorDocTipo) || 99;
  const docNro = String(p.receptorDocNro ?? "").replace(/\D/g, "");
  return {
    ver: 1,
    fecha: arFechaISO(p.fecha),
    cuit: Number(p.cuit.replace(/\D/g, "")),
    ptoVta: p.ptoVta,
    tipoCmp: p.cbteTipo,
    nroCmp: p.cbteNro,
    importe: Math.round(p.importe * 100) / 100,
    moneda: "PES",
    ctz: 1,
    tipoDocRec,
    nroDocRec: tipoDocRec === 99 ? 0 : Number(docNro || 0),
    tipoCodAut: "E",
    codAut: p.cae,
  };
}

/** URL de verificación ARCA para imprimir junto al CAE. */
export function buildQrUrl(p: QrPayload): string {
  const b64 = Buffer.from(JSON.stringify(buildQrPayload(p)), "utf8").toString("base64");
  return `https://www.arca.gob.ar/fe/qr/?p=${b64}`;
}
