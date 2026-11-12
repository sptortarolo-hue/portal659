import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryOne, queryMany, withTransaction } from "@/lib/db";
import { getOpenShift } from "@/lib/cash-closing";
import { hasOrderPaymentsTable, insertOrderPayments, isSplitMethod, type SplitMethod } from "@/lib/order-payments";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Estado de pagos parciales de una mesa: total, pagado, pendiente y lista. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await gateRequest(request, { allowStaff: true });
  if (!gate.ok) return gateError(gate);
  if (!gate.plan.can("mesas")) {
    return NextResponse.json({ error: "Las mesas forman parte del plan Gestión integral" }, { status: 403 });
  }
  const { id } = await params;

  const table = await queryOne<{ id: string }>(
    `SELECT id FROM tables WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
    [id, gate.vendor.id]
  );
  if (!table) return NextResponse.json({ error: "Mesa no encontrada" }, { status: 404 });

  const orders = await queryMany<{ total: number }>(
    `SELECT total FROM orders WHERE vendor_id = $1 AND table_id = $2 AND closed_at IS NULL AND status <> 'cancelled'`,
    [gate.vendor.id, id]
  );
  const total = (orders || []).reduce((s, o) => s + (Number(o.total) || 0), 0);

  type ItemPayment = {
    id: string;
    amount: number;
    payment_method: string;
    kind: string;
    created_at: string;
    items: { orderId: string; lineIndex: number; qty: number }[] | null;
  };

  let payments: ItemPayment[] = [];
  try {
    payments = await queryMany<ItemPayment>(
      `SELECT id, amount, payment_method, kind, created_at, items FROM table_payments WHERE vendor_id = $1 AND table_id = $2 ORDER BY created_at ASC`,
      [gate.vendor.id, id]
    );
  } catch {
    payments = [];
  }
  const paid = (payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const pending = Math.max(0, Math.round((total - paid) * 100) / 100);

  return NextResponse.json({
    total: Math.round(total * 100) / 100,
    paid: Math.round(paid * 100) / 100,
    pending,
    payments: payments || [],
  });
}

/** Registra un pago parcial (por monto o por ítems) sobre la cuenta de la mesa. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await gateRequest(request, { allowStaff: true });
  if (!gate.ok) return gateError(gate);
  if (!gate.plan.can("mesas")) {
    return NextResponse.json({ error: "Las mesas forman parte del plan Gestión integral" }, { status: 403 });
  }
  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  const table = await queryOne<{ id: string; status: string }>(
    `SELECT id, status FROM tables WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
    [id, gate.vendor.id]
  );
  if (!table) return NextResponse.json({ error: "Mesa no encontrada" }, { status: 404 });
  if (table.status !== "ocupada") {
    return NextResponse.json({ error: "La mesa está libre" }, { status: 400 });
  }

  const paymentMethod = ["efectivo", "transferencia", "tarjeta", "mixto", "whatsapp"].includes(body?.paymentMethod)
    ? body.paymentMethod
    : "efectivo";

  const mode = body?.mode === "items" ? "items" : "amount";
  let amount = Number(body?.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "Indicá un monto mayor a 0" }, { status: 400 });
  }
  amount = Math.round(amount * 100) / 100;

  // Total pendiente actual
  const orders = await queryMany<{ total: number }>(
    `SELECT total FROM orders WHERE vendor_id = $1 AND table_id = $2 AND closed_at IS NULL AND status <> 'cancelled'`,
    [gate.vendor.id, id]
  );
  const total = (orders || []).reduce((s, o) => s + (Number(o.total) || 0), 0);

  let paid = 0;
  try {
    const ps = await queryMany<{ amount: number }>(
      `SELECT amount FROM table_payments WHERE vendor_id = $1 AND table_id = $2`,
      [gate.vendor.id, id]
    );
    paid = (ps || []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
  } catch {
    paid = 0;
  }
  const pending = Math.max(0, Math.round((total - paid) * 100) / 100);

  if (amount > pending + 0.01) {
    return NextResponse.json(
      { error: `El monto supera el saldo pendiente ($${pending.toLocaleString("es-AR")})`, code: "exceeds_pending" },
      { status: 400 }
    );
  }

  const items = Array.isArray(body?.items) ? body.items : [];
  const userId = gate.previewSession ? null : gate.user?.id ?? null;

  let payment;
  try {
    payment = await queryOne<{ id: string; created_at: string }>(
      `INSERT INTO table_payments (vendor_id, table_id, amount, payment_method, kind, items, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, created_at`,
      [gate.vendor.id, id, amount, paymentMethod, mode, JSON.stringify(items), userId]
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (/relation .*table_payments.* does not exist/i.test(msg)) {
      return NextResponse.json(
        { error: "Falta aplicar la migración de cobro parcial en la base de datos", code: "migration_missing" },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: "No se pudo registrar el pago" }, { status: 500 });
  }

  // Movimiento de caja si es efectivo y hay turno abierto.
  // Con la migración de order_payments aplicada, el parcial queda registrado
  // en `order_payments` (kind='parcial', contado por su propia fecha) y NO
  // se duplica como movimiento: antes la plata entraba dos veces al cierre
  // (movimiento + la venta del cierre de mesa).
  const paymentsTable = await hasOrderPaymentsTable();
  if (paymentMethod === "efectivo" && !paymentsTable) {
    try {
      const shift = await getOpenShift(gate.vendor.id);
      if (shift) {
        await queryOne(
          `INSERT INTO cash_movements (vendor_id, shift_id, kind, amount, reason, created_by)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [gate.vendor.id, shift.id, "ingreso", amount, `Cobro parcial mesa`, userId]
        ).catch(() => null);
      }
    } catch {
      /* best-effort */
    }
  }

  // Desglose por medio: el parcial de mesa es su propia fila de pago (la
  // plata entró al cajón en este momento, aunque la mesa cierre después).
  // Guarda de doble envío: si el mismo monto/medio se registró en los últimos
  // 2 minutos (doble tap o reintento de red), no se duplica la fila.
  if (paymentsTable && isSplitMethod(paymentMethod)) {
    try {
      const dup = await queryOne<{ id: string }>(
        `SELECT id FROM order_payments
         WHERE vendor_id = $1 AND table_id = $2 AND kind = 'parcial'
           AND method = $3 AND amount = $4 AND created_at > now() - interval '2 minutes'
         LIMIT 1`,
        [gate.vendor.id, id, paymentMethod, amount]
      ).catch(() => null);
      if (!dup) {
        await withTransaction(async (tx) =>
          insertOrderPayments(tx, {
            vendorId: gate.vendor.id,
            tableId: id,
            kind: "parcial",
            payments: [{ method: paymentMethod as SplitMethod, amount, tendered: null, bankAccountId: body?.bankAccountId || null }],
            createdBy: userId,
            replace: false,
          })
        );
      }
    } catch {
      /* best-effort: si falla, el table_payment ya quedó registrado */
    }
  }

  const newPaid = Math.round((paid + amount) * 100) / 100;
  const newPending = Math.max(0, Math.round((total - newPaid) * 100) / 100);

  return NextResponse.json({
    ok: true,
    payment: { id: payment?.id, amount, payment_method: paymentMethod, kind: mode, created_at: payment?.created_at },
    total: Math.round(total * 100) / 100,
    paid: newPaid,
    pending: newPending,
  });
}