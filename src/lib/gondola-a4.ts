import {
  buildLabelSpec,
  DEFAULT_LABEL_PRINTER_CONFIG,
  type LabelContent,
  type LabelPrinterConfig,
} from "./label-spec";
import { renderLabelPng } from "./label-render-server";
import { loadStickerProduct } from "./sticker-server";

/**
 * Hoja A4 con etiquetas de góndola (50 × 35 mm, 4 × 8 por hoja).
 *
 * Aislado a propósito: NO toca el motor `label-spec` ni `/api/print`. Cada
 * etiqueta se dibuja con el MISMO renderer de la etiqueta adhesiva (PNG en
 * blanco y negro) y se arma una hoja con pdf-lib, igual que los otros PDFs
 * del proyecto (quote-pdf, plan-receipt-pdf, cartel).
 *
 * El PNG ocupa los 30 mm superiores de la celda; los 5 mm inferiores se
 * reservan para el precio sin impuestos nacionales / leyenda de IVA. Así no
 * hace falta agrandar ni recortar la etiqueta existente.
 */

const CELL_W_MM = 50;
const CELL_H_MM = 35;
const LABEL_H_MM = 30;
const COLS = 4;
const ROWS = 8;
const PER_PAGE = COLS * ROWS;
const PAGE_W_MM = 210;
const PAGE_H_MM = 297;
const SIDE_MARGIN_MM = 5;
const TOP_MARGIN_MM = 8.5;
const MAX_PRODUCTS = 200;

function mmToPt(mm: number): number {
  return (mm * 72) / 25.4;
}

/** Helvetica (WinAnsi) no acepta tildes: las sacamos solo en esta línea. */
function ascii(s: string): string {
  return String(s)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, "");
}

function money(n: number): string {
  return new Intl.NumberFormat("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(n) || 0);
}

export type GondolaA4Options = {
  vendor: Record<string, any>;
  productIds: string[];
  includeTaxLine?: boolean;
};

export type GondolaA4Result =
  | { ok: true; pdf: Buffer; labels: number; pages: number; skipped: number }
  | { ok: false; status: number; error: string };

export async function buildGondolaA4Pdf({
  vendor,
  productIds,
  includeTaxLine = false,
}: GondolaA4Options): Promise<GondolaA4Result> {
  const ids = Array.from(new Set((productIds || []).filter(Boolean).map(String))).slice(0, MAX_PRODUCTS);
  if (ids.length === 0) {
    return { ok: false, status: 400, error: "Seleccioná al menos un producto" };
  }

  // La misma config del rollo, forzada al tamaño de la celda. Es un objeto
  // nuevo: no se escribe en la DB ni se reutiliza la instancia del comercio.
  const cfg: LabelPrinterConfig = {
    ...DEFAULT_LABEL_PRINTER_CONFIG,
    size: "custom",
    widthMm: CELL_W_MM,
    heightMm: LABEL_H_MM,
    language: "tspl",
    tpl: "gondola",
  };

  const isResponsible =
    String(vendor?.fiscal_cond_iva ?? "") === "responsable_inscripto";

  const images: { png: Buffer; taxLine: string }[] = [];
  let skipped = 0;
  for (const productId of ids) {
    const product = await loadStickerProduct(String(vendor.id), productId);
    if (!product) {
      skipped++;
      continue;
    }
    const unit = String(product.unit ?? "unidad") === "kg" ? "kg" : "unidad";
    const price = Math.round((Number(product.promo_price ?? product.price) || 0) * 100) / 100;
    const oldPrice =
      product.promo_price != null ? Math.round(Number(product.price) * 100) / 100 : null;
    const content: LabelContent = {
      template: "gondola",
      storeName: String(vendor.store_name || "Mi comercio"),
      productName: String(product.name || "Producto"),
      unit,
      price,
      oldPrice,
      kg: null,
      total: price,
      code: String(product.sku ?? "").trim() || null,
    };
    const spec = buildLabelSpec(content, cfg);
    images.push({
      png: await renderLabelPng(spec),
      taxLine: isResponsible
        ? `Precio sin imp. nacionales: $${money(price / 1.21)}`
        : "IVA incluido (no discriminado)",
    });
  }

  if (images.length === 0) {
    return { ok: false, status: 404, error: "No se encontraron los productos" };
  }

  try {
    const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const pageW = mmToPt(PAGE_W_MM);
    const pageH = mmToPt(PAGE_H_MM);
    const cellWPt = mmToPt(CELL_W_MM);
    const cellHPt = mmToPt(CELL_H_MM);
    const labelHPt = mmToPt(LABEL_H_MM);

    for (let start = 0; start < images.length; start += PER_PAGE) {
      const page = pdf.addPage([pageW, pageH]);
      const chunk = images.slice(start, start + PER_PAGE);
      for (let i = 0; i < chunk.length; i++) {
        const col = i % COLS;
        const row = Math.floor(i / COLS);
        const xLeft = SIDE_MARGIN_MM + col * CELL_W_MM;
        const yTop = TOP_MARGIN_MM + row * CELL_H_MM;
        const x = mmToPt(xLeft);
        const labelBottom = pageH - mmToPt(yTop + LABEL_H_MM);
        const cellBottom = pageH - mmToPt(yTop + CELL_H_MM);

        const img = await pdf.embedPng(chunk[i].png);
        page.drawImage(img, {
          x,
          y: labelBottom,
          width: cellWPt,
          height: labelHPt,
        });
        if (includeTaxLine) {
          page.drawText(ascii(chunk[i].taxLine), {
            x: x + mmToPt(1.5),
            y: cellBottom + mmToPt(1.2),
            size: 6.5,
            font,
            color: rgb(0.15, 0.15, 0.15),
          });
        }
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
