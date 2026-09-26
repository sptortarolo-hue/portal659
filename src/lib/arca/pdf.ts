/**
 * PDF A4 del comprobante fiscal (Factura C / Nota de Crédito C).
 * Sectores estilo AFIP: encabezado con logo + datos emisor, receptor,
 * tabla de ítems (del pedido), TOTAL, CAE + QR de verificación.
 * pdf-lib puro (sin binarios): seguro en docker slim.
 */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { existsSync, readFileSync } from "fs";
import path from "path";
import { orderLineTotal } from "@/lib/order-line";
import type { Order, OrderItem, Vendor } from "@/types/database";
import type { FiscalInvoice } from "@/lib/arca/emit";

export type InvoicePdfData = {
  vendor: Pick<
    Vendor,
    "store_name" | "cuit" | "fiscal_cond_iva" | "address" | "phone" | "logo_url"
  >;
  invoice: Pick<
    FiscalInvoice,
    "cbte_tipo" | "punto_venta" | "cbte_nro" | "cae" | "cae_vto" | "total" | "created_at"
  > & { asoc_pto?: number | null; asoc_nro?: number | null };
  order: Pick<Order, "items" | "customer_name" | "payment_method" | "created_at"> | null;
  qrUrl: string;
};

const money = (n: number) =>
  `$${Number(n || 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fdate = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
};

const caeVto = (vto: string): string => {
  const c = (vto || "").replace(/\D/g, "");
  return c.length === 8 ? fdate(`${c.slice(0, 4)}-${c.slice(4, 6)}-${c.slice(6, 8)}`) : vto;
};

function condLabel(cond: string | null | undefined): string {
  const c = (cond || "").trim().toLowerCase();
  if (c === "monotributo") return "Monotributo";
  if (c === "responsable_inscripto") return "IVA Responsable Inscripto";
  return (cond || "").trim();
}

/** Resuelve el logo (/uploads/...) al archivo en disco. */
function logoDiskPath(logoUrl: string | null | undefined): string | null {
  if (!logoUrl) return null;
  const m = logoUrl.match(/\/uploads\/([^?#]+)/);
  if (!m) return null;
  const root = process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads");
  const p = path.join(root, m[1]);
  return existsSync(p) ? p : null;
}

export async function buildInvoicePdf(data: InvoicePdfData): Promise<Buffer> {
  const { vendor, invoice, order, qrUrl } = data;
  const isNc = Number(invoice.cbte_tipo) === 13;
  const docTitle = isNc ? "NOTA DE CRÉDITO C" : "FACTURA C";
  const nro = `${String(invoice.punto_venta).padStart(4, "0")}-${String(invoice.cbte_nro).padStart(8, "0")}`;

  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]); // A4
  const { width } = page.getSize();
  const M = 48; // margen
  const black = rgb(0, 0, 0);
  const gray = rgb(0.4, 0.4, 0.4);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let y = 841.89 - 48;

  const text = (
    str: string,
    x: number,
    yy: number,
    size = 10,
    f = font,
    color = black,
    maxW?: number
  ) => {
    let s = str;
    if (maxW) {
      while (s.length > 1 && f.widthOfTextAtSize(s + "…", size) > maxW) s = s.slice(0, -1);
      if (s !== str) s += "…";
    }
    page.drawText(s, { x, y: yy, size, font: f, color });
  };

  // Logo (izq) + bloque documento (der).
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
  const rightX = width - M - 230;
  text(vendor.store_name || "", M + 170, y - 6, 15, bold, black, 250);
  text(docTitle, rightX, y - 6, 15, bold);
  text("ORIGINAL", rightX, y - 24, 9, bold);
  text(`Nº ${nro}`, rightX, y - 42, 12, bold);
  text(`Fecha: ${fdate(invoice.created_at)}`, rightX, y - 58, 9, font, gray);
  text(`CUIT: ${vendor.cuit || "-"}`, rightX, y - 72, 9, font, gray);
  const cond = condLabel(vendor.fiscal_cond_iva);
  if (cond) text(cond, rightX, y - 86, 9, font, gray);
  if (vendor.address) text(vendor.address, M + 170, y - 26, 9, font, gray, 250);
  if (vendor.phone) text(`Tel: ${vendor.phone}`, M + 170, y - 40, 9, font, gray, 250);
  y -= 110;

  // Receptor + asociado (NC).
  text("A consumidor final", M, y, 10, bold);
  y -= 16;
  if (isNc && invoice.asoc_nro != null) {
    const asoc = `${String(invoice.asoc_pto ?? invoice.punto_venta).padStart(4, "0")}-${String(invoice.asoc_nro).padStart(8, "0")}`;
    text(`Anula a Factura C ${asoc}`, M, y, 10, font);
    y -= 16;
  }
  y -= 8;
  page.drawLine({ start: { x: M, y }, end: { x: width - M, y }, thickness: 1, color: gray });
  y -= 18;

  // Tabla de ítems.
  const cols = [M, M + 40, M + 330, M + 430];
  text("Cant", cols[0], y, 9, bold, gray);
  text("Descripción", cols[1], y, 9, bold, gray);
  text("P. Unit", cols[2], y, 9, bold, gray);
  text("Importe", width - M - 70, y, 9, bold, gray);
  y -= 14;
  const items: OrderItem[] = order?.items || [];
  for (const it of items) {
    if (y < 200) break; // v1: una página (tickets chicos entran)
    const lineTotal = orderLineTotal({ price: it.price, qty: it.qty, pack_size: it.pack_size });
    const unit = Number(it.qty) ? lineTotal / Number(it.qty) : Number(it.price);
    text(String(it.qty), cols[0], y, 10);
    let desc = it.name;
    if (it.modifiers?.length) desc += ` (${it.modifiers.join(", ")})`;
    text(desc, cols[1], y, 10, font, black, 220);
    text(money(unit), cols[2], y, 10);
    const imp = money(lineTotal);
    text(imp, width - M - font.widthOfTextAtSize(imp, 10), y, 10);
    y -= 15;
  }
  y -= 6;
  page.drawLine({ start: { x: M, y }, end: { x: width - M, y }, thickness: 1, color: gray });
  y -= 22;
  const totalStr = money(invoice.total);
  text("TOTAL", width - M - 170, y, 11, bold, gray);
  text(totalStr, width - M - bold.widthOfTextAtSize(totalStr, 14), y - 2, 14, bold);

  // CAE + QR.
  y -= 48;
  text(`CAE: ${invoice.cae}`, M, y, 10, bold);
  text(`Vto. CAE: ${caeVto(invoice.cae_vto)}`, M, y - 16, 10);
  text("Comprobante electrónico autorizado por ARCA.", M, y - 32, 8, font, gray);
  text("Verificá en arca.gob.ar/fe/qr", M, y - 44, 8, font, gray);
  try {
    const QRCode = (await import("qrcode")).default;
    const qrBuf: Buffer = await QRCode.toBuffer(qrUrl, { width: 220, margin: 1 });
    const qr = await doc.embedPng(qrBuf);
    page.drawImage(qr, { x: width - M - 110, y: y - 70, width: 110, height: 110 });
  } catch {
    /* sin QR: el CAE + link alcanzan */
  }

  // Pie.
  text("Emitido con Portal 659 · www.portal659.com.ar", M, 40, 8, font, gray);

  return Buffer.from(await doc.save());
}
