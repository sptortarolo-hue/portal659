import { getVendorByRequest } from "@/lib/vendor-utils";
import { queryOne } from "@/lib/db";
import { NextResponse } from "next/server";

/**
 * POST /api/vendor/mp/disconnect
 * El comercio revoca la vinculación de su cuenta de Mercado Pago.
 * Limpia los tokens (después de esto el comercio no puede cobrar online hasta
 * que vuelva a conectar).
 */
export async function POST(request: Request) {
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  await queryOne(
    `UPDATE vendors
     SET mp_user_id = NULL, mp_access_token = NULL, mp_refresh_token = NULL,
         mp_public_key = NULL, mp_expires_at = NULL, mp_connected_at = NULL
     WHERE id = $1`,
    [vendor.id]
  );

  return NextResponse.json({ ok: true });
}
