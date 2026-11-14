import sharp from "sharp";
import fs from "fs";
import path from "path";
import QRCode from "qrcode";

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface TicketImageInput {
  storeName: string;
  logoUrl?: string | null;
  address?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  instagram?: string | null;
  facebook?: string | null;
  printLogo?: boolean | null;
  printAddress?: boolean | null;
  printPhone?: boolean | null;
  printSocial?: boolean | null;
  customerName?: string | null;
  date?: string | null;
  time?: string | null;
  items: { name: string; qty?: number; price?: number; modifiers?: string[] }[];
  total: number;
  depositPaid?: number;
  amountPaid?: number;
  paymentMethod?: string | null;
  vuelto?: number;
  cashDiscount?: number;
  // Fiscal
  invoiceNumber?: string | null;
  cae?: string | null;
  caeVto?: string | null;
  isFiscal?: boolean;
  qrData?: string | null; // data para QR fiscal
  footer?: string;
}

let fontBase64Cache: string | null = null;
function loadFontBase64(): string | null {
  if (fontBase64Cache !== null) return fontBase64Cache || null;
  try {
    const fontPath = path.join(process.cwd(), "assets", "fonts", "Roboto-Bold.ttf");
    if (!fs.existsSync(fontPath)) {
      fontBase64Cache = "";
      return null;
    }
    const buf = fs.readFileSync(fontPath);
    fontBase64Cache = buf.toString("base64");
    return fontBase64Cache;
  } catch {
    fontBase64Cache = "";
    return null;
  }
}

let logoCache: Map<string, string> = new Map();
async function loadLogoBase64(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  if (logoCache.has(url)) return logoCache.get(url)!;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const b64 = buf.toString("base64");
    const mime = res.headers.get("content-type") || "image/png";
    const dataUri = `data:${mime};base64,${b64}`;
    logoCache.set(url, dataUri);
    return dataUri;
  } catch {
    return null;
  }
}

/**
 * Renderiza un comprobante (ticket o factura) como PNG, replicando el layout
 * del ticket térmico (composeStoreHeader + ítems + total + vuelto + seña + fiscal).
 */
