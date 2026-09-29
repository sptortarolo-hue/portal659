import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryMany } from "@/lib/db";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const GATE_MSG = "Compras e inventario forman parte del plan Gestión integral";

/**
 * Reposición sugerida: para productos/variantes con control de stock,
 * calcula cobertura en días (stock / venta diaria promedio de los últimos
 * 30 días en pedidos no cancelados) y sugiere cantidad para llegar al
 * umbral + cobertura objetivo. Incluye el proveedor más barato con precio.
 * Query: ?days= (cobertura objetivo, default 14) & ?range= (ventana de
 * ventas en días, default 30).
 */
export async function GET(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (!gate.plan.can("inventory")) {
    return NextResponse.json({ error: GATE_MSG }, { status: 403 });
  }
  const url = new URL(request.url);
  const coverDays = Math.min(90, Math.max(1, Number(url.searchParams.get("days")) || 14));
  const rangeDays = Math.min(180, Math.max(7, Number(url.searchParams.get("range")) || 30));

  const since = new Date(Date.now() - rangeDays * 86400000).toISOString();
  let orders: { items: any[] }[] = [];
  try {
    orders = (await queryMany<{ items: any[] }>(
      `SELECT items FROM orders WHERE vendor_id = $1 AND is_preview = false
       AND status <> 'cancelled' AND created_at >= $2`,
      [gate.vendor.id, since]
    )) || [];
  } catch {
    return NextResponse.json({ suggestions: [] });
  }
  // Ventas por día por producto/variante (canal app+mostrador venden stock).
  const soldPerDay: Record<string, number> = {};
  for (const o of orders) {
    for (const it of o.items || []) {
      if ((it as any)?.manual) continue;
      const key =
        (it as any)?.variant_id != null
          ? `v:${(it as any).variant_id}`
          : (it as any)?.product_id != null
            ? `p:${(it as any).product_id}`
            : null;
      if (!key) continue;
      soldPerDay[key] = (soldPerDay[key] || 0) + (Number((it as any)?.qty) || 0);
    }
  }
  for (const k of Object.keys(soldPerDay)) soldPerDay[k] /= rangeDays;

  const products = await queryMany<Record<string, any>>(
    `SELECT id, name, stock, stock_low_threshold, cost_last, cost_avg
     FROM products WHERE vendor_id = $1 AND stock_control = true`,
    [gate.vendor.id]
  ).catch(() => []);
  const variants = await queryMany<Record<string, any>>(
    `SELECT v.id, v.product_id, v.color, v.talle, v.stock, v.cost_last, p.name AS product_name
     FROM product_variants v JOIN products p ON p.id = v.product_id
     WHERE p.vendor_id = $1`,
    [gate.vendor.id]
  ).catch(() => []);

  // Mejor precio por target (para sugerir proveedor).
  const prices = await queryMany<Record<string, any>>(
    `SELECT pl.product_id, pl.variant_id, pl.price, s.name AS supplier_name
     FROM supplier_pricelists pl JOIN suppliers s ON s.id = pl.supplier_id
     WHERE pl.vendor_id = $1 AND s.active IS DISTINCT FROM false`,
    [gate.vendor.id]
  ).catch(() => []);
  const bestByTarget: Record<string, { price: number; supplier: string }> = {};
  for (const r of prices || []) {
    const key = r.variant_id != null ? `v:${r.variant_id}` : r.product_id != null ? `p:${r.product_id}` : null;
    if (!key) continue;
    const price = Number(r.price);
    if (!isFinite(price)) continue;
    const cur = bestByTarget[key];
    if (!cur || price < cur.price) bestByTarget[key] = { price, supplier: String(r.supplier_name || "") };
  }

  type Suggestion = {
    kind: "product" | "variant";
    id: string;
    product_id: string;
    name: string;
    stock: number;
    threshold: number;
    avgDaily: number;
    coverDays: number | null;
    suggestedQty: number;
    costLast: number | null;
    costAvg: number | null;
    bestPrice: number | null;
    bestSupplier: string | null;
  };
  const suggestions: Suggestion[] = [];
  const push = (
    kind: "product" | "variant",
    id: string,
    productId: string,
    name: string,
    stock: number,
    threshold: number,
    costLast: number | null,
    costAvg: number | null = null
  ) => {
    const avg = soldPerDay[`${kind === "variant" ? "v" : "p"}:${id}`] || 0;
    const cover = avg > 0 ? stock / avg : null;
    // Sugiere solo si está en/bajo umbral o con menos cobertura que el objetivo.
    if (stock > threshold && (cover === null || cover >= coverDays)) return;
    const target = Math.max(threshold + 1, Math.ceil(avg * coverDays));
    const qty = Math.max(0, target - stock);
    if (qty <= 0) return;
    const best = bestByTarget[`${kind === "variant" ? "v" : "p"}:${id}`];
    suggestions.push({
      kind, id, product_id: productId, name, stock,
      threshold, avgDaily: Math.round(avg * 100) / 100,
      coverDays: cover === null ? null : Math.round(cover * 10) / 10,
      suggestedQty: qty, costLast, costAvg,
      bestPrice: best?.price ?? null,
      bestSupplier: best?.supplier ?? null,
    });
  };
  for (const p of products || []) {
    push("product", String(p.id), String(p.id), String(p.name || ""), Number(p.stock) || 0,
      Number(p.stock_low_threshold ?? 5) || 0,
      p.cost_last != null ? Number(p.cost_last) : null,
      p.cost_avg != null ? Number(p.cost_avg) : null);
  }
  for (const v of variants || []) {
    push("variant", String(v.id), String(v.product_id),
      `${v.product_name || ""} (${v.color || ""} · ${v.talle || ""})`,
      Number(v.stock) || 0, 0,
      v.cost_last != null ? Number(v.cost_last) : null);
  }
  suggestions.sort((a, b) => (a.coverDays ?? 9999) - (b.coverDays ?? 9999));
  return NextResponse.json({ suggestions, coverDays, rangeDays });
}
