import { getAuthSupabase } from "@/lib/auth-utils";
import { NextResponse } from "next/server";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const params = await context.params;

  const supabase = getAuthSupabase(request);
  if (!supabase) {
    return NextResponse.json({ error: "Error de conexión" }, { status: 503 });
  }

  const { data: user } = await supabase.auth.getUser();
  if (!user?.user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { data: vendor } = await supabase
    .from("vendors")
    .select("id")
    .eq("user_id", user.user.id)
    .single();

  if (!vendor) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const body = await request.json();
  const { status } = body;

  if (!["new", "confirmed", "completed", "cancelled"].includes(status)) {
    return NextResponse.json({ error: "Estado inválido" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("orders")
    .update({ status })
    .eq("id", params.id)
    .eq("vendor_id", vendor.id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ order: data });
}
