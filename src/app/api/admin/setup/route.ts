import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    return NextResponse.json({ error: "Faltan variables de entorno" }, { status: 500 });
  }

  const supabase = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { email, password, firstName, lastName, whatsapp } = await request.json();

  if (!email || !password || !firstName || !lastName) {
    return NextResponse.json({ error: "Faltan datos requeridos" }, { status: 400 });
  }

  const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      first_name: firstName,
      last_name: lastName,
      full_name: `${firstName} ${lastName}`,
      whatsapp: whatsapp || "",
      role: "vendor",
      vertical: "gastronomia",
    },
  });

  if (authError) {
    return NextResponse.json({ error: authError.message }, { status: 500 });
  }

  const userId = authUser.user.id;

  const { error: vendorError } = await supabase.from("vendors").upsert({
    user_id: userId,
    store_name: "Portal 659 Admin",
    slug: "admin-portal659",
    category: "admin",
    vertical: "gastronomia",
    neighborhood: "sicardi",
    whatsapp: whatsapp || null,
    accepting_quotes: false,
    verified: true,
    is_admin: true,
  });

  if (vendorError) {
    return NextResponse.json({ error: vendorError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, userId });
}
