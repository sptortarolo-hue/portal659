import { NextResponse } from "next/server";
import { withTransaction } from "@/lib/db";
import { hashPassword } from "@/lib/auth";

export async function POST(request: Request) {
  const { email, password, firstName, lastName, whatsapp } = await request.json();

  if (!email || !password || !firstName || !lastName) {
    return NextResponse.json({ error: "Faltan datos requeridos" }, { status: 400 });
  }

  try {
    const userId = await withTransaction(async (tx) => {
      const rows = await tx.query<{ id: string }>(
        `INSERT INTO profiles (email, password_hash, full_name, whatsapp, role, email_confirmed)
         VALUES ($1, $2, $3, $4, 'vendor', true)
         RETURNING id`,
        [email.toLowerCase().trim(), await hashPassword(password), `${firstName} ${lastName}`, whatsapp || ""]
      );
      const id = rows[0].id;

      // El permiso real lo lee getAuthUser desde profiles.is_admin.
      await tx.queryVoid(`UPDATE profiles SET is_admin = true WHERE id = $1`, [id]);

      await tx.queryVoid(
        `INSERT INTO vendors (user_id, store_name, slug, category, vertical, neighborhood, whatsapp, accepting_quotes, verified, is_admin)
         VALUES ($1, $2, 'admin-portal659', 'admin', 'gastronomia', 'sicardi', $3, false, true, true)`,
        [id, "Portal 659 Admin", whatsapp || null]
      );

      return id;
    });

    return NextResponse.json({ ok: true, userId });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Error al crear admin";
    if (msg.includes("duplicate") || msg.includes("unique")) {
      return NextResponse.json({ error: "El email ya está registrado" }, { status: 409 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}