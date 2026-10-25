/**
 * Etiquetas de precio para servicios (estética). Client-safe.
 *
 * - `price` seteado            → precio fijo: "$X"
 * - `price_from` (+ `price_to`)→ "Desde $X" / "Desde $X – $Y"
 * - ninguno                    → null (el caller muestra "Consultar")
 *
 * Fijo y "desde" son mutuamente excluyentes (lo garantizan las APIs de
 * servicios); si vinieran ambos igual gana el fijo.
 */
export type ServicePriced = {
  price?: number | null;
  price_from?: number | null;
  price_to?: number | null;
};

const fmt = (n: number): string => Number(n).toLocaleString("es-AR");

/** Etiqueta para mostrar junto al servicio. null = sin precio ("Consultar"). */
export function servicePriceLabel(s: ServicePriced): string | null {
  if (s.price != null && Number(s.price) >= 0) return `$${fmt(Number(s.price))}`;
  const from = s.price_from != null ? Number(s.price_from) : null;
  if (from == null || !Number.isFinite(from)) return null;
  const to = s.price_to != null ? Number(s.price_to) : null;
  if (to != null && Number.isFinite(to) && to > from) return `Desde $${fmt(from)} – $${fmt(to)}`;
  return `Desde $${fmt(from)}`;
}

/** Precio mínimo de referencia (para snapshot de turno): fijo o "desde". */
export function servicePriceMin(s: ServicePriced): number | null {
  if (s.price != null && Number(s.price) >= 0) return Number(s.price);
  if (s.price_from != null && Number(s.price_from) >= 0) return Number(s.price_from);
  return null;
}

/** ¿El servicio se cobra con precio final definido al atender? */
export function isFromPricing(s: ServicePriced): boolean {
  const hasFixed = s.price != null && Number(s.price) >= 0;
  const hasFrom = s.price_from != null && Number(s.price_from) >= 0;
  return !hasFixed && hasFrom;
}
