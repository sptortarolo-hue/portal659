import { NextResponse } from "next/server";
import { getVendorByRequest } from "@/lib/vendor-utils";
import { queryMany, withTransaction } from "@/lib/db";
import { priceFromCost, clampPrice, promoFromRatio } from "@/lib/cost-reprice";

type Op = "pct_up" | "pct_down" | "add" | "set" | "markup_pct" | "margin_pct";

/**
 * Modificación masiva de precios (estilo Fudo): una sola transacción en vez
 * de N PATCHes desde el cliente.
 *
 * Body: {
 *   ids: string[],
 *   op: "pct_up" | "pct_down" | "add" | "set" | "markup_pct" | "margin_pct",
 *   value: number,
 *   includePromos?: boolean,   // propaga el precio a promo_price/variant.promo manteniendo su %
 * }
 *
 * - pct_up/pct_down: porcentaje (0–500) sobre el precio, redondeado a entero.
 * - add: suma/resta fija ($), admite negativo (hasta ±1e9).
 * - set: precio fijo para todos.
 * - markup_pct: RECARGO sobre costo (precio = cost_last × (1 + x\/100)); 0–1000.
 * - margin_pct: MARGEN sobre precio (precio = cost_last \/ (1 − x\/100)); 0–<100.
 *   Las operaciones de costo usan SIEMPRE el último costo (cost_last): los
 *   productos/variantes sin costo se saltean y se reportan en
 *   `skippedNoCost`. Requieren migrate-inventory.sql (cost_last en products y
 *   product_variants); sin la migración responden 503 nombrando el archivo.
 * - Las tarjetas (giftcards) y los combos se excluyen siempre (precio del
 *   combo = armado, no costo).
 * - promos (`promo_price` / `product_variants.promo`): con includePromos=true
 *   se recalculan MANTENIENDO el % de descuento que la promo ya tenía
 *   (cociente promo\/precio previo, topeado al nuevo precio); con false
 *   (default) quedan intactas.
 */
