import { NextResponse } from "next/server";
import { getAuthSupabase } from "@/lib/auth-utils";
import { isAdmin } from "@/lib/admin-utils";

export async function GET(request: Request) {
  if (!(await isAdmin(request))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const supabase = getAuthSupabase(request)!;
  const url = new URL(request.url);

  const rating = url.searchParams.get("rating");
  const vendorId = url.searchParams.get("vendor_id");
  const search = url.searchParams.get("search");

  let query = supabase
    .from("reviews")
    .select("*, vendors(store_name, slug)")
    .order("created_at", { ascending: false });

  if (rating) query = query.eq("rating", parseInt(rating));
  if (vendorId) query = query.eq("vendor_id", vendorId);
  if (search) {
    query = query.or(`customer_name.ilike.%${search}%,comment.ilike.%${search}%`);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ reviews: data || [] });
}

export async function DELETE(request: Request) {
  if (!(await isAdmin(request))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const body = await request.json();
  const { reviewId } = body;

  if (!reviewId) {
    return NextResponse.json({ error: "reviewId es requerido" }, { status: 400 });
  }

  const supabase = getAuthSupabase(request)!;
  const { error } = await supabase.from("reviews").delete().eq("id", reviewId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
