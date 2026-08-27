import { NextResponse } from "next/server";
import { getAuthSupabase } from "@/lib/auth-utils";
import { isAdmin } from "@/lib/admin-utils";

export async function GET(request: Request) {
  if (!(await isAdmin(request))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const supabase = getAuthSupabase(request)!;

  const [neighborhoodsRes, categoriesRes] = await Promise.all([
    supabase.from("neighborhoods").select("*").order("name"),
    supabase.from("categories").select("*").order("name"),
  ]);

  return NextResponse.json({
    neighborhoods: neighborhoodsRes.data || [],
    categories: categoriesRes.data || [],
  });
}

export async function PATCH(request: Request) {
  if (!(await isAdmin(request))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const body = await request.json();
  const { type, id, data: updateData } = body;

  if (!type || !id || !updateData) {
    return NextResponse.json({ error: "type, id y data son requeridos" }, { status: 400 });
  }

  const supabase = getAuthSupabase(request)!;
  const table = type === "neighborhood" ? "neighborhoods" : "categories";

  const { error } = await supabase.from(table).update(updateData).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
