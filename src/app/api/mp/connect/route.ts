import { getVendorByRequest } from "@/lib/vendor-utils";
import { buildConnectUrl, isMpEnabled } from "@/lib/mp-oauth";
import { getSiteUrl } from "@/lib/site-url";
import { NextResponse } from "next/server";

/**
 * GET /api/mp/connect
 * Inicia el flujo OAuth: redirige al comercio a la pantalla de autorización
 * de Mercado Pago. El `state` firmado ata el callback a ESTE comercio.
 * Sin `MP_ENABLED=1` (sin OK de MP), se rechaza aunque se acceda directo.
 */
export async function GET(request: Request) {
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) {
    return NextResponse.redirect(new URL("/login", getSiteUrl(request)));
  }

  if (!isMpEnabled()) {
    return NextResponse.json(
      { error: "Los pagos online con Mercado Pago están deshabilitados por ahora" },
      { status: 403 }
    );
  }

  const redirectUri = `${getSiteUrl(request)}/api/mp/oauth/callback`;
  const url = buildConnectUrl(vendor.id, redirectUri);
  return NextResponse.redirect(url);
}
