import { isStripeEnabled } from "@/lib/stripe-connect";
import { NextResponse } from "next/server";

/**
 * GET /api/stripe/status → { enabled: boolean }
 * El dashboard consulta esto en runtime para mostrar u ocultar la card de
 * conexión con Stripe. Sin `STRIPE_ENABLED=1`, todo Stripe está apagado.
 */
export async function GET() {
  return NextResponse.json({ enabled: isStripeEnabled() });
}
