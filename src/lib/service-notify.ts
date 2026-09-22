import { queryMany } from "@/lib/db";
import { sendPushToUser } from "@/lib/push";

const digitsOf = (p: unknown) =>
  String(p || "").replace(/\D/g, "").replace(/^549?|^54/, "");

/**
 * Avisa al cliente de un servicio (turno confirmado, presupuesto respondido /
 * aceptado, seña pagada). Los formularios públicos no loguean al cliente, así
 * que se lo busca por teléfono: si tiene cuenta con ese número, le llega push;
 * si no, el vendor usa el link de WhatsApp de la bandeja. Best-effort.
 */
export async function findCustomerUserId(phone: unknown): Promise<string | null> {
  const d = digitsOf(phone);
  if (d.length < 8) return null;
  const tail = d.slice(-8);
  const rows = await queryMany<{ id: string; phone: string | null; whatsapp: string | null }>(
    `SELECT id, phone, whatsapp FROM profiles
     WHERE (phone IS NOT NULL AND regexp_replace(phone, '\\D', '', 'g') LIKE '%' || $1)
        OR (whatsapp IS NOT NULL AND regexp_replace(whatsapp, '\\D', '', 'g') LIKE '%' || $1)
     LIMIT 5`,
    [tail]
  ).catch(() => []);
  for (const r of rows || []) {
    for (const p of [r.phone, r.whatsapp]) {
      const pd = digitsOf(p);
      if (pd.length >= 8 && (pd.endsWith(tail) || tail.endsWith(pd.slice(-8)))) {
        return r.id;
      }
    }
  }
  return null;
}

export async function notifyServiceClient(
  phone: unknown,
  payload: { title: string; body: string; link?: string }
): Promise<boolean> {
  try {
    const userId = await findCustomerUserId(phone);
    if (!userId) return false;
    await sendPushToUser(userId, payload);
    return true;
  } catch {
    return false;
  }
}
