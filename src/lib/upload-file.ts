import { logApiError } from "@/lib/api-error";
import { getSiteUrl } from "@/lib/site-url";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { randomBytes } from "crypto";

const MAX_SIZE = 5 * 1024 * 1024; // imágenes y PDF
const MAX_VIDEO_SIZE = 25 * 1024 * 1024; // posters de video (clips cortos en bucle)

export type SaveUploadParams = {
  file: File;
  /** Carpeta dentro de UPLOAD_DIR (se sanitiza a [a-z0-9_-]). */
  folder: string;
  /** Subcarpeta por comercio. */
  vendorId: string;
};

/**
 * Guarda un archivo subido (imagen o PDF) en disco y devuelve su URL absoluta.
 * Mismas validaciones que /api/vendor/upload (imagen/PDF, sin SVG ni HEIC,
 * máx 5MB) y mismo achicado de fotos a 1200px/q80 con sharp.
 *
 * Helper compartido por /api/vendor/upload y por el comprobante de pago de
 * planes (/api/vendor/suscripcion/pagos/[id]/comprobante) para no duplicar
 * reglas: si se endurece una validación, aplica a los dos.
 */
export async function saveUploadedFile({ file, folder, vendorId }: SaveUploadParams): Promise<string> {
  if (!file || !file.size) throw new Error("Archivo requerido");

  const safeFolder = String(folder || "offers").replace(/[^a-z0-9_-]/g, "");
  const isPdf = file.type === "application/pdf" || (file.name || "").toLowerCase().endsWith(".pdf");
  const isVideo = file.type.startsWith("video/") || /\.(mp4|webm|mov|avi|mkv)$/i.test(file.name || "");
  if (!file.type.startsWith("image/") && !isPdf && !isVideo) {
    throw new Error("El archivo debe ser una imagen, PDF o video (MP4/WebM)");
  }
  if (file.type === "image/svg+xml" || (file.name || "").toLowerCase().endsWith(".svg")) {
    throw new Error("El formato SVG no está permitido por seguridad (usá JPG/PNG/WEBP)");
  }
  if (file.type === "image/heic" || file.type === "image/heif" || /\.(heic|heif)$/i.test(file.name || "")) {
    throw new Error("Las fotos HEIC de iPhone no están soportadas: exportala como JPG y subila de nuevo");
  }
  if (isVideo ? file.size > MAX_VIDEO_SIZE : file.size > MAX_SIZE) {
    throw new Error(
      isVideo
        ? "El video debe pesar menos de 25 MB (usá un clip corto, se repite en bucle)"
        : "El archivo debe pesar menos de 5 MB"
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  const rawExt = (file.name.split(".").pop() || "jpg")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  // Un video sin extensión reconocible (o con una rara) se guarda como MP4:
  // si cayera en "jpg" el navegador no lo reproduciría.
  const VIDEO_EXTS = ["mp4", "webm", "mov", "m4v"];
  const ext = isVideo
    ? (VIDEO_EXTS.includes(rawExt) ? rawExt : "mp4")
    : rawExt;
  const filename = `${Date.now()}-${randomBytes(6).toString("hex")}.${ext}`;

  const uploadRoot = process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads");
  // Carpeta por comercio: los archivos de un local nunca se mezclan con otro.
  const dir = path.join(uploadRoot, safeFolder, vendorId);

  // PDF y video: se guardan tal cual (sin reprocesar con sharp).
  if (isPdf || isVideo) {
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, filename), buffer);
    return `${getSiteUrl()}/uploads/${safeFolder}/${vendorId}/${filename}`;
  }

  let outBuffer = buffer;
  let outExt = ext;
  try {
    const sharp = (await import("sharp")).default;
    const pipeline = sharp(buffer).rotate().resize({
      width: 1200,
      withoutEnlargement: true,
    });
    const meta = await sharp(buffer).metadata();
    const format = meta.format as string | undefined;
    if (format === "png" || format === "webp") {
      outBuffer = await pipeline.toFormat(format, { quality: 80 }).toBuffer();
      outExt = format;
    } else if (format === "avif" || format === "gif") {
      outBuffer = buffer;
    } else {
      outBuffer = await pipeline.jpeg({ quality: 80, mozjpeg: true }).toBuffer();
      outExt = "jpg";
    }
  } catch (e) {
    logApiError("upload/sharp", e);
    outBuffer = buffer;
  }

  const outFilename = filename.replace(/\.[a-z0-9]+$/, `.${outExt}`);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, outFilename), outBuffer);
  return `${getSiteUrl()}/uploads/${safeFolder}/${vendorId}/${outFilename}`;
}
