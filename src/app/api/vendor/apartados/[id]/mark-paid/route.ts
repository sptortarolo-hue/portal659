import { gateRequest } from "@/lib/subscription-gate";
import { queryOne } from "@/lib/db";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Marca cobros manuales de un apartado (efectivo/transferencia en el local):
 * - kind=deposit: la seña quedó cobrada.
 * - kind=remainder: el saldo quedó cobrado → el pedido queda totalmente pago
 *   (payment_status='paid', paid_at) pero sigue en su estado actual: el
 *   comercio lo acepta con el flujo normal y dispara sus notificaciones.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await gateRequest(request);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const kind = (body as { kind?: unknown }).kind;

  const order = await queryOne<{
    id: string;
    vendor_id: string;
    status: string;
    is_apartado: boolean | null;
    deposit_status: string | null;
    remainder_paid_at: string | null;
  }>(
    `SELECT id, vendor_id, status, is_apartado, deposit_status, remainder_paid_at
     FROM orders WHERE id = $1 LIMIT 1`,
    [id]
  ).catch(() => undefined);
  if (!order) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  if (order.vendor_id !== gate.vendor.id) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  if (!order.is_apartado) {
    return NextResponse.json({ error: "No es un apartado." }, { status: 400 });
  }
  if (order.status === "cancelled") {
    return NextResponse.json({ error: "El apartado está cancelado." }, { status: 400 });
  }

  if (kind === "deposit") {
    if (order.deposit_status === "paid") {
      return NextResponse.json({ error: "La seña ya está cobrada." }, { status: 400 });
    }
    const updated = await queryOne<Record<string, unknown>>(
      `UPDATE orders SET deposit_status = 'paid', deposit_paid_at = now(), updated_at = now() WHERE id = $1 RETURNING *`,
      [id]
    ).catch(() => null);
    if (!updated) {
      return NextResponse.json(
        { error: "Falta aplicar la migración migrate-apartado.sql en la base." },
        { status: 400 }
      );
    }
    return NextResponse.json({ order: updated });
  }

  if (kind === "remainder") {
    if (order.deposit_status !== "paid") {
      return NextResponse.json({ error: "Primero hay que cobrar la seña." }, { status: 400 });
    }
    if (order.remainder_paid_at) {
      return NextResponse.json({ error: "El saldo ya está cobrado." }, { status: 400 });
    }
    const updated = await queryOne<Record<string, unknown>>(
      `UPDATE orders SET remainder_paid_at = now(), payment_status = 'paid', paid_at = now(), updated_at = now()
       WHERE id = $1 RETURNING *`,
      [id]
    ).catch(() => null);
    if (!updated) {
      return NextResponse.json(
        { error: "Falta aplicar la migración migrate-apartado.sql en la base." },
        { status: 400 }
      );
    }
    return NextResponse.json({ order: updated });
  }

  return NextResponse.json({ error: "kind inválido (deposit | remainder)." }, { status: 400 });
}
