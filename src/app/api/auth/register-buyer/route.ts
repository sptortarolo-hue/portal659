import { NextResponse } from "next/server";
import { queryOne } from "@/lib/db";
import { hashPassword, signAccessToken } from "@/lib/auth";
import { withRateLimit } from "@/lib/api-wrapper";
import { toE164Plus, checkArgPhone, phoneVariantsAR } from "@/lib/phone";

/**
 * Registro de comprador (cliente): cuenta para guardar favoritos, datos de
 * contacto, pedidos y reseñas. No crea un comercio.
 * - WhatsApp es obligatorio y válido (celular argentino). Se usa además para iniciar sesión.
 */
export const POST = withRateLimit(async (request: Request) => {
  const { email, password, firstName, lastName, whatsapp } = await request.json();

  if (!email || !password || !firstName || !lastName || !whatsapp) {
    return NextResponse.json(
      { error: "Completá nombre, apellido, email, contraseña y WhatsApp" },
      { status: 400 }
    );
  }

  if (password.length < 6) {
    return NextResponse.json({ error: "La contraseña debe tener al menos 6 caracteres" }, { status: 400 });
  }

  const emailLower = String(email).toLowerCase().trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailLower)) {
    return NextResponse.json({ error: "Email inválido" }, { status: 400 });
  }

  // WhatsApp: solo celulares argentinos válidos.
  const phoneCheck = checkArgPhone(String(whatsapp || ""));
  if (!phoneCheck.ok) {
    return NextResponse.json(
      { error: "Ingresá un WhatsApp válido (celular argentino)" },
      { status: 400 }
    );
  }
  const phoneE164 = toE164Plus(whatsapp);

  const existing = await queryOne<{ id: string }>(
    `SELECT id FROM profiles WHERE lower(email) = lower($1) LIMIT 1`,
    [emailLower]
  );
  if (existing) {
    return NextResponse.json({ error: "El email ya está registrado" }, { status: 409 });
  }

  const phoneVariants = phoneVariantsAR(whatsapp);
  const existingPhone = await queryOne<{ id: string }>(
    `SELECT id FROM profiles
     WHERE regexp_replace(whatsapp, '[^0-9]', '', 'g') = ANY($1)
        OR regexp_replace(phone, '[^0-9]', '', 'g') = ANY($1)
     LIMIT 1`,
    [phoneVariants]
  );
  if (existingPhone) {
    return NextResponse.json({ error: "Ese WhatsApp ya está registrado" }, { status: 409 });
  }

  const passwordHash = await hashPassword(password);
  const fullName = `${String(firstName).trim()} ${String(lastName).trim()}`.trim();

  const user = await queryOne<{ id: string; email: string; full_name: string | null; role: string }>(
    `INSERT INTO profiles (email, password_hash, full_name, phone, whatsapp, role, email_confirmed, verified)
     VALUES ($1, $2, $3, $4, $4, 'buyer', true, true)
     RETURNING id, email, full_name, role`,
    [emailLower, passwordHash, fullName, phoneE164]
  );

  if (!user) {
    return NextResponse.json({ error: "No se pudo crear la cuenta" }, { status: 500 });
  }

  const accessToken = await signAccessToken({
    id: user.id,
    email: user.email,
    role: user.role,
  });

  const response = NextResponse.json({
    ok: true,
    user: { id: user.id, email: user.email, name: user.full_name || user.email, role: user.role },
  });

  const isLocal = process.env.NODE_ENV === "development";
  const cookieOpts = {
    httpOnly: true,
    secure: !isLocal,
    sameSite: "lax" as const,
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  };
  response.cookies.set("sb-access-token", accessToken, cookieOpts);
  response.cookies.set("sb-refresh-token", accessToken, cookieOpts);

  return response;
}, { maxRequests: 10 });