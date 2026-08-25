import { getAuthSupabase, getUserId } from "@/lib/auth-utils";
import { NextResponse } from "next/server";

async function isAdmin(request: Request): Promise<boolean> {
  const supabase = getAuthSupabase(request);
  if (!supabase) return false;
  const userId = await getUserId(supabase);
  if (!userId) return false;
  const { data } = await supabase
    .from("vendors")
    .select("is_admin")
    .eq("user_id", userId)
    .maybeSingle();
  return data?.is_admin === true;
}

export async function GET(request: Request) {
  if (!(await isAdmin(request))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const supabase = getAuthSupabase(request)!;

  const [vendorsRes, ordersRes, reviewsRes, productsRes] = await Promise.all([
    supabase.from("vendors").select("*").order("created_at", { ascending: false }),
    supabase.from("orders").select("*, vendors(store_name)").order("created_at", { ascending: false }).limit(100),
    supabase.from("reviews").select("*, vendors(store_name)").order("created_at", { ascending: false }).limit(50),
    supabase.from("products").select("id, name, price, available, vendor_id").order("created_at", { ascending: false }),
  ]);

  const totalProducts = productsRes.data?.length || 0;
  const totalRevenue = ordersRes.data?.filter((o: any) => o.status !== "cancelled").reduce((s: number, o: any) => s + Number(o.total), 0) || 0;
  const avgRating = reviewsRes.data && reviewsRes.data.length > 0
    ? reviewsRes.data.reduce((s: number, r: any) => s + r.rating, 0) / reviewsRes.data.length
    : 0;

  return NextResponse.json({
    vendors: vendorsRes.data || [],
    orders: ordersRes.data || [],
    reviews: reviewsRes.data || [],
    stats: {
      totalVendors: vendorsRes.data?.length || 0,
      totalOrders: ordersRes.data?.length || 0,
      totalProducts,
      totalReviews: reviewsRes.data?.length || 0,
      totalRevenue,
      avgRating: Math.round(avgRating * 10) / 10,
    },
  });
}

export async function PATCH(request: Request) {
  if (!(await isAdmin(request))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const body = await request.json();
  const { vendorId, action } = body;

  if (!vendorId || !action) {
    return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  }

  const supabase = getAuthSupabase(request)!;

  if (action === "toggle_verified") {
    const { data: vendor } = await supabase.from("vendors").select("verified").eq("id", vendorId).single();
    if (!vendor) return NextResponse.json({ error: "Vendor no encontrado" }, { status: 404 });
    await supabase.from("vendors").update({ verified: !vendor.verified }).eq("id", vendorId);
    return NextResponse.json({ ok: true });
  }

  if (action === "toggle_admin") {
    const { data: vendor } = await supabase.from("vendors").select("is_admin").eq("id", vendorId).single();
    if (!vendor) return NextResponse.json({ error: "Vendor no encontrado" }, { status: 404 });
    await supabase.from("vendors").update({ is_admin: !vendor.is_admin }).eq("id", vendorId);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Acción inválida" }, { status: 400 });
}
