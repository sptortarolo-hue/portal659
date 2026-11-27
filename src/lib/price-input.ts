/**
 * Parseo del precio tipeado en los formularios de producto.
 *
 * Cliente y servidor usan EXACTAMENTE la misma regla para que el mensaje
 * "El nombre y el precio son obligatorios" no aparezca cuando el comercio
 * sí cargó un precio (caso típico: precio 0 para completar después, o
 * montos escritos con coma).
 *
 * Regla:
 *   - vacío / null / undefined → null (falta precio)
 *   - negativo o NaN           → null (precio inválido)
 *   - "0"                      → 0 (válido: el alta desde factura ya lo usa)
 *   - "1500,50" / "1500.50"    → 1500.5
 */
export function parsePriceInput(raw: string | number | null | undefined): number | null {
  if (raw == null) return null;
  if (typeof raw === "string" && raw.trim() === "") return null;
  const cleaned = String(raw).trim().replace(/\s/g, "").replace(",", ".");
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}
