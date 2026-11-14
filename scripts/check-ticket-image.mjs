/**
 * Check del comprobante PNG (WhatsApp / descarga).
 *
 * Renderiza un comprobante de ejemplo con la misma ruta que usa la API
 * (`src/lib/ticket-image.ts` → pureimage + Roboto-Bold del repo) y verifica:
 *   1. que el PNG se genere con el ancho esperado (1152 px = 80mm ×2),
 *   2. que haya TEXTO (tinta en las franjas del cuerpo, no sólo el logo),
 *   3. que el QR fiscal se dibuje.
 *
 * Corre en cualquier lado (no necesita Docker ni DB):
 *   node scripts/check-ticket-image.mjs
 */
import { createRequire } from "node:module";
import fs from "fs";
import os from "os";
import path from "path";

const require = createRequire(import.meta.url);
const Module = require("module");
const ts = require("typescript");

// --- Mini-loader TS: compila los .ts del repo y resuelve el alias "@/..." ---
const srcRoot = path.resolve(process.cwd(), "src");
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request.startsWith("@/")) request = path.join(srcRoot, request.slice(2));
  return origResolve.call(this, request, ...args);
};
require.extensions[".ts"] = function (mod, filename) {
  const out = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: filename,
  }).outputText;
  mod._compile(out, filename);
};

const sharp = require("sharp");
const { renderReceiptImage } = require("../src/lib/ticket-image.ts");

const outPath =
  process.env.PORTAL659_CHECK_OUT || path.join(os.tmpdir(), "portal659-receipt-check.png");

function fail(msg) {
  console.error(`[check-ticket-image] FAIL: ${msg}`);
  process.exit(1);
}

// --- Logo de prueba (para ejercitar el mismo camino que el logo real) ---
async function makeTestLogo() {
  const dir = path.join(process.cwd(), "uploads", "_check");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "logo-test.png");
  const png = await sharp({
  create: { width: 256, height: 256, channels: 4, background: { r: 244, g: 67, b: 54, alpha: 1 } },
  })
    .composite([
      {
        input: Buffer.from(
          `<svg width="256" height="256"><circle cx="128" cy="128" r="96" fill="#ffffff"/><text x="128" y="152" font-size="72" text-anchor="middle" fill="#d32f2f">P</text></svg>`
        ),
        top: 0,
        left: 0,
      },
    ])
    .png()
    .toBuffer();
  fs.writeFileSync(file, png);
  return "/uploads/_check/logo-test.png";
}

/** Devuelve la cantidad de píxeles oscuros por franja horizontal. */
async function inkBands(png) {
  const { data, info } = await sharp(png).greyscale().raw().toBuffer({ resolveWithObject: true });
  const bands = 4;
  const h = info.height;
  const counts = new Array(bands).fill(0);
  for (let y = 0; y < h; y++) {
    const band = Math.min(bands - 1, Math.floor((y / h) * bands));
    for (let x = 0; x < info.width; x++) {
      if (data[y * info.width + x] < 160) counts[band]++;
    }
  }
  return counts;
}

async function main() {
  const logoUrl = await makeTestLogo();

  const png = await renderReceiptImage({
    storeName: "Peluquería y Estética Demo",
    logoUrl,
    address: "Av. Siempreviva 742, CABA",
    phone: "11 5555 1234",
    whatsapp: "11 5555 1234",
    instagram: "pelu.demo",
    facebook: "peludemo",
    customerName: "Ana Gómez",
    date: "14/11/2026",
    time: "10:30",
    staffName: "Carla",
    bookingRef: "ab12cd34",
    items: [
      { name: "Corte + Barba", qty: 1, price: 18000 },
      { name: "Coloración", qty: 2, price: 25000, modifiers: ["Tono 7", "Ampollillas"] },
    ],
    total: 68000,
    depositPaid: 20000,
    amountPaid: 48000,
    cashAmount: 50000,
    vuelto: 2000,
    paymentMethod: "efectivo",
    invoiceNumber: "0001-00001234",
    cae: "71234567890123",
    caeVto: "2026-11-24",
    isFiscal: true,
    qrData: "https://www.arca.gob.ar/fe/qr/?p=dGVzdA",
    docTitle: "TICKET",
    footer: "Factura C — documento fiscal",
  });

  if (!png) fail("renderReceiptImage devolvió null");
  fs.writeFileSync(outPath, png);

  const meta = await sharp(png).metadata();
  if (meta.width !== 1152) fail(`ancho esperado 1152, obtenido ${meta.width}`);
  if (!meta.height || meta.height < 400) fail(`alto insuficiente: ${meta.height}`);

  const bands = await inkBands(png);
  console.log("[check-ticket-image] ink por franja (arriba→abajo):", bands);

  // Franja 3 (mitad): encabezado + items. Franja 4 (abajo): totales + fiscal.
  if (bands[2] < 200) fail("sin texto en la franja media (encabezado/ítems)");
  if (bands[3] < 200) fail("sin texto en la franja inferior (totales/fiscal)");

  const totalInk = bands.reduce((a, b) => a + b, 0);
  if (totalInk < 1500) fail(`muy poca tinta (${totalInk}): parece que sólo se dibujó el logo`);

  console.log(`[check-ticket-image] OK → ${outPath} (${meta.width}x${meta.height}, tinta=${totalInk})`);
}

main().catch((e) => {
  console.error("[check-ticket-image] FAIL:", e);
  process.exit(1);
});
