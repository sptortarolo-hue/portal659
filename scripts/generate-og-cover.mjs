/**
 * Genera public/og-cover.jpg (1200x630, JPEG liviano): la tarjeta de marca
 * que se ve al compartir portal659.com.ar (home y páginas sin og propio).
 *
 *   node scripts/generate-og-cover.mjs
 *
 * Todo se dibuja con pureimage (gradiente por filas + texto Roboto Bold +
 * ícono de la app) y se codifica a JPEG con sharp. Sin SVG (sharp en Windows
 * no siempre renderiza SVG consistentemente).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { PassThrough } from "stream";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const FONT_PATH = path.join(ROOT, "assets", "fonts", "Roboto-Bold.ttf");
const ICON_PATH = path.join(ROOT, "public", "icons", "icon-512.png");
const OUT_PATH = path.join(ROOT, "public", "og-cover.jpg");

const W = 1200;
const H = 630;

// Colores de marca (del ícono): lima → azul real.
const TOP = { r: 0xa3, g: 0xe6, b: 0x35 }; // #a3e635
const BOTTOM = { r: 0x1d, g: 0x4e, b: 0xd8 }; // #1d4ed8

async function pngBuffer(PImage, img) {
  const pt = new PassThrough();
  const chunks = [];
  pt.on("data", (c) => chunks.push(c));
  const done = new Promise((res, rej) => {
    pt.on("end", res);
    pt.on("error", rej);
  });
  await PImage.encodePNGToStream(img, pt);
  await done;
  return Buffer.concat(chunks);
}

async function main() {
  const PImage = await import("pureimage");
  PImage.registerFont(FONT_PATH, "RobotoBold").loadSync();

  const img = PImage.make(W, H);
  const ctx = img.getContext("2d");

  // Fondo: gradiente vertical lima → azul (por filas).
  for (let y = 0; y < H; y++) {
    const t = y / (H - 1);
    const r = Math.round(TOP.r + (BOTTOM.r - TOP.r) * t);
    const g = Math.round(TOP.g + (BOTTOM.g - TOP.g) * t);
    const b = Math.round(TOP.b + (BOTTOM.b - TOP.b) * t);
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(0, y, W, 1);
  }

  // Ícono de la app centrado (con su "gloss" propio).
  const iconStream = fs.createReadStream(ICON_PATH);
  const icon = await PImage.decodePNGFromStream(iconStream);
  const iconSize = 230;
  ctx.drawImage(
    icon,
    0, 0, icon.width, icon.height,
    (W - iconSize) / 2, 46, iconSize, iconSize
  );

  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";

  ctx.font = `92px RobotoBold`;
  ctx.fillText("Portal 659", W / 2, 340);

  ctx.font = `44px RobotoBold`;
  ctx.fillText("El centro comercial de tu barrio", W / 2, 420);

  ctx.font = `34px RobotoBold`;
  ctx.globalAlpha = 0.92;
  ctx.fillText("Pedí y contactá directo por WhatsApp · 0% comisión", W / 2, 488);

  ctx.font = `30px RobotoBold`;
  ctx.globalAlpha = 0.85;
  ctx.fillText("www.portal659.com.ar", W / 2, 544);
  ctx.globalAlpha = 1;

  const png = await pngBuffer(PImage, img);
  const sharp = (await import("sharp")).default;
  await sharp(png).jpeg({ quality: 82, mozjpeg: true }).toFile(OUT_PATH);

  const stat = fs.statSync(OUT_PATH);
  console.log(`OK: ${OUT_PATH} (${Math.round(stat.size / 1024)} KB)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
