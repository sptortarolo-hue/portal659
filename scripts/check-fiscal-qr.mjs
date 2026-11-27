/**
 * Verificación del QR fiscal ARCA y de las fechas en TZ Argentina.
 * Corre con: node scripts/check-fiscal-qr.mjs
 *
 * Invariantes:
 *   1. Sin receptor → consumidor final (tipoDocRec 99, nroDocRec 0).
 *   2. Con DNI/CUIT → el QR lleva el documento real de la factura.
 *   3. La fecha del QR y del CbteFch se calculan en hora AR, no en UTC del VPS.
 *   4. La URL de verificación codifica el payload en base64.
 */
import assert from "node:assert/strict";
import { buildQrPayload, buildQrUrl } from "../src/lib/arca/qr.ts";
import { arFechaISO, arYYYYMMDD } from "../src/lib/arca/fecha.ts";

const base = {
  cuit: "20-12345678-9",
  ptoVta: 1,
  cbteTipo: 11,
  cbteNro: 42,
  importe: 1500.5,
  cae: "123456789012345",
  fecha: new Date("2026-11-27T15:00:00Z"),
};

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ✔ ${name}`);
  } catch (e) {
    console.error(`  ✘ ${name}: ${e.message}`);
    failures++;
  }
}

check("default consumidor final", () => {
  const p = buildQrPayload(base);
  assert.equal(p.tipoDocRec, 99);
  assert.equal(p.nroDocRec, 0);
  assert.equal(p.ver, 1);
  assert.equal(p.moneda, "PES");
  assert.equal(p.tipoCodAut, "E");
  assert.equal(p.codAut, base.cae);
  assert.equal(p.cuit, 20123456789);
});

check("DNI identificado viaja en el QR", () => {
  const p = buildQrPayload({ ...base, receptorDocTipo: 96, receptorDocNro: "12.345.678" });
  assert.equal(p.tipoDocRec, 96);
  assert.equal(p.nroDocRec, 12345678);
});

check("CUIT identificado viaja en el QR", () => {
  const p = buildQrPayload({ ...base, receptorDocTipo: 80, receptorDocNro: "20-12345678-9" });
  assert.equal(p.tipoDocRec, 80);
  assert.equal(p.nroDocRec, 20123456789);
});

check("tipo 99 con documento fuerza nroDocRec 0", () => {
  const p = buildQrPayload({ ...base, receptorDocTipo: 99, receptorDocNro: "12345678" });
  assert.equal(p.nroDocRec, 0);
});

check("fecha en hora AR al mediodía", () => {
  const at = new Date("2026-11-27T15:00:00Z"); // 12:00 AR
  assert.equal(arFechaISO(at), "2026-11-27");
  assert.equal(arYYYYMMDD(at), "20261127");
  assert.equal(buildQrPayload({ ...base, fecha: at }).fecha, "2026-11-27");
});

check("fecha en hora AR después de las 21:00 UTC", () => {
  const at = new Date("2026-11-27T23:30:00Z"); // 20:30 del 27 en AR
  assert.equal(arFechaISO(at), "2026-11-27");
  // Caso límite real: 02:30 UTC del 28 = 23:30 del 27 en AR.
  const late = new Date("2026-11-28T02:30:00Z");
  assert.equal(arFechaISO(late), "2026-11-27");
  assert.equal(arYYYYMMDD(late), "20261127");
  // Y con getters UTC (el bug histórico) sería 2026-11-28.
  assert.equal(late.getUTCDate(), 28);
});

check("la URL codifica el payload", () => {
  const url = buildQrUrl(base);
  assert.ok(url.startsWith("https://www.arca.gob.ar/fe/qr/?p="));
  const p = JSON.parse(Buffer.from(url.split("?p=")[1], "base64").toString("utf8"));
  assert.equal(p.codAut, base.cae);
  assert.equal(p.tipoDocRec, 99);
});

if (failures) {
  console.error(`\n${failures} verificación(es) fallaron`);
  process.exit(1);
}
console.log("\nQR fiscal y fechas AR: OK");
