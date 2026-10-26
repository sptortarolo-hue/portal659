/**
 * PDF A4 del Recibo X de pago de planes ("documento no válido como factura").
 * Comprobante NO fiscal: no lleva CAE ni se envía a ARCA. pdf-lib puro (sin
 * binarios): seguro en docker slim. Patrón espejo de src/lib/quote-pdf.ts.
 */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { Vendor } from "@/types/database";

export type PlanReceiptPdfData = {
  /** Datos del comercio que paga (a quien se le emite el recibo). */
  vendor: Pick<Vendor, "store_name" | "address" | "phone" | "whatsapp">;
  /** Número del recibo ("0001/2026"). */
  receiptNumber: string;
  issuedAt: string;
  planName: string;
  amount: number;
  periodStart: string | null;
  periodEnd: string | null;
  method: string;
};

const money = (n: number) =>
  `$${Number(n || 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fdate = (iso: string | null): string => {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
};

export async function buildPlanReceiptPdf(data: PlanReceiptPdfData): Promise<Buffer> {
  const { vendor, receiptNumber, issuedAt, planName, amount, periodStart, periodEnd, method } = data;
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

  // Encabezado: quien emite (Portal 659) + tipo de documento.
  text("Portal 659", M, y - 6, 16, bold);
  text("Centro comercial del barrio · www.portal659.com.ar", M, y - 26, 9, font, gray);
  text("RECIBO X", width - M - bold.widthOfTextAtSize("RECIBO X", 15), y - 6, 15, bold);
  text(`Nº ${receiptNumber}`, width - M - bold.widthOfTextAtSize(`Nº ${receiptNumber}`, 10), y - 26, 10, bold);
  text(`Fecha: ${fdate(issuedAt)}`, width - M - font.widthOfTextAtSize(`Fecha: ${fdate(issuedAt)}`, 9), y - 42, 9, font, gray);
  y -= 70;

  text("Recibimos de", M, y, 10, bold, gray);
  y -= 16;
  text(vendor.store_name || "", M, y, 12, bold);
  y -= 16;
  if (vendor.address) text(vendor.address, M, y, 9, font, gray);
  y -= 14;
  const contact = [vendor.phone, vendor.whatsapp].filter(Boolean).join(" · ");
  if (contact) text(contact, M, y, 9, font, gray);
  y -= 22;

  page.drawLine({ start: { x: M, y }, end: { x: width - M, y }, thickness: 1, color: gray });
  y -= 24;

  text("Concepto", M, y, 10, bold, gray);
  y -= 16;
  text(`Plan ${planName}`, M, y, 11, bold);
  y -= 15;
  if (periodStart && periodEnd) {
    text(`Período abonado: del ${fdate(periodStart)} al ${fdate(periodEnd)}`, M, y, 10);
    y -= 15;
  }
  text(`Medio de pago: ${method}`, M, y, 10);
  y -= 30;

  const totalStr = money(amount);
  text("TOTAL", width - M - 170, y, 11, bold, gray);
  text(totalStr, width - M - bold.widthOfTextAtSize(totalStr, 14), y - 2, 14, bold);
  y -= 40;

  // Leyendas: documento no fiscal (obligatorio para un Recibo X).
  text("Documento no válido como factura.", M, y, 9, bold);
  y -= 14;
  text("Este comprobante respalda el pago de la suscripción y no tiene validez fiscal.", M, y, 8, font, gray);
  y -= 14;
  text("Ante cualquier duda sobre este pago, escribinos a www.portal659.com.ar.", M, y, 8, font, gray);

  return Buffer.from(await doc.save());
}
