import { getAuthSupabase } from "@/lib/auth-utils";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const supabase = getAuthSupabase(request);
  if (!supabase) return NextResponse.json({ error: "Error de conexión" }, { status: 503 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { data: vendor } = await supabase.from("vendors").select("id").eq("user_id", user.id).maybeSingle();
  if (!vendor) return NextResponse.json({ gallery: [] });

  const { data: gallery } = await supabase
    .from("vendor_gallery")
    .select("*")
    .eq("vendor_id", vendor.id)
    .order("position", { ascending: true });

  return NextResponse.json({ gallery: gallery || [] });
}

export async function POST(request: Request) {
  const supabase = getAuthSupabase(request);
  if (!supabase) return NextResponse.json({ error: "Error de conexión" }, { status: 503 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const body = await request.json();
  const { image_url, caption } = body;

  if (!image_url) return NextResponse.json({ error: "Falta image_url" }, { status: 400 });

  const { data: vendor } = await supabase.from("vendors").select("id").eq("user_id", user.id).maybeSingle();
  if (!vendor) return NextResponse.json({ error: "Vendor no encontrado" }, { status: 404 });

  const { count } = await supabase.from("vendor_gallery").select("*", { count: "exact", head: true }).eq("vendor_id", vendor.id);

  const { data, error } = await supabase
    .from("vendor_gallery")
    .insert({
      vendor_id: vendor.id,
      image_url,
      caption: caption || null,
      position: count || 0,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ item: data });
}
