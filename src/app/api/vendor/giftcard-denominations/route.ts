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
      const exists = await queryOne<{ id: string }>(
        `SELECT id FROM products
         WHERE vendor_id = $1 AND (sku = $2 OR (sku IS NULL AND lower(category) = 'giftcards' AND price = $3)) LIMIT 1`,
        [gate.vendor.id, `GC-${damt}`, damt]
      ).catch(() => null);
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
    // Devolver montos como número (no "10000.00") para la UI.
    const clean = (rows || []).map((d) => ({ ...d, amount: Math.round(Number(d.amount)) || 0 }));
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
      // Guardamos el monto antes de borrar para apagar el producto.
      const den = await queryOne<{ amount: number }>(
        `SELECT amount FROM giftcard_denominations WHERE id = $1 AND vendor_id = $2`,
        [id, gate.vendor.id]
      ).catch(() => null);
      await queryOne(`DELETE FROM giftcard_denominations WHERE id = $1 AND vendor_id = $2`, [
        id,
        gate.vendor.id,
      ]).catch(() => null);
      if (den) {
        const denamt = Math.round(Number(den.amount)) || 0;
        await queryOne(
          `UPDATE products SET available = false WHERE vendor_id = $1 AND sku = $2`,
          [gate.vendor.id, `GC-${denamt}`]
        ).catch(() => null);
        // Fallback sin sku: por categoría + precio exacto.
        await queryOne(
          `UPDATE products SET available = false
           WHERE vendor_id = $1 AND lower(category) = 'giftcards' AND price = $2 AND sku IS NULL`,
          [gate.vendor.id, denamt]
        ).catch(() => null);
      }
      return NextResponse.json({ ok: true });
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
