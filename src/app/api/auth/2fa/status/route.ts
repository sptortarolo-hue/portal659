import { NextResponse } from "next/server";
import { queryOne } from "@/lib/db";
import { getAuthUser } from "@/lib/auth";
import { withRateLimit } from "@/lib/api-wrapper";
import { isMissing2faMigration } from "@/lib/totp";

export const GET = withRateLimit(async (request: Request) => {
  const user = await getAuthUser(request);
  if (!user?.is_admin) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  try {
    const row = await queryOne<{ totp_enabled: boolean }>(
      `SELECT COALESCE(totp_enabled, false) AS totp_enabled FROM profiles WHERE id = $1`,
      [user.id]
    );
    return NextResponse.json({ enabled: row?.totp_enabled === true });
  } catch (e) {
    if (isMissing2faMigration(e)) {
      return NextResponse.json(
        { error: "Falta aplicar supabase/self-host/migrate-2fa-totp.sql en el contenedor de la DB." },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: "Error al leer el estado" }, { status: 500 });
  }
}, { maxRequests: 20 });
