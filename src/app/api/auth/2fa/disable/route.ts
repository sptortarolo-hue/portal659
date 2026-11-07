import { NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";
import { getAuthUser, verifyPassword } from "@/lib/auth";
import { withRateLimit } from "@/lib/api-wrapper";
import { isMissing2faMigration } from "@/lib/totp";

export const POST = withRateLimit(async (request: Request) => {
  const user = await getAuthUser(request);
  if (!user?.is_admin) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  const { password } = (await request.json().catch(() => ({}))) as { password?: string };
  if (!password) {
    return NextResponse.json({ error: "Ingresá tu contraseña para desactivar." }, { status: 400 });
  }

  let row: { password_hash: string } | undefined;
  try {
    row = await queryOne<{ password_hash: string }>(
      `SELECT password_hash FROM profiles WHERE id = $1`,
      [user.id]
    );
  } catch (e) {
    return NextResponse.json({ error: "Error al leer el perfil" }, { status: 500 });
  }
  if (!row || !(await verifyPassword(password, row.password_hash))) {
    return NextResponse.json({ error: "Contraseña incorrecta." }, { status: 401 });
  }

  try {
    await query(
      `UPDATE profiles SET totp_secret = NULL, totp_enabled = false, totp_last_step = NULL WHERE id = $1`,
      [user.id]
    );
  } catch (e) {
    if (isMissing2faMigration(e)) {
      return NextResponse.json(
        { error: "Falta aplicar supabase/self-host/migrate-2fa-totp.sql en el contenedor de la DB." },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: "Error al desactivar" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}, { maxRequests: 10 });
