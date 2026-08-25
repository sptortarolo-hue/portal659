import { getAuthSupabase } from "@/lib/auth-utils";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const supabase = getAuthSupabase(request);
  if (!supabase) return NextResponse.json({ error: "Error de conexión" }, { status: 503 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { data: vendor } = await supabase.from("vendors").select("id").eq("user_id", user.id).maybeSingle();

  const { searchParams } = new URL(request.url);
  const productId = searchParams.get("product_id");

  let query = supabase
    .from("product_images")
    .select("*")
    .order("position", { ascending: true });

  if (productId) {
    query = query.eq("product_id", productId);
  } else if (!vendor) {
    return NextResponse.json({ images: [] });
  } else {
    const { data: products } = await supabase.from("products").select("id").eq("vendor_id", vendor.id);
    const ids = (products || []).map((p: any) => p.id);
    if (ids.length === 0) return NextResponse.json({ images: [] });
    query = query.in("product_id", ids);
  }

  const { data: images } = await query;
  return NextResponse.json({ images: images || [] });
}

export async function PUT(request: Request) {
  const supabase = getAuthSupabase(request);
  if (!supabase) return NextResponse.json({ error: "Error de conexión" }, { status: 503 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const body = await request.json();
  const { product_id, images } = body;

  if (!product_id || !Array.isArray(images)) {
    return NextResponse.json({ error: "Faltan datos" }, { status: 400 });
  }

  const { data: vendor } = await supabase.from("vendors").select("id").eq("user_id", user.id).maybeSingle();
  if (!vendor) return NextResponse.json({ error: "Vendor no encontrado" }, { status: 404 });

  const { data: product } = await supabase
    .from("products")
    .select("id")
    .eq("id", product_id)
    .eq("vendor_id", vendor.id)
    .maybeSingle();
  if (!product) return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 });

  await supabase.from("product_images").delete().eq("product_id", product_id);

  const rows = (images as string[])
    .filter((url) => url && url.trim())
    .map((url, i) => ({ product_id, image_url: url.trim(), position: i }));

  if (rows.length === 0) return NextResponse.json({ ok: true });

  const { error } = await supabase.from("product_images").insert(rows);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}