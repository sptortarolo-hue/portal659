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

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const params = await context.params;
  const { supabase, vendorId } = await getVendor(request);
  if (!supabase) {
    return NextResponse.json({ error: "Error de conexión" }, { status: 503 });
  }
  if (!vendorId) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const body = await request.json();
  const { data, error } = await supabase
    .from("products")
    .update(body)
    .eq("id", params.id)
    .eq("vendor_id", vendorId)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ offer: data });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const params = await context.params;
  const { supabase, vendorId } = await getVendor(request);
  if (!supabase) {
    return NextResponse.json({ error: "Error de conexión" }, { status: 503 });
  }
  if (!vendorId) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const { error } = await supabase
    .from("products")
    .delete()
    .eq("id", params.id)
    .eq("vendor_id", vendorId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
