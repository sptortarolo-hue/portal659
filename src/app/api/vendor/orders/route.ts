import { getAuthSupabase } from "@/lib/auth-utils";
import { NextResponse } from "next/server";

async function getVendor(request: Request) {
  const supabase = getAuthSupabase(request);
  if (!supabase) return { supabase: null, vendorId: null };
  const { data: user } = await supabase.auth.getUser();
  if (!user?.user) return { supabase, vendorId: null };
  const { data: vendor } = await supabase
    .from("vendors")
    .select("id")
    .eq("user_id", user.user.id)
    .single();
  return { supabase, vendorId: vendor?.id || null };
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
    .from("orders")
    .select("*")
    .eq("vendor_id", vendorId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ orders: data });
}
