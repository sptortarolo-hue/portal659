import { NextResponse } from "next/server";
import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryMany, queryOne, withTransaction } from "@/lib/db";
import { priceFromCost, clampPrice, type MarginRule } from "@/lib/cost-reprice";
import { resolveRounding, type Rounding } from "@/lib/price-rounding";
import { effectiveCostOf } from "@/lib/product-packaging";

export const dynamic = "force-dynamic";
const GATE_MSG = "La administración de precios forma parte del plan Gestión integral";

type ProductRow = {
  id: string;
  name: string;
  price: number | null;
  promo_price: number | null;
  cost_last: number | null;
  packaging_cost?: number | null;
  margin_list_id: string | null;
  sku: string | null;
  is_combo: boolean;
  price_source?: string | null;
};
type ListRow = { id: string; name: string; rule: string; pct: number; step: number | null; mode: string | null; tail: number | null };

/**
 * Vista previa / aplicación del paso 5 del asistente de precios.
 * Body: { productIds, listId?, overrides?: {productId: listId|null}, includePromos?, apply? }
 * Cada producto usa su override, o listId global, o su lista actual.
 */
export async function POST(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (!(gate.plan.can("inventory") || gate.plan.can("recipes"))) {
    return NextResponse.json({ error: GATE_MSG }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const ids = Array.isArray(body?.productIds) ? body.productIds.map(String).filter(Boolean) : [];
  if (ids.length === 0) return NextResponse.json({ ok: false, error: "Sin productos" }, { status: 400 });
  const listId = body?.listId ? String(body.listId) : null;
  const overrides: Record<string, string | null> =
    body?.overrides && typeof body.overrides === "object" && !Array.isArray(body.overrides)
      ? Object.fromEntries(
          Object.entries(body.overrides).map(([k, v]) => [String(k), v ? String(v) : null])
        )
      : {};
  const includePromos = body?.includePromos === true;
  const apply = body?.apply === true;

  const cols = await queryMany<{ table_name: string; column_name: string }>(
    `SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema='public'
        AND ((table_name='products' AND column_name IN ('cost_last','packaging_cost','sku','is_combo','price_source','pricing_skipped','margin_list_id','promo_price'))
          OR (table_name='vendors' AND column_name IN ('price_round_step','price_round_mode','price_round_tail')))`
  ).catch(() => []);
  const has = (t: string, c: string) => cols.some((x) => x.table_name === t && x.column_name === c);

  const vendor = await queryOne<Record<string, unknown>>(
    `SELECT ${has("vendors", "price_round_step") ? "price_round_step, price_round_mode, price_round_tail" : "NULL::numeric AS price_round_step, NULL::text AS price_round_mode, NULL::numeric AS price_round_tail"}
       FROM vendors WHERE id = $1 LIMIT 1`,
    [gate.vendor.id]
  ).catch(() => null);
  const globalRounding: Rounding = resolveRounding({
    step: vendor?.price_round_step,
    mode: vendor?.price_round_mode,
    tail: vendor?.price_round_tail,
  });

  const roundCols = await queryMany<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='margin_lists' AND column_name='price_round_step'`
  ).catch(() => []);
  const hasListRound = roundCols.length > 0;

  const products = await queryMany<ProductRow>(
    `SELECT id, name, price, ${has("products", "promo_price") ? "promo_price" : "NULL::numeric AS promo_price"},
            ${has("products", "cost_last") ? "cost_last" : "NULL::numeric AS cost_last"},
            ${has("products", "packaging_cost") ? "packaging_cost" : "0::numeric AS packaging_cost"},
            ${has("products", "margin_list_id") ? "margin_list_id" : "NULL::uuid AS margin_list_id"},
            ${has("products", "sku") ? "sku" : "NULL::text AS sku"},
            ${has("products", "is_combo") ? "COALESCE(is_combo,false) AS is_combo" : "false AS is_combo"}
       FROM products WHERE vendor_id=$1 AND id = ANY($2::uuid[])`,
    [gate.vendor.id, ids]
  ).catch(() => []);

  const effectiveListId = (p: ProductRow): string | null => {
    if (Object.prototype.hasOwnProperty.call(overrides, p.id)) return overrides[p.id];
    if (listId) return listId;
    return p.margin_list_id;
  };

  const needed = [...new Set((products || []).map(effectiveListId).filter(Boolean) as string[])];
  const listsById = new Map<string, ListRow>();
  if (needed.length > 0) {
    const rows = await queryMany<ListRow>(
      hasListRound
        ? `SELECT id, name, rule, pct::float8 AS pct,
                  price_round_step::float8 AS step, price_round_mode AS mode, price_round_tail::float8 AS tail
             FROM margin_lists WHERE vendor_id=$1 AND id = ANY($2::uuid[])`
        : `SELECT id, name, rule, pct::float8 AS pct, NULL::numeric AS step, NULL::text AS mode, NULL::numeric AS tail
             FROM margin_lists WHERE vendor_id=$1 AND id = ANY($2::uuid[])`,
      [gate.vendor.id, needed]
    ).catch(() => []);
    for (const l of rows || []) listsById.set(l.id, l);
  }

  const rows = (products || []).map((p) => {
    const finalListId = effectiveListId(p);
    const list = finalListId ? listsById.get(finalListId) || null : null;
    const isGift = (p.sku || "").startsWith("GC-");
    const skipReason = p.is_combo || isGift ? "combo/giftcard" : p.cost_last == null ? "sin_costo" : !list ? "sin_lista" : null;
    const rounding = list ? resolveRounding({ step: list.step, mode: list.mode, tail: list.tail }) : globalRounding;
    // Costo efectivo = producto + empaque (in_recipe ya lo incluye y tiene 0).
    const effectiveCost = effectiveCostOf(p);
    const suggested =
      !skipReason && list
        ? clampPrice(priceFromCost(effectiveCost, list.rule as MarginRule, Number(list.pct), rounding) ?? 0, rounding)
        : null;
    const ratio =
      includePromos && p.promo_price != null && Number(p.price) > 0
        ? Number(p.promo_price) / Number(p.price)
        : null;
    const newPromo = ratio != null && suggested != null ? Math.min(suggested, Math.round(suggested * ratio)) : null;
    return {
      id: p.id,
      name: p.name,
      cost: effectiveCost,
      packaging_cost: Number(p.packaging_cost) || 0,
      oldPrice: p.price != null ? Number(p.price) : null,
      newPrice: suggested,
      listId: finalListId,
      listName: list?.name || null,
      rounding: list?.name || null,
      newPromo,
      skip: skipReason,
    };
  });

  if (!apply) return NextResponse.json({ ok: true, items: rows, lists: [...listsById.values()] });

  await withTransaction(async (tx) => {
    for (const r of rows) {
      if (r.newPrice == null) continue;
      await tx.queryVoid(`UPDATE products SET price=$2::numeric WHERE id=$1 AND vendor_id=$3`, [r.id, r.newPrice, gate.vendor.id]);
      if (r.newPromo != null && has("products", "promo_price")) {
        await tx.queryVoid(`UPDATE products SET promo_price=$2::numeric WHERE id=$1 AND vendor_id=$3`, [r.id, r.newPromo, gate.vendor.id]);
      }
      if (has("products", "margin_list_id")) {
        await tx.queryVoid(`UPDATE products SET margin_list_id=$2 WHERE id=$1 AND vendor_id=$3`, [r.id, r.listId, gate.vendor.id]);
      }
      if (has("products", "price_source")) {
        await tx.queryVoid(`UPDATE products SET price_source=$2 WHERE id=$1 AND vendor_id=$3`, [r.id, r.listId ? "lista" : "manual", gate.vendor.id]);
      }
    }
  });

  return NextResponse.json({ ok: true, applied: rows.filter((r) => r.newPrice != null).length, items: rows });
}
