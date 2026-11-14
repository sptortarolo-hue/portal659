import { sendWaText } from "@/lib/wa-send";
import { toE164 } from "@/lib/phone";

/**
 * Envío "inteligente" de un mensaje de WhatsApp:
 * - Si el bot WA del comercio está conectado → se envía automáticamente
 *   (texto y/o imagen) y se devuelve { mode: "auto", ok: true }.
 * - Si no → se devuelve { mode: "manual", url } con un link wa.me para que
 *   el dueño lo envíe a mano (comportamiento actual, sin romper nada).
 *
 * Best-effort: si sendWaText/sendImage falla, se cae a manual.
 */
export async function sendOrLink(input: {
  vendorId: string;
  phone: string;
  text: string;
  imageData?: string; // base64 (sin prefijo data:)
  imageName?: string;
}): Promise<{ mode: "auto" | "manual"; ok: boolean; url?: string; reason?: string }> {
  const wabotUrl = (process.env.WABOT_URL || "http://wabot:8792").replace(/\/$/, "");
  // El relay arma el JID con el número (numero@s.whatsapp.net): tiene que ser
  // E.164 (549...) o el mensaje se pierde. toE164 normaliza "011 15-...",
  // "11 5555-..." y "+54 9 ..." al formato que usa WhatsApp.
  const phoneDigits =
    toE164(input.phone) || String(input.phone || "").replace(/\D/g, "");
  const manualUrl = phoneDigits
    ? `https://wa.me/${phoneDigits}?text=${encodeURIComponent(input.text)}`
    : undefined;

  try {
    const body: Record<string, unknown> = {
      vendorId: input.vendorId,
      waId: phoneDigits || input.phone,
      text: input.text,
      noState: true,
    };
    if (input.imageData) {
      body.type = "image";
      body.data = input.imageData;
    }
    const r = await fetch(`${wabotUrl}/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.WA_BOT_SECRET || ""}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const data = await r.json().catch(() => ({}));
    if (r.ok && data.sent === true) {
      return { mode: "auto", ok: true };
    }
    return { mode: "manual", ok: false, url: manualUrl, reason: data.reason || "not_sent" };
  } catch {
    return { mode: "manual", ok: false, url: manualUrl, reason: "error" };
  }
}

export function isBotConnectedHint(phone: string): string | null {
  const d = String(phone || "").replace(/\D/g, "");
  return d ? `https://wa.me/${d}` : null;
}
