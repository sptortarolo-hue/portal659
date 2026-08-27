import { NextResponse } from "next/server";
import { getAuthSupabase } from "@/lib/auth-utils";
import { isAdmin } from "@/lib/admin-utils";

export async function GET(request: Request) {
  if (!(await isAdmin(request))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const supabase = getAuthSupabase(request)!;
  const { data, error } = await supabase.from("neighborhoods").select("*").order("name");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ neighborhoods: data || [] });
}

export async function POST(request: Request) {
  if (!(await isAdmin(request))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const body = await request.json();
  const { name, slug, lat, lng } = body;

  if (!name || !slug) {
    return NextResponse.json({ error: "name y slug son requeridos" }, { status: 400 });
  }

  const supabase = getAuthSupabase(request)!;
  const { data, error } = await supabase
    .from("neighborhoods")
    .insert({ name, slug, lat: lat || null, lng: lng || null })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ neighborhood: data });
}

export async function DELETE(request: Request) {
  if (!(await isAdmin(request))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const body = await request.json();
  const { id } = body;

  if (!id) return NextResponse.json({ error: "id es requerido" }, { status: 400 });

  const supabase = getAuthSupabase(request)!;
  const { error } = await supabase.from("neighborhoods").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
