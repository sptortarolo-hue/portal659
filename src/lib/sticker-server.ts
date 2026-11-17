import { queryOne } from "@/lib/db";
import {
  arISODate,
  addDaysISO,
  buildLabelSpec,
  readLabelPrinterConfig,
  type LabelContent,
  type LabelSpec,
  type LabelTemplateId,
} from "./label-spec";
import { renderLabelPng } from "./label-render-server";
import { readScaleLabelConfig, normalizePlu } from "./scale-barcode";

/**
 * Lógica compartida de la etiqueta adhesiva: la usa la impresión
 * (`/api/print` con type "sticker") y la vista previa (`/api/vendor/label/preview`).
 *
 * El servidor RECALCULA precio, total e importe codificado desde la DB: el
 * cliente nunca manda el importe final (manda solo los kilos pesados) —
 * exactamente el contrato de la balanza Etiquetadora.
 */

export type StickerRequest = {
  productId: string | null;
  kg: number | null;
  copies: number;
  template?: LabelTemplateId | null;
  packedAt?: string | null;
  /** null = usar la cascada (expires_at del producto → conserva). */
  shelfLifeDays?: number | null;
};

export type StickerResult =
  | {
      ok: true;
      cfg: ReturnType<typeof readLabelPrinterConfig>;
      product: { id: string; name: string; unit: "unidad" | "kg"; price: number; oldPrice: number | null; sku: string | null; plu: string | null };
      content: LabelContent;
      spec: LabelSpec;
      png: Buffer;
      packedAt: string;
      expiresAt: string | null;
    }
  | { ok: false; status: number; error: string };

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

export async function loadStickerProduct(vendorId: string, productId: string): Promise<ProductRow | null> {
  const base =
    `SELECT id, name, price, promo_price, unit FROM products WHERE vendor_id = $1 AND id = $2 LIMIT 1`;
  // expires_at::text: node-pg parsea `date` como Date y String(Date) no entra
  // en el regex \d{4}-\d{2}-\d{2} → se perdería el vencimiento de la ficha.
  const full =
    `SELECT id, name, price, promo_price, unit, sku, scale_plu, expires_at::text AS expires_at FROM products WHERE vendor_id = $1 AND id = $2 LIMIT 1`;
  try {
    return (await queryOne<ProductRow>(full, [vendorId, productId])) ?? null;
  } catch {
    try {
      const withSku = `SELECT id, name, price, promo_price, unit, sku FROM products WHERE vendor_id = $1 AND id = $2 LIMIT 1`;
      return (await queryOne<ProductRow>(withSku, [vendorId, productId])) ?? null;
    } catch {
      return (await queryOne<ProductRow>(base, [vendorId, productId])) ?? null;
    }
  }
}

/**
 * Resuelve y valida la etiqueta a imprimir. Devuelve el PNG ya renderizado:
 * ninguno de los dos llamadores puede dibujar nada distinto.
 */
