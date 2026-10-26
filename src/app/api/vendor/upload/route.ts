import { getVendorByRequest } from "@/lib/vendor-utils";
import { saveUploadedFile } from "@/lib/upload-file";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  // Sesión normal (dueño), admin-as o sesión de prueba (link compartido):
  // la vista previa hace TODO lo que el panel en producción (fotos incluidas).
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) {
    return NextResponse.json(
      { error: "Necesitás un local registrado para subir imágenes" },
      { status: 403 }
    );
  }

  const form = await request.formData();
  const file = form.get("file") as File | null;
  const folder = String(form.get("folder") || "offers").replace(/[^a-z0-9_-]/g, "");

  try {
    const url = await saveUploadedFile({ file: file as File, folder, vendorId: vendor.id });
    return NextResponse.json({ url });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "No se pudo subir el archivo" }, { status: 400 });
  }
}
