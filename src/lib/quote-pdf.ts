/**
 * PDF A4 del presupuesto de oficio (servicios) o consulta (estética).
 * Logo + datos del comercio, cliente, tabla de partidas (material/mano de
 * obra), TOTAL, seña y condiciones. pdf-lib puro (sin binarios): seguro en
 * docker slim. Patrón espejo de src/lib/arca/pdf.ts.
 */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { existsSync, readFileSync } from "fs";
import path from "path";
import type { Quote, QuoteItem, Vendor } from "@/types/database";

export type QuotePdfData = {
  vendor: Pick<Vendor, "store_name" | "address" | "phone" | "whatsapp" | "logo_url">;
  /** Título del documento ("PRESUPUESTO" por defecto, "CONSULTA" en estética). */
  docTitle?: string;
  quote: Pick<
    Quote,
    | "customer_name"
    | "customer_phone"
    | "service_name"
    | "description"
    | "preferred_date"
    | "quoted_price"
    | "deposit_pct"
    | "deposit_amount"
    | "created_at"
  >;
  items: Pick<QuoteItem, "kind" | "description" | "qty" | "unit_price">[];
};

const money = (n: number) =>
  `$${Number(n || 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fdate = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
};

function logoDiskPath(logoUrl: string | null | undefined): string | null {
  if (!logoUrl) return null;
  const m = logoUrl.match(/\/uploads\/([^?#]+)/);
  if (!m) return null;
  const root = process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads");
  const p = path.join(root, m[1]);
  return existsSync(p) ? p : null;
}

export async function buildQuotePdf(data: QuotePdfData): Promise<Buffer> {
  const { vendor, quote, items } = data;
  const docTitle = data.docTitle || "PRESUPUESTO";
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]); // A4
  const { width } = page.getSize();
  const M = 48;
  const black = rgb(0, 0, 0);
  const gray = rgb(0.4, 0.4, 0.4);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let y = 841.89 - 48;

  const text = (str: string, x: number, yy: number, size = 10, f = font, color = black, maxW?: number) => {
    let s = str;
    if (maxW) {
      while (s.length > 1 && f.widthOfTextAtSize(s + "…", size) > maxW) s = s.slice(0, -1);
      if (s !== str) s += "…";
    }
    page.drawText(s, { x, y: yy, size, font: f, color });
  };

  const logoPath = logoDiskPath(vendor.logo_url);
  if (logoPath) {
    try {
      const bytes = readFileSync(logoPath);
      const img = logoPath.toLowerCase().endsWith(".png")
        ? await doc.embedPng(bytes)
        : await doc.embedJpg(bytes);
      const h = 72;
      const w = (img.width / img.height) * h;
      page.drawImage(img, { x: M, y: y - h, width: Math.min(w, 150), height: h });
    } catch {
      /* sin logo: solo texto */
    }
  }
  // El título se mide y se alinea a derecha; el bloque izquierdo (nombre,
  // dirección, contacto) se limita al espacio restante para que nunca se
  // solapen, sea cual sea el largo del nombre del local.
  const titleW = bold.widthOfTextAtSize(docTitle, 15);
  const rightX = width - M - titleW;
  const nameMaxW = Math.max(80, rightX - (M + 170) - 12);
  text(vendor.store_name || "", M + 170, y - 6, 15, bold, black, nameMaxW);
  text(docTitle, rightX, y - 6, 15, bold);
  text(`Fecha: ${fdate(quote.created_at)}`, rightX, y - 26, 9, font, gray);
  if (vendor.address) text(vendor.address, M + 170, y - 26, 9, font, gray, nameMaxW);
  const contact = [vendor.phone, vendor.whatsapp].filter(Boolean).join(" · ");
  if (contact) text(contact, M + 170, y - 40, 9, font, gray, nameMaxW);
  y -= 110;

  text("Cliente", M, y, 10, bold);
  y -= 16;
  text(quote.customer_name || "", M, y, 11, bold);
  y -= 15;
  if (quote.customer_phone) {
    text(`Tel: ${quote.customer_phone}`, M, y, 9, font, gray);
    y -= 14;
  }
  if (quote.service_name) {
    text(`Servicio: ${quote.service_name}`, M, y, 9, font, gray);
    y -= 14;
  }
  if (quote.preferred_date) {
    text(`Fecha estimada: ${quote.preferred_date}`, M, y, 9, font, gray);
    y -= 14;
  }
  y -= 4;
  page.drawLine({ start: { x: M, y }, end: { x: width - M, y }, thickness: 1, color: gray });
  y -= 18;

  if (quote.description) {
    text("Detalle del trabajo", M, y, 10, bold);
    y -= 15;
    // Wrap simple por palabras.
    const words = quote.description.split(/\s+/);
    let line = "";
    for (const w of words) {
      const probe = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(probe, 10) > width - M * 2 && line) {
        text(line, M, y, 10);
        y -= 14;
        line = w;
      } else {
        line = probe;
      }
    }
    if (line) {
      text(line, M, y, 10);
      y -= 14;
    }
    y -= 8;
  }

  // Tabla de partidas.
  if (items.length > 0) {
    const cols = [M, M + 44, M + 330, M + 430];
    text("Cant", cols[0], y, 9, bold, gray);
    text("Descripción", cols[1], y, 9, bold, gray);
    text("P. Unit", cols[2], y, 9, bold, gray);
    text("Importe", width - M - 70, y, 9, bold, gray);
    y -= 14;
    for (const it of items) {
      if (y < 220) break; // v1: una página
      const lineTotal = Math.round(Number(it.qty) * Number(it.unit_price) * 100) / 100;
      text(String(it.qty), cols[0], y, 10);
      const tag = it.kind === "labor" ? "Mano de obra: " : "";
      text(tag + it.description, cols[1], y, 10, font, black, 220);
      text(money(Number(it.unit_price)), cols[2], y, 10);
      const imp = money(lineTotal);
      text(imp, width - M - font.widthOfTextAtSize(imp, 10), y, 10);
      y -= 15;
    }
    y -= 6;
    page.drawLine({ start: { x: M, y }, end: { x: width - M, y }, thickness: 1, color: gray });
    y -= 22;
  }

  const total = items.length > 0
    ? items.reduce((s, it) => s + Number(it.qty) * Number(it.unit_price), 0)
    : Number(quote.quoted_price) || 0;
  const totalStr = money(total);
  text("TOTAL", width - M - 170, y, 11, bold, gray);
  text(totalStr, width - M - bold.widthOfTextAtSize(totalStr, 14), y - 2, 14, bold);
  y -= 26;

  if (quote.deposit_amount != null && Number(quote.deposit_amount) > 0) {
    const sena = `Seña (${quote.deposit_pct ?? ""}%): ${money(Number(quote.deposit_amount))}`;
    text(sena, M, y, 10, bold);
    y -= 16;
  }
  text("Sin compromiso. Validez: 30 días salvo indicación contraria.", M, y, 8, font, gray);
  y -= 14;
  text("Este documento no es comprobante fiscal.", M, y, 8, font, gray);

  text("Emitido con Portal 659 · www.portal659.com.ar", M, 40, 8, font, gray);

  return Buffer.from(await doc.save());
}
