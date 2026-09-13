import { getVendorByRequest } from "@/lib/vendor-utils";
import { logApiError } from "@/lib/api-error";
import { getSiteUrl } from "@/lib/site-url";
import { NextResponse } from "next/server";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { randomBytes } from "crypto";

const MAX_SIZE = 5 * 1024 * 1024;

export async function POST(request: Request) {
  const { userId, vendor } = await getVendorByRequest(request);
  if (!userId) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  if (!vendor) {
    return NextResponse.json(
      { error: "Necesitás un local registrado para subir imágenes" },
      { status: 403 }
    );
  }

  const form = await request.formData();
  const file = form.get("file") as File | null;
  const folder = String(form.get("folder") || "offers").replace(/[^a-z0-9_-]/g, "");

  if (!file || !file.size) {
    return NextResponse.json({ error: "Archivo requerido" }, { status: 400 });
  }
  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ error: "El archivo debe ser una imagen" }, { status: 400 });
  }
  // NO permitimos SVG: se sirven con el mismo origen y un SVG con <script>
  // sería un XSS si alguien abre la URL directamente.
  if (file.type === "image/svg+xml" || (file.name || "").toLowerCase().endsWith(".svg")) {
    return NextResponse.json({ error: "El formato SVG no está permitido por seguridad (usá JPG/PNG/WEBP)" }, { status: 400 });
  }
  // HEIC/HEIF (foto default del iPhone): ningún navegador lo renderiza en
  // <img> y se serviría como application/octet-stream (imagen rota para
  // siempre). Se rechaza con mensaje claro en vez de guardar un archivo muerto.
  if (file.type === "image/heic" || file.type === "image/heif" || /\.(heic|heif)$/i.test(file.name || "")) {
    return NextResponse.json({ error: "Las fotos HEIC de iPhone no están soportadas: exportala como JPG y subila de nuevo" }, { status: 400 });
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: "La imagen debe pesar menos de 5 MB" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  const ext = (file.name.split(".").pop() || "jpg")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  const filename = `${Date.now()}-${randomBytes(6).toString("hex")}.${ext}`;

  // Achicar fotos de cámara a un tamaño web (máx 1200px, calidad 80) para que
  // las fichas de Mostrador/Mesa y el micrositio carguen al instante.
  // PNG/WebP con transparencia se conservan en su formato para no romper recortes.
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
      // GIF animados y AVIF: no se tocan (sharp aplanaría la animación).
      outBuffer = buffer;
    } else {
      outBuffer = await pipeline.jpeg({ quality: 80, mozjpeg: true }).toBuffer();
      outExt = "jpg";
    }
  } catch (e) {
    // Si sharp falla, se guarda el original sin romper la subida (se loguea la degradación).
    logApiError("vendor-upload/sharp", e);
    outBuffer = buffer;
  }
  const outFilename = filename.replace(/\.[a-z0-9]+$/, `.${outExt}`);

  const uploadRoot = process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads");
  const dir = path.join(uploadRoot, folder, userId);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, outFilename), outBuffer);

  const url = `${getSiteUrl()}/uploads/${folder}/${userId}/${outFilename}`;
  return NextResponse.json({ url });
}