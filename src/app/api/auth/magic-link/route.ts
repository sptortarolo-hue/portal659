import { getSupabase } from "@/lib/supabase";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json({ error: "Error de conexión" }, { status: 503 });
  }

  const { email } = await request.json();

  if (!email) {
    return NextResponse.json(
      { error: "Email es requerido" },
      { status: 400 }
    );
  }

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${request.headers.get("origin") || "https://conectamos-v2.onrender.com"}/`,
    },
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 401 });
  }

  return NextResponse.json({ ok: true });
}
