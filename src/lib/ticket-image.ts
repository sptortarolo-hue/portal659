import sharp from "sharp";

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export type ReceiptLine = { label: string; value?: string };

export interface TicketImageInput {
  storeName: string;
  logoUrl?: string | null;
  address?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  instagram?: string | null;
  customerName?: string | null;
  date?: string | null;
  time?: string | null;
  items: { name: string; qty?: number; price?: number }[];
  total: number;
  depositPaid?: number;
  amountPaid?: number;
  paymentMethod?: string | null;
  // Fiscal
  invoiceNumber?: string | null;
  cae?: string | null;
  caeVto?: string | null;
  isFiscal?: boolean;
  footer?: string;
}

/**
 * Renderiza un comprobante (ticket o factura) como PNG usando sharp (SVG → PNG).
 * Tolerante: si sharp/SVG falla, devuelve null.
 */
export async function renderReceiptImage(input: TicketImageInput): Promise<Buffer | null> {
  try {
    const width = 420;
    const padding = 20;
    const lineHeight = 22;
    const lines: { text: string; bold?: boolean; size?: number; color?: string }[] = [];

    // Header
    lines.push({ text: input.storeName, bold: true, size: 20 });
    if (input.address) lines.push({ text: input.address, size: 13 });
    if (input.phone) lines.push({ text: `Tel: ${input.phone}`, size: 13 });
    if (input.whatsapp) lines.push({ text: `WA: ${input.whatsapp}`, size: 13 });
    if (input.instagram) lines.push({ text: `IG: ${input.instagram}`, size: 13 });
    lines.push({ text: "—".repeat(32), size: 12 });

    if (input.isFiscal && input.invoiceNumber) {
      lines.push({ text: `FACTURA C N° ${input.invoiceNumber}`, bold: true, size: 16 });
      lines.push({ text: "—".repeat(32), size: 12 });
    }

    if (input.customerName) lines.push({ text: `Cliente: ${input.customerName}`, size: 14 });
    if (input.date) lines.push({ text: `Fecha: ${input.date}${input.time ? " " + input.time : ""}`, size: 14 });
    lines.push({ text: "—".repeat(32), size: 12 });

    // Items
    for (const it of input.items) {
      const qty = it.qty && it.qty > 1 ? `${it.qty}x ` : "";
      const price = it.price != null ? `  $${Number(it.price).toLocaleString("es-AR")}` : "";
      lines.push({ text: `${qty}${it.name}${price}`, size: 14 });
    }
    lines.push({ text: "—".repeat(32), size: 12 });

    // Totales
    if (input.depositPaid && input.depositPaid > 0) {
      lines.push({ text: `Seña pagada: $${input.depositPaid.toLocaleString("es-AR")}`, size: 14 });
    }
    lines.push({ text: `TOTAL: $${input.total.toLocaleString("es-AR")}`, bold: true, size: 16 });
    if (input.amountPaid != null && input.amountPaid > 0 && input.amountPaid !== input.total) {
      lines.push({ text: `Cobrado: $${input.amountPaid.toLocaleString("es-AR")}`, size: 14 });
    }
    if (input.paymentMethod) {
      lines.push({ text: `Pago: ${input.paymentMethod}`, size: 13 });
    }

    // Fiscal
    if (input.isFiscal) {
      lines.push({ text: "—".repeat(32), size: 12 });
      if (input.cae) lines.push({ text: `CAE: ${input.cae}`, size: 13 });
      if (input.caeVto) lines.push({ text: `Vto CAE: ${input.caeVto}`, size: 13 });
    }

    if (input.footer) {
      lines.push({ text: "—".repeat(32), size: 12 });
      lines.push({ text: input.footer, size: 12 });
    }

    // Build SVG
    const height = 40 + lines.length * lineHeight + 20;
    const svgParts: string[] = [];
    svgParts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`);
    svgParts.push(`<rect width="100%" height="100%" fill="white"/>`);
    let y = 30;
    for (const l of lines) {
      const fs = l.size || 14;
      const fw = l.bold ? "bold" : "normal";
      svgParts.push(
        `<text x="${padding}" y="${y}" font-size="${fs}" font-weight="${fw}" font-family="monospace" fill="${l.color || "black"}">${esc(l.text)}</text>`
      );
      y += lineHeight;
    }
    svgParts.push(`</svg>`);

    const svg = svgParts.join("");
    const png = await sharp(Buffer.from(svg)).png().toBuffer();
    return png;
  } catch (e) {
    console.error("[ticket-image] render failed", e);
    return null;
  }
}
