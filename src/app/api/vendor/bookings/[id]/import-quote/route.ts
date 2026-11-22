import { getVendorByRequest } from "@/lib/vendor-utils";
import { hasTable, queryMany, queryOne, withTransaction, type Tx } from "@/lib/db";
import { logStockMovement } from "@/lib/stock-ledger";
import { addBookingEventTx } from "@/lib/booking-events";
import { recalcServicePriceTx } from "@/lib/vendor-booking";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Sincroniza la cuenta de la orden con el presupuesto vinculado: la cuenta
 * queda IGUAL al presupuesto (reemplaza, no suma). Borra las partidas
 * actuales reponiendo stock (misma regla de unidades enteras que el DELETE
 * de repuestos) y carga las partidas del presupuesto desde cero
 * (repuestos/material → work_order_parts, mano de obra → labor_amount); un
 * presupuesto a precio cerrado pasa como mano de obra. El "Total a cobrar"
 * (service_price) se recalcula como suma de la cuenta.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const vendorRow = await queryOne<{ vertical: string | null }>(
    `SELECT vertical FROM vendors WHERE id = $1 LIMIT 1`,
    [vendor.id]
  );
  const vertical = vendorRow?.vertical || "";
  if (vertical !== "taller" && vertical !== "servicio" && vertical !== "estetica") {
    return NextResponse.json({ error: "Solo para talleres/servicios/estética" }, { status: 403 });
  }

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "ID inválido" }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const quoteId = typeof body.quote_id === "string" ? body.quote_id : "";
  if (!/^[0-9a-f-]{36}$/i.test(quoteId)) {
    return NextResponse.json({ error: "quote_id inválido" }, { status: 400 });
  }

  const hasParts = await hasTable({ query: <T extends { [k: string]: unknown }>(sql: string, p?: unknown[]) => queryMany<T>(sql, p) }, "work_order_parts").catch(() => false);
  const hasQuoteItems = await hasTable({ query: <T extends { [k: string]: unknown }>(sql: string, p?: unknown[]) => queryMany<T>(sql, p) }, "quote_items").catch(() => false);
  if (!hasParts || !hasQuoteItems) {
    return NextResponse.json({ error: "Faltan migraciones (taller v3 / service manual)" }, { status: 503 });
  }

  try {
    await withTransaction(async (tx: Tx) => {
      const booking = await tx.queryOne<{ id: string; vendor_id: string; service_price: number | null; labor_amount: number | null }>(
        `SELECT id, vendor_id, service_price, labor_amount FROM bookings WHERE id = $1 LIMIT 1`,
        [id]
      );
      if (!booking || booking.vendor_id !== vendor.id) throw new Error("No autorizado");

      const quote = await tx.queryOne<{ id: string; vendor_id: string; quoted_price: number | null }>(
        `SELECT id, vendor_id, quoted_price FROM quotes WHERE id = $1 LIMIT 1`,
        [quoteId]
      );
      if (!quote || quote.vendor_id !== vendor.id) throw new Error("Presupuesto no encontrado");

      const items = await tx.query<{ kind: string; description: string; qty: number; unit_price: number; product_id: string | null; variant_id: string | null }>(
        `SELECT kind, description, qty, unit_price, product_id, variant_id FROM quote_items WHERE quote_id = $1 ORDER BY position ASC`,
        [quoteId]
      );
      const quotePrice = quote.quoted_price != null ? Number(quote.quoted_price) : null;

      // REEMPLAZAR (no sumar): la cuenta queda igual al presupuesto. Primero
      // se borran las partidas actuales reponiendo stock (misma regla de
      // unidades enteras que el DELETE de repuestos) y kardex inverso; después
      // se cargan las del presupuesto desde cero.
      const current = await tx.query<{ id: string; product_id: string | null; variant_id: string | null; name: string | null; qty: number }>(
        `SELECT id, product_id, variant_id, name, qty FROM work_order_parts WHERE booking_id = $1 AND vendor_id = $2`,
        [id, vendor.id]
      );
      for (const old of current) {
        const stockQty = Math.max(1, Math.round(Number(old.qty) || 0));
        if (old.variant_id) {
          await tx.queryVoid(`UPDATE product_variants SET stock = stock + $1 WHERE id = $2`, [stockQty, old.variant_id]);
        } else if (old.product_id) {
          await tx.queryVoid(
            `UPDATE products SET stock = stock + $1 WHERE id = $2 AND stock_control = true`,
            [stockQty, old.product_id]
          );
        } else {
          continue; // material suelto: nunca movió stock
        }
        await logStockMovement(tx, {
          vendorId: vendor.id,
          product_id: old.product_id,
          variant_id: old.variant_id,
          qty_delta: stockQty,
          reason: "orden",
          ref_booking: id,
        });
      }
      if (current.length > 0) {
        await tx.queryVoid(`DELETE FROM work_order_parts WHERE booking_id = $1 AND vendor_id = $2`, [id, vendor.id]);
      }

      let laborTotal = 0;
      for (const it of items) {
        if (it.kind === "labor") {
          laborTotal += Number(it.qty) * Number(it.unit_price);
          continue;
        }
        // repuesto o material
        if (it.kind === "repuesto" && it.product_id) {
          // quote_items.qty es numeric → pg lo devuelve como string ("1.00"),
          // y stock (integer) / stock_ledger.qty_delta no lo aceptan: Postgres
          // explota con "invalid input syntax for type integer: 1.00".
          // El stock de repuestos se descuenta por unidades enteras.
          const stockQty = Math.max(1, Math.round(Number(it.qty) || 1));
          const prod = await tx.queryOne<{ name: string; price: number | null; promo_price: number | null; stock_control: boolean | null; stock: number | null; cost_last: number | null }>(
            `SELECT name, price, promo_price, stock_control, stock, cost_last FROM products WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
            [it.product_id, vendor.id]
          );
          if (prod) {
            if (prod.stock_control === true) {
              const rows = await tx.query<{ id: string }>(
                `UPDATE products SET stock = stock - $1 WHERE id = $2 AND stock_control = true AND COALESCE(stock, 0) >= $1 RETURNING id`,
                [stockQty, it.product_id]
              );
              if (rows.length === 0) throw new Error(`Sin stock suficiente de "${prod.name}"`);
            }
            const unitPrice = Number(it.unit_price) > 0 ? Number(it.unit_price) : Number(prod.promo_price ?? prod.price ?? 0);
            // cost_last estricto: sin costo la fila entra en 0 (el margen de la
            // orden queda incompleto hasta cargarlo). Nunca cae a cost_avg.
            const unitCost = prod.cost_last != null && Number.isFinite(Number(prod.cost_last)) ? Number(prod.cost_last) : 0;
            await tx.queryVoid(
              `INSERT INTO work_order_parts (vendor_id, booking_id, product_id, variant_id, name, qty, unit_cost, unit_price, created_by)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL)`,
              [vendor.id, id, it.product_id, it.variant_id, prod.name, Number(it.qty), unitCost, unitPrice]
            );
            await logStockMovement(tx, {
              vendorId: vendor.id,
              product_id: it.product_id,
              variant_id: it.variant_id,
              qty_delta: -stockQty,
              reason: "orden",
              ref_booking: id,
            });
          } else {
            await tx.queryVoid(
              `INSERT INTO work_order_parts (vendor_id, booking_id, product_id, variant_id, name, qty, unit_cost, unit_price, created_by)
               VALUES ($1, $2, NULL, NULL, $3, $4, 0, $5, NULL)`,
              [vendor.id, id, it.description, Number(it.qty), Number(it.unit_price)]
            );
          }
        } else {
          // material libre
          await tx.queryVoid(
            `INSERT INTO work_order_parts (vendor_id, booking_id, product_id, variant_id, name, qty, unit_cost, unit_price, created_by)
             VALUES ($1, $2, NULL, NULL, $3, $4, 0, $5, NULL)`,
            [vendor.id, id, it.description, Number(it.qty), Number(it.unit_price)]
          );
        }
      }
      // Mano de obra: la del presupuesto manda. Si el presupuesto es a precio
      // cerrado (sin partidas), pasa como mano de obra para que la cuenta
      // refleje el precio que aceptó el cliente. Si trae repuestos pero
      // ninguna partida de mano de obra, se conserva la cargada en la orden.
      if (laborTotal > 0) {
        await tx.queryVoid(`UPDATE bookings SET labor_amount = $1 WHERE id = $2`, [laborTotal, id]);
      } else if (items.length === 0 && quotePrice != null && quotePrice > 0) {
        await tx.queryVoid(`UPDATE bookings SET labor_amount = $1 WHERE id = $2`, [quotePrice, id]);
      }

      // El total a cobrar es SIEMPRE la suma de la cuenta (partidas + mano de
      // obra): se recalcula acá, nunca se escribe a mano.
      await recalcServicePriceTx(tx, id);

      await tx.queryVoid(`UPDATE bookings SET quote_id = $1 WHERE id = $2`, [quoteId, id]);

      await addBookingEventTx(tx, {
        vendorId: vendor.id,
        bookingId: id,
        kind: "quote_linked",
        message: `Cuenta sincronizada desde el presupuesto (reemplazada): ${items.length} partida${items.length === 1 ? "" : "s"}${current.length > 0 ? `, ${current.length} anteriores repuestas` : ""}`,
      });
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = (e as Error)?.message || "No se pudo importar";
    if (/Sin stock suficiente/i.test(msg)) return NextResponse.json({ error: msg }, { status: 409 });
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
