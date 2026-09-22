import { logApiError } from "@/lib/api-error";
import { queryOne } from "@/lib/db";
import { getSiteUrl } from "@/lib/site-url";
import { NextResponse } from "next/server";
import { withRateLimit } from "@/lib/api-wrapper";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { randomBytes } from "crypto";

const MAX_SIZE = 5 * 1024 * 1024;
const MAX_FILES_NOTE = "Hasta 3 fotos por solicitud";

/**
 * Subida pública de fotos para presupuestos de servicios (el cliente no tiene
 * cuenta). Restringida: solo imágenes web (sin SVG/HEIC), 5 MB, carpeta fija
 * `service-requests/<vendorId>` y vendor existente. Rate-limit 10/min.
 */
export const POST = withRateLimit(async (request: Request) => {
  const { searchParams } = new URL(request.url);
  const vendorId = searchParams.get("vendorId") || "";
  if (!/^[0-9a-f-]{36}$/i.test(vendorId)) {
    return NextResponse.json({ error: "vendorId inválido" }, { status: 400 });
  }
  const vendor = await queryOne<{ id: string }>(
    `SELECT id FROM vendors WHERE id = $1 AND vertical = 'servicio' LIMIT 1`,
    [vendorId]
  );
  if (!vendor) {
    return NextResponse.json({ error: "Comercio no encontrado" }, { status: 404 });
  }

  const form = await request.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) {
    return NextResponse.json({ error: "Archivo requerido" }, { status: 400 });
  }
  if (files.length > 3) {
    return NextResponse.json({ error: MAX_FILES_NOTE }, { status: 400 });
  }

  const urls: string[] = [];
  for (const file of files) {
    if (!file.type.startsWith("image/")) {
      return NextResponse.json({ error: "El archivo debe ser una imagen" }, { status: 400 });
    }
    if (file.type === "image/svg+xml" || (file.name || "").toLowerCase().endsWith(".svg")) {
      return NextResponse.json({ error: "El formato SVG no está permitido (usá JPG/PNG/WEBP)" }, { status: 400 });
    }
    if (file.type === "image/heic" || file.type === "image/heif" || /\.(heic|heif)$/i.test(file.name || "")) {
      return NextResponse.json({ error: "Las fotos HEIC de iPhone no están soportadas: exportala como JPG" }, { status: 400 });
    }
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: "Cada imagen debe pesar menos de 5 MB" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    let outBuffer = buffer;
    let outExt = "jpg";
    try {
      const sharp = (await import("sharp")).default;
      const meta = await sharp(buffer).metadata();
      const format = meta.format as string | undefined;
      const pipeline = sharp(buffer).rotate().resize({ width: 1200, withoutEnlargement: true });
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
      logApiError("service-upload/sharp", e);
      outBuffer = buffer;
    }

    const outFilename = `${Date.now()}-${randomBytes(6).toString("hex")}.${outExt}`;
    const uploadRoot = process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads");
    const dir = path.join(uploadRoot, "service-requests", vendorId);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, outFilename), outBuffer);
    urls.push(`${getSiteUrl()}/uploads/service-requests/${vendorId}/${outFilename}`);
  }

  return NextResponse.json({ urls });
}, { maxRequests: 10 });
