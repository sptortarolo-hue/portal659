/**
 * Achica en el lugar las fotos ya subidas (originales de cámara de hasta 5MB)
 * al mismo formato que genera la ruta /api/vendor/upload desde el cambio de
 * imágenes livianas: máx 1200px de ancho, calidad 80.
 *
 * - GIF animados y AVIF no se tocan.
 * - PNG/WebP se conservan en su formato (transparencia).
 * - Solo reescribe si la imagen supera los 1200px o pesa más de 400KB.
 * - Idempotente: correrlo de nuevo no cambia nada.
 *
 * Uso:
 *   node scripts/downscale-uploads.mjs [directorio]
 *   # directorio default: UPLOAD_DIR del env o ./uploads
 *   # En el VPS: docker exec ... o corriendo con UPLOAD_DIR=/ruta/al/volumen
 *
 * OJO: reescribe los archivos originales sin backup. Si querés resguardo,
 * copiá la carpeta de uploads antes de correrlo.
 */
import { readdir, stat, readFile, writeFile } from "fs/promises";
import path from "path";
import sharp from "sharp";

const MAX_WIDTH = 1200;
const MIN_BYTES = 400 * 1024;

const root =
  process.argv[2] || process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads");

let done = 0;
let skipped = 0;
let savedBytes = 0;

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      await walk(full);
      continue;
    }
    if (!/\.(jpe?g|png|webp)$/i.test(e.name)) {
      skipped++;
      continue;
    }
    try {
      const st = await stat(full);
      const input = await readFile(full);
      const meta = await sharp(input).metadata();
      if (!meta.width || (meta.width <= MAX_WIDTH && st.size <= MIN_BYTES)) {
        skipped++;
        continue;
      }
      if (meta.format === "gif") {
        skipped++;
        continue;
      }
      const pipeline = sharp(input)
        .rotate()
        .resize({ width: MAX_WIDTH, withoutEnlargement: true });
      const out =
        meta.format === "png" || meta.format === "webp"
          ? await pipeline.toFormat(meta.format, { quality: 80 }).toBuffer()
          : await pipeline.jpeg({ quality: 80, mozjpeg: true }).toBuffer();
      if (out.length >= st.size) {
        skipped++;
        continue;
      }
      await writeFile(full, out);
      done++;
      savedBytes += st.size - out.length;
      console.log(
        `✓ ${path.relative(root, full)} ${(st.size / 1024).toFixed(0)}KB → ${(out.length / 1024).toFixed(0)}KB`
      );
    } catch (err) {
      console.error(`✗ ${path.relative(root, full)}: ${err.message}`);
    }
  }
}

await walk(root);
console.log(
  `\nListo: ${done} achicadas, ${skipped} sin cambios, ahorro ${(savedBytes / 1024 / 1024).toFixed(1)}MB`
);
