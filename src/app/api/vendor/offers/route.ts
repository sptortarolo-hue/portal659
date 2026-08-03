import { getAuthSupabase } from "@/lib/auth-utils";
import { NextResponse } from "next/server";

async function getVendor(request: Request) {
  const supabase = getAuthSupabase(request);
  if (!supabase) return { supabase: null, vendorId: null };
  const { data: user } = await supabase.auth.getUser();
  if (!user?.user) return { supabase, vendorId: null };
  const { data: vendor } = await supabase
    .from("vendors")
    .select("id, neighborhood")
    .eq("user_id", user.user.id)
    .single();
  return { supabase, vendorId: vendor?.id || null, neighborhood: vendor?.neighborhood || null };
}

export async function GET(request: Request) {
  const { supabase, vendorId } = await getVendor(request);
  if (!supabase) {
    return NextResponse.json({ error: "Error de conexión" }, { status: 503 });
  }
  if (!vendorId) {
    return NextResponse.json(
      { error: "No tenés un local registrado" },
      { status: 403 }
    );
  }

  const { data, error } = await supabase
    .from("products")
    .select("*")
    .eq("vendor_id", vendorId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ offers: data });
}

export async function POST(request: Request) {
  const { supabase, vendorId, neighborhood } = await getVendor(request);
  if (!supabase) {
    return NextResponse.json({ error: "Error de conexión" }, { status: 503 });
  }
  if (!vendorId) {
    return NextResponse.json(
      { error: "No tenés un local registrado" },
      { status: 403 }
    );
  }

  const body = await request.json();
  const { name, description, price, category, featured_today, image_url } =
    body;

  if (!name || !price) {
    return NextResponse.json(
      { error: "El nombre y el precio son obligatorios" },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("products")
    .insert({
      vendor_id: vendorId,
      name,
      description: description || null,
      price: parseFloat(price),
      currency: "ARS",
      category: category || "otras",
      neighborhood: neighborhood,
      type: "food",
      available: true,
      featured_today: !!featured_today,
      image_url: image_url || null,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ offer: data });
}
