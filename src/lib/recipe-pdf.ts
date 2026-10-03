/**
 * PDF A4 de ficha de receta (escandallo) para gastronomía.
 * Logo + datos del comercio, tabla de ingredientes (neta/bruta/costo),
 * preparación, y resumen de costos vs venta (food cost).
 * pdf-lib puro (sin binarios): seguro en docker slim.
 * Patrón espejo de src/lib/quote-pdf.ts.
 */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { existsSync, readFileSync } from "fs";
import path from "path";
import type { RecipeCost } from "@/lib/costing";

export type RecipePdfData = {
  vendor: { store_name: string; address?: string | null; phone?: string | null; whatsapp?: string | null; logo_url?: string | null };
  productName: string;
  price: number;
  portions: number;
  instructions: string | null;
  cost: RecipeCost;
  /** Presentaciones vinculadas (porción/entera) con su precio. */
  linked?: { name: string; servings: number; price: number }[];
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

/** Wrap simple por palabras (Helvetica no hace wrap automático). */
function wrap(text: string, font: any, size: number, maxW: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const probe = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(probe, size) > maxW && line) {
      lines.push(line);
      line = w;
    } else {
      line = probe;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export async function buildRecipePdf(data: RecipePdfData): Promise<Buffer> {
  const { vendor, productName, price, portions, instructions, cost, linked } = data;
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]); // A4
  const { width } = page.getSize();
  const M = 48;
  const black = rgb(0, 0, 0);
  const gray = rgb(0.4, 0.4, 0.4);
  const green = rgb(0.13, 0.55, 0.24);
  const red = rgb(0.75, 0.15, 0.15);
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

  // ---- Header: logo + comercio + título ----
  const logoPath = logoDiskPath(vendor.logo_url);
  if (logoPath) {
    try {
      const bytes = readFileSync(logoPath);
      const img = logoPath.toLowerCase().endsWith(".png")
        ? await doc.embedPng(bytes)
        : await doc.embedJpg(bytes);
      const h = 64;
      const w = (img.width / img.height) * h;
      page.drawImage(img, { x: M, y: y - h, width: Math.min(w, 140), height: h });
    } catch {
      /* sin logo: solo texto */
    }
  }
  text(vendor.store_name || "", M + 160, y - 6, 15, bold, black, 250);
  text("FICHA DE RECETA", width - M - 230, y - 6, 15, bold);
  text(`Fecha: ${fdate(new Date().toISOString())}`, width - M - 230, y - 26, 9, font, gray);
  if (vendor.address) text(vendor.address, M + 160, y - 26, 9, font, gray, 250);
  const contact = [vendor.phone, vendor.whatsapp].filter(Boolean).join(" · ");
  if (contact) text(contact, M + 160, y - 40, 9, font, gray, 250);
  y -= 100;

  // ---- Plato ----
  text("Plato", M, y, 10, bold, gray);
  y -= 16;
  text(productName, M, y, 14, bold);
  y -= 15;
  text(`Precio de venta: ${money(price)}  ·  Rinde: ${portions} porción${portions === 1 ? "" : "es"}`, M, y, 10, font, gray);
  y -= 8;
  page.drawLine({ start: { x: M, y }, end: { x: width - M, y }, thickness: 1, color: gray });
  y -= 20;

  // ---- Tabla de ingredientes ----
  text("Ingredientes", M, y, 11, bold);
  y -= 14;
  const cols = [M, M + 200, M + 260, M + 330];
  text("Ingrediente", cols[0], y, 9, bold, gray);
  text("Cant. neta", cols[1], y, 9, bold, gray);
  text("Cant. bruta", cols[2], y, 9, bold, gray);
  text("Costo", width - M - 70, y, 9, bold, gray);
  y -= 14;
  for (const ln of cost.lines) {
    if (y < 200) break; // v1: una página
    const indent = ln.is_elaborated ? 12 : 0;
    text(ln.name + (ln.is_elaborated ? " 🧪" : ""), cols[0] + indent, y, 10, font, black, 190);
    text(`${Number(ln.qty_net).toLocaleString("es-AR")} ${ln.unit}`, cols[1], y, 10);
    text(`${Number(ln.qty_gross_base).toLocaleString("es-AR")} ${ln.base_unit}`, cols[2], y, 10);
    const c = money(ln.line_cost);
    text(c, width - M - font.widthOfTextAtSize(c, 10), y, 10);
    y -= 15;
  }
  y -= 6;
  page.drawLine({ start: { x: M, y }, end: { x: width - M, y }, thickness: 1, color: gray });
  y -= 20;

  // ---- Preparación ----
  if (instructions) {
    text("Preparación", M, y, 11, bold);
    y -= 15;
    for (const line of wrap(instructions, font, 10, width - M * 2)) {
      if (y < 200) break;
      text(line, M, y, 10);
      y -= 14;
    }
    y -= 8;
  }

  // ---- Resumen de costos ----
  text("Costos", M, y, 11, bold);
  y -= 16;
  const perPortion = cost.perPortion;
  const pct = price > 0 ? (perPortion / price) * 100 : null;
  const pctColor = pct === null ? gray : pct < 30 ? green : pct <= 35 ? rgb(0.75, 0.55, 0.1) : red;
  const rows: [string, string, any][] = [
    ["Costo total de la receta", money(cost.total), black],
    ["Costo por porción", money(perPortion), black],
    ["Precio de venta", money(price), black],
    ["Food cost", pct !== null ? `${pct.toLocaleString("es-AR", { maximumFractionDigits: 1 })}%` : "—", pctColor],
    ["Margen", pct !== null ? `${(100 - pct).toLocaleString("es-AR", { maximumFractionDigits: 1 })}% ($${(price - perPortion).toLocaleString("es-AR")})` : "—", black],
  ];
  for (const [label, value, color] of rows) {
    if (y < 200) break;
    text(label, M, y, 10, font, gray);
    text(value, width - M - font.widthOfTextAtSize(value, 10), y, 10, bold, color);
    y -= 15;
  }

  // ---- Presentaciones vinculadas ----
  if (linked && linked.length > 0) {
    y -= 6;
    text("Otras presentaciones", M, y, 11, bold);
    y -= 15;
    for (const l of linked) {
      if (y < 200) break;
      const lCost = (cost.total / portions) * l.servings;
      const lPct = l.price > 0 ? (lCost / l.price) * 100 : null;
      text(`${l.name} (${l.servings} porc.)`, M, y, 10);
      text(`${money(lCost)} · ${lPct !== null ? lPct.toLocaleString("es-AR", { maximumFractionDigits: 1 }) + "%" : "—"}`, width - M - 130, y, 10, font, gray);
      y -= 15;
    }
  }

  if (cost.warnings.length > 0) {
    y -= 6;
    text("Avisos", M, y, 10, bold, red);
    y -= 14;
    for (const w of cost.warnings.slice(0, 3)) {
      if (y < 200) break;
      text("⚠️ " + w, M, y, 9, font, gray, width - M * 2);
      y -= 13;
    }
  }

  text("Emitido con Portal 659 · www.portal659.com.ar", M, 40, 8, font, gray);

  return Buffer.from(await doc.save());
}
