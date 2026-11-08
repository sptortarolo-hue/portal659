/**
 * Repuestos de una orden de servicio (taller): tipos + totales client-safe.
 * El server guarda snapshot de costo/precio por fila (work_order_parts), así
 * que los totales se calculan en el cliente sin tocar la base.
 */

export type WorkOrderPart = {
  id: string;
  product_id?: string | null;
  variant_id?: string | null;
  name?: string | null;
  qty: number;
  unit_cost: number;
  unit_price: number;
  created_at?: string;
};

/** Costo total de los repuestos (Σ costo × cantidad). */
export function partsCostTotal(parts: WorkOrderPart[] | null | undefined): number {
  return round2((parts || []).reduce((acc, p) => acc + (Number(p.unit_cost) || 0) * (Number(p.qty) || 0), 0));
}

/** Precio total de los repuestos (Σ precio cobrado × cantidad). */
export function partsPriceTotal(parts: WorkOrderPart[] | null | undefined): number {
  return round2((parts || []).reduce((acc, p) => acc + (Number(p.unit_price) || 0) * (Number(p.qty) || 0), 0));
}

export type OrderCostSummary = {
  /** Costo de los repuestos usados. */
  partsCost: number;
  /** Precio cobrado de los repuestos. */
  partsPrice: number;
  /** Mano de obra cobrada. */
  labor: number;
  /** Costo total (repuestos a costo). */
  cost: number;
  /** Ingreso estimado: presupuesto aprobado, o repuestos cobrados + mano de obra. */
  revenue: number;
  /** Margen = ingreso − costo (solo informativo, no contable). */
  margin: number;
};

/**
 * Resumen de costo/margen de la orden:
 * - ingreso = presupuesto (`service_price`) si hay, si no repuestos + mano de obra;
 * - costo = Σ costo de repuestos (la mano de obra no lleva costo acá);
 * - margen = ingreso − costo.
 */
export function orderCostSummary(opts: {
  parts: WorkOrderPart[] | null | undefined;
  laborAmount?: number | null;
  quotedPrice?: number | null;
}): OrderCostSummary {
  const partsPrice = partsPriceTotal(opts.parts);
  const partsCost = partsCostTotal(opts.parts);
  const labor = Math.max(0, Number(opts.laborAmount) || 0);
  const revenue = (Number(opts.quotedPrice) || 0) > 0 ? Number(opts.quotedPrice) : round2(partsPrice + labor);
  const cost = partsCost;
  return { partsCost, partsPrice, labor, cost, revenue, margin: round2(revenue - cost) };
}

export function money(n: number): string {
  return Number(n || 0).toLocaleString("es-AR");
}

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}
