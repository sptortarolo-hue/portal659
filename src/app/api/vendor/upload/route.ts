import { getServiceClient } from "@/lib/supabase";
import { getAuthSupabase } from "@/lib/auth-utils";
import { NextResponse } from "next/server";

const MAX_SIZE = 5 * 1024 * 1024;

export async function POST(request: Request) {
  const supabase = getAuthSupabase(request);
  if (!supabase) {
    return NextResponse.json({ error: "Error de conexión" }, { status: 503 });
  }

  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  const userId = userData.user.id;

  const { data: vendor } = await supabase
    .from("vendors")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (!vendor) {
    return NextResponse.json(
      { error: "Necesitás un local registrado para subir imágenes" },
      { status: 403 }
    );
  }

  const service = getServiceClient();
  if (!service) {
    return NextResponse.json({ error: "Error de configuración" }, { status: 503 });
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

  const ext = (file.name.split(".").pop() || "jpg")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  const path = `${folder}/${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  const { error } = await service.storage
    .from("menu-images")
    .upload(path, file, { contentType: file.type, upsert: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL}/storage/v1/object/public/menu-images/${path}`;
  return NextResponse.json({ url });
}
