import { getAuthSupabase } from "@/lib/auth-utils";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const supabase = getAuthSupabase(request);
  if (!supabase) {
    return NextResponse.json({ error: "Error de conexión" }, { status: 503 });
  }

  const { error } = await supabase.auth.signOut();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
