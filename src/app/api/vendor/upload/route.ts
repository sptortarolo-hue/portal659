import { getVendorByRequest } from "@/lib/vendor-utils";
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
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: "La imagen debe pesar menos de 5 MB" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  const ext = (file.name.split(".").pop() || "jpg")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  const filename = `${Date.now()}-${randomBytes(6).toString("hex")}.${ext}`;

  const uploadRoot = process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads");
  const dir = path.join(uploadRoot, folder, userId);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, filename), buffer);

  const url = `${process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"}/uploads/${folder}/${userId}/${filename}`;
  return NextResponse.json({ url });
}