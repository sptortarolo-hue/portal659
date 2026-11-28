import { NextResponse } from "next/server";
import { isGoogleAuthEnabled } from "@/lib/google-auth";

/**
 * GET /api/auth/google/status → { enabled }
 *
 * Lo consulta el botón "Continuar con Google" para mostrarse solo si el
 * servidor tiene GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET configurados.
 */
export async function GET() {
  return NextResponse.json(
    { enabled: isGoogleAuthEnabled() },
    { headers: { "Cache-Control": "no-store" } }
  );
}
