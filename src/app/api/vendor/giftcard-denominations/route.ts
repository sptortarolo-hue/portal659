import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryMany, queryOne } from "@/lib/db";
import { NextResponse } from "next/server";
import { canSellGiftcards, normalizeGiftAmount } from "@/lib/giftcards";

/**
 * Montos fijos de giftcard por comercio (comercio/moda; estética legacy
 * vende con monto abierto y puede no tener filas).
 * - GET: lista ordenada por monto.
 * - POST { amount }: agrega (dedupe por unique).
 * - POST { action: "delete", id }: borra.
 * - POST { action: "toggle", id, active }: prende/apaga.
 */
export async function GET(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (!canSellGiftcards(gate.vendor.vertical)) {
    return NextResponse.json({ denominations: [] });
  }
  try {
    const rows = await queryMany<{ id: string; amount: number; active: boolean; position: number }>(
      `SELECT id, amount, active, position FROM giftcard_denominations
       WHERE vendor_id = $1 ORDER BY amount ASC`,
      [gate.vendor.id]
    );
    // Reconciliación: cada monto activo crea su producto si falta (montos
    // creados antes del deploy o columnas que aún no están migradas).
    // OJO: pg devuelve numeric como string ("10000.00"): normalizar a
    // entero antes de armar el sku, si no se crean duplicados GC-10000.00.
    for (const d of rows || []) {
      if (d.active === false) continue;
      const damt = Math.round(Number(d.amount)) || 0;
      if (!(damt > 0)) continue;
      // sku '' cuenta como faltante (filas creadas a mano sin sku).
      const exists = await queryOne<{ id: string; sku: string | null }>(
        `SELECT id, sku FROM products
         WHERE vendor_id = $1 AND (sku = $2 OR (COALESCE(sku, '') = '' AND lower(category) = 'giftcards' AND price = $3)) LIMIT 1`,
        [gate.vendor.id, `GC-${damt}`, damt]
      ).catch(() => null);
      if (exists && !exists.sku) {
        // Backfill: la fila existe pero sin sku → se completa (evita duplicados).
        await queryOne(`UPDATE products SET sku = $2 WHERE id = $1`, [exists.id, `GC-${damt}`]).catch(() => null);
      }
      if (!exists) {
        // Insert mínimo (columnas núcleo) y sku aparte por si la columna falta.
        const created = await queryOne<{ id: string }>(
          `INSERT INTO products (vendor_id, name, description, price, currency, category, available, stock, stock_control, featured_today, requires_prep, has_variants)
           VALUES ($1, $2, $3, $4, 'ARS', 'Giftcards', true, 0, false, false, false, false)
           RETURNING id`,
          [
            gate.vendor.id,
            `Giftcard $${damt.toLocaleString("es-AR")}`,
            `Tarjeta de regalo de ${damt.toLocaleString("es-AR")} para gastar en el local.`,
            damt,
          ]
        ).catch(() => null);
        if (created) {
          await queryOne(`UPDATE products SET sku = $2 WHERE id = $1`, [created.id, `GC-${damt}`]).catch(() => null);
        }
      }
    }
    // Devolver montos como número (no "10000.00") para la UI, con foto y
    // descripción del producto para personalizar la tarjeta.
    const clean = (rows || []).map((d) => ({ ...d, amount: Math.round(Number(d.amount)) || 0 }));
    try {
      const skus = clean.map((d: any) => `GC-${d.amount}`);
      const prods = skus.length
        ? await queryMany<{ sku: string; image_url: string | null; description: string | null }>(
            `SELECT sku, image_url, description FROM products WHERE vendor_id = $1 AND sku = ANY($2)`,
            [gate.vendor.id, skus]
          )
        : [];
      const bySku = new Map((prods || []).map((p) => [String(p.sku), p]));
      for (const d of clean as any[]) {
        const p = bySku.get(`GC-${d.amount}`);
        d.image_url = p?.image_url != null ? String(p.image_url) : null;
        d.description = p?.description != null ? String(p.description) : null;
      }
    } catch {
      /* sin columnas: montos igual */
    }
    return NextResponse.json({ denominations: clean });
  } catch {
    return NextResponse.json({ denominations: [], migrationMissing: true }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (!canSellGiftcards(gate.vendor.vertical)) {
    return NextResponse.json({ error: "Giftcards no disponibles para este rubro" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const action = String(body.action || "add");
  try {
    if (action === "delete") {
      const id = String(body.id || "");
      if (!id) return NextResponse.json({ error: "Falta el id" }, { status: 400 });
      // Monto antes de borrar (para ubicar el producto del catálogo).
      const den = await queryOne<{ amount: number }>(
        `SELECT amount FROM giftcard_denominations WHERE id = $1 AND vendor_id = $2`,
        [id, gate.vendor.id]
      ).catch(() => null);
      if (!den) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
      const denamt = Math.round(Number(den.amount)) || 0;
      await queryOne(`DELETE FROM giftcard_denominations WHERE id = $1 AND vendor_id = $2`, [
        id,
        gate.vendor.id,
      ]).catch(() => null);
      // Borrado real del producto del catálogo, salvo con historial (pedidos
      // que lo incluyeron o códigos emitidos): ahí se apaga para no romper
      // nada (ante la duda, no se borra: fail-closed).
      let productDeleted = false;
      if (denamt > 0) {
        // Todos los productos de ese monto (incluye duplicados viejos): si
        // no quedó ninguno a la venta, el monto desaparece del micrositio.
        // Tolerante a DBs sin columna sku: reintenta solo por categoría+precio.
        let prods = await queryMany<{ id: string }>(
          `SELECT id FROM products WHERE vendor_id = $1 AND (sku = $2 OR (lower(category) = 'giftcards' AND price = $3))`,
          [gate.vendor.id, `GC-${denamt}`, denamt]
        ).catch(() => [] as { id: string }[]);
        if (prods.length === 0) {
          prods = await queryMany<{ id: string }>(
            `SELECT id FROM products WHERE vendor_id = $1 AND lower(category) = 'giftcards' AND price = $2`,
            [gate.vendor.id, denamt]
          ).catch(() => [] as { id: string }[]);
        }
        for (const prod of prods) {
          let hasHistory = true;
          try {
            const used = await queryOne<{ e: boolean }>(
              `SELECT EXISTS (
                 SELECT 1 FROM orders o, LATERAL jsonb_array_elements(o.items::jsonb) AS i
                 WHERE o.vendor_id = $1 AND i->>'product_id' = $2
               ) AS e`,
              [gate.vendor.id, prod.id]
            );
            const issued = await queryOne<{ e: boolean }>(
              `SELECT EXISTS (SELECT 1 FROM giftcards WHERE vendor_id = $1 AND product_id = $2) AS e`,
              [gate.vendor.id, prod.id]
            );
            hasHistory = used?.e === true || issued?.e === true;
          } catch {
            hasHistory = true;
          }
          if (!hasHistory) {
            await queryOne(`DELETE FROM products WHERE id = $1 AND vendor_id = $2`, [
              prod.id,
              gate.vendor.id,
            ]).catch(() => null);
            productDeleted = true;
          } else {
            await queryOne(`UPDATE products SET available = false WHERE id = $1 AND vendor_id = $2`, [
              prod.id,
              gate.vendor.id,
            ]).catch(() => null);
          }
        }
      }
      return NextResponse.json({ ok: true, productDeleted });
    }
    if (action === "customize") {
      // Personalizar la tarjeta del monto: foto + descripción. Precio,
      // categoría y sku van atados a la denominación y no se tocan.
      const id = String(body.id || "");
      if (!id) return NextResponse.json({ error: "Falta el id" }, { status: 400 });
      const den = await queryOne<{ id: string; amount: number }>(
        `SELECT id, amount FROM giftcard_denominations WHERE id = $1 AND vendor_id = $2`,
        [id, gate.vendor.id]
      ).catch(() => null);
      if (!den) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
      const damt = Math.round(Number(den.amount)) || 0;
      const imageUrl =
        typeof body.image_url === "string" && body.image_url.trim() !== ""
          ? body.image_url.trim().slice(0, 500)
          : null;
      const description =
        typeof body.description === "string" && body.description.trim() !== ""
          ? body.description.trim().slice(0, 500)
          : null;
      let prod = await queryOne<{ id: string }>(
        `SELECT id FROM products WHERE vendor_id = $1 AND (sku = $2 OR (lower(category) = 'giftcards' AND price = $3)) LIMIT 1`,
        [gate.vendor.id, `GC-${damt}`, damt]
      ).catch(() => null);
      if (!prod) {
        prod = await queryOne<{ id: string }>(
          `SELECT id FROM products WHERE vendor_id = $1 AND lower(category) = 'giftcards' AND price = $2 LIMIT 1`,
          [gate.vendor.id, damt]
        ).catch(() => null);
      }
      if (!prod) {
        return NextResponse.json(
          { error: "Sin producto: reabrí la pestaña Tarjetas para regenerarlo" },
          { status: 404 }
        );
      }
      const updated = await queryOne<{ id: string; image_url: string | null; description: string | null }>(
        `UPDATE products SET image_url = $3, description = $4 WHERE id = $1 AND vendor_id = $2
         RETURNING id, image_url, description`,
        [prod.id, gate.vendor.id, imageUrl, description]
      );
      return NextResponse.json({ denomination: { id: den.id, amount: damt }, product: updated });
    }
    if (action === "toggle") {
      const id = String(body.id || "");
      if (!id) return NextResponse.json({ error: "Falta el id" }, { status: 400 });
      const updated = await queryOne<{ id: string; active: boolean; amount: number }>(
        `UPDATE giftcard_denominations SET active = $3 WHERE id = $1 AND vendor_id = $2 RETURNING id, active, amount`,
        [id, gate.vendor.id, body.active !== false]
      );
      if (!updated) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
      // El producto del catálogo prende/apaga con el monto.
      const updamt = Math.round(Number(updated.amount)) || 0;
      await queryOne(
        `UPDATE products SET available = $3 WHERE vendor_id = $1 AND sku = $2`,
        [gate.vendor.id, `GC-${updamt}`, updated.active]
      ).catch(() => null);
      return NextResponse.json({ denomination: { ...updated, amount: updamt } });
    }
    // add (default)
    const amount = normalizeGiftAmount(body.amount);
    if (!amount) return NextResponse.json({ error: "Monto inválido" }, { status: 400 });
    try {
      const row = await queryOne<{ id: string; amount: number; active: boolean }>(
        `INSERT INTO giftcard_denominations (vendor_id, amount, position)
         VALUES ($1, $2, (SELECT COUNT(*) FROM giftcard_denominations WHERE vendor_id = $1))
         RETURNING id, amount, active`,
        [gate.vendor.id, amount]
      );
      // Producto del catálogo: se compra como cualquier producto (local/web,
      // sin MP intermedio). Insert mínimo + sku aparte (si falta la columna).
      const product = await queryOne<{ id: string }>(
        `INSERT INTO products (vendor_id, name, description, price, currency, category, available, stock, stock_control, featured_today, requires_prep, has_variants)
         VALUES ($1, $2, $3, $4, 'ARS', 'Giftcards', true, 0, false, false, false, false)
         RETURNING id`,
        [
          gate.vendor.id,
          `Giftcard $${amount.toLocaleString("es-AR")}`,
          `Tarjeta de regalo de ${amount.toLocaleString("es-AR")} para gastar en el local.`,
          amount,
        ]
      ).catch(() => null);
      if (product) {
        await queryOne(`UPDATE products SET sku = $2 WHERE id = $1`, [product.id, `GC-${amount}`]).catch(() => null);
      }
      return NextResponse.json({ denomination: row, product });
    } catch (e) {
      if (/duplicate|unique/i.test((e as Error)?.message || "")) {
        return NextResponse.json({ error: "Ese monto ya está en la lista" }, { status: 409 });
      }
      throw e;
    }
  } catch {
    return NextResponse.json(
      { error: "Falta aplicar la migración migrate-giftcard-denominations.sql en la base" },
      { status: 503 }
    );
  }
}
