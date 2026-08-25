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
    .from("product_variants")
    .select("*")
    .order("position", { ascending: true });

  if (productId) {
    query = query.eq("product_id", productId);
  } else if (!vendor) {
    return NextResponse.json({ variants: [] });
  } else {
    const { data: products } = await supabase.from("products").select("id").eq("vendor_id", vendor.id);
    const ids = (products || []).map((p: any) => p.id);
    if (ids.length === 0) return NextResponse.json({ variants: [] });
    query = query.in("product_id", ids);
  }

  const { data: variants } = await query;
  return NextResponse.json({ variants: variants || [] });
}

export async function PUT(request: Request) {
  const supabase = getAuthSupabase(request);
  if (!supabase) return NextResponse.json({ error: "Error de conexión" }, { status: 503 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const body = await request.json();
  const { product_id, variants } = body;

  if (!product_id || !Array.isArray(variants)) {
    return NextResponse.json({ error: "Faltan datos" }, { status: 400 });
  }

  const { data: vendor } = await supabase.from("vendors").select("id").eq("user_id", user.id).maybeSingle();
  if (!vendor) return NextResponse.json({ error: "Vendor no encontrado" }, { status: 404 });

  const { data: product } = await supabase
    .from("products")
    .select("id, vendor_id")
    .eq("id", product_id)
    .eq("vendor_id", vendor.id)
    .maybeSingle();
  if (!product) return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 });

  await supabase.from("product_variants").delete().eq("product_id", product_id);

  const rows = (variants as any[]).map((v, i) => ({
    product_id,
    color: String(v.color || "").trim(),
    talle: String(v.talle || "").trim(),
    price: Number(v.price || 0),
    promo: v.promo !== undefined && v.promo !== null && v.promo !== "" ? Number(v.promo) : null,
    stock: Number(v.stock || 0),
    sku: v.sku ? String(v.sku) : null,
    position: i,
  }));

  const { error } = await supabase
    .from("product_variants")
    .insert(rows);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}