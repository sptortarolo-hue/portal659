import { getSupabase } from "@/lib/supabase";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const supabase = getSupabase();
  if (!supabase) return NextResponse.json({ error: "Error de conexión" }, { status: 503 });

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const { data } = await supabase
    .from("vendors")
    .select("transfer_cbu, transfer_alias, transfer_qr_url, whatsapp, store_name, vertical")
    .eq("id", id)
    .single();

  return NextResponse.json({ vendor: data });
}
