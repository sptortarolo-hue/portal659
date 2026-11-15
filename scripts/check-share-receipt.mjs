/**
 * Check del envío del comprobante por WhatsApp.
 *
 * Verifica:
 *  1. El comprobante ESCRITO (fallback sin imagen) se arma bien: encabezado,
 *     datos del turno, partidas, total, fiscal y links.
 *  2. El link del chat se arma con E.164 (wa.me/549...) y con fallback al
 *     selector de contactos cuando no hay teléfono.
 *  3. El helper abre el chat SINCRÓNICAMENTE (antes de cualquier await): si
 *     se abriera después, el navegador lo bloquea como popup y no pasa nada
 *     (el bug que se reportó).
 *  4. wa-dispatch manda el E.164 al bot (si no, el JID queda mal y el mensaje
 *     no llega).
 *  5. La API devuelve share.waUrl / share.receiptText / share.botLinked.
 *  6. Queda UN solo botón de envío (no "Compartir" + "Enviar").
 *
 *   node scripts/check-share-receipt.mjs
 */
import { createRequire } from "node:module";
import fs from "fs";
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

const { buildReceiptText, paymentLabel } = require("../src/lib/receipt-text.ts");
const { buildWaUrl } = require("../src/lib/share-receipt.ts");

function fail(msg) {
  console.error(`[check-share-receipt] FAIL: ${msg}`);
  process.exit(1);
}

function ok(msg) {
  console.log(`[check-share-receipt] OK: ${msg}`);
}

function readSrc(rel) {
  return fs.readFileSync(path.join(process.cwd(), rel), "utf8");
}

// ---------------------------------------------------------------- 1. texto
const texto = buildReceiptText({
  storeName: "Peluquería Demo",
  customerName: "Ana Gómez",
  serviceName: "Corte + Barba",
  staffName: "Carla",
  date: "14/11/2026",
  time: "10:30",
  durationMin: 60,
  locationName: "Sucursal Centro",
  notes: "Tono 7, sin raya en la sien.",
  productsUsed: "Shampoo reparador",
  items: [
    { name: "Corte + Barba", qty: 1, price: 18000 },
    { name: "Coloración", qty: 2, price: 25000, modifiers: ["Tono 7"] },
  ],
  total: 68000,
  depositPaid: 20000,
  amountPaid: 48000,
  cashAmount: 50000,
  vuelto: 2000,
  paymentMethod: "efectivo",
  invoiceNumber: "0001-00001234",
  cae: "71234567890123",
  isFiscal: true,
  storeUrl: "https://www.portal659.com.ar/tienda/pelu-demo",
  instagram: "peludemo",
});

for (const esperado of [
  "🧾 *Tu comprobante de servicio*",
  "*Peluquería Demo*",
  "• Servicio: Corte + Barba",
  "• Profesional: Carla",
  "• Fecha: 14/11/2026 · 10:30",
  "• 1× Corte + Barba — $18.000",
  "• 2× Coloración — $50.000",
  "(Tono 7)",
  "💰 *Total: $68.000*",
  "Efectivo",
  "Vuelto $2.000",
  "Seña pagada: $20.000",
  "Factura C N° 0001-00001234",
  "CAE: 71234567890123",
]) {
  // (El saludo "Hola ... Gracias por tu visita." se quitó del comprobante
  // escrito: va en el texto corto que se manda antes, para no duplicar.)
  if (!texto.includes(esperado)) fail(`el comprobante escrito no tiene: ${esperado}`);
}
ok("el comprobante escrito tiene todos los datos");

if (paymentLabel("efectivo") !== "Efectivo") fail("paymentLabel no mapea efectivo");
if (paymentLabel("tarjeta") !== "Tarjeta") fail("paymentLabel no mapea tarjeta");

// ------------------------------------------------------------- 2. link WA
const wa1 = buildWaUrl("5491155551234", "hola Ana");
if (!wa1.startsWith("https://wa.me/5491155551234?text=")) fail(`waUrl E.164 mal: ${wa1}`);
const wa2 = buildWaUrl("11 5555-1234", "hola");
if (!wa2.startsWith("https://wa.me/5491155551234?text=")) fail(`waUrl no normaliza a E.164: ${wa2}`);
const wa3 = buildWaUrl(null, "hola");
if (!wa3.startsWith("https://wa.me/?text=")) fail(`waUrl sin teléfono mal: ${wa3}`);
ok("el link del chat se arma con E.164 (y fallback sin teléfono)");

// ------------------------------------- 3. el chat se abre sin awaits previos
const shareSrc = readSrc("src/lib/share-receipt.ts");
const openIdx = shareSrc.indexOf("const opened = openWa(waUrl);");
const awaitIdx = shareSrc.indexOf("await downloadImage");
if (openIdx < 0) fail("share-receipt.ts no abre el chat con openWa");
if (awaitIdx < 0) fail("share-receipt.ts no descarga la imagen");
if (openIdx > awaitIdx) fail("el chat se abre DESPUÉS de un await: el navegador lo va a bloquear");
if (!shareSrc.includes("canShareFiles()")) fail("share-receipt.ts no decide si puede compartir archivos");
ok("el chat se abre dentro del gesto del click (sin popup blocker)");

// ---------------------------------------------- 4. wa-dispatch manda E.164
const dispatchSrc = readSrc("src/lib/wa-dispatch.ts");
if (!dispatchSrc.includes("toE164(input.phone)")) fail("wa-dispatch no normaliza el teléfono a E.164");
if (!/waId:\s*phoneDigits/.test(dispatchSrc)) fail("wa-dispatch no manda el E.164 al bot");
ok("wa-dispatch manda el E.164 al bot");

// ------------------------------------------------- 5. la API devuelve el share
const apiSrc = readSrc("src/app/api/vendor/bookings/[id]/send-receipt/route.ts");
for (const needle of ["receiptText", "waUrl", "botLinked", "toE164(booking.customer_phone)"]) {
  if (!apiSrc.includes(needle)) fail(`la API no expone ${needle}`);
}
if (!apiSrc.includes("buildReceiptText")) fail("la API no arma el comprobante escrito");
ok("la API devuelve waUrl + receiptText + botLinked");

// ------------------------------------------------------- 6. un solo botón
for (const file of [
  "src/components/dashboard/booking-card.tsx",
  "src/components/dashboard/booking-cobro-modal.tsx",
]) {
  const src = readSrc(file);
  if (src.includes("📤 Compartir")) fail(`${file} todavía tiene el botón "Compartir"`);
  if (!src.includes("Enviar por WA") && !src.includes("Enviar comprobante por WA")) {
    fail(`${file} no tiene el botón de enviar`);
  }
  if (!src.includes("Abrir el chat de")) fail(`${file} no tiene el link al chat del cliente`);
}
ok("un solo botón de envío + link al chat del cliente");

console.log("[check-share-receipt] TODO OK");
