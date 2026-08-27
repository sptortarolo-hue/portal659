import { getAuthSupabase } from "@/lib/auth-utils";
import { resolveVendorPlan } from "@/lib/plans";
import { NextResponse } from "next/server";

async function getVendor(request: Request) {
  const supabase = getAuthSupabase(request);
  if (!supabase) return { supabase: null, vendor: null };
  const { data: user } = await supabase.auth.getUser();
  if (!user?.user) return { supabase, vendor: null };
  const { data: vendor } = await supabase
    .from("vendors")
    .select("id, neighborhood, vertical, plan_id, plan_status, plan_expires_at, trial_ends_at")
    .eq("user_id", user.user.id)
    .single();
  return { supabase, vendor };
}

export async function GET(request: Request) {
  const { supabase, vendor } = await getVendor(request);
  if (!supabase) {
    return NextResponse.json({ error: "Error de conexión" }, { status: 503 });
  }
  if (!vendor) {
    return NextResponse.json(
      { error: "No tenés un local registrado" },
      { status: 403 }
    );
  }

  const { data, error } = await supabase
    .from("products")
    .select("*")
    .eq("vendor_id", vendor.id)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ offers: data });
}

export async function POST(request: Request) {
  const { supabase, vendor } = await getVendor(request);
  if (!supabase) {
    return NextResponse.json({ error: "Error de conexión" }, { status: 503 });
  }
  if (!vendor) {
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

  // Límite de productos según plan
  const { data: plans } = await supabase.from("plans").select("*");
  const plan = resolveVendorPlan(vendor, plans || []);
  if (plan.maxProducts != null) {
    const { count } = await supabase
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("vendor_id", vendor.id);
    if ((count || 0) >= plan.maxProducts) {
      return NextResponse.json(
        {
          error: `Tu plan permite hasta ${plan.maxProducts} productos. Actualizá a Gestión integral para productos ilimitados.`,
          code: "plan_limit",
        },
        { status: 403 }
      );
    }
  }

  const { data, error } = await supabase
    .from("products")
    .insert({
      vendor_id: vendor.id,
      name,
      description: description || null,
      price: parseFloat(price),
      currency: "ARS",
      category: category || "otras",
      neighborhood: vendor.neighborhood,
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
