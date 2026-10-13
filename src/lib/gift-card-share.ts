/**
 * Texto e imagen compartible de giftcards (client-safe: sin imports node).
 * El envío viaja por wa.me (el comercio lo manda desde su WhatsApp):
 * cero costo, cero riesgo de ban. La imagen sale del endpoint
 * /og/giftcard/[code].jpg y la ficha pública de /g/[code].
 */

/** YYYY-MM-DD (o con hora) → DD/MM/AAAA. "" si no hay fecha. */
export function fmtVence(iso: string | null | undefined): string {  const d = String(iso || "").slice(0, 10);
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

/** Link público a la ficha de la tarjeta (conocimiento del código = acceso). */
export function giftcardCardUrl(siteUrl: string, code: string): string {
  const base = String(siteUrl || "").replace(/\/$/, "") || "https://www.portal659.com.ar";
  return `${base}/g/${encodeURIComponent(String(code || "").trim().toUpperCase())}`;
}

/** Link directo a la imagen de la tarjeta (para adjuntar/descargar). */
export function giftcardImageUrl(siteUrl: string, code: string): string {
  const base = String(siteUrl || "").replace(/\/$/, "") || "https://www.portal659.com.ar";
  return `${base}/og/giftcard/${encodeURIComponent(String(code || "").trim().toUpperCase())}.jpg`;
}

export function buildGiftcardWaText(opts: {
  storeName: string;
  amount: number;
  code: string;
  expiresAt?: string | null;
  cardUrl?: string | null;
  recipientName?: string | null;
}): string {
  const who = opts.recipientName ? ` para ${opts.recipientName}` : "";
  const lines = [
    `🎁 ¡Te regalaron una tarjeta de *${opts.storeName}*${who}!`,
    `💰 Valor: $${Math.round(Number(opts.amount) || 0).toLocaleString("es-AR")}`,
    `🔑 Código: *${String(opts.code || "").trim().toUpperCase()}*`,
  ];
  const vence = fmtVence(opts.expiresAt);
  lines.push(vence ? `📅 Válida hasta el ${vence}` : `📅 Sin vencimiento`);
  if (opts.cardUrl) {
    lines.push("", `Mirá tu tarjeta acá: ${opts.cardUrl}`);
  }
  lines.push(`Presentá el código en ${opts.storeName} para usarla. ¡Que la disfrutes!`);
  return lines.join("\n");
}

/** Link wa.me con el texto prearmado (phone en dígitos o "" = share genérico). */
export function giftcardWaLink(phoneDigits: string, text: string): string {
  const digits = String(phoneDigits || "").replace(/[^0-9]/g, "");
  const base = digits ? `https://wa.me/${digits}` : "https://wa.me/";
  return `${base}?text=${encodeURIComponent(text)}`;
}

/** ¿La fila de producto/catálogo es una giftcard vendible (monto fijo)? */
export function isGiftProductRow(p: { sku?: unknown; category?: unknown } | null | undefined): boolean {
  if (!p) return false;
  return (
    String((p as { sku?: unknown }).sku || "").startsWith("GC-") ||
    String((p as { category?: unknown }).category || "").trim().toLowerCase() === "giftcards"
  );
}
