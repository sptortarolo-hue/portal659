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

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
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

  const { id } = await ctx.params;
  const body = await request.json();

  const { data: existing } = await supabase
    .from("vendor_categories")
    .select("*")
    .eq("id", id)
    .eq("vendor_id", vendorId)
    .single();
  if (!existing) {
    return NextResponse.json(
      { error: "Categoría no encontrada" },
      { status: 404 }
    );
  }

  const patch: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) {
    patch.name = body.name.trim();
  }
  if (typeof body.position === "number") {
    patch.position = body.position;
  }

  const { data, error } = await supabase
    .from("vendor_categories")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (patch.name && patch.name !== existing.name) {
    await supabase
      .from("products")
      .update({ category: patch.name })
      .eq("vendor_id", vendorId)
      .ilike("category", existing.name);
  }

  return NextResponse.json({ category: data });
}

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
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

  const { id } = await ctx.params;

  const { data: existing } = await supabase
    .from("vendor_categories")
    .select("name")
    .eq("id", id)
    .eq("vendor_id", vendorId)
    .single();
  if (!existing) {
    return NextResponse.json(
      { error: "Categoría no encontrada" },
      { status: 404 }
    );
  }

  const { error } = await supabase
    .from("vendor_categories")
    .delete()
    .eq("id", id)
    .eq("vendor_id", vendorId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await supabase
    .from("products")
    .update({ category: "otras" })
    .eq("vendor_id", vendorId)
    .ilike("category", existing.name);

  return NextResponse.json({ ok: true });
}
