import { NextResponse } from "next/server";
import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryMany, queryOne, withTransaction } from "@/lib/db";
import { priceFromCost, clampPrice, type MarginRule } from "@/lib/cost-reprice";
import { resolveRounding, type Rounding } from "@/lib/price-rounding";

export const dynamic = "force-dynamic";

const GATE_MSG = "La administración de precios forma parte del plan Gestión integral";

type ProductRow = {
  id: string;
  name: string;
  price: number | null;
  promo_price: number | null;
  cost_last: number | null;
  margin_list_id: string | null;
  sku: string | null;
  is_combo: boolean;
  price_source?: string | null;
};

/**
 * Vista previa / aplicación del paso 5 del asistente de precios.
 * Body: { productIds: string[], listId?: string|null, includePromos?: boolean, apply?: boolean }
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
  const includePromos = body?.includePromos === true;
  const apply = body?.apply === true;

  // Esquema tolerante.
  const cols = await queryMany<{ table_name: string; column_name: string }>(
    `SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema='public'
        AND ((table_name='products' AND column_name IN ('cost_last','sku','is_combo','price_source','pricing_skipped','margin_list_id','promo_price'))
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

  type ListRow = { id: string; name: string; rule: string; pct: number; step: number | null; mode: string | null; tail: number | null };
  let list: ListRow | null = null;
  if (listId) {
    const row = await queryOne<ListRow>(
      hasListRound
        ? `SELECT id, name, rule, pct::float8 AS pct,
                  price_round_step::float8 AS step, price_round_mode AS mode, price_round_tail::float8 AS tail
             FROM margin_lists WHERE id=$1 AND vendor_id=$2 LIMIT 1`
        : `SELECT id, name, rule, pct::float8 AS pct, NULL::numeric AS step, NULL::text AS mode, NULL::numeric AS tail
             FROM margin_lists WHERE id=$1 AND vendor_id=$2 LIMIT 1`,
      [listId, gate.vendor.id]
    ).catch(() => null);
    list = row || null;
    if (!list) return NextResponse.json({ ok: false, error: "Lista no encontrada" }, { status: 404 });
  }

  const products = await queryMany<ProductRow>(
    `SELECT id, name, price, ${has("products", "promo_price") ? "promo_price" : "NULL::numeric AS promo_price"},
            ${has("products", "cost_last") ? "cost_last" : "NULL::numeric AS cost_last"},
            ${has("products", "margin_list_id") ? "margin_list_id" : "NULL::uuid AS margin_list_id"},
            ${has("products", "sku") ? "sku" : "NULL::text AS sku"},
            ${has("products", "is_combo") ? "COALESCE(is_combo,false) AS is_combo" : "false AS is_combo"}
       FROM products WHERE vendor_id=$1 AND id = ANY($2::uuid[])`,
    [gate.vendor.id, ids]
  ).catch(() => []);

  const rows = (products || []).map((p) => {
    const isGift = (p.sku || "").startsWith("GC-");
    const skipReason = p.is_combo || isGift ? "combo/giftcard" : p.cost_last == null ? "sin_costo" : null;
    const rounding = list ? resolveRounding({ step: list.step, mode: list.mode, tail: list.tail }) : globalRounding;
    const suggested =
      !skipReason && list
        ? clampPrice(priceFromCost(Number(p.cost_last), list.rule as MarginRule, Number(list.pct), rounding) ?? 0, rounding)
        : null;
    const ratio =
      includePromos && p.promo_price != null && Number(p.price) > 0
        ? Number(p.promo_price) / Number(p.price)
        : null;
    const newPromo = ratio != null && suggested != null ? Math.min(suggested, Math.round(suggested * ratio)) : null;
    return {
      id: p.id,
      name: p.name,
      cost: p.cost_last != null ? Number(p.cost_last) : null,
      oldPrice: p.price != null ? Number(p.price) : null,
      newPrice: suggested,
      rounding: list ? list.name : null,
      newPromo,
      skip: skipReason || (!list ? "sin_lista" : null),
    };
  });

  if (!apply) {
    return NextResponse.json({ ok: true, items: rows });
  }

  await withTransaction(async (tx) => {
    for (const r of rows) {
      if (r.newPrice == null) continue;
      await tx.queryVoid(`UPDATE products SET price=$2::numeric WHERE id=$1 AND vendor_id=$3`, [r.id, r.newPrice, gate.vendor.id]);
      if (r.newPromo != null && has("products", "promo_price")) {
        await tx.queryVoid(`UPDATE products SET promo_price=$2::numeric WHERE id=$1 AND vendor_id=$3`, [r.id, r.newPromo, gate.vendor.id]);
      }
      if (list && has("products", "margin_list_id")) {
        await tx.queryVoid(`UPDATE products SET margin_list_id=$2 WHERE id=$1 AND vendor_id=$3`, [r.id, list.id, gate.vendor.id]);
      }
      if (has("products", "price_source")) {
        await tx.queryVoid(`UPDATE products SET price_source='lista' WHERE id=$1 AND vendor_id=$3`, [r.id, gate.vendor.id]);
      }
    }
  });

  return NextResponse.json({ ok: true, applied: rows.filter((r) => r.newPrice != null).length, items: rows });
}
