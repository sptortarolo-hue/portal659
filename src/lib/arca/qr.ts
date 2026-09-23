/**
 * QR fiscal ARCA (obligatorio en el comprobante).
 * Payload JSON → base64url → URL de verificación.
 */
export type QrPayload = {
  cuit: string;
  ptoVta: number;
  cbteTipo: number;
  cbteNro: number;
  importe: number;
  cae: string;
  fecha: Date;
};

export function buildQrPayload(p: QrPayload): Record<string, number | string> {
  const d = p.fecha;
  const fecha = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return {
    ver: 1,
    fecha,
    cuit: Number(p.cuit.replace(/\D/g, "")),
    ptoVta: p.ptoVta,
    tipoCmp: p.cbteTipo,
    nroCmp: p.cbteNro,
    importe: Math.round(p.importe * 100) / 100,
    moneda: "PES",
    ctz: 1,
    tipoDocRec: 99,
    nroDocRec: 0,
    tipoCodAut: "E",
    codAut: p.cae,
  };
}

/** URL de verificación ARCA para imprimir junto al CAE. */
export function buildQrUrl(p: QrPayload): string {
  const b64 = Buffer.from(JSON.stringify(buildQrPayload(p)), "utf8").toString("base64");
  return `https://www.arca.gob.ar/fe/qr/?p=${b64}`;
}
