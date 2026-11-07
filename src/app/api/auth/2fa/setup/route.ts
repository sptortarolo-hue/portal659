import { NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";
import { getAuthUser } from "@/lib/auth";
import { withRateLimit } from "@/lib/api-wrapper";
import { generateTotpSecret, otpauthUrl, encryptTotpSecret, isMissing2faMigration } from "@/lib/totp";
import QRCode from "qrcode";

export const POST = withRateLimit(async (request: Request) => {
  const user = await getAuthUser(request);
  if (!user?.is_admin) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  // Regenerar sobrescribe el secreto anterior: la app autenticadora vieja
  // deja de validar (el admin debe re-escanear el QR).
  let secret: string;
  try {
    secret = generateTotpSecret();
    await query(
      `UPDATE profiles SET totp_secret = $1, totp_enabled = false, totp_last_step = NULL WHERE id = $2`,
      [encryptTotpSecret(secret), user.id]
    );
  } catch (e) {
    if (isMissing2faMigration(e)) {
      return NextResponse.json(
        { error: "Falta aplicar supabase/self-host/migrate-2fa-totp.sql en el contenedor de la DB." },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: "Error al generar el secreto" }, { status: 500 });
  }
  const otpauth = otpauthUrl(secret, user.email);
  let qr: string | null = null;
  try {
    qr = await QRCode.toDataURL(otpauth, { margin: 1, width: 240 });
  } catch {
    qr = null;
  }
  return NextResponse.json({ ok: true, secret, otpauthUrl: otpauth, qr });
}, { maxRequests: 10 });
