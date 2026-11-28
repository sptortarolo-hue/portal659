import { queryOne } from "@/lib/db";
import {
  arISODate,
  addDaysISO,
  measureTextPx,
  readLabelPrinterConfig,
  LABEL_PX_PER_MM,
  type LabelPrinterConfig,
} from "./label-spec";
import { loadPureImage, loadSharp, encodePng, FONT_NAME, makeCircularLogo } from "./printer-image";
import { code128BarWidths } from "./code128";
import { normalizePlu } from "./scale-barcode";

/**
 * Hoja A4 APAISADA con etiquetas de góndola "completas" (70 × 35 mm,
 * 4 columnas × 5 filas = 20 por hoja).
 *
 * Diseño (modelo del comercio): faja superior con logo redondo + nombre del
 * producto en negrita; separador; faja inferior dividida, con código de barras
 * real + SKU + precio por kg a la izquierda y precio grande a la derecha.
 * Sin fondo amarillo. Marcas de corte en L dentro del borde en blanco.
 *
 * Módulo NUEVO y aislado: NO modifica `label-spec`, `sticker-server`,
 * `/api/print` ni `thermal-printer`. Construye su propia imagen y la embute
 * en un PDF con pdf-lib, igual patrón que otros PDFs del proyecto.
 */

const PAGE_W_MM = 297;
const PAGE_H_MM = 210;
const CELL_W_MM = 70;
const CELL_H_MM = 35;
const COLS = 4;
const ROWS = 5;
const PER_PAGE = COLS * ROWS;
const SIDE_MARGIN_MM = (PAGE_W_MM - COLS * CELL_W_MM) / 2; // 8.5
const ROW_GAP_MM = 1;
const TOP_MARGIN_MM = (PAGE_H_MM - (ROWS * CELL_H_MM + (ROWS - 1) * ROW_GAP_MM)) / 2; // 15.5
const MAX_PRODUCTS = 200;

const W = Math.round(CELL_W_MM * LABEL_PX_PER_MM); // 560
const H = Math.round(CELL_H_MM * LABEL_PX_PER_MM); // 280

function mmToPt(mm: number): number {
  return (mm * 72) / 25.4;
}

