import { getVendorByRequest } from "@/lib/vendor-utils";
import { logApiError } from "@/lib/api-error";
import { getSiteUrl } from "@/lib/site-url";
import { query, queryOne } from "@/lib/db";
import { NextResponse } from "next/server";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { randomBytes } from "crypto";

const MAX_SIZE = 5 * 1024 * 1024;

export async function POST(request: Request) {
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) {
    return NextResponse.json(
      { error: "Necesitás un local registrado para subir imágenes" },
      { status: 403 }
    );
  }

  const form = await request.formData();
  const file = form.get("file") as File | null;

  if (!file || !file.size) {
    return NextResponse.json({ error: "Archivo requerido" }, { status: 400 });
  }
  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ error: "El archivo debe ser una imagen" }, { status: 400 });
  }
  if (file.type === "image/svg+xml" || (file.name || "").toLowerCase().endsWith(".svg")) {
    return NextResponse.json({ error: "El formato SVG no está permitido por seguridad (usá JPG/PNG/WEBP)" }, { status: 400 });
  }
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
    logApiError("vendor-promo-image/sharp", e);
    outBuffer = buffer;
  }
  const outFilename = filename.replace(/\.[a-z0-9]+$/, `.${outExt}`);

  const uploadRoot = process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads");
  const dir = path.join(uploadRoot, "promo", vendor.id);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, outFilename), outBuffer);

  const url = `${getSiteUrl()}/uploads/promo/${vendor.id}/${outFilename}`;

  try {
    try {
      await query(
        `INSERT INTO vendor_promo_images (vendor_id, image_url, updated_at, mode) VALUES ($1, $2, now(), 'manual')
         ON CONFLICT (vendor_id) DO UPDATE SET image_url = $2, updated_at = now(), mode = 'manual'`,
        [vendor.id, url]
      );
    } catch {
      try {
        await query(
          `INSERT INTO vendor_promo_images (vendor_id, image_url, updated_at) VALUES ($1, $2, now())
           ON CONFLICT (vendor_id) DO UPDATE SET image_url = $2, updated_at = now()`,
          [vendor.id, url]
        );
      } catch {
        await query(
          `INSERT INTO vendor_promo_images (vendor_id, image_url) VALUES ($1, $2)
           ON CONFLICT (vendor_id) DO UPDATE SET image_url = $2, created_at = now()`,
          [vendor.id, url]
        );
      }
    }
  } catch {
    return NextResponse.json(
      { error: "Falta aplicar supabase/self-host/migrate-promo-share.sql en la DB" },
      { status: 503 }
    );
  }

  return NextResponse.json({ url });
}

export async function GET(request: Request) {
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const row = await queryOne<{ image_url: string }>(
    `SELECT image_url FROM vendor_promo_images WHERE vendor_id = $1 LIMIT 1`,
    [vendor.id]
  ).catch(() => null);

  return NextResponse.json({ imageUrl: row?.image_url || null });
}

export async function DELETE(request: Request) {
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  try {
    try {
      await query(
        `UPDATE vendor_promo_images SET image_url = '', updated_at = now(), mode = 'auto' WHERE vendor_id = $1`,
        [vendor.id]
      );
    } catch {
      try {
        await query(
          `UPDATE vendor_promo_images SET image_url = '', updated_at = now() WHERE vendor_id = $1`,
          [vendor.id]
        );
      } catch {
        await query(`DELETE FROM vendor_promo_images WHERE vendor_id = $1`, [vendor.id]);
      }
    }
  } catch {
    return NextResponse.json(
      { error: "Falta aplicar supabase/self-host/migrate-promo-share.sql en la DB" },
      { status: 503 }
    );
  }

  return NextResponse.json({ ok: true });
}
