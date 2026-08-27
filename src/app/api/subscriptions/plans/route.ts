import { getSupabase } from "@/lib/supabase";
import { NextResponse } from "next/server";

export const revalidate = 60;

export async function GET() {
  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json({ error: "Error de conexión" }, { status: 503 });
  }

  const { data, error } = await supabase
    .from("plans")
    .select("*")
    .order("sort", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ plans: data || [] });
}