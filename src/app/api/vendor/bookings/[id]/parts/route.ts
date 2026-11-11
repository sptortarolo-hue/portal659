import { getVendorByRequest } from "@/lib/vendor-utils";
import { hasTable, queryMany, queryOne, withTransaction, type Tx } from "@/lib/db";
import { logStockMovement } from "@/lib/stock-ledger";
import { addBookingEventTx } from "@/lib/booking-events";
import { recalcServicePriceTx } from "@/lib/vendor-booking";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Repuestos usados en una orden de servicio (taller v3, integra Inventario):
 * - POST { product_id, variant_id?, qty, unit_price? } → agrega el repuesto con
 *   snapshot de costo/precio, DESCUENTA stock (solo stock_control) en la misma
 *   tx, escribe kardex (reason 'orden', ref_booking) y registra el evento.
 * - DELETE ?partId= → quita el repuesto, repone stock, kardex inverso y evento.
 *
 * Sin la migración `migrate-taller-v3.sql` → 503 nombrando el archivo.
 * Sin stock suficiente → 409 (la tx hace rollback, la orden queda igual).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  // Vertical del comercio: `getVendorByRequest` no lo incluía en algunas rutas
  // viejas, así que se resuelve acá (nunca asumir que viene en el objeto).
  const vendorRow = await queryOne<{ vertical: string | null }>(
    `SELECT vertical FROM vendors WHERE id = $1 LIMIT 1`,
    [vendor.id]
  );
  const vertical = vendorRow?.vertical || "";
  if (vertical !== "taller" && vertical !== "servicio" && vertical !== "estetica") {
    return NextResponse.json(
      { error: "Solo disponible para talleres, servicios y estética" },
      { status: 403 }
    );
  }

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const productId = typeof body.product_id === "string" ? body.product_id : "";
  const variantId = typeof body.variant_id === "string" && body.variant_id ? body.variant_id : null;
  const qty = Math.max(0.01, Math.round(Number(body.qty) * 100) / 100 || 0);
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "ID inválido" }, { status: 400 });
  }
  if (!productId || !/^[0-9a-f-]{36}$/i.test(productId) || qty <= 0) {
    return NextResponse.json({ error: "Elegí un repuesto y una cantidad mayor a 0" }, { status: 400 });
  }

  const booking = await queryOne<{ id: string; vendor_id: string; status: string; kind: string | null; work_order_no: number | null }>(
    `SELECT id, vendor_id, status, kind, work_order_no FROM bookings WHERE id = $1 LIMIT 1`,
    [id]
  ).catch(() => undefined);
  if (!booking) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  if (booking.vendor_id !== vendor.id) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const hasParts = await hasTable({ query: <T extends { [k: string]: unknown }>(sql: string, p?: unknown[]) => queryMany<T>(sql, p) }, "work_order_parts").catch(() => false);
  if (!hasParts) {
    return NextResponse.json({ error: "Falta aplicar la migración migrate-taller-v3.sql en la base" }, { status: 503 });
  }

  const customPrice = body.unit_price != null && Number(body.unit_price) > 0 ? Math.round(Number(body.unit_price) * 100) / 100 : null;

  try {
    const part = await withTransaction(async (tx: Tx) => {
      let name = "";
      let unitPrice = 0;
      let unitCost = 0;
      let stockControl = false;
      if (variantId) {
        const row = await tx.queryOne<{
          name: string; price: number | null; promo: number | null; cost_last: number | null; cost_avg: number | null; stock: number | null;
        }>(
          `SELECT p.name, v.price, v.promo, v.cost_last, v.cost_avg, v.stock
           FROM product_variants v JOIN products p ON p.id = v.product_id
           WHERE v.id = $1 AND v.product_id = $2 AND p.vendor_id = $3 LIMIT 1`,
          [variantId, productId, vendor.id]
        );
        if (!row) throw new Error("Repuesto no encontrado en tu catálogo");
        name = row.name;
        unitPrice = Number(row.promo ?? row.price ?? 0);
        unitCost = Number(row.cost_last ?? row.cost_avg ?? 0);
      } else {
        const row = await tx.queryOne<{
          name: string; price: number | null; promo_price: number | null; stock_control: boolean | null; stock: number | null;
        }>(
          `SELECT name, price, promo_price, stock_control, stock FROM products WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
          [productId, vendor.id]
        );
        if (!row) throw new Error("Repuesto no encontrado en tu catálogo");
        name = row.name;
        unitPrice = Number(row.promo_price ?? row.price ?? 0);
        stockControl = row.stock_control === true;
        const costRow = await tx
          .queryOne<{ cost_last: number | null; cost_avg: number | null }>(
            `SELECT cost_last, cost_avg FROM products WHERE id = $1 LIMIT 1`,
            [productId]
          )
          .catch(() => null);
        unitCost = Number(costRow?.cost_last ?? costRow?.cost_avg ?? 0);
      }
      if (customPrice) unitPrice = customPrice;

      // El stock de repuestos se descuenta por unidades enteras (las columnas
      // stock son integer): igual que import-quote. La fila guarda el qty real.
      const stockQty = Math.max(1, Math.round(Number(qty) || 1));

      if (variantId) {
        const rows = await tx.query<{ id: string }>(
          `UPDATE product_variants SET stock = stock - $1 WHERE id = $2 AND stock >= $1 RETURNING id`,
          [stockQty, variantId]
        );
        if (rows.length === 0) throw new Error(`Sin stock suficiente de "${name}"`);
      } else if (stockControl) {
        const rows = await tx.query<{ id: string }>(
          `UPDATE products SET stock = stock - $1 WHERE id = $2 AND stock_control = true AND COALESCE(stock, 0) >= $1 RETURNING id`,
          [stockQty, productId]
        );
        if (rows.length === 0) throw new Error(`Sin stock suficiente de "${name}"`);
      }

      const inserted = await tx.queryOne<{
        id: string; product_id: string | null; variant_id: string | null; name: string | null;
        qty: number; unit_cost: number; unit_price: number;
      }>(
        `INSERT INTO work_order_parts (vendor_id, booking_id, product_id, variant_id, name, qty, unit_cost, unit_price, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL)
         RETURNING id, product_id, variant_id, name, qty, unit_cost, unit_price`,
        [vendor.id, id, productId, variantId, name, qty, unitCost, unitPrice]
      );

      await logStockMovement(tx, {
        vendorId: vendor.id,
        product_id: productId,
        variant_id: variantId,
        qty_delta: -stockQty,
        reason: "orden",
        ref_booking: id,
      });

      await addBookingEventTx(tx, {
        vendorId: vendor.id,
        bookingId: id,
        kind: "parts",
        message: `Repuesto usado: ${name} × ${qty}`,
      });

      // El total a cobrar es siempre la suma de la cuenta (partidas + mano
      // de obra): se recalcula acá, no hay botón para eso.
      await recalcServicePriceTx(tx, id);

      return inserted;
    });

    return NextResponse.json({ ok: true, part });
  } catch (e) {
    const msg = (e as Error)?.message || "";
    if (/Sin stock suficiente/i.test(msg)) {
      return NextResponse.json({ error: msg }, { status: 409 });
    }
    if (/no encontrado/i.test(msg)) {
      return NextResponse.json({ error: msg }, { status: 404 });
    }
    throw e;
  }
}

/** Quita un repuesto de la orden: repone stock + kardex inverso + evento. */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { id } = await params;
  const partId = new URL(request.url).searchParams.get("partId") || "";
  if (!/^[0-9a-f-]{36}$/i.test(id) || !/^[0-9a-f-]{36}$/i.test(partId)) {
    return NextResponse.json({ error: "ID inválido" }, { status: 400 });
  }

  try {
    const removed = await withTransaction(async (tx: Tx) => {
      const part = await tx.queryOne<{
        id: string; product_id: string | null; variant_id: string | null; name: string | null; qty: number;
      }>(
        `SELECT id, product_id, variant_id, name, qty FROM work_order_parts
         WHERE id = $1 AND vendor_id = $2 AND booking_id = $3 LIMIT 1`,
        [partId, vendor.id, id]
      );
      if (!part) throw new Error("Repuesto no encontrado");

      // work_order_parts.qty es numeric(10,2) → pg lo devuelve como string
      // ("1.00"). products.stock / product_variants.stock son integer y
      // Postgres explota con "invalid input syntax for type integer: 1.00"
      // al reponer con el string crudo (misma clase de bug que import-quote).
      // Misma regla que el POST e import-quote: unidades enteras, así la
      // reposición es simétrica al descuento original.
      const stockQty = Math.max(1, Math.round(Number(part.qty) || 0));

      if (part.variant_id) {
        await tx.queryVoid(`UPDATE product_variants SET stock = stock + $1 WHERE id = $2`, [stockQty, part.variant_id]);
      } else if (part.product_id) {
        await tx.queryVoid(
          `UPDATE products SET stock = stock + $1 WHERE id = $2 AND stock_control = true`,
          [stockQty, part.product_id]
        );
      }

      await logStockMovement(tx, {
        vendorId: vendor.id,
        product_id: part.product_id,
        variant_id: part.variant_id,
        qty_delta: stockQty,
        reason: "orden",
        ref_booking: id,
      });

      await addBookingEventTx(tx, {
        vendorId: vendor.id,
        bookingId: id,
        kind: "parts",
        message: `Repuesto quitado: ${part.name || "repuesto"} × ${part.qty}`,
      });

      await tx.queryVoid(`DELETE FROM work_order_parts WHERE id = $1 AND vendor_id = $2`, [partId, vendor.id]);

      // El total a cobrar sigue a la cuenta: sin el repuesto, baja solo.
      await recalcServicePriceTx(tx, id);

      return part;
    });
    return NextResponse.json({ ok: true, removed: removed?.id || null });
  } catch (e) {
    const msg = (e as Error)?.message || "";
    if (/no encontrado/i.test(msg)) return NextResponse.json({ error: msg }, { status: 404 });
    throw e;
  }
}
