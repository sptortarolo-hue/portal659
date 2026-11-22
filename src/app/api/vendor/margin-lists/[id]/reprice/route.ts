import { NextResponse } from "next/server";
import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryMany, queryOne, withTransaction } from "@/lib/db";
import { priceFromCost, clampPrice, promoFromRatio, type MarginRule } from "@/lib/cost-reprice";
import { describeRounding, isDefaultRounding, resolveRounding, type Rounding } from "@/lib/price-rounding";

export const dynamic = "force-dynamic";

const GATE_MSG = "Las listas de margen forman parte del inventario (plan Gestión integral)";
const MIGRATION_MSG = "Falta la migración supabase/self-host/migrate-margin-lists.sql";
const RULE_LABEL: Record<string, string> = { markup: "Recargo", margin: "Margen" };

/**
 * Recalcula los precios de todos los productos (y sus variantes) que tienen
 * esta lista según su regla (markup | margin sobre cost_last).
 *
 * Body: { includePromos?: boolean, dryRun?: boolean }
 * - dryRun=true: no escribe nada; devuelve el detalle de cada cambio.
 * - dryRun=false: aplica en una transacción (entero, mismo criterio que el
 *   bulk-price). Combos/giftcards se omiten; sin costo → skippedNoCost.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (!(gate.plan.can("inventory") || gate.plan.can("recipes"))) {
    return NextResponse.json({ error: GATE_MSG }, { status: 403 });
  }
  const { id } = await params;

  let body: any;
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const includePromos = body?.includePromos === true;
  const dryRun = body?.dryRun === true;

  let list: { id: string; name: string; rule: string; pct: number; price_round_step?: number | null; price_round_mode?: string | null; price_round_tail?: number | null } | undefined;
  try {
    // Redondeo tolerante: sin migrate-price-rounding.sql la lista no trae la regla (default neutro).
    const roundCols = await queryMany<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'margin_lists' AND column_name = 'price_round_step'`
    ).catch(() => [] as { column_name: string }[]);
    const hasRoundCols = roundCols.length > 0;
    list = await queryOne(
      hasRoundCols
        ? `SELECT id, name, rule, pct::float8 AS pct,
                  price_round_step::float8 AS price_round_step, price_round_mode, price_round_tail::float8 AS price_round_tail
             FROM margin_lists WHERE id = $1 AND vendor_id = $2 LIMIT 1`
        : `SELECT id, name, rule, pct::float8 AS pct FROM margin_lists WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
      [id, gate.vendor.id]
    );
  } catch {
    return NextResponse.json({ ok: false, error: MIGRATION_MSG }, { status: 503 });
  }
  if (!list) {
    return NextResponse.json({ ok: false, error: "Lista no encontrada" }, { status: 404 });
  }
  const rule = list.rule as MarginRule;
  const pct = Number(list.pct);
  const rounding: Rounding = resolveRounding({
    step: list.price_round_step,
    mode: list.price_round_mode,
    tail: list.price_round_tail,
  });
  const roundingLabel = isDefaultRounding(rounding) ? null : describeRounding(rounding);

  // Tolerancia a schema parcial: sku (giftcards), is_combo y cost_last.
  const schema = await queryMany<{ table_name: string; column_name: string }>(
    `SELECT table_name, column_name
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND ((table_name = 'products' AND column_name IN ('cost_last', 'sku', 'is_combo'))
          OR (table_name = 'product_variants' AND column_name = 'cost_last'))`
  ).catch(() => [] as { table_name: string; column_name: string }[]);
  const has = new Set(schema.map((c) => `${c.table_name}.${c.column_name}`));
  const hasProductsCost = has.has("products.cost_last");
  const hasVariantsCost = has.has("product_variants.cost_last");
  const hasSku = has.has("products.sku");
  const hasComboCol = has.has("products.is_combo");
  if (!hasProductsCost || !hasVariantsCost) {
    return NextResponse.json(
      { ok: false, error: "Falta la migración supabase/self-host/migrate-inventory.sql (cost_last)" },
      { status: 503 }
    );
  }

  const giftFilter = hasSku
    ? "AND NOT (COALESCE(sku, '') LIKE 'GC-%' OR lower(COALESCE(category, '')) = 'giftcards')"
    : "";
  const giftFilterVariant = hasSku
    ? "AND NOT (COALESCE(p.sku, '') LIKE 'GC-%' OR lower(COALESCE(p.category, '')) = 'giftcards')"
    : "";

  try {
    // --- Cargar productos de la lista -------------------------------------
    const products = await queryMany<{
      id: string;
      name: string;
      price: number;
      promo_price: number | null;
      cost_last: number | null;
      is_combo: boolean;
    }>(
      `SELECT id, name, price, promo_price,
              ${hasProductsCost ? "cost_last" : "NULL::numeric AS cost_last"}${hasComboCol ? ", COALESCE(is_combo, false) AS is_combo" : ", false AS is_combo"}
         FROM products
        WHERE vendor_id = $1 AND margin_list_id = $2 ${giftFilter}`,
      [gate.vendor.id, id]
    );

    // --- Variantes de esos productos --------------------------------------
    const productIds = products.map((p) => p.id);
    const variantRows = productIds.length
      ? await queryMany<{
          id: string;
          product_id: string;
          product_name: string;
          color: string;
          talle: string;
          price: number;
          promo: number | null;
          cost_last: number | null;
          is_combo: boolean;
        }>(
          `SELECT v.id, v.product_id, p.name AS product_name, v.color, v.talle,
                  v.price, v.promo,
                  ${hasVariantsCost ? "v.cost_last" : "NULL::numeric AS cost_last"},
                  ${hasComboCol ? "COALESCE(p.is_combo, false)" : "false"} AS is_combo
             FROM product_variants v
             JOIN products p ON p.id = v.product_id
            WHERE p.vendor_id = $1 AND v.product_id = ANY($2::uuid[]) ${giftFilterVariant}`,
          [gate.vendor.id, productIds]
        )
      : [];

    // --- Calcular ---------------------------------------------------------
    let skippedNoCost = 0;
    let skippedCombo = 0;
    let promosUpdated = 0;

    type Item = {
      id: string;
      kind: "product" | "variant";
      name: string;
      cost: number | null;
      oldPrice: number;
      newPrice: number | null;
      oldPromo: number | null;
      newPromo: number | null;
      skip: "no_cost" | "combo" | null;
    };
    const items: Item[] = [];
    const prodNew: { id: string; price: number; promo: number | null; hasPromo: boolean }[] = [];
    const varNew: { id: string; price: number; promo: number | null; hasPromo: boolean }[] = [];

    for (const p of products) {
      if (p.is_combo) {
        skippedCombo++;
        items.push({
          id: p.id, kind: "product", name: p.name, cost: p.cost_last != null ? Number(p.cost_last) : null,
          oldPrice: Number(p.price), newPrice: null, oldPromo: p.promo_price != null ? Number(p.promo_price) : null,
          newPromo: null, skip: "combo",
        });
        continue;
      }
      const cost = p.cost_last != null ? Number(p.cost_last) : null;
      const newPriceRaw = priceFromCost(cost, rule, pct, rounding);
      if (newPriceRaw == null) {
        skippedNoCost++;
        items.push({
          id: p.id, kind: "product", name: p.name, cost,
          oldPrice: Number(p.price), newPrice: null, oldPromo: p.promo_price != null ? Number(p.promo_price) : null,
          newPromo: null, skip: "no_cost",
        });
        continue;
      }
      const newPrice = clampPrice(newPriceRaw, rounding);
      const newPromo = promoFromRatio(newPrice, Number(p.price), p.promo_price, includePromos, rounding);
      prodNew.push({ id: p.id, price: newPrice, promo: newPromo, hasPromo: newPromo != null });
      if (newPromo != null && Number(p.promo_price) !== newPromo) promosUpdated++;
      items.push({
        id: p.id, kind: "product", name: p.name, cost,
        oldPrice: Number(p.price), newPrice, oldPromo: p.promo_price != null ? Number(p.promo_price) : null,
        newPromo, skip: null,
      });
    }

    for (const v of variantRows) {
      if (v.is_combo) continue; // el combo no se vende por costo
      const label = [v.color, v.talle].filter((s) => String(s || "").trim()).join(" ");
      const name = label ? `${v.product_name} — ${label}` : v.product_name;
      const cost = v.cost_last != null ? Number(v.cost_last) : null;
      const newPriceRaw = priceFromCost(cost, rule, pct, rounding);
      if (newPriceRaw == null) {
        skippedNoCost++;
        items.push({
          id: v.id, kind: "variant", name, cost,
          oldPrice: Number(v.price), newPrice: null, oldPromo: v.promo != null ? Number(v.promo) : null,
          newPromo: null, skip: "no_cost",
        });
        continue;
      }
      const newPrice = clampPrice(newPriceRaw, rounding);
      const newPromo = promoFromRatio(newPrice, Number(v.price), v.promo, includePromos, rounding);
      varNew.push({ id: v.id, price: newPrice, promo: newPromo, hasPromo: newPromo != null });
      if (newPromo != null && Number(v.promo) !== newPromo) promosUpdated++;
      items.push({
        id: v.id, kind: "variant", name, cost,
        oldPrice: Number(v.price), newPrice, oldPromo: v.promo != null ? Number(v.promo) : null,
        newPromo, skip: null,
      });
    }

    if (dryRun) {
      const capped = items.slice(0, 1000);
      return NextResponse.json({
        ok: true,
        dryRun: true,
        listId: list.id,
        listName: list.name,
        rule,
        pct,
        includePromos,
        items: capped,
        itemsTruncated: items.length > capped.length,
        skippedNoCost,
        skippedCombo,
        ruleLabel: RULE_LABEL[rule] ?? rule,
        rounding: { step: rounding.step, mode: rounding.mode, tail: rounding.tail },
        roundingLabel,
      });
    }

    // --- Aplicar en transacción -------------------------------------------
    const result = await withTransaction(async (tx) => {
      if (prodNew.length > 0) {
        await tx.queryVoid(
          `UPDATE products p
              SET price = data.new_price,
                  promo_price = CASE WHEN data.has_promo THEN data.new_promo ELSE p.promo_price END
             FROM (
               SELECT * FROM unnest($2::uuid[], $3::numeric[], $4::numeric[], $5::boolean[])
                 AS t(id, new_price, new_promo, has_promo)
             ) AS data
            WHERE p.vendor_id = $1 AND p.id = data.id`,
          [gate.vendor.id, prodNew.map((x) => x.id), prodNew.map((x) => x.price), prodNew.map((x) => x.promo), prodNew.map((x) => x.hasPromo)]
        );
      }
      if (varNew.length > 0) {
        await tx.queryVoid(
          `UPDATE product_variants v
              SET price = data.new_price,
                  promo = CASE WHEN data.has_promo THEN data.new_promo ELSE v.promo END
             FROM (
               SELECT * FROM unnest($2::uuid[], $3::numeric[], $4::numeric[], $5::boolean[])
                 AS t(id, new_price, new_promo, has_promo)
             ) AS data
            WHERE v.id = data.id
              AND EXISTS (SELECT 1 FROM products p WHERE p.id = v.product_id AND p.vendor_id = $1)`,
          [gate.vendor.id, varNew.map((x) => x.id), varNew.map((x) => x.price), varNew.map((x) => x.promo), varNew.map((x) => x.hasPromo)]
        );
      }
      return { updated: prodNew.length, variantsUpdated: varNew.length };
    });

    if (result.updated > 0 || result.variantsUpdated > 0) {
      try {
        const { touchPromoVersion } = await import("@/lib/promo-server");
        await touchPromoVersion(gate.vendor.id);
      } catch {
        /* best-effort */
      }
    }

    return NextResponse.json({
      ok: true,
      dryRun: false,
      listId: list.id,
      ...result,
      promosUpdated,
      skippedNoCost,
      skippedCombo,
      rounding: { step: rounding.step, mode: rounding.mode, tail: rounding.tail },
      roundingLabel,
    });
  } catch (e) {
    console.error("[margin-lists] reprice error:", e);
    return NextResponse.json({ ok: false, error: "No se pudo recalcular la lista" }, { status: 500 });
  }
}
