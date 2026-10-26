import { logApiError } from "@/lib/api-error";
import { getSiteUrl } from "@/lib/site-url";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { randomBytes } from "crypto";

const MAX_SIZE = 5 * 1024 * 1024;

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
  if (!file.type.startsWith("image/") && !isPdf) {
    throw new Error("El archivo debe ser una imagen o PDF");
  }
  if (file.type === "image/svg+xml" || (file.name || "").toLowerCase().endsWith(".svg")) {
    throw new Error("El formato SVG no está permitido por seguridad (usá JPG/PNG/WEBP)");
  }
  if (file.type === "image/heic" || file.type === "image/heif" || /\.(heic|heif)$/i.test(file.name || "")) {
    throw new Error("Las fotos HEIC de iPhone no están soportadas: exportala como JPG y subila de nuevo");
  }
  if (file.size > MAX_SIZE) {
    throw new Error("El archivo debe pesar menos de 5 MB");
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  const ext = (file.name.split(".").pop() || "jpg")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  const filename = `${Date.now()}-${randomBytes(6).toString("hex")}.${ext}`;

  const uploadRoot = process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads");
  // Carpeta por comercio: los archivos de un local nunca se mezclan con otro.
  const dir = path.join(uploadRoot, safeFolder, vendorId);

  // PDF: se guarda tal cual (no se reprocesa).
  if (isPdf) {
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
