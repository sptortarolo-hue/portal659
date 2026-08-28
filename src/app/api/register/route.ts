import { NextResponse } from "next/server";
import { withTransaction } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { sendEmail, welcomeEmail } from "@/lib/email";

const TIPOS = ["gastronomia", "comercio", "servicio", "moda", "salud"] as const;

export async function POST(request: Request) {
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
  const passwordHash = await hashPassword(password);

  try {
    const user = await withTransaction(async (tx) => {
      const rows = await tx.query<{ id: string; email: string; full_name: string | null; role: string }>(
        `INSERT INTO profiles (email, password_hash, full_name, phone, whatsapp, role, email_confirmed)
         VALUES ($1, $2, $3, NULL, $4, 'vendor', true)
         RETURNING id, email, full_name, role`,
        [email.toLowerCase().trim(), passwordHash, `${firstName} ${lastName}`, whatsapp]
      );

      const userId = rows[0].id;

      const vendorRows = await tx.query<{ slug: string }>(
        `INSERT INTO vendors (user_id, store_name, vertical, neighborhood, whatsapp)
         VALUES ($1, $2, $3, 'sicardi', $4)
         RETURNING slug`,
        [userId, firstName, selected, whatsapp]
      );

      return { ...rows[0], slug: vendorRows[0]?.slug || "" };
    });

    // Email de bienvenida (best-effort)
    const baseUrl = (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "");
    if (user.email && user.slug) {
      const microsite = `${baseUrl}/tienda/${user.slug}`;
      const { subject, html } = welcomeEmail(user.full_name || firstName, microsite);
      await sendEmail({ to: user.email, subject, html });
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