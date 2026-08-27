import { NextResponse } from "next/server";
import { getAuthSupabase } from "@/lib/auth-utils";
import { isAdmin } from "@/lib/admin-utils";

export async function GET(request: Request) {
  if (!(await isAdmin(request))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const supabase = getAuthSupabase(request)!;
  const { data, error } = await supabase.from("categories").select("*").order("name");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ categories: data || [] });
}

export async function POST(request: Request) {
  if (!(await isAdmin(request))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const body = await request.json();
  const { name, slug, vertical } = body;

  if (!name) return NextResponse.json({ error: "name es requerido" }, { status: 400 });

  const supabase = getAuthSupabase(request)!;
  const { data, error } = await supabase
    .from("categories")
    .insert({ name, slug: slug || name.toLowerCase().replace(/\s+/g, "-"), vertical: vertical || null })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ category: data });
}

export async function DELETE(request: Request) {
  if (!(await isAdmin(request))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const body = await request.json();
  const { id } = body;

  if (!id) return NextResponse.json({ error: "id es requerido" }, { status: 400 });

  const supabase = getAuthSupabase(request)!;
  const { error } = await supabase.from("categories").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
