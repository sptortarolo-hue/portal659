import { getVendorByRequest } from "@/lib/vendor-utils";
import { buildStripeConnectUrl, isStripeEnabled } from "@/lib/stripe-connect";
import { getSiteUrl } from "@/lib/site-url";
import { NextResponse } from "next/server";

/**
 * GET /api/stripe/connect
 * Inicia el OAuth de Stripe Connect (Standard): redirige al comercio a
 * autorizar al portal como plataforma. El `state` firmado ata el callback
 * a ESTE comercio. Sin `STRIPE_ENABLED=1` se rechaza aunque se acceda directo.
 */
export async function GET(request: Request) {
  const { vendor, staffRole } = await getVendorByRequest(request);
  if (!vendor) {
    return NextResponse.redirect(new URL("/login", getSiteUrl(request)));
  }
  // La conexión de Stripe es del dueño (el staff no vincula cuentas).
  if (staffRole === "delivery" || staffRole === "staff") {
    return NextResponse.json({ error: "Solo el dueño puede conectar Stripe" }, { status: 403 });
  }

  if (!isStripeEnabled()) {
    return NextResponse.json(
      { error: "Los pagos online con Stripe están deshabilitados por ahora" },
      { status: 403 }
    );
  }

  const redirectUri = `${getSiteUrl(request)}/api/stripe/oauth/callback`;
  const url = buildStripeConnectUrl(vendor.id, redirectUri);
  return NextResponse.redirect(url);
}
