import { NextResponse } from "next/server";
import { withTransaction } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { sendEmail, welcomeEmail, confirmEmailEmail } from "@/lib/email";
import { getSiteUrl } from "@/lib/site-url";
import { createHash, randomBytes } from "crypto";
import { checkArgPhone, toE164Plus } from "@/lib/phone";

const TIPOS = ["gastronomia", "comercio", "servicio", "moda", "salud", "otro"] as const;

export async function POST(request: Request) {
  const { email, password, firstName, lastName, storeName, whatsapp, tipo } = await request.json();

  if (!email || !password || !firstName || !lastName || !storeName || !whatsapp) {
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

  // WhatsApp obligatorio y válido (celular argentino).
  const phoneCheck = checkArgPhone(String(whatsapp || ""));
  if (!phoneCheck.ok) {
    return NextResponse.json(
      { error: "Ingresá un WhatsApp válido (celular argentino)" },
      { status: 400 }
    );
  }
  const phoneE164 = toE164Plus(whatsapp) || String(whatsapp).trim();

  const storeNameClean = String(storeName).trim();
  if (!storeNameClean) {
    return NextResponse.json({ error: "Ingresá el nombre del local comercial" }, { status: 400 });
  }

  const selected = TIPOS.includes(tipo) ? tipo : "gastronomia";
  const passwordHash = await hashPassword(password);

  const confirmToken = randomBytes(32).toString("hex");
  const confirmTokenHash = createHash("sha256").update(confirmToken).digest("hex");
  const confirmExpires = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(); // 48 h

  try {
    const user = await withTransaction(async (tx) => {
      const rows = await tx.query<{ id: string; email: string; full_name: string | null; role: string }>(
        `INSERT INTO profiles (email, password_hash, full_name, phone, whatsapp, role, email_confirmed, confirm_token_hash, confirm_token_expires)
         VALUES ($1, $2, $3, $4, $4, 'vendor', false, $5, $6)
         RETURNING id, email, full_name, role`,
        [email.toLowerCase().trim(), passwordHash, `${String(firstName).trim()} ${String(lastName).trim()}`.trim(), phoneE164, confirmTokenHash, confirmExpires]
      );

      const userId = rows[0].id;

      const vendorRows = await tx.query<{ slug: string }>(
        `INSERT INTO vendors (user_id, store_name, vertical, neighborhood, whatsapp)
         VALUES ($1, $2, $3, 'sicardi', $4)
         RETURNING slug`,
        [userId, storeNameClean, selected, phoneE164]
      );

      return { ...rows[0], slug: vendorRows[0]?.slug || "" };
    });

    // Emails best-effort
    const baseUrl = getSiteUrl(request);
    const confirmUrl = `${baseUrl}/auth/callback?token=${confirmToken}&type=signup`;
    const { subject, html } = confirmEmailEmail(confirmUrl);
    await sendEmail({ to: user.email, subject, html });

    if (user.email && user.slug) {
      const microsite = `${baseUrl}/tienda/${user.slug}`;
      const welcome = welcomeEmail(user.full_name || storeNameClean, microsite);
      await sendEmail({ to: user.email, subject: welcome.subject, html: welcome.html });
    }

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        user_metadata: { full_name: user.full_name, role: user.role },
      },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Error al registrar";
    if (msg.includes("duplicate") || msg.includes("unique")) {
      return NextResponse.json({ error: "El email ya está registrado" }, { status: 409 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}