import { getSupabase } from "@/lib/supabase";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json({ error: "Error de conexion" }, { status: 503 });
  }

  const { searchParams } = new URL(request.url);
  const days = parseInt(searchParams.get("days") || "7", 10);
  const limit = parseInt(searchParams.get("limit") || "5", 10);

  const { data, error } = await supabase.rpc("get_most_ordered_products", {
    p_days: days,
    p_limit: limit,
  });

  if (error) {
    return NextResponse.json({ error: error.message, items: [] }, { status: 500 });
  }

  return NextResponse.json({ items: data || [] });
}
