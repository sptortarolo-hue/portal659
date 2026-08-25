import { getSupabase, getServiceClient } from "@/lib/supabase";
import { getAuthSupabase, getUserId } from "@/lib/auth-utils";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json({ error: "Error de conexión" }, { status: 503 });
  }

  const { searchParams } = new URL(request.url);
  const vendorId = searchParams.get("vendor_id");

  if (!vendorId) {
    return NextResponse.json({ error: "vendor_id requerido" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("reviews")
    .select("*")
    .eq("vendor_id", vendorId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const avg = data && data.length > 0
    ? data.reduce((sum, r) => sum + r.rating, 0) / data.length
    : 0;

  return NextResponse.json({ reviews: data || [], avgRating: Math.round(avg * 10) / 10, count: data?.length || 0 });
}

export async function POST(request: Request) {
  const authSupabase = getAuthSupabase(request);
  if (!authSupabase) {
    return NextResponse.json({ error: "Error de conexión" }, { status: 503 });
  }

  const userId = await getUserId(authSupabase);
  if (!userId) {
    return NextResponse.json({ error: "Debés estar logueado para reseñar" }, { status: 401 });
  }

  const body = await request.json();
  const { vendorId, productId, customerName, rating, comment } = body;

  if (!vendorId || !customerName || !rating || rating < 1 || rating > 5) {
    return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  }

  // Verificar que el usuario tiene un pedido completado en este local
  const svc = getServiceClient();
  if (svc) {
    const { data: hasOrder } = await svc
      .from("orders")
      .select("id")
      .eq("customer_id", userId)
      .eq("vendor_id", vendorId)
      .eq("status", "completed")
      .limit(1)
      .maybeSingle();

    if (!hasOrder) {
      return NextResponse.json(
        { error: "Debés tener un pedido completado en este local para dejar una reseña" },
        { status: 403 }
      );
    }
  }

  const { data: existing } = await authSupabase
    .from("reviews")
    .select("id")
    .eq("vendor_id", vendorId)
    .eq("customer_id", userId)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ error: "Ya dejaste una reseña en este local" }, { status: 409 });
  }

  const { error } = await authSupabase.from("reviews").insert({
    vendor_id: vendorId,
    product_id: productId || null,
    customer_id: userId,
    customer_name: customerName,
    rating,
    comment: comment || null,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
