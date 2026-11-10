import { getVendorByRequest } from "@/lib/vendor-utils";
import { hasTable, queryMany, queryOne, withTransaction, type Tx } from "@/lib/db";
import { logStockMovement } from "@/lib/stock-ledger";
import { addBookingEventTx } from "@/lib/booking-events";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Importa un presupuesto vinculado a la cuenta de la orden: copia las
 * partidas (repuestos/material → work_order_parts, mano de obra → labor_amount)
 * y fija service_price = quoted_price. Idempotente: si ya hay partidas, no
 * duplica; solo completa lo que falte.
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

      const existingParts = await tx.query<{ id: string }>(
        `SELECT id FROM work_order_parts WHERE booking_id = $1 LIMIT 1`,
        [id]
      );

      // Importar repuestos/material solo si no hay partidas aún.
      if (existingParts.length === 0) {
        let laborTotal = 0;
        for (const it of items) {
          if (it.kind === "labor") {
            laborTotal += Number(it.qty) * Number(it.unit_price);
            continue;
          }
          // repuesto o material
          if (it.kind === "repuesto" && it.product_id) {
            // descontar stock si controla
            const prod = await tx.queryOne<{ name: string; price: number | null; promo_price: number | null; stock_control: boolean | null; stock: number | null; cost_last: number | null; cost_avg: number | null }>(
              `SELECT name, price, promo_price, stock_control, stock, cost_last, cost_avg FROM products WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
              [it.product_id, vendor.id]
            );
            if (prod) {
              if (prod.stock_control === true) {
                const rows = await tx.query<{ id: string }>(
                  `UPDATE products SET stock = stock - $1 WHERE id = $2 AND stock_control = true AND COALESCE(stock, 0) >= $1 RETURNING id`,
                  [it.qty, it.product_id]
                );
                if (rows.length === 0) throw new Error(`Sin stock suficiente de "${prod.name}"`);
              }
              const unitPrice = Number(it.unit_price) > 0 ? Number(it.unit_price) : Number(prod.promo_price ?? prod.price ?? 0);
              const unitCost = Number(prod.cost_last ?? prod.cost_avg ?? 0);
              await tx.queryVoid(
                `INSERT INTO work_order_parts (vendor_id, booking_id, product_id, variant_id, name, qty, unit_cost, unit_price, created_by)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL)`,
                [vendor.id, id, it.product_id, it.variant_id, prod.name, it.qty, unitCost, unitPrice]
              );
              await logStockMovement(tx, {
                vendorId: vendor.id,
                product_id: it.product_id,
                variant_id: it.variant_id,
                qty_delta: -it.qty,
                reason: "orden",
                ref_booking: id,
              });
            } else {
              // producto no encontrado: cargar como material libre
              await tx.queryVoid(
                `INSERT INTO work_order_parts (vendor_id, booking_id, product_id, variant_id, name, qty, unit_cost, unit_price, created_by)
                 VALUES ($1, $2, NULL, NULL, $3, $4, 0, $5, NULL)`,
                [vendor.id, id, it.description, it.qty, it.unit_price]
              );
            }
          } else {
            // material libre
            await tx.queryVoid(
              `INSERT INTO work_order_parts (vendor_id, booking_id, product_id, variant_id, name, qty, unit_cost, unit_price, created_by)
               VALUES ($1, $2, NULL, NULL, $3, $4, 0, $5, NULL)`,
              [vendor.id, id, it.description, it.qty, it.unit_price]
            );
          }
        }
        // labor_amount: sumar labor si no había
        if (laborTotal > 0 && (booking.labor_amount == null || Number(booking.labor_amount) === 0)) {
          await tx.queryVoid(`UPDATE bookings SET labor_amount = $1 WHERE id = $2`, [laborTotal, id]);
        }
      }

      // service_price: sembrar si vacío
      if (booking.service_price == null || Number(booking.service_price) === 0) {
        const price = quote.quoted_price != null ? Number(quote.quoted_price) : null;
        if (price != null && price > 0) {
          await tx.queryVoid(`UPDATE bookings SET service_price = $1 WHERE id = $2`, [price, id]);
        }
      }

      await tx.queryVoid(`UPDATE bookings SET quote_id = $1 WHERE id = $2`, [quoteId, id]);

      await addBookingEventTx(tx, {
        vendorId: vendor.id,
        bookingId: id,
        kind: "quote_linked",
        message: `Presupuesto importado a la cuenta (${items.length} partida${items.length === 1 ? "" : "s"})`,
      });
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = (e as Error)?.message || "No se pudo importar";
    if (/Sin stock suficiente/i.test(msg)) return NextResponse.json({ error: msg }, { status: 409 });
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
