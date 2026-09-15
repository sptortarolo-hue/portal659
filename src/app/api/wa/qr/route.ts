import { getAuthUser } from "@/lib/auth";
import { getVendorByRequest } from "@/lib/vendor-utils";
import { queryOne } from "@/lib/db";
import { NextResponse } from "next/server";

/**
 * GET /api/wa/qr — devuelve el QR de vinculación del bot de WhatsApp del comercio
 * actual (el que genera el relay en el celular y el cerebro guarda en Postgres).
 * Devuelve `{ qr: string | null }`; el panel /vendor/wa-bot lo renderiza como imagen.
 */
export async function GET(request: Request) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const row = await queryOne<{ qr_data: string | null }>(
    `SELECT qr_data FROM vendor_wa_bots
     WHERE vendor_id = $1 AND qr_updated_at > now() - interval '90 seconds'`,
    [vendor.id]
  );
  return NextResponse.json({ qr: row?.qr_data ?? null });
}