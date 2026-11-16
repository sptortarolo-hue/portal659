/**
 * Check de la tarjeta para compartir (og:image / preview de WhatsApp).
 *
 * Verifica:
 *  1. La tarjeta de la TIENDA usa el helper compartido y NO una URL remota
 *     en `background-image` (resvg no dibuja WebP/AVIF: los dejaba en blanco
 *     sin error → logo + texto y sin la foto del local).
 *  2. El helper normaliza cualquier formato a JPEG embebido (data URI).
 *  3. El recorte es "inteligente" (attention): con una foto vertical no
 *     muestra la franja vacía, sino la banda con detalle (el local).
 *  4. El recorte produce una tarjeta con la foto DIBUJADA (no plana).
 *  5. El panel NO guarda la URL blob: del recorte (rompía la foto en el
 *     micrositio y en la tarjeta) y el API rechaza URLs no http(s).
 *  6. La URL de la imagen lleva versión (?v=): al cambiar la portada,
 *     WhatsApp (que cachea la preview por URL) la vuelve a pedir.
 *  7. La caché de la tarjeta es corta (1h), no 24h.
 *
 *   node scripts/check-share-card.mjs
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
const React = require("react");

let failed = 0;
function fail(msg) {
  console.error(`[check-share-card] FAIL: ${msg}`);
  failed++;
}
function ok(msg) {
  console.log(`[check-share-card] OK: ${msg}`);
}
function readSrc(rel) {
  return fs.readFileSync(path.join(process.cwd(), rel), "utf8");
}
function expect(cond, msg) {
  if (cond) ok(msg);
  else fail(msg);
}

// ---------------------------------------------------------------- estáticos
const routeSrc = readSrc("src/app/api/share/tienda/[slug]/route.tsx");
expect(
  routeSrc.includes("coverJpegDataUri") && routeSrc.includes("squareJpegDataUri"),
  "la tarjeta de la tienda usa el helper compartido (foto y logo embebidos)"
);
expect(
  !/backgroundImage/.test(routeSrc),
  "la tarjeta no usa background-image con URL remota (resvg no dibuja WebP/AVIF)"
);
expect(
  routeSrc.includes("s-maxage=3600"),
  "la caché de la tarjeta es corta (1h) y no de 24h"
);

const libSrc = readSrc("src/lib/share-image.ts");
expect(
  libSrc.includes("data:image/jpeg;base64"),
  "el helper embebe la foto como JPEG (data URI)"
);
expect(
  libSrc.includes("sharp.strategy.attention"),
  "el helper recorta con la banda más detallada (attention)"
);

const dashSrc = readSrc("src/app/vendor/dashboard/page.tsx");
const cropHandler = dashSrc.slice(
  dashSrc.indexOf("const handleCropComplete"),
  dashSrc.indexOf("const handleCropComplete") + 900
);
expect(
  cropHandler.includes("done?.(file)") || cropHandler.includes("done(file)"),
  "el recorte devuelve el ARCHIVO recortado (no una URL blob:)"
);
expect(
  !/image_url[^\n]*previewUrl|logo_url[^\n]*previewUrl/.test(dashSrc),
  "el panel nunca guarda el previewUrl (blob:) en la base"
);
// Los 5 paneles con recorte (portada/logo) tienen que stagear el archivo
// recortado: si stagean el original, el "Guardar" lo sube y se pierde el
// recorte.
for (const dash of [
  "dashboard-estetica",
  "dashboard-comercio",
  "dashboard-gastro",
  "dashboard-generico",
  "dashboard-servicio",
]) {
  const src = readSrc(`src/components/dashboard/${dash}.tsx`);
  expect(
    /onCrop\("cover", src, \(cropped\) =>/.test(src) &&
      /setStoreFile\(cropped\)/.test(src),
    `${dash}: el panel sube el archivo YA recortado (no el original)`
  );
}

const meSrc = readSrc("src/app/api/vendor/me/route.ts");
expect(
  meSrc.includes("normalizeImageUrl"),
  "el API valida que la foto NO sea una URL temporal (blob:/data:)"
);
expect(
  meSrc.includes("blob:|data:"),
  "el API rechaza explícitamente las URLs blob:/data:"
);
expect(
  !meSrc.includes("payload.image_url = image_url || null"),
  "el API ya no guarda image_url a ciegas"
);

const tiendaSrc = readSrc("src/app/tienda/[slug]/page.tsx");
expect(
  tiendaSrc.includes("shareVersion") && tiendaSrc.includes("shareQuery"),
  "la og:image del micrositio lleva versión (?v=) para que WhatsApp la vuelva a pedir"
);

// El link COMPARTIDO también va versionado: WhatsApp cachea la preview por
// URL de página, así que si el link no cambia sigue viendo la tarjeta vieja.
const versionLib = require("../src/lib/share-version.ts");
const v1 = versionLib.shareVersionFor("https://x/foto.jpg", "https://x/logo.png");
const v2 = versionLib.shareVersionFor("https://x/foto2.jpg", "https://x/logo.png");
const v3 = versionLib.shareVersionFor("https://x/foto.jpg", "https://x/logo.png");
expect(!!v1 && v1 !== v2, "la versión cambia cuando cambia la foto del local");
expect(v1 === v3, "la versión es estable si la foto no cambia");

const shareBtnSrc = readSrc("src/components/store/whatsapp-share-button.tsx");
expect(
  shareBtnSrc.includes("version") && shareBtnSrc.includes("v=${version}"),
  "el link que comparte el micrositio lleva la versión de la foto"
);
expect(
  dashSrc.includes("?v=${shareVersion}"),
  "el link que comparte el panel lleva la versión de la foto"
);
expect(
  dashSrc.includes("/og/tienda/${vendor.slug}.jpg?cb="),
  "el panel tiene un botón para ver la tarjeta (preview real, sin caché)"
);

// ------------------------------------------------------------- funcionales
const { toJpegDataUri } = require("../src/lib/share-image.ts");

// Foto vertical sintética: mitad de arriba PLANA (la "pared") y mitad de
// abajo con detalle (el "local"). El recorte tiene que elegir la de abajo.
const flat = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="#0a7f78"/></svg>`
);
const detailed = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="600" height="800" fill="#ffffff"/>` +
    Array.from({ length: 40 }, (_, i) => `<rect x="${(i % 10) * 60}" y="${400 + Math.floor(i / 10) * 100}" width="58" height="98" fill="#e11d48"/>`).join("") +
    `</svg>`
);
const vertical = await sharp(detailed).composite([{ input: flat, top: 0, left: 0 }]).jpeg().toBuffer();

const dataUri = await toJpegDataUri(vertical, { width: 1200, height: 630, fit: "cover", smart: true });
expect(!!dataUri && dataUri.startsWith("data:image/jpeg;base64,"), "el helper devuelve un JPEG embebido");

if (dataUri) {
  const crop = Buffer.from(dataUri.split(",")[1], "base64");
  const meta = await sharp(crop).metadata();
  expect(
    meta.format === "jpeg" && meta.width === 1200 && meta.height === 630,
    `el recorte sale en 1200x630 JPEG (${meta.format} ${meta.width}x${meta.height})`
  );
  const { data, info } = await sharp(crop).resize(20, 10, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
  let sum = [0, 0, 0];
  const n = data.length / info.channels;
  for (let i = 0; i < data.length; i += info.channels) {
    for (let c = 0; c < 3; c++) sum[c] += data[i + c];
  }
  const mean = sum.map((s) => Math.round(s / n));
  const esPared = Math.abs(mean[0] - 10) < 60 && Math.abs(mean[1] - 127) < 60 && Math.abs(mean[2] - 120) < 60;
  expect(!esPared, `el recorte NO muestra la franja plana de la foto (mean=${mean.join(",")})`);
}

// Render real con el mismo motor de next/og: la foto tiene que quedar
// DIBUJADA (no un fondo plano).
const ogPath = path.join(process.cwd(), "node_modules", "next", "dist", "server", "og", "image-response.js");
const { ImageResponse } = require(ogPath);
const h = React.createElement;

async function renderCard(src) {
  const el = h(
    "div",
    {
      style: {
        width: 1200,
        height: 630,
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-end",
        alignItems: "flex-start",
        padding: 48,
        background: "#333333",
        position: "relative",
        fontFamily: "system-ui, sans-serif",
      },
    },
    [
      h("img", {
        src,
        width: 1200,
        height: 630,
        style: { position: "absolute", inset: 0, width: 1200, height: 630, objectFit: "cover" },
      }),
      h("div", { style: { position: "relative", color: "#fff", fontSize: 56, fontWeight: 800 } }, "TEXTO"),
    ]
  );
  const res = new ImageResponse(el, { width: 1200, height: 630 });
  const png = Buffer.from(await res.arrayBuffer());
  const { data, info } = await sharp(png).resize(40, 20, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
  let sum = [0, 0, 0];
  const n = data.length / info.channels;
  for (let i = 0; i < data.length; i += info.channels) {
    for (let c = 0; c < 3; c++) sum[c] += data[i + c];
  }
  return sum.map((s) => Math.round(s / n));
}

// 1) Foto WebP cruda (sin normalizar): el motor NO la dibuja (info).
const webp = await sharp(detailed).webp().toBuffer();
const webpUri = `data:image/webp;base64,${webp.toString("base64")}`;
const meanWebp = await renderCard(webpUri);
const plano = Math.abs(meanWebp[0] - meanWebp[1]) < 12 && Math.abs(meanWebp[1] - meanWebp[2]) < 12;
console.log(`[check-share-card] INFO: WebP crudo en la tarjeta -> mean=${meanWebp.join(",")} (${plano ? "plano: motivo del bug" : "dibujado"})`);

// 2) La misma foto normalizada a JPEG (lo que hace el helper): se dibuja.
const webpNormalizada = await toJpegDataUri(webp, { width: 1200, height: 630, fit: "cover", smart: true });
expect(!!webpNormalizada, "una foto WebP se normaliza a JPEG sin perderla");
if (webpNormalizada) {
  const meanJpeg = await renderCard(webpNormalizada);
  const planoJpeg = Math.abs(meanJpeg[0] - meanJpeg[1]) < 12 && Math.abs(meanJpeg[1] - meanJpeg[2]) < 12;
  expect(!planoJpeg, `con la foto normalizada la tarjeta la DIBUJA (mean=${meanJpeg.join(",")})`);
}

// 3) El motor dibuja la foto embebida (ya cubierto arriba). Sin pruebas de
// red: el check tiene que correr también sin internet.

if (failed > 0) {
  console.error(`[check-share-card] ${failed} check(s) fallaron`);
  process.exit(1);
}
console.log("[check-share-card] Todo OK");
