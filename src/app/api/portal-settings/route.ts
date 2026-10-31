import { NextResponse } from "next/server";
import { getPortalSetting } from "@/lib/portal-settings";

export const dynamic = "force-dynamic";

/**
 * Settings públicos del portal (solo lectura, sin auth): lo consume el
 * layout para decidir si monta el botón flotante de WhatsApp.
 */
export async function GET() {
  const waFloat = await getPortalSetting("wa_float");
  const tvQrOnline = await getPortalSetting("tv_qr_online");
  return NextResponse.json({ waFloat, tvQrOnline });
}
