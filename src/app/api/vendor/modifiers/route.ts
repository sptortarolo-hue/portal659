import { getAuthSupabase } from "@/lib/auth-utils";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const supabase = getAuthSupabase(request);
  if (!supabase) return NextResponse.json({ error: "Error de conexión" }, { status: 503 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { data: vendor } = await supabase.from("vendors").select("id").eq("user_id", user.id).maybeSingle();
  if (!vendor) return NextResponse.json({ modifiers: [] });

  const { searchParams } = new URL(request.url);
  const productId = searchParams.get("product_id");

  let query = supabase
    .from("product_modifiers")
    .select("*")
    .order("position", { ascending: true });

  if (productId) {
    query = query.eq("product_id", productId);
  } else {
    const { data: products } = await supabase.from("products").select("id").eq("vendor_id", vendor.id);
    const ids = (products || []).map((p: any) => p.id);
    if (ids.length === 0) return NextResponse.json({ modifiers: [] });
    query = query.in("product_id", ids);
  }

  const { data: modifiers } = await query;
  return NextResponse.json({ modifiers: modifiers || [] });
}

export async function POST(request: Request) {
  const supabase = getAuthSupabase(request);
  if (!supabase) return NextResponse.json({ error: "Error de conexión" }, { status: 503 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const body = await request.json();
  const { product_id, group_name, options, required, max_selections } = body;

  if (!product_id || !group_name) {
    return NextResponse.json({ error: "Faltan datos" }, { status: 400 });
  }

  const { data: vendor } = await supabase.from("vendors").select("id").eq("user_id", user.id).maybeSingle();
  if (!vendor) return NextResponse.json({ error: "Vendor no encontrado" }, { status: 404 });

  const { data: product } = await supabase.from("products").select("id").eq("id", product_id).eq("vendor_id", vendor.id).maybeSingle();
  if (!product) return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 });

  const { count } = await supabase.from("product_modifiers").select("*", { count: "exact", head: true }).eq("product_id", product_id);

  const { data, error } = await supabase
    .from("product_modifiers")
    .insert({
      product_id,
      group_name,
      options: options || [],
      required: required || false,
      max_selections: max_selections || 1,
      position: count || 0,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ modifier: data });
}
