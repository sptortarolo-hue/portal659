import { logApiError } from "@/lib/api-error";
import { queryOne } from "@/lib/db";
import { getSiteUrl } from "@/lib/site-url";
import { normalizeShipmentCode } from "@/lib/shipment-handoff";
import { NextResponse } from "next/server";
import { withRateLimit } from "@/lib/api-wrapper";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { randomBytes } from "crypto";

const MAX_SIZE = 5 * 1024 * 1024;

/**
 * Subida de foto POD SIN login (repartidor que escaneó el paquete).
 * La llave es el código impreso en la oblea: valida que exista el encargo y
 * limite 1 foto por request, 5 MB, rate-limit por IP (igual al operador).
 */
export const POST = withRateLimit(async (request: Request) => {
  const url = new URL(request.url);
  const refCode = normalizeShipmentCode(url.searchParams.get("code") || "");
  if (!refCode) {
    return NextResponse.json({ error: "Falta el código del envío" }, { status: 400 });
  }
  const shipment = await queryOne<{ id: string }>(
    `SELECT id FROM shipments WHERE code = $1 LIMIT 1`,
    [refCode]
  ).catch(() => undefined);
  if (!shipment) {
    return NextResponse.json({ error: "Encargo no encontrado" }, { status: 404 });
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
    logApiError("shipment-upload-hand/sharp", e);
    outBuffer = buffer;
    outExt = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
    if (outExt.length > 5) outExt = "jpg";
  }

  const dir = path.join(process.env.UPLOAD_DIR || "./uploads", "shipments");
  await mkdir(dir, { recursive: true });
  const name = `${refCode.toLowerCase()}-${randomBytes(6).toString("hex")}.${outExt}`;
  await writeFile(path.join(dir, name), outBuffer);
  const publicUrl = `${getSiteUrl()}/uploads/shipments/${name}`;

  return NextResponse.json({ ok: true, url: publicUrl });
});
