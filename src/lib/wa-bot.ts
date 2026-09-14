import { queryOne } from "@/lib/db";

/**
 * Helpers del bot de WhatsApp.
 * `WA_BOT_SECRET` es el secreto compartido entre el servicio `services/wa-bot`
 * (y el APK relay) y estos endpoints internos de la app.
 */

export function waBotSecret(): string {
  return process.env.WA_BOT_SECRET || "";
}

/** Autentica un request al endpoint interno del bot. Sin secreto configurado
 *  (dev local) se permite el acceso. */
export function authWaBot(request: Request): boolean {
  const secret = waBotSecret();
  if (!secret) return true;
  const auth = request.headers.get("authorization") || "";
  return auth === `Bearer ${secret}`;
}

export type VendorWaBot = {
  vendor_id: string;
  wa_phone: string | null;
  status: string | null;
  enabled: boolean;
  token: string | null;
};

export async function getVendorWaBot(vendorId: string): Promise<VendorWaBot | null> {
  try {
    const row = await queryOne<any>(
      `SELECT * FROM vendor_wa_bots WHERE vendor_id = $1 LIMIT 1`,
      [vendorId]
    );
    return (row as VendorWaBot) ?? null;
  } catch {
    // Tabla aún no migrada → no hay registro que bloquee nada.
    return null;
  }
}

/** ¿El bot está habilitado para este vendor? Tolerante a tabla inexistente
 *  (dev sin migrar) → true. Si la fila existe y enabled=false → false.
 *  Es el "kill switch" por comercio, usado por el admin y el servicio. */
export async function isWaBotEnabled(vendorId: string): Promise<boolean> {
  const row = await getVendorWaBot(vendorId);
  if (!row) return true;
  return row.enabled !== false;
}