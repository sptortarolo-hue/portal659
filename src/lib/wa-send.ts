/**
 * Envío de WhatsApp por el número del comercio (relay Portal Wa Link).
 *
 * Camino: Next → POST http://wabot:8792/send (servicio `wabot`, misma red
 * docker) → WS → relay Go en el celular del comercio → WhatsApp.
 * Si el relay no está vinculado, el cerebro responde sent:false y se sigue
 * con push como siempre (tolerante: WA nunca rompe el flujo).
 *
 * Anti-ban: solo se envía a clientes con turno (relación existente), en
 * horario diurno AR (9-21) y con los rate limits del cerebro
 * (WA_MAX_MSG_PER_HOUR/DAY). Opt-out por comercio: vendors.wa_reminders.
 */

const TZ_AR = "America/Argentina/Buenos_Aires";

export function waBotUrl(): string {
  return (process.env.WABOT_URL || "http://portal659-wabot:8792").replace(/\/$/, "");
}

/** Horario diurno AR (9:00–21:00): fuera de eso no se despierta a nadie. */
export function isDaytimeAR(at = new Date()): boolean {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: TZ_AR,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(at);
    const get = (t: string) => parts.find((p) => p.type === t)?.value || "0";
    const mins = Number(get("hour")) * 60 + Number(get("minute"));
    return mins >= 9 * 60 && mins < 21 * 60;
  } catch {
    return true;
  }
}

export type WaSendResult = { sent: boolean; reason?: string };

/**
 * Envía un texto por WhatsApp vía relay del comercio.
 * `noState=true`: no toca la máquina del asistente (recordatorios, avisos).
 */
export async function sendWaText(input: {
  vendorId: string;
  waId: string;
  text: string;
  orderId?: string | null;
}): Promise<WaSendResult> {
  const secret = process.env.WA_BOT_SECRET || "";
  if (!secret) return { sent: false, reason: "no_secret" };
  const digits = String(input.waId || "").replace(/\D/g, "");
  if (digits.length < 8) return { sent: false, reason: "bad_phone" };
  try {
    const res = await fetch(`${waBotUrl()}/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({
        vendorId: input.vendorId,
        waId: digits,
        text: String(input.text || "").slice(0, 1000),
        orderId: input.orderId || null,
        noState: true,
      }),
      signal: AbortSignal.timeout(12000),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) return { sent: false, reason: data?.error || `http_${res.status}` };
    return { sent: data?.sent === true, reason: data?.reason };
  } catch {
    return { sent: false, reason: "unreachable" };
  }
}