export async function renderReceiptImage(input: TicketImageInput): Promise<Buffer | null> {
  try {
    const width = 400;
    const padding = 16;
    const lineHeight = 20;
    const lines: { text: string; bold?: boolean; size?: number; align?: "left" | "center" | "right" }[] = [];

    const fontB64 = loadFontBase64();
    const fontFace = fontB64
      ? `@font-face { font-family: 'Roboto'; src: url('data:font/ttf;base64,${fontB64}') format('truetype'); font-weight: bold; }`
      : "";
    const fontFamily = fontB64 ? "Roboto" : "DejaVu Sans, sans-serif";

    // --- Header (logo + nombre + datos) ---
    const wantLogo = input.printLogo !== false && !!input.logoUrl;
    const logoDataUri = wantLogo ? await loadLogoBase64(input.logoUrl) : null;

    // Nombre del local
    const storeName = input.storeName || "Comercio";

    // Address
    const address = input.printAddress !== false ? (input.address || "").trim() : "";
    const phone = input.printPhone !== false ? (input.phone || "").trim() : "";
    const whatsapp = input.printPhone !== false ? (input.whatsapp || "").trim() : "";
    const ig = input.printSocial !== false && input.instagram ? `IG: @${input.instagram.replace(/^@/, "")}` : null;
    const fb = input.printSocial !== false && input.facebook ? `FB: ${input.facebook}` : null;

    // --- Build SVG ---
    // Calculamos altura aproximada
    let lineCount = 0;
    if (!logoDataUri) lineCount += 1; // nombre
    if (address) lineCount += 1;
    if (phone || whatsapp) lineCount += 1;
    if (ig || fb) lineCount += 1;
    lineCount += 1; // separador
    if (input.customerName) lineCount += 1;
    if (input.date) lineCount += 1;
    lineCount += 1; // separador
    for (const it of input.items) {
      lineCount += 1;
      if (it.modifiers && it.modifiers.length > 0) lineCount += 1;
    }
    lineCount += 1; // separador
    if (input.depositPaid && input.depositPaid > 0) lineCount += 1;
    lineCount += 1; // total
    if (input.amountPaid != null && input.amountPaid > 0 && input.amountPaid !== input.total) lineCount += 1;
    if (input.paymentMethod) lineCount += 1;
    if (input.vuelto != null && input.vuelto > 0) lineCount += 1;
    if (input.cashDiscount && input.cashDiscount > 0) lineCount += 1;
    if (input.isFiscal) {
      lineCount += 1; // separador
      if (input.invoiceNumber) lineCount += 1;
      if (input.cae) lineCount += 1;
      if (input.caeVto) lineCount += 1;
      if (input.qrData) lineCount += 6; // QR ~6 líneas de altura
    }
    if (input.footer) {
      lineCount += 1; // separador
      lineCount += 1;
    }
    lineCount += 1; // fecha/hora final

    const lh = 20;
    const height = 30 + lineCount * lh + 20;

    const svg: string[] = [];
    svg.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`);
    svg.push(`<defs>${fontFace ? `<style>${fontFace}</style>` : ""}</defs>`);
    svg.push(`<rect width="100%" height="100%" fill="white"/>`);

    let y = 24;
    const cx = width / 2;

    // --- Logo + nombre ---
    if (logoDataUri) {
      // Logo redondo centrado (como composeStoreHeader en modo imagen)
      const logoSize = 60;
      const logoX = (width - logoSize) / 2;
      svg.push(`<defs><clipPath id="logoCircle"><circle cx="${logoX + logoSize / 2}" cy="${y + logoSize / 2}" r="${logoSize / 2}"/></clipPath></defs>`);
      svg.push(`<image href="${logoDataUri}" x="${logoX}" y="${y}" width="${logoSize}" height="${logoSize}" clip-path="url(#logoCircle)" preserveAspectRatio="xMidYMid slice"/>`);
      y += logoSize + 8;
    }

    // Nombre del local (centrado, bold)
    svg.push(`<text x="${cx}" y="${y}" font-size="18" font-weight="bold" font-family="${fontFamily}" text-anchor="middle" fill="black">${esc(storeName)}</text>`);
    y += lineHeight + 2;

    // Datos
    if (address) {
      svg.push(`<text x="${cx}" y="${y}" font-size="12" font-family="${fontFamily}" text-anchor="middle" fill="black">${esc(address)}</text>`);
      y += lineHeight;
    }
    if (phone || whatsapp) {
      const tel = phone ? `Tel: ${phone}` : null;
      const wa = whatsapp ? `WA: ${whatsapp}` : null;
      const combined = [tel, wa].filter(Boolean).join(" · ");
      svg.push(`<text x="${cx}" y="${y}" font-size="12" font-family="${fontFamily}" text-anchor="middle" fill="black">${esc(combined)}</text>`);
      y += lineHeight;
    }
    if (ig || fb) {
      const combined = [ig, fb].filter(Boolean).join(" · ");
      svg.push(`<text x="${cx}" y="${y}" font-size="12" font-family="${fontFamily}" text-anchor="middle" fill="black">${esc(combined)}</text>`);
      y += lineHeight;
    }

    // Separador
    svg.push(`<text x="${padding}" y="${y}" font-size="12" font-family="${fontFamily}" fill="black">${"-".repeat(48)}</text>`);
    y += lineHeight;

    // Customer + fecha
    if (input.customerName) {
      svg.push(`<text x="${padding}" y="${y}" font-size="13" font-family="${fontFamily}" fill="black">${esc(`Cliente: ${input.customerName}`)}</text>`);
      y += lineHeight;
    }
    if (input.date) {
      svg.push(`<text x="${padding}" y="${y}" font-size="13" font-family="${fontFamily}" fill="black">${esc(`Fecha: ${input.date}${input.time ? " " + input.time : ""}`)}</text>`);
      y += lineHeight;
    }

    // Separador
    svg.push(`<text x="${padding}" y="${y}" font-size="12" font-family="${fontFamily}" fill="black">${"-".repeat(48)}</text>`);
    y += lineHeight;

    // Items
    for (const it of input.items) {
      const qty = it.qty && it.qty > 1 ? `${it.qty}x ` : "";
      const price = it.price != null ? `  $${Number(it.price).toLocaleString("es-AR")}` : "";
      svg.push(`<text x="${padding}" y="${y}" font-size="13" font-family="${fontFamily}" fill="black">${esc(`${qty}${it.name}${price}`)}</text>`);
      y += lineHeight;
      if (it.modifiers && it.modifiers.length > 0) {
        svg.push(`<text x="${padding + 10}" y="${y}" font-size="11" font-family="${fontFamily}" fill="black">${esc(`(${it.modifiers.join(", ")})`)}</text>`);
        y += lineHeight;
      }
    }

    // Separador
    svg.push(`<text x="${padding}" y="${y}" font-size="12" font-family="${fontFamily}" fill="black">${"-".repeat(48)}</text>`);
    y += lineHeight;

    // Seña
    if (input.depositPaid && input.depositPaid > 0) {
      svg.push(`<text x="${padding}" y="${y}" font-size="13" font-family="${fontFamily}" fill="black">${esc(`Seña pagada: $${input.depositPaid.toLocaleString("es-AR")}`)}</text>`);
      y += lineHeight;
    }

    // Descuento en efectivo
    if (input.cashDiscount && input.cashDiscount > 0) {
      svg.push(`<text x="${padding}" y="${y}" font-size="13" font-family="${fontFamily}" fill="black">${esc(`Desc. efectivo: -$${input.cashDiscount.toLocaleString("es-AR")}`)}</text>`);
      y += lineHeight;
    }

    // Total
    svg.push(`<text x="${padding}" y="${y}" font-size="16" font-weight="bold" font-family="${fontFamily}" fill="black">${esc(`TOTAL: $${input.total.toLocaleString("es-AR")}`)}</text>`);
    y += lineHeight + 2;

    // Cobrado
    if (input.amountPaid != null && input.amountPaid > 0 && input.amountPaid !== input.total) {
      svg.push(`<text x="${padding}" y="${y}" font-size="13" font-family="${fontFamily}" fill="black">${esc(`Cobrado: $${input.amountPaid.toLocaleString("es-AR")}`)}</text>`);
      y += lineHeight;
    }

    // Vuelto
    if (input.vuelto != null && input.vuelto > 0) {
      svg.push(`<text x="${padding}" y="${y}" font-size="13" font-family="${fontFamily}" fill="black">${esc(`Vuelto: $${input.vuelto.toLocaleString("es-AR")}`)}</text>`);
      y += lineHeight;
    }

    // Método de pago
    if (input.paymentMethod) {
      svg.push(`<text x="${padding}" y="${y}" font-size="12" font-family="${fontFamily}" fill="black">${esc(`Pago: ${input.paymentMethod}`)}</text>`);
      y += lineHeight;
    }

    // --- Fiscal (Factura C) ---
    if (input.isFiscal) {
      svg.push(`<text x="${padding}" y="${y}" font-size="12" font-family="${fontFamily}" fill="black">${"-".repeat(48)}</text>`);
      y += lineHeight;
      if (input.invoiceNumber) {
        svg.push(`<text x="${padding}" y="${y}" font-size="13" font-weight="bold" font-family="${fontFamily}" fill="black">${esc(`FACTURA C N° ${input.invoiceNumber}`)}</text>`);
        y += lineHeight;
      }
      if (input.cae) {
        svg.push(`<text x="${padding}" y="${y}" font-size="12" font-family="${fontFamily}" fill="black">${esc(`CAE: ${input.cae}`)}</text>`);
        y += lineHeight;
      }
      if (input.caeVto) {
        svg.push(`<text x="${padding}" y="${y}" font-size="12" font-family="${fontFamily}" fill="black">${esc(`Vto CAE: ${input.caeVto}`)}</text>`);
        y += lineHeight;
      }
      // QR fiscal
      if (input.qrData) {
        try {
          const qrDataUri = await QRCode.toDataURL(input.qrData, { width: 120, margin: 1 });
          const qrSize = 120;
          const qrX = (width - qrSize) / 2;
          svg.push(`<image href="${qrDataUri}" x="${qrX}" y="${y}" width="${qrSize}" height="${qrSize}"/>`);
          y += qrSize + 8;
        } catch { /* sin QR */ }
      }
    }

    // Footer
    if (input.footer) {
      svg.push(`<text x="${padding}" y="${y}" font-size="12" font-family="${fontFamily}" fill="black">${"-".repeat(48)}</text>`);
      y += lineHeight;
      svg.push(`<text x="${cx}" y="${y}" font-size="12" font-family="${fontFamily}" text-anchor="middle" fill="black">${esc(input.footer)}</text>`);
      y += lineHeight;
    }

    // Fecha/hora de emisión
    const now = new Date();
    const fechaEmision = now.toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" });
    const horaEmision = now.toLocaleTimeString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", minute: "2-digit" });
    svg.push(`<text x="${cx}" y="${y}" font-size="10" font-family="${fontFamily}" text-anchor="middle" fill="gray">${esc(`Emitido: ${fechaEmision} ${horaEmision}`)}</text>`);
    y += lineHeight;

    svg.push(`</svg>`);

    const png = await sharp(Buffer.from(svg.join(""))).png().toBuffer();
    return png;
  } catch (e) {
    console.error("[ticket-image] render failed", e);
    return null;
  }
}
