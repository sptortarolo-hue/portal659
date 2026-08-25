import { getAuthSupabase, getUserId } from "@/lib/auth-utils";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const supabase = getAuthSupabase(request);
  if (!supabase) return NextResponse.json({ favorites: [] });

  const userId = await getUserId(supabase);
  if (!userId) return NextResponse.json({ favorites: [] });

  const { data } = await supabase
    .from("favorites")
    .select("vendor_id, vendors(id, store_name, slug, logo_url, vertical, neighborhood)")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  return NextResponse.json({ favorites: data || [] });
}

export async function POST(request: Request) {
  const supabase = getAuthSupabase(request);
  if (!supabase) return NextResponse.json({ error: "Error de conexión" }, { status: 503 });

  const userId = await getUserId(supabase);
  if (!userId) return NextResponse.json({ error: "Debés estar logueado" }, { status: 401 });

  const body = await request.json();
  const { vendorId } = body;
  if (!vendorId) return NextResponse.json({ error: "vendorId requerido" }, { status: 400 });

  const { data: existing } = await supabase
    .from("favorites")
    .select("id")
    .eq("user_id", userId)
    .eq("vendor_id", vendorId)
    .maybeSingle();

  if (existing) {
    await supabase.from("favorites").delete().eq("id", existing.id);
    return NextResponse.json({ ok: true, favorited: false });
  }

  const { error } = await supabase.from("favorites").insert({
    user_id: userId,
    vendor_id: vendorId,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, favorited: true });
}
