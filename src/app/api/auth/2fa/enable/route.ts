import { NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";
import { getAuthUser } from "@/lib/auth";
import { withRateLimit } from "@/lib/api-wrapper";
import { decryptTotpSecret, verifyTotp, isMissing2faMigration } from "@/lib/totp";

export const POST = withRateLimit(async (request: Request) => {
  const user = await getAuthUser(request);
  if (!user?.is_admin) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  const { code } = (await request.json().catch(() => ({}))) as { code?: string };

  let row: { totp_secret: string | undefined; totp_enabled: boolean; totp_last_step: number | null } | undefined;
  try {
    row = await queryOne<{ totp_secret: string | undefined; totp_enabled: boolean; totp_last_step: number | null }>(
      `SELECT totp_secret, COALESCE(totp_enabled, false) AS totp_enabled, totp_last_step FROM profiles WHERE id = $1`,
      [user.id]
    );
  } catch (e) {
    if (isMissing2faMigration(e)) {
      return NextResponse.json(
        { error: "Falta aplicar supabase/self-host/migrate-2fa-totp.sql en el contenedor de la DB." },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: "Error al leer el estado" }, { status: 500 });
  }

  if (!row?.totp_secret) {
    return NextResponse.json(
      { error: "Primero generá el código QR (Paso 1)." },
      { status: 400 }
    );
  }
  if (row.totp_enabled) {
    return NextResponse.json({ error: "La verificación en dos pasos ya está activada." }, { status: 400 });
  }
  const secret = decryptTotpSecret(row.totp_secret);
  if (!secret) {
    return NextResponse.json({ error: "Secreto inválido. Volvé a generar el QR." }, { status: 400 });
  }
  const v = verifyTotp(secret, String(code || ""), row.totp_last_step);
  if (!v.ok) {
    return NextResponse.json({ error: "Código inválido o vencido. Probá el actual." }, { status: 400 });
  }
  try {
    await query(
      `UPDATE profiles SET totp_enabled = true, totp_last_step = $1 WHERE id = $2`,
      [v.step, user.id]
    );
  } catch (e) {
    if (isMissing2faMigration(e)) {
      return NextResponse.json(
        { error: "Falta aplicar supabase/self-host/migrate-2fa-totp.sql en el contenedor de la DB." },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: "Error al activar" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}, { maxRequests: 10 });
