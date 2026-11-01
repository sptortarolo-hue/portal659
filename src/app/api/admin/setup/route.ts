import { NextResponse } from "next/server";
import { withTransaction } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { isAdmin } from "@/lib/admin-utils";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  // Alta de administradores: en PRODUCCIÓN solo puede hacerlo un admin que
  // ya esté autenticado. Antes el endpoint era público y cualquiera que
  // hiciera un POST se convertía en admin (agujero de seguridad).
  // Para el primer admin (o para cambiar la clave del dueño) está el script
  // scripts/create-admin-v2.mjs, que habla directo con la DB.
  if (process.env.NODE_ENV === "production" && !(await isAdmin(request))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

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

      // Portal 659 no tiene tienda propia: el admin gestiona otros comercios
      // mediante impersonación (admin-as). No se crea vendor fantasma.

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
