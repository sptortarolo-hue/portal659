import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryOne, queryMany, withTransaction } from "@/lib/db";
import { cashDiscountForItems, normalizeCashPct } from "@/lib/cash-discount";
import { NextResponse } from "next/server";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (!gate.plan.can("mesas")) {
    return NextResponse.json({ error: "Las mesas forman parte del plan Gestión integral" }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json();
  const paymentMethod = ["efectivo", "transferencia", "tarjeta", "mixto", "whatsapp"].includes(body?.paymentMethod)
    ? body.paymentMethod
    : "efectivo";

  const table = await queryOne<Record<string, any>>(
    `SELECT id, name, status FROM tables WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
    [id, gate.vendor.id]
  );

  if (!table) return NextResponse.json({ error: "Mesa no encontrada" }, { status: 404 });
  if (table.status !== "ocupada") {
    return NextResponse.json({ error: "La mesa está libre" }, { status: 400 });
  }

  const orders = await queryMany<Record<string, any>>(
    `SELECT id, total, status, paid_at, items FROM orders WHERE vendor_id = $1 AND table_id = $2 AND status NOT IN ('cancelled', 'completed')`,
    [gate.vendor.id, table.id]
  );

  const list = orders || [];

  // Descuento en efectivo al cerrar: la precuenta lo anuncia y acá se aplica
  // de verdad, con la misma fórmula (ítems con promo excluida no reciben).
  const cashPct = paymentMethod === "efectivo" ? normalizeCashPct((gate.vendor as any).cash_discount_pct) : 0;
  let cashDiscountTotal = 0;
  const perOrder = new Map<string, { cashPct: number; cashDiscount: number; total: number }>();

  if (cashPct > 0 && list.length > 0) {
    const ids = new Set<string>();
    for (const o of list) {
      for (const i of (Array.isArray(o.items) ? o.items : [])) {
        if (i?.product_id) ids.add(String(i.product_id));
      }
    }
    const prows = ids.size
      ? await queryMany<{ id: string; promo_price: number | null; cash_discount_excluded: boolean | null }>(
          `SELECT id, promo_price, cash_discount_excluded FROM products WHERE vendor_id = $1 AND id = ANY($2)`,
          [gate.vendor.id, [...ids]]
        )
      : [];
    const pmap = new Map((prows || []).map((p) => [p.id, p]));
    for (const o of list) {
      const items = Array.isArray(o.items) ? o.items : [];
      const { cashDiscount } = cashDiscountForItems(
        items.map((i: any) => {
          const p = i?.product_id ? pmap.get(String(i.product_id)) : undefined;
          return {
            unitPrice: Number(i?.price) || 0,
            qty: Number(i?.qty) || 1,
            hasPromo: p ? p.promo_price != null : false,
            excluded: p?.cash_discount_excluded ?? null,
          };
        }),
        cashPct
      );
      if (cashDiscount > 0) {
        const newTotal = Math.max(0, Math.round((Number(o.total) - cashDiscount) * 100) / 100);
        perOrder.set(o.id, { cashPct, cashDiscount, total: newTotal });
        cashDiscountTotal += cashDiscount;
      }
    }
  }

  const total = list.reduce((s: number, o: any) => s + Number(o.total), 0) - cashDiscountTotal;
  const now = new Date().toISOString();

  await withTransaction(async (tx) => {
    // Descuento por orden primero (cash_pct/cash_discount/total real cobrado),
    // después el cierre: todo en la misma transacción.
    for (const [orderId, d] of perOrder) {
      await tx.query(
        `UPDATE orders SET cash_pct = $1, cash_discount = $2, total = $3 WHERE id = $4`,
        [d.cashPct, d.cashDiscount, d.total, orderId]
      );
    }

    const toUpdate = list.filter((o) => o.status !== "completed");
    if (toUpdate.length > 0) {
      await tx.query(
        `UPDATE orders SET status = 'completed', paid_at = $1, closed_at = $1 WHERE id = ANY($2)`,
        [now, toUpdate.map((o) => o.id)]
      );
    } else {
      // ya estaban completadas: solo registrar el cierre de la mesa
      await tx.query(
        `UPDATE orders SET paid_at = $1 WHERE table_id = $2 AND id = ANY($3)`,
        [now, table.id, list.map((o) => o.id)]
      );
    }

    await tx.query(`UPDATE tables SET status = 'libre' WHERE id = $1`, [table.id]);
  });

  return NextResponse.json({
    ok: true,
    table: { ...table, status: "libre" },
    total: Math.round(total * 100) / 100,
    cashDiscount: cashDiscountTotal > 0 ? Math.round(cashDiscountTotal * 100) / 100 : 0,
    cashPct: cashPct || 0,
    ordersClosed: list.length,
    paymentMethod,
  });
}