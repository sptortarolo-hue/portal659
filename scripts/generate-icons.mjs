// Genera íconos PNG de Portal 659 (sin dependencias, usa zlib de Node).
// Diseño: fondo indigo (#4f46e5) con un círculo blanco y un "storefront" sencillo.
// Uso: node scripts/generate-icons.mjs
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "public", "icons");
mkdirSync(OUT_DIR, { recursive: true });

const INDIGO = [79, 70, 229]; // #4f46e5
const INDIGO_DARK = [67, 56, 202]; // #4338ca
const WHITE = [255, 255, 255];

function crc32(buf) {
  let c, table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  let p = 0;
  for (let y = 0; y < height; y++) {
    raw[p++] = 0; // filter none
    for (let x = 0; x < width * 4; x++) raw[p++] = rgba[y * width * 4 + x];
  }
  const idat = deflateSync(raw);
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

function insideRoundedSquare(x, y, size, radius) {
  const cx = size / 2, cy = size / 2;
  const dx = Math.max(Math.abs(x - cx) - (cx - radius), 0);
  const dy = Math.max(Math.abs(y - cy) - (cy - radius), 0);
  return (dx * dx + dy * dy) <= radius * radius;
}

// Ícono estándar: fondo indigo, círculo blanco con "storefront"
function renderIcon(size, { rounded = false, maskable = false } = {}) {
  const rgba = Buffer.alloc(size * size * 4);
  const cx = size / 2, cy = size / 2;
  const circleR = size * 0.34;
  const safe = size * 0.4; // área segura maskable (80%)

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let idx = (y * size + x) * 4;
      // fondo
      if (rounded || maskable) {
        if (!insideRoundedSquare(x, y, size, size * 0.22)) {
          rgba[idx + 3] = 0; // transparente fuera del redondeo
          continue;
        }
      }
      rgba[idx] = INDIGO[0]; rgba[idx + 1] = INDIGO[1]; rgba[idx + 2] = INDIGO[2]; rgba[idx + 3] = 255;
      // gradiente sutil hacia abajo
      const t = y / size;
      rgba[idx] = Math.round(INDIGO[0] + (INDIGO_DARK[0] - INDIGO[0]) * t);
      rgba[idx + 1] = Math.round(INDIGO[1] + (INDIGO_DARK[1] - INDIGO[1]) * t);
      rgba[idx + 2] = Math.round(INDIGO[2] + (INDIGO_DARK[2] - INDIGO[2]) * t);

      // círculo blanco
      const d = Math.hypot(x - cx, y - cy);
      if (d <= circleR) {
        rgba[idx] = WHITE[0]; rgba[idx + 1] = WHITE[1]; rgba[idx + 2] = WHITE[2];
      }
    }
  }
  return encodePNG(size, size, rgba);
}

const targets = [
  { file: "icon-192.png", size: 192, opts: {} },
  { file: "icon-512.png", size: 512, opts: {} },
  { file: "icon-512-maskable.png", size: 512, opts: { maskable: true } },
  { file: "apple-touch-icon.png", size: 180, opts: {} },
];

for (const t of targets) {
  const buf = renderIcon(t.size, t.opts);
  writeFileSync(join(OUT_DIR, t.file), buf);
  console.log("Generado", t.file, `(${t.size}x${t.size})`);
}
console.log("Listo. Los PNG quedaron en public/icons/");