import { getSupabase } from "@/lib/supabase";
import { NextResponse } from "next/server";

const TIPOS = ["gastronomia", "comercio", "servicio", "moda", "salud", "varios", "mascotas", "comprador"] as const;

export async function POST(request: Request) {
  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json({ error: "Error de conexión" }, { status: 503 });
  }

  const { email, password, name, tipo } = await request.json();

  if (!email || !password || !name) {
    return NextResponse.json(
      { error: "Faltan datos requeridos" },
      { status: 400 }
    );
  }

  if (password.length < 6) {
    return NextResponse.json(
      { error: "La contraseña debe tener al menos 6 caracteres" },
      { status: 400 }
    );
  }

  const selected = TIPOS.includes(tipo) ? tipo : "gastronomia";
  const role = selected === "comprador" ? "buyer" : "vendor";
  const vertical = selected === "comprador" ? "otro" : selected;

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: name, role, vertical },
    },
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ user: data.user });
}