function money(n: number, decimals = 2): string {
  return (Number(n) || 0).toLocaleString("es-AR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtDate(iso: string | null): string | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y.slice(2)}`;
}

type ProductRow = {
  id: string;
  name: string;
  price: number | string | null;
  promo_price: number | string | null;
  unit: string | null;
  sku?: string | null;
  scale_plu?: string | null;
  expires_at?: string | null;
};

async function loadProduct(vendorId: string, productId: string): Promise<ProductRow | null> {
  const full =
    `SELECT id, name, price, promo_price, unit, sku, scale_plu, expires_at::text AS expires_at ` +
    `FROM products WHERE vendor_id = $1 AND id = $2 LIMIT 1`;
  try {
    return (await queryOne<ProductRow>(full, [vendorId, productId])) ?? null;
  } catch {
    try {
      const withSku =
        `SELECT id, name, price, promo_price, unit, sku FROM products WHERE vendor_id = $1 AND id = $2 LIMIT 1`;
      return (await queryOne<ProductRow>(withSku, [vendorId, productId])) ?? null;
    } catch {
      return (
        (await queryOne<ProductRow>(
          `SELECT id, name, price, promo_price, unit FROM products WHERE vendor_id = $1 AND id = $2 LIMIT 1`,
          [vendorId, productId]
        )) ?? null
      );
    }
  }
}

function fitText(ctx: any, text: string, maxWidth: number, maxLines: number): string[] {
  const clean = String(text || "Producto").trim();
  const words = clean.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (measureTextPx(next, 36) <= maxWidth || !line) {
      line = next;
      continue;
    }
    lines.push(line);
    line = word;
    if (lines.length === maxLines - 1) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  // Cortar palabras largas para no salirse del bloque.
  return lines.slice(0, maxLines).map((ln) => {
    if (measureTextPx(ln, 36) <= maxWidth) return ln;
    let out = ln;
    while (out.length > 1 && measureTextPx(`${out}…`, 36) > maxWidth) out = out.slice(0, -1);
    return `${out}…`;
  });
}

async function renderOne(vendor: Record<string, any>, product: ProductRow, cfg: LabelPrinterConfig): Promise<Buffer> {
  const PI = await loadPureImage();
  const sharp = await loadSharp();
  const canvas = PI.make(W, H);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";

  // Marcas de corte en L, dentro del borde en blanco (2 mm del borde).
  ctx.fillStyle = "#b8b8b8";
  const inset = 16;
  const len = 24;
  const th = 2;
  for (const [x, y, sx, sy] of [
    [inset, inset, 1, 1],
    [W - inset, inset, -1, 1],
    [inset, H - inset, 1, -1],
    [W - inset, H - inset, -1, -1],
  ]) {
    ctx.fillRect(sx > 0 ? x : x - len, y, len, th);
    ctx.fillRect(x, sy > 0 ? y : y - len, th, len);
  }

  const isKg = String(product.unit ?? "unidad") === "kg";
  const price = Math.round((Number(product.promo_price ?? product.price) || 0) * 100) / 100;
  const oldPrice =
    product.promo_price != null ? Math.round(Number(product.price) * 100) / 100 : null;
  const hasPromo = oldPrice != null && oldPrice > price + 0.004;
  const saving = hasPromo ? Math.round((oldPrice - price) * 100) / 100 : 0;
  const sku = String(product.sku ?? "").trim();
  const plu = normalizePlu(product.scale_plu);
  const code = sku || plu || `P-${String(product.id).replace(/-/g, "").slice(0, 10).toUpperCase()}`;

  let expires: string | null = null;
  const productExpiry = String(product.expires_at ?? "").match(/^\d{4}-\d{2}-\d{2}$/);
  if (productExpiry) expires = productExpiry[0];
  else if (cfg.shelfLifeDays && cfg.shelfLifeDays > 0) expires = addDaysISO(arISODate(), cfg.shelfLifeDays);

  // Faja superior: logo + nombre (2 líneas) + fechas.
  const nameLines = fitText(ctx, product.name, W - 140, 2);
  ctx.fillStyle = "black";
  ctx.font = `36px ${FONT_NAME}`;
  nameLines.forEach((ln, i) => ctx.fillText(ln, 116, 48 + i * 38));
  // ASCII a propósito: pureimage no dibuja bien tildes ni el punto medio.
  ctx.font = `14px ${FONT_NAME}`;
  ctx.fillText(String(vendor.store_name || "Mi comercio").toUpperCase().slice(0, 26), 116, 102);
  if (expires) {
    const envasado = cfg.shelfLifeDays && cfg.shelfLifeDays > 0
      ? addDaysISO(expires, -cfg.shelfLifeDays)
      : null;
    ctx.font = `12px ${FONT_NAME}`;
    const dateText = envasado
      ? `ENV: ${fmtDate(envasado)} - V: ${fmtDate(expires)}`
      : `V: ${fmtDate(expires)}`;
    ctx.fillText(dateText.slice(0, 36), 116, 116);
  }

  // Separador horizontal.
  ctx.fillRect(28, 124, W - 56, 2);

  // Faja inferior izquierda: barras + dígitos + SKU + precio por kg.
  const widths = code128BarWidths(code);
  if (widths) {
    const total = widths.reduce((a, b) => a + b, 0);
    const maxW = 254;
    const module = Math.max(1, maxW / total);
    let x = 36;
    const yBar = 136;
    const hBar = 52;
    ctx.fillStyle = "black";
    for (let i = 0; i < widths.length; i++) {
      const w = widths[i] * module;
      if (i % 2 === 0) ctx.fillRect(Math.round(x), yBar, Math.max(1, Math.round(w)), hBar);
      x += w;
    }
  }
  ctx.fillStyle = "black";
  ctx.font = `20px ${FONT_NAME}`;
  ctx.fillText(code, 36, 208);
  ctx.font = `17px ${FONT_NAME}`;
  ctx.fillText(`SKU: ${sku || "-"}`.slice(0, 34), 36, 230);
  if (isKg) {
    ctx.font = `15px ${FONT_NAME}`;
    ctx.fillText(`PRECIO X KG: $${money(price)}`.slice(0, 36), 36, 250);
  }

  // Separador vertical y bloque del precio (sin fondo amarillo).
  ctx.fillRect(304, 132, 2, H - 148);
  ctx.fillStyle = "black";
  const priceText = `$${money(price)}`;
  let priceSize = hasPromo ? 58 : 62;
  while (priceSize > 26 && measureTextPx(priceText, priceSize) > 215) priceSize -= 2;
  if (hasPromo) {
    ctx.font = `16px ${FONT_NAME}`;
    ctx.fillText(`ANTES $${money(oldPrice!)}`, 320, 152);
    ctx.font = `${priceSize}px ${FONT_NAME}`;
    ctx.fillText(priceText, 320, 208);
    ctx.font = `18px ${FONT_NAME}`;
    // ASCII: el glyph de "Á" sale mal en pureimage con esta fuente.
    ctx.fillText(`AHORRAS $${money(saving)}`, 320, 236);
  } else {
    ctx.font = `${priceSize}px ${FONT_NAME}`;
    ctx.fillText(priceText, 320, 200);
    if (isKg) {
      ctx.font = `18px ${FONT_NAME}`;
      ctx.fillText("/kg", 320, 228);
    }
  }

  const base = await encodePng(PI, canvas);
  const logoUrl = String(vendor.logo_url || "");
  let out = sharp(base);
  if (logoUrl) {
    try {
      const circle = await makeCircularLogo(logoUrl);
      if (circle) {
        const sized = await sharp(circle).resize(76, 76).png().toBuffer();
        out = out.composite([{ input: sized, left: 28, top: 28 }]);
      }
    } catch {
      /* sin logo: la etiqueta sale igual */
    }
  }
  return await out.png().toBuffer();
}

export type GondolaA4FullOptions = {
  vendor: Record<string, any>;
  productIds: string[];
};

export type GondolaA4FullResult =
  | { ok: true; pdf: Buffer; labels: number; pages: number; skipped: number }
  | { ok: false; status: number; error: string };

export async function buildGondolaA4FullPdf({
  vendor,
  productIds,
}: GondolaA4FullOptions): Promise<GondolaA4FullResult> {
  const ids = Array.from(new Set((productIds || []).filter(Boolean).map(String))).slice(0, MAX_PRODUCTS);
  if (ids.length === 0) return { ok: false, status: 400, error: "Seleccioná al menos un producto" };

  const cfg = readLabelPrinterConfig(vendor?.label_printer_config);
  const images: Buffer[] = [];
  let skipped = 0;
  for (const id of ids) {
    const product = await loadProduct(String(vendor.id), id);
    if (!product) {
      skipped++;
      continue;
    }
    images.push(await renderOne(vendor, product, cfg));
  }
  if (images.length === 0) return { ok: false, status: 404, error: "No se encontraron los productos" };

  try {
    const { PDFDocument } = await import("pdf-lib");
    const pdf = await PDFDocument.create();
    const pageW = mmToPt(PAGE_W_MM);
    const pageH = mmToPt(PAGE_H_MM);

    for (let start = 0; start < images.length; start += PER_PAGE) {
      const page = pdf.addPage([pageW, pageH]);
      const chunk = images.slice(start, start + PER_PAGE);
      for (let i = 0; i < chunk.length; i++) {
        const col = i % COLS;
        const row = Math.floor(i / COLS);
        const x = SIDE_MARGIN_MM + col * CELL_W_MM;
        const yTop = TOP_MARGIN_MM + row * (CELL_H_MM + ROW_GAP_MM);
        const img = await pdf.embedPng(chunk[i]);
        page.drawImage(img, {
          x: mmToPt(x),
          y: pageH - mmToPt(yTop + CELL_H_MM),
          width: mmToPt(CELL_W_MM),
          height: mmToPt(CELL_H_MM),
        });
      }
    }

    return {
      ok: true,
      pdf: Buffer.from(await pdf.save()),
      labels: images.length,
      pages: Math.ceil(images.length / PER_PAGE),
      skipped,
    };
  } catch {
    return { ok: false, status: 500, error: "No se pudo generar el PDF A4" };
  }
}
