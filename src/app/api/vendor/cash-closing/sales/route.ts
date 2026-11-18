import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryMany, queryOne } from "@/lib/db";
import { NextResponse } from "next/server";

export type ClosingSale = {
  id: string;
  order_number: number | null;
  total: number;
  payment_method: string | null;
  paid_at: string;
  status: string | null;
  method: string | null;
  is_direct: boolean;
  items_summary: string;
  items_count: number;
};

function fmtItems(items: unknown): { summary: string; count: number } {
  const list = Array.isArray(items) ? items : [];
  const parts: string[] = [];
  let count = 0;
  for (const raw of list) {
    const it = raw as { name?: string; qty?: number; unit?: string; pack_size?: number };
    const qty = Number(it?.qty) || 0;
    count += qty > 0 ? qty : 1;
    if (parts.length < 3 && it?.name) {
      const q = qty > 0 ? `${qty}× ` : "";
      parts.push(`${q}${it.name}`);
    }
  }
  return {
    summary: parts.join(" · ") + (list.length > 3 ? ` +${list.length - 3}` : ""),
    count,
  };
}

/**
 * Ventas cobradas dentro del período de un cierre. Las usa el ajuste
 * post-cierre para elegir la venta que se registró de más y anularla (con
 * devolución de stock). Se filtra por `paid_at` (cuándo entró la plata), no
 * por `created_at`, que es lo que el Z tomó en cuenta.
 */
export async function GET(request: Request) {
  const gate = await gateRequest(request, { allowStaff: true });
  if (!gate.ok) return gateError(gate);
  if (!gate.plan.can("pos")) {
    return NextResponse.json(
      { error: "La caja forma parte del plan Gestión integral", code: "plan_limit" },
      { status: 403 }
    );
  }

  const closingId = new URL(request.url).searchParams.get("closingId") || "";
  if (!closingId) {
    return NextResponse.json({ error: "Indicá el cierre" }, { status: 400 });
  }

  const closing = await queryOne<{ id: string; since: string; closed_at: string }>(
    `SELECT id, since, closed_at FROM cash_closings
     WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
    [closingId, gate.vendor.id]
  ).catch(() => null);
  if (!closing) {
    return NextResponse.json({ error: "Cierre no encontrado" }, { status: 404 });
  }

  const rows = await queryMany<Record<string, any>>(
    `SELECT id, pickup_number, total, payment_method, paid_at::text AS paid_at,
            status, method, items,
            CASE WHEN EXISTS (
              SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'is_direct'
            ) THEN is_direct ELSE false END AS is_direct
     FROM orders
     WHERE vendor_id = $1
       AND paid_at IS NOT NULL
       AND paid_at >= $2
       AND paid_at <= $3
       AND is_preview = false
       AND status <> 'cancelled'
     ORDER BY paid_at DESC
     LIMIT 200`,
    [gate.vendor.id, closing.since, closing.closed_at]
  ).catch(async () => {
    // Sin columna is_direct (migración pendiente): se omite el flag.
    return queryMany<Record<string, any>>(
      `SELECT id, pickup_number, total, payment_method, paid_at::text AS paid_at,
              status, method, items
       FROM orders
       WHERE vendor_id = $1
         AND paid_at IS NOT NULL
         AND paid_at >= $2
         AND paid_at <= $3
         AND is_preview = false
         AND status <> 'cancelled'
       ORDER BY paid_at DESC
       LIMIT 200`,
      [gate.vendor.id, closing.since, closing.closed_at]
    );
  });

  const sales: ClosingSale[] = (rows || []).map((r) => {
    const { summary, count } = fmtItems(r.items);
    return {
      id: String(r.id),
      order_number: r.pickup_number != null ? Number(r.pickup_number) : null,
      total: Math.round((Number(r.total) || 0) * 100) / 100,
      payment_method: r.payment_method || null,
      paid_at: new Date(r.paid_at).toISOString(),
      status: r.status || null,
      method: r.method || null,
      is_direct: r.is_direct === true,
      items_summary: summary,
      items_count: count,
    };
  });

  return NextResponse.json({
    closing: {
      id: closing.id,
      since: closing.since,
      closed_at: closing.closed_at,
    },
    sales,
  });
}
