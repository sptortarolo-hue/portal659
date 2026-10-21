import { logApiError } from "@/lib/api-error";
import { queryOne } from "@/lib/db";
import { getSiteUrl } from "@/lib/site-url";
import { getAuthUser } from "@/lib/auth";
import { fetchOperatorCarriers } from "@/lib/shipping-server";
import { NextResponse } from "next/server";
import { withRateLimit } from "@/lib/api-wrapper";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { randomBytes } from "crypto";

const MAX_SIZE = 5 * 1024 * 1024;

/**
 * Subida de foto POD (prueba de entrega) del operador de logística.
 * Auth: login normal del portal con rol de operador (carrier_operators).
 * Carpeta fija `shipments/` con nombre único. 1 foto, 5 MB, rate-limit.
 */
export const POST = withRateLimit(async (request: Request) => {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  const carriers = await fetchOperatorCarriers(user.id);
  if (carriers.length === 0) {
    return NextResponse.json({ error: "No sos operador de ninguna logística" }, { status: 403 });
  }

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "Archivo requerido" }, { status: 400 });
  }
  if (!file.type.startsWith("image/") || file.type === "image/svg+xml") {
    return NextResponse.json({ error: "El archivo debe ser una imagen" }, { status: 400 });
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: "La imagen debe pesar menos de 5 MB" }, { status: 400 });
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
    logApiError("shipment-upload/sharp", e);
    outBuffer = buffer;
  }

  const outFilename = `${Date.now()}-${randomBytes(6).toString("hex")}.${outExt}`;
  const uploadRoot = process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads");
  const dir = path.join(uploadRoot, "shipments");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, outFilename), outBuffer);

  return NextResponse.json({ url: `${getSiteUrl()}/uploads/shipments/${outFilename}` });
}, { maxRequests: 20 });