export async function POST(request: Request) {
  const { vendor, staffRole } = await getVendorByRequest(request);
  if (!vendor) {
    return NextResponse.json({ ok: false, error: "No autenticado" }, { status: 401 });
  }
  if (staffRole === "delivery") {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 403 });
  }

  let body: { ids?: unknown; op?: unknown; value?: unknown; includePromos?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Body inválido" }, { status: 400 });
  }

  const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === "string") : [];
  const op = String(body.op || "") as Op;
  const value = Number(body.value);
  const includePromos = body.includePromos === true;

  if (ids.length === 0) {
    return NextResponse.json({ ok: false, error: "Sin productos seleccionados" }, { status: 400 });
  }
  if (ids.length > 500) {
    return NextResponse.json({ ok: false, error: "Máximo 500 productos por vez" }, { status: 400 });
  }
  if (!["pct_up", "pct_down", "add", "set", "markup_pct", "margin_pct"].includes(op)) {
    return NextResponse.json({ ok: false, error: "Operación inválida" }, { status: 400 });
  }
  if (!isFinite(value) || value < -1e9 || value > 1e9) {
    return NextResponse.json({ ok: false, error: "Valor inválido" }, { status: 400 });
  }
  if ((op === "pct_up" || op === "pct_down") && value > 500) {
    return NextResponse.json({ ok: false, error: "Porcentaje fuera de rango (0–500)" }, { status: 400 });
  }
  if (op === "pct_up" || op === "pct_down" || op === "set") {
    if (value < 0) {
      return NextResponse.json({ ok: false, error: "El valor no puede ser negativo" }, { status: 400 });
    }
  }
  if (op === "markup_pct" && value > 1000) {
    return NextResponse.json({ ok: false, error: "Recargo fuera de rango (0–1000)" }, { status: 400 });
  }
  if (op === "margin_pct" && value >= 100) {
    return NextResponse.json({ ok: false, error: "El margen debe ser menor al 100%" }, { status: 400 });
  }
  if (op === "markup_pct" && value < 0) {
    return NextResponse.json({ ok: false, error: "El recargo no puede ser negativo" }, { status: 400 });
  }
  if (op === "margin_pct" && value < 0) {
    return NextResponse.json({ ok: false, error: "El margen no puede ser negativo" }, { status: 400 });
  }

  const isCostOp = op === "markup_pct" || op === "margin_pct";

  // Solo las operaciones de costo requieren las columnas de
  // migrate-inventory.sql (cost_last); el resto funciona sin la migración.
  let schema: { table_name: string; column_name: string }[];
  try {
    schema = await queryMany<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND ((table_name = 'products' AND column_name IN ('cost_last', 'sku', 'is_combo'))
            OR (table_name = 'product_variants' AND column_name = 'cost_last'))`
    );
  } catch {
    return NextResponse.json(
      { ok: false, error: "No se pudo verificar el esquema de la base" },
      { status: 500 }
    );
  }
  const has = new Set(schema.map((c) => `${c.table_name}.${c.column_name}`));
  const hasProductsCost = has.has("products.cost_last");
  const hasVariantsCost = has.has("product_variants.cost_last");
  const hasSku = has.has("products.sku");
  const hasComboCol = has.has("products.is_combo");

  if (isCostOp && (!hasProductsCost || !hasVariantsCost)) {
    return NextResponse.json(
      { ok: false, error: "Falta la migración supabase/self-host/migrate-inventory.sql (cost_last)" },
      { status: 503 }
    );
  }

  function basePrice(oldPrice: number, cost: number | null): number | null {
    if (!isCostOp) {
      if (op === "pct_up") return Math.round((oldPrice * (100 + value)) / 100);
      if (op === "pct_down") return Math.round((oldPrice * (100 - value)) / 100);
      if (op === "add") return Math.round(oldPrice + value);
      return Math.round(value);
    }
    const r = op === "markup_pct" ? "markup" : "margin";
    return priceFromCost(cost, r, value);
  }

  /** Promo manteniendo el cociente promo/precio previo (topeada al nuevo precio). */
  function promoFor(newPrice: number, oldPrice: number, oldPromo: number | null): number | null {
    return promoFromRatio(newPrice, oldPrice, oldPromo, includePromos);
  }

  try {
    const result = await withTransaction(async (tx) => {
      // Candidatos: tolerante a DB sin columna sku y/o sin cost_last (las
      // ops no-costo pueden correr igual). Preguntar primero, consultar
      // despues: adentro de una tx un SELECT fallido la aborta.
      const giftFilter = hasSku
        ? "AND NOT (COALESCE(sku, '') LIKE 'GC-%' OR lower(COALESCE(category, '')) = 'giftcards')"
        : "";
      const giftFilterVariant = hasSku
        ? "AND NOT (COALESCE(p.sku, '') LIKE 'GC-%' OR lower(COALESCE(p.category, '')) = 'giftcards')"
        : "";
      const rows = await tx.query<{
        id: string;
        price: number;
        promo_price: number | null;
        cost_last: number | null;
        is_combo: boolean;
      }>(
        `SELECT id, price, promo_price,
                ${hasProductsCost ? "cost_last" : "NULL::numeric AS cost_last"}${hasComboCol ? ", COALESCE(is_combo, false) AS is_combo" : ", false AS is_combo"}
           FROM products
          WHERE vendor_id = $1 AND id = ANY($2::uuid[])
            ${giftFilter}`,
        [vendor.id, ids]
      );

      let skippedNoCost = 0;
      let skippedCombo = 0;
      let promosUpdated = 0;

      // Productos a actualizar.
      const updIds: string[] = [];
      const updPrices: number[] = [];
      const updPromos: (number | null)[] = [];
      const updHasPromo: boolean[] = [];
      for (const r of rows) {
        if (r.is_combo) {
          skippedCombo++;
          continue;
        }
        const newPrice = basePrice(Number(r.price), r.cost_last);
        if (newPrice == null) {
          skippedNoCost++;
          continue;
        }
        // price es numeric(10,2): topear al máximo de la columna.
        const finalPrice = clampPrice(newPrice);
        const newPromo = promoFor(finalPrice, Number(r.price), r.promo_price);
        updIds.push(r.id);
        updPrices.push(finalPrice);
        updPromos.push(newPromo);
        updHasPromo.push(newPromo != null);
        if (newPromo != null && Number(r.promo_price) !== newPromo) promosUpdated++;
      }

      if (updIds.length > 0) {
        await tx.queryVoid(
          `UPDATE products p
              SET price = data.new_price,
                  promo_price = CASE WHEN data.has_promo THEN data.new_promo ELSE p.promo_price END
             FROM (
               SELECT * FROM unnest($2::uuid[], $3::numeric[], $4::numeric[], $5::boolean[])
                 AS t(id, new_price, new_promo, has_promo)
             ) AS data
            WHERE p.vendor_id = $1 AND p.id = data.id`,
          [vendor.id, updIds, updPrices, updPromos, updHasPromo]
        );
      }

      // Variantes de los productos seleccionados (excepto combos): se recalculan
      // desde el cost_last de cada variante; sin costo → saltear y contar.
      const variantRows = await tx.query<{
        id: string;
        product_id: string;
        price: number;
        promo: number | null;
        cost_last: number | null;
        is_combo: boolean;
      }>(
        `SELECT v.id, v.product_id, v.price, v.promo, ${hasVariantsCost ? 'v.cost_last' : 'NULL::numeric AS cost_last'},
                ${hasComboCol ? "COALESCE(p.is_combo, false)" : "false"} AS is_combo
           FROM product_variants v
           JOIN products p ON p.id = v.product_id
          WHERE p.vendor_id = $1 AND v.product_id = ANY($2::uuid[])
            ${giftFilterVariant}`,
        [vendor.id, ids]
      );

      const vUpdIds: string[] = [];
      const vUpdPrices: number[] = [];
      const vUpdPromos: (number | null)[] = [];
      const vUpdHasPromo: boolean[] = [];
      let variantsUpdated = 0;

      for (const v of variantRows) {
        if (v.is_combo) continue; // el combo no se vende por costo
        const newPrice = basePrice(Number(v.price), v.cost_last);
        if (newPrice == null) {
          skippedNoCost++;
          continue;
        }
        // price es numeric(10,2): topear al máximo de la columna.
        const finalPrice = clampPrice(newPrice);
        const newPromo = promoFor(finalPrice, Number(v.price), v.promo);
        vUpdIds.push(v.id);
        vUpdPrices.push(finalPrice);
        vUpdPromos.push(newPromo);
        vUpdHasPromo.push(newPromo != null);
        variantsUpdated++;
        if (newPromo != null && Number(v.promo) !== newPromo) promosUpdated++;
      }

      if (vUpdIds.length > 0) {
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
          [vendor.id, vUpdIds, vUpdPrices, vUpdPromos, vUpdHasPromo]
        );
      }

      return {
        updated: updIds.length,
        variantsUpdated,
        promosUpdated,
        skippedNoCost,
        skippedCombo,
      };
    });

    // Tras el COMMIT: mover el versionado de la tarjeta promo (?v=).
    if (result.updated > 0 || result.variantsUpdated > 0) {
      try {
        const { touchPromoVersion } = await import("@/lib/promo-server");
        await touchPromoVersion(vendor.id);
      } catch {
        // Best-effort: el versionado no invalida los precios.
      }
    }

    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error("[bulk-price] Error:", e);
    return NextResponse.json({ ok: false, error: "No se pudieron actualizar los precios" }, { status: 500 });
  }
}
