import { isMpEnabled } from "@/lib/mp-oauth";
import { NextResponse } from "next/server";

/**
 * GET /api/mp/status → { enabled: boolean }
 * El dashboard consulta esto en runtime para mostrar u ocultar la card de
 * conexión con Mercado Pago. Sin `MP_ENABLED=1`, todo MP está apagado.
 */
export async function GET() {
  return NextResponse.json({ enabled: isMpEnabled() });
}
