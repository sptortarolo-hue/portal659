// Genera public/og-logo.jpg: el logo del portal centrado en 1200x630 sobre
// fondo blanco, en JPEG liviano (<150KB) — WhatsApp corta la preview si el
// og:image pasa de ~300KB (el PNG original pesa 1.1MB y no se muestra).
// Re-ejecutar si cambia public/Portal659Logo.png.
import sharp from "sharp";

const SRC = "public/Portal659Logo.png";
const OUT = "public/og-logo.jpg";
const W = 1200;
const H = 630;

const info = await sharp(SRC).metadata();
const scale = Math.min((W - 80) / info.width, (H - 80) / info.height);
const w = Math.round(info.width * scale);
const h = Math.round(info.height * scale);

const logo = await sharp(SRC)
  .resize(w, h, { fit: "contain" })
  .toBuffer();

const buf = await sharp({
  create: {
    width: W,
    height: H,
    channels: 3,
    background: { r: 255, g: 255, b: 255 },
  },
})
  .composite([{ input: logo, top: Math.round((H - h) / 2), left: Math.round((W - w) / 2) }])
  .flatten({ background: { r: 255, g: 255, b: 255 } })
  .jpeg({ quality: 86, mozjpeg: true })
  .toBuffer();

const { writeFileSync, statSync } = await import("node:fs");
writeFileSync(OUT, buf);
const kb = Math.round(statSync(OUT).size / 1024);
console.log(`${OUT} — ${W}x${H} — ${kb}KB — logo ${w}x${h}`);