export async function buildStickerForProduct(
  vendor: Record<string, any>,
  req: StickerRequest
): Promise<StickerResult> {
  const cfg = readLabelPrinterConfig(vendor?.label_printer_config);
  if (!req.productId) {
    return { ok: false, status: 400, error: "productId requerido" };
  }
  const product = await loadStickerProduct(String(vendor.id), String(req.productId));
  if (!product) {
    return { ok: false, status: 404, error: "Producto no encontrado" };
  }

  const isKg = String(product.unit ?? "unidad") === "kg";
  const price = Math.round((Number(product.promo_price ?? product.price) || 0) * 100) / 100;
  const oldPrice = product.promo_price != null ? Math.round(Number(product.price) * 100) / 100 : null;

  let kg: number | null = null;
  if (isKg) {
    kg = Math.round(Number(req.kg) * 1000) / 1000;
    if (!(kg > 0) || kg > 999) {
      return { ok: false, status: 400, error: "Ingresá el peso (entre 0,001 y 999 kg)" };
    }
  }
  const total = isKg ? Math.round((kg || 0) * price * 100) / 100 : price;

  const template: LabelTemplateId = req.template === "gondola" || req.template === "envasado" ? req.template : cfg.tpl;
  const packedAt = String(req.packedAt ?? "").match(/^\d{4}-\d{2}-\d{2}$/)
    ? String(req.packedAt)
    : arISODate();

  // Vencimiento en cascada: producto → envasado + N días → nada
  let expiresAt: string | null = null;
  const productExpiry = String(product.expires_at ?? "").match(/^\d{4}-\d{2}-\d{2}$/);
  if (template === "envasado" && productExpiry) {
    expiresAt = productExpiry[0];
  } else if (template === "envasado") {
    const days = req.shelfLifeDays != null ? req.shelfLifeDays : cfg.shelfLifeDays;
    if (days && days > 0) expiresAt = addDaysISO(packedAt, days);
  }

  const sku = String(product.sku ?? "").trim();
  const plu = normalizePlu(product.scale_plu) || null;
  const code = sku || (plu ? plu : `P-${String(product.id).replace(/-/g, "").slice(0, 10).toUpperCase()}`);

  const content: LabelContent = {
    template,
    storeName: String(vendor.store_name || "Mi comercio"),
    productName: String(product.name || "Producto"),
    plu: isKg ? plu : null,
    unit: isKg ? "kg" : "unidad",
    price,
    oldPrice,
    kg: isKg ? kg : null,
    total,
    packedAt: template === "envasado" ? packedAt : null,
    expiresAt,
    code,
  };

  const scaleCfg =
    isKg && plu ? readScaleLabelConfig(vendor?.scale_label_config) : null;
  const spec = buildLabelSpec(content, cfg, {
    scaleFormat: scaleCfg && scaleCfg.enabled ? scaleCfg : null,
  });
  const png = await renderLabelPng(spec);

  return {
    ok: true,
    cfg,
    product: { id: product.id, name: String(product.name), unit: isKg ? "kg" : "unidad", price, oldPrice, sku: sku || null, plu },
    content,
    spec,
    png,
    packedAt,
    expiresAt,
  };
}

export type CalibrateResult =
  | { ok: true; language: "tspl" | "zpl" | "escpos"; spec: LabelSpec; png: Buffer }
  | { ok: false; status: number; error: string };

/**
 * Etiqueta de calibración: contenido fijo (producto + precio + código) para
 * probar el lenguaje, el GAP y el tamaño del rollo. El envasado por defecto
 * usar el idioma de prueba elegido.
 */
export async function calibrateSticker(
  vendor: Record<string, any>,
  language: "tspl" | "zpl" | "escpos"
): Promise<CalibrateResult> {
  if (language !== "tspl" && language !== "zpl" && language !== "escpos") {
    return { ok: false, status: 400, error: "Lenguaje inválido" };
  }
  const cfg = readLabelPrinterConfig(vendor?.label_printer_config);
  const packedAt = arISODate();
  const content: LabelContent = {
    template: cfg.tpl,
    storeName: String(vendor.store_name || "Mi comercio"),
    productName: "ETIQUETA DE PRUEBA — calibración",
    plu: cfg.tpl === "envasado" ? "128" : null,
    unit: cfg.tpl === "envasado" ? "kg" : "unidad",
    price: 12345.67,
    oldPrice: null,
    kg: cfg.tpl === "envasado" ? 1.234 : null,
    total: cfg.tpl === "envasado" ? 15230.56 : 12345.67,
    packedAt: cfg.tpl === "envasado" ? packedAt : null,
    expiresAt: cfg.tpl === "envasado" ? addDaysISO(packedAt, 30) : null,
    code: "7791234567890",
  };
  const spec = buildLabelSpec(content, cfg, { scaleFormat: null });
  const png = await renderLabelPng(spec);
  return { ok: true, language, spec, png };
}


