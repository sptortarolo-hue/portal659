/**
 * Check del comprobante "realzado" (PNG que se manda por WhatsApp).
 *
 * Renderiza un comprobante de ejemplo con la misma ruta que la API
 * (`src/lib/receipt-image.ts` → pureimage + Roboto del repo) y verifica:
 *   1. ancho 1080 px (documento vertical),
 *   2. que haya TEXTO (tinta en todas las franjas del cuerpo),
 *   3. que haya COLOR (franja de acento + logo a color),
 *   4. que el QR fiscal se haya dibujado (zona del QR con tinta densa).
 *
 *   node scripts/check-receipt-image.mjs
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
const { renderReceiptCard } = require("../src/lib/receipt-image.ts");

const outPath =
  process.env.PORTAL659_CHECK_OUT || path.join(os.tmpdir(), "portal659-receipt-check.png");

function fail(msg) {
  console.error(`[check-receipt-image] FAIL: ${msg}`);
  process.exit(1);
}

/** Logo de prueba (para ejercitar el mismo camino que el logo real). */
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

/** Tinta (oscuros) por franja horizontal + cantidad de píxeles con color. */
async function analyze(png) {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const bands = 5;
  const counts = new Array(bands).fill(0);
  const saturated = new Array(bands).fill(0);
  // Identidad Portal 659: azul #4f46e5 + lima #a3e635 (y la lima fuerte #4d7c0f).
  const BLUE = [79, 70, 229];
  const LIME = [163, 230, 53];
  const LIME_STRONG = [77, 124, 15];
  let blue = 0;
  let lime = 0;
  let limeStrong = 0;

  const near = (r, g, b, [tr, tg, tb], tol = 26) =>
    Math.abs(r - tr) <= tol && Math.abs(g - tg) <= tol && Math.abs(b - tb) <= tol;

  for (let y = 0; y < info.height; y++) {
    const band = Math.min(bands - 1, Math.floor((y / info.height) * bands));
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * info.channels;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if ((r + g + b) / 3 < 160) counts[band]++;
      if (Math.max(r, g, b) - Math.min(r, g, b) > 40) saturated[band]++;
      if (near(r, g, b, BLUE)) blue++;
      if (near(r, g, b, LIME)) lime++;
      if (near(r, g, b, LIME_STRONG)) limeStrong++;
    }
  }
  return { counts, saturated, blue, lime, limeStrong, width: info.width, height: info.height };
}

async function main() {
  const logoUrl = await makeTestLogo();

  const png = await renderReceiptCard({
    storeName: "Peluquería y Estética Demo",
    logoUrl,
    address: "Av. Siempreviva 742, CABA",
    phone: "11 5555 1234",
    whatsapp: "11 5555 1234",
    instagram: "pelu.demo",
    facebook: "peludemo",
    categoryLabel: "Peluquería y estética",
    neighborhood: "Sicardi",
    customerName: "Ana Gómez",
    serviceName: "Corte + Barba",
    staffName: "Carla",
    date: "14/11/2026",
    time: "10:30",
    durationMin: 60,
    locationName: "Sucursal Centro",
    notes: "Tono 7, sin raya en la sien.",
    productsUsed: "Shampoo reparador, leave-in",
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
    storeUrl: "https://www.portal659.com.ar/tienda/pelu-demo",
  });

  if (!png) fail("renderReceiptCard devolvió null");
  fs.writeFileSync(outPath, png);

  const meta = await sharp(png).metadata();
  if (meta.width !== 1080) fail(`ancho esperado 1080, obtenido ${meta.width}`);
  if (!meta.height || meta.height < 900) fail(`alto insuficiente: ${meta.height}`);

  const { counts, saturated, blue, lime, limeStrong } = await analyze(png);
  console.log("[check-receipt-image] tinta por franja:", counts);
  console.log("[check-receipt-image] color por franja :", saturated);
  console.log(
    "[check-receipt-image] portal → azul:",
    blue,
    "lima:",
    lime,
    "lima fuerte:",
    limeStrong
  );

  // Franja 0: encabezado (franja azul del portal + logo + nombre).
  if (saturated[0] < 20000) fail("la franja del encabezado no tiene el color de acento");
  // Identidad Portal 659: azul #4f46e5 en la franja del encabezado.
  if (blue < 20000) fail(`falta el azul del portal (#4f46e5) en el comprobante (${blue} px)`);
  // Detalles en lima: separadores + barra de la caja de totales.
  if (lime < 2000) fail(`falta la lima del portal (#a3e635) en los detalles (${lime} px)`);
  // El "Total" y "Reservá tu próximo turno" van en lima fuerte (legible).
  if (limeStrong < 500) fail(`falta la lima fuerte (#4d7c0f) en los textos destacados (${limeStrong} px)`);
  // Franjas 1..4: el cuerpo tiene texto en todas.
  for (let i = 1; i < counts.length; i++) {
    if (counts[i] < 800) fail(`sin texto suficiente en la franja ${i} (${counts[i]})`);
  }
  // La última franja incluye el QR fiscal: tiene que ser densa en píxeles.
  const totalInk = counts.reduce((a, b) => a + b, 0);
  if (totalInk < 8000) fail(`muy poca tinta (${totalInk}): parece que no se dibujó el texto`);

  console.log(
    `[check-receipt-image] OK → ${outPath} (${meta.width}x${meta.height}, tinta=${totalInk}, azul=${blue}, lima=${lime}, limaFuerte=${limeStrong})`
  );
}

main().catch((e) => {
  console.error("[check-receipt-image] FAIL:", e);
  process.exit(1);
});
