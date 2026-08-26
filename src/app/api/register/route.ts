import { getSupabase } from "@/lib/supabase";
import { NextResponse } from "next/server";

const TIPOS = ["gastronomia", "comercio", "servicio", "moda", "salud", "varios", "mascotas"] as const;

export async function POST(request: Request) {
  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json({ error: "Error de conexión" }, { status: 503 });
  }

  const { email, password, firstName, lastName, whatsapp, tipo } = await request.json();

  if (!email || !password || !firstName || !lastName || !whatsapp) {
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

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        first_name: firstName,
        last_name: lastName,
        full_name: `${firstName} ${lastName}`,
        whatsapp,
        role: "vendor",
        vertical: selected,
      },
    },
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ user: data.user });
}
