import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryOne } from "@/lib/db";
import { NextResponse } from "next/server";
import { canSellGiftcards } from "@/lib/giftcards";

/**
 * Resumen de tarjetas para el tab Tarjetas: emitidas, canjeadas, saldo
 * pendiente y vendidas por pedido (circuito automático F2).
 */
export async function GET(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (!canSellGiftcards(gate.vendor.vertical)) {
    return NextResponse.json({ total: 0, active: 0, issued: 0, redeemed: 0, outstanding: 0, soldViaOrders: 0, soldViaOrdersCount: 0 });
  }
  try {
    const row = await queryOne<{
      total: string; active: string; issued: string; redeemed: string; outstanding: string;
    }>(
      `SELECT COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status = 'active') AS active,
        COALESCE(SUM(amount), 0) AS issued,
        COALESCE(SUM(amount - balance), 0) AS redeemed,
        COALESCE(SUM(CASE WHEN status = 'active' THEN balance ELSE 0 END), 0) AS outstanding
       FROM giftcards WHERE vendor_id = $1`,
      [gate.vendor.id]
    );
    // Vendidas por pedido (emisión automática F2). Tolerante a migración
    // sin aplicar: sin order_id no hay vínculo posible.
    const sold = await queryOne<{ s: string; c: string }>(
      `SELECT COALESCE(SUM(amount), 0) AS s, COUNT(*) AS c FROM giftcards
       WHERE vendor_id = $1 AND order_id IS NOT NULL`,
      [gate.vendor.id]
    ).catch(() => null);
    return NextResponse.json({
      total: Number(row?.total) || 0,
      active: Number(row?.active) || 0,
      issued: Math.round(Number(row?.issued) || 0),
      redeemed: Math.round(Number(row?.redeemed) || 0),
      outstanding: Math.round(Number(row?.outstanding) || 0),
      soldViaOrders: Math.round(Number(sold?.s) || 0),
      soldViaOrdersCount: Number(sold?.c) || 0,
    });
  } catch {
    return NextResponse.json({ migrationMissing: true }, { status: 503 });
  }
}
