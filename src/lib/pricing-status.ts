/**
 * Estado del flujo de precios de un producto.
 *
 * El stage NO se guarda: se deriva de los datos reales para que nunca mienta
 * si el usuario edita costo/lista/precio desde otra pantalla.
 */
export type PricingStage = "sin_costo" | "costo" | "con_lista" | "listo";
export type PricingMissing = "costo" | "lista" | "precio";

export type PricingStatus = {
  stage: PricingStage;
  missing: PricingMissing[];
  skipped: Record<string, string>;
  priceSource: "manual" | "lista" | "factura";
  readyFor: string[];
  label: string;
  tone: "neutral" | "warning" | "success";
};

type PricingProduct = {
  cost_last?: number | null;
  price?: number | null;
  margin_list_id?: string | null;
  price_source?: string | null;
  pricing_skipped?: unknown;
  image_url?: string | null;
  category?: string | null;
  stock_control?: boolean | null;
  is_combo?: boolean | null;
  kind?: "product" | "ingredient";
};

function readSkipped(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v != null && String(v).trim()) out[k] = String(v).trim();
  }
  return out;
}

export function getPricingStatus(p: PricingProduct): PricingStatus {
  const skipped = readSkipped(p.pricing_skipped);
  const priceSource =
    p.price_source === "lista" || p.price_source === "factura" ? p.price_source : "manual";

  const hasCost = p.cost_last != null && Number.isFinite(Number(p.cost_last));
  const hasList = !!p.margin_list_id || !!skipped.list;
  const hasPrice = p.price != null && Number(p.price) > 0;

  const missing: PricingMissing[] = [];
  if (!hasCost) missing.push("costo");
  if (!hasCost) {
    return finish("sin_costo", missing, skipped, priceSource, p, "○ Sin costo", "neutral");
  }
  if (!hasList) missing.push("lista");
  if (!hasPrice) missing.push("precio");

  const stage: PricingStage = !hasList ? "costo" : !hasPrice ? "con_lista" : "listo";
  const label =
    stage === "listo"
      ? priceSource === "manual" && !p.margin_list_id
        ? "⚠️ Precio manual"
        : "✓ Listo"
      : stage === "con_lista"
        ? "⚠️ Falta precio"
        : "⚠️ Falta lista";
  const tone = stage === "listo" ? "success" : "warning";
  return finish(stage, missing, skipped, priceSource, p, label, tone);
}

function finish(
  stage: PricingStage,
  missing: PricingMissing[],
  skipped: Record<string, string>,
  priceSource: "manual" | "lista" | "factura",
  p: PricingProduct,
  label: string,
  tone: "neutral" | "warning" | "success"
): PricingStatus {
  const readyFor: string[] = [];
  if (p.kind !== "ingredient" && !p.is_combo) {
    if (p.price != null && Number(p.price) > 0) {
      if (p.image_url) readyFor.push("micrositio");
      if (p.category) readyFor.push("carta");
      if (p.stock_control) readyFor.push("pos");
    }
    if (p.cost_last != null) readyFor.push("analytics");
  } else if (p.cost_last != null) {
    readyFor.push("analytics");
  }
  return { stage, missing, skipped, priceSource, readyFor, label, tone };
}
