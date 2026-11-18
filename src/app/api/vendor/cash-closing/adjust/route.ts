import { gateRequest, gateError } from "@/lib/subscription-gate";
import { hasColumn, hasTable, queryOne, withTransaction } from "@/lib/db";
import {
  applyClosingAdjustments,
  listClosingAdjustments,
  summarizeAdjustments,
  type CashAdjustmentKind,
} from "@/lib/cash-closing";
import { CASH_METHOD_LABELS } from "@/lib/cash-methods";
import { adjustStockForItems, type StockMove } from "@/lib/stock";
import { logStockMovement } from "@/lib/stock-ledger";
import { decrementCustomerFromOrder } from "@/lib/customers";
import type { OrderItem } from "@/types/database";
import { NextResponse } from "next/server";

const KINDS: CashAdjustmentKind[] = ["venta_faltante", "venta_duplicada", "otro"];

/** Marca interna: otro request canceló la venta entre el SELECT y el UPDATE. */
const ALREADY_CANCELLED = "__already_cancelled__";

function migrationMissing() {
  return NextResponse.json(
    {
      error:
        "Falta aplicar la migración de ajustes post-cierre en la base de datos (migrate-cash-adjustments.sql)",
      code: "migration_missing",
    },
    { status: 503 }
  );
}

function ordersMigrationMissing() {
  return NextResponse.json(
    {
      error:
        "Falta aplicar migrate-cash-adjustments-orders.sql (ajuste vinculado a la venta)",
      code: "migration_missing",
    },
    { status: 503 }
  );
}

/**
 * Cierre del comercio, tolerante a la migración de turnos (expected_cash).
 * Devuelve null si no existe o no es del comercio.
 */
async function fetchClosing(closingId: string, vendorId: string) {
  const base = `id, since, closed_at, gross_total, net_total, cash_declared,
                cash_difference, by_method`;
  const withExpected = await queryOne<Record<string, any>>(
    `SELECT ${base}, expected_cash FROM cash_closings
     WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
    [closingId, vendorId]
  ).catch(() => null);
  if (withExpected) return withExpected;
  return queryOne<Record<string, any>>(
    `SELECT ${base} FROM cash_closings
     WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
    [closingId, vendorId]
  ).catch(() => null);
}

/**
 * Ajustes post-cierre: corrige un Z ya cerrado cuando una venta quedó sin
 * registrar, se registró dos veces o se cargó con el medio de pago equivocado.
 * No reescribe el cierre ni mueve dinero: deja el ajuste firmado con motivo,
 * autor y fecha, y el panel suma los importes al neto y al esperado.
 *
 * GET  ?closingId=  → ajustes (de un cierre o de todo el comercio)
 * POST { closingId, amount, kind, method, direction?, reason }
 *      amount es la magnitud (positiva). El signo lo define `kind`:
 *      venta_faltante → +, venta_duplicada → −, otro → `direction` o el signo
 *      del monto recibido.
 * POST { closingId, orderId, reason }
 *      Anula una venta real del período: devuelve stock, anula giftcards,
 *      descuenta el CRM y registra un ajuste negativo por cada medio cobrado.
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
  if (closingId) {
    const closing = await queryOne<Record<string, unknown>>(
      `SELECT id FROM cash_closings WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
      [closingId, gate.vendor.id]
    ).catch(() => null);
    if (!closing) {
      return NextResponse.json({ error: "Cierre no encontrado" }, { status: 404 });
    }
  }
  const adjustments = await listClosingAdjustments(
    gate.vendor.id,
    closingId ? [closingId] : undefined
  );
  return NextResponse.json({ adjustments, totals: summarizeAdjustments(adjustments) });
}

export async function POST(request: Request) {
  const gate = await gateRequest(request, { allowStaff: true });
  if (!gate.ok) return gateError(gate);
  if (!gate.plan.can("pos")) {
    return NextResponse.json(
      { error: "La caja forma parte del plan Gestión integral", code: "plan_limit" },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const closingId = typeof body?.closingId === "string" ? body.closingId.trim() : "";
  if (!closingId) {
    return NextResponse.json({ error: "Indicá el cierre a ajustar" }, { status: 400 });
  }

  const closing = await fetchClosing(closingId, gate.vendor.id);
  if (!closing) {
    return NextResponse.json({ error: "Cierre no encontrado" }, { status: 404 });
  }

  const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 240) : "";

  // ── Venta duplicada / de más: se anula la venta REAL ───────────────────────
  // El ajuste negativo es la consecuencia; la causa se corrige en el pedido:
  // stock devuelto, kardex, giftcards anuladas y CRM descontado. Así la venta
  // deja de existir para Analytics (nunca existió) y el Z queda congelado.
  const orderId = typeof body?.orderId === "string" ? body.orderId.trim() : "";
  if (orderId) {
    // order_id es de migrate-cash-adjustments-orders.sql: sin esa columna el
    // ajuste no puede vincularse a la venta (y el stock no se repondría solo).
    const orderCol = await queryOne<{ e: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'cash_closing_adjustments'
           AND column_name = 'order_id'
       ) AS e`
    ).catch(() => null);
    if (orderCol?.e !== true) return ordersMigrationMissing();
    if (reason.length < 3) {
      return NextResponse.json(
        { error: "Escribí el motivo de la anulación (qué venta y por qué)" },
        { status: 400 }
      );
    }

    // is_preview puede no existir (migrate-preview.sql pendiente): se lee
    // con fallback para que el rechazo no se disfrade de "no encontrada".
    const order = await queryOne<Record<string, any>>(
      `SELECT id, pickup_number, total, status, channel, items,
              customer_phone, method, payment_method, paid_at,
              CASE WHEN EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'is_preview'
              ) THEN is_preview ELSE false END AS is_preview
       FROM orders WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
      [orderId, gate.vendor.id]
    ).catch(() => null);
    if (!order) {
      return NextResponse.json({ error: "Venta no encontrada" }, { status: 404 });
    }
    if (order.is_preview === true) {
      return NextResponse.json(
        { error: "Los pedidos de prueba no forman parte de la caja" },
        { status: 400 }
      );
    }
    if (order.status === "cancelled") {
      return NextResponse.json({ error: "La venta ya está anulada" }, { status: 409 });
    }
    if (!order.paid_at) {
      return NextResponse.json(
        { error: "La venta no está cobrada: no forma parte del cierre" },
        { status: 400 }
      );
    }
    // La venta tiene que pertenecer al período del cierre (paid_at entre el
    // arranque del período y el momento del cierre, con 1 min de tolerancia).
    const paidAtMs = new Date(order.paid_at).getTime();
    const sinceMs = closing.since ? new Date(closing.since).getTime() : 0;
    const closedMs = new Date(closing.closed_at).getTime();
    if (!Number.isFinite(paidAtMs) || paidAtMs < sinceMs - 1000 || paidAtMs > closedMs + 60_000) {
      return NextResponse.json(
        { error: "Esa venta no pertenece a este cierre" },
        { status: 400 }
      );
    }

    const dup = await queryOne<{ id: string }>(
      `SELECT id FROM cash_closing_adjustments
       WHERE order_id = $1 AND kind = 'venta_duplicada' LIMIT 1`,
      [orderId]
    ).catch(() => null);
    if (dup) {
      return NextResponse.json(
        { error: "Esa venta ya fue anulada desde un ajuste" },
        { status: 409 }
      );
    }

    const userId = gate.previewSession ? null : gate.user.id;
    let result: { orderNumber: number | null; methods: string[]; rows: number };
    try {
      result = await withTransaction(async (tx) => {
        const hasCancelReason = await hasColumn(tx, "orders", "cancel_reason");
        const hasCancelledBy = await hasColumn(tx, "orders", "cancelled_by");
        const hasUpdatedAt = await hasColumn(tx, "orders", "updated_at");

        const sets = ["status = 'cancelled'"];
        const params: unknown[] = [orderId, gate.vendor.id];
        let idx = 3;
        if (hasCancelReason) {
          sets.push(`cancel_reason = $${idx++}`);
          params.push(reason);
        }
        if (hasCancelledBy) {
          sets.push(`cancelled_by = $${idx++}`);
          params.push("Ajuste post-cierre");
        }
        if (hasUpdatedAt) sets.push("updated_at = now()");

        // El WHERE status <> 'cancelled' es el candado atómico: dos requests
        // simultáneos no pueden anular la misma venta dos veces.
        const rows = await tx.query<Record<string, any>>(
          `UPDATE orders SET ${sets.join(", ")}
           WHERE id = $1 AND vendor_id = $2 AND status <> 'cancelled'
           RETURNING id, items, total, pickup_number, channel, customer_phone,
                     method, payment_method`,
          params
        );
        if (!rows || rows.length === 0) throw new Error(ALREADY_CANCELLED);
        const o = rows[0];

        if (await hasTable(tx, "order_status_log")) {
          await tx.queryVoid(
            `INSERT INTO order_status_log (order_id, status) VALUES ($1, 'cancelled')`,
            [o.id]
          );
        }

        // Stock: solo canales que reservaron al vender (app y mostrador; mesa
        // nunca reservó; preview ya se rechazó arriba). Por peso no toca stock.
        if (o.channel === "app" || o.channel === "mostrador") {
          const items = ((o.items as OrderItem[] | null) || []).filter(
            (i) => (i as OrderItem)?.unit !== "kg"
          );
          const returned: StockMove[] = await adjustStockForItems(tx, items, "increment");
          for (const m of returned) {
            await logStockMovement(tx, {
              vendorId: gate.vendor.id,
              product_id: m.product_id,
              variant_id: m.variant_id,
              qty_delta: m.qty,
              reason: "devolucion",
              ref_order: o.id,
            });
          }
        }

        // CRM: la compra anulada sale del libro (app y mostrador delivery).
        if (o.customer_phone) {
          const hasCustomerRow =
            o.channel === "app" || (o.channel === "mostrador" && o.method === "delivery");
          if (hasCustomerRow && !String(o.customer_phone).startsWith("lid:")) {
            await decrementCustomerFromOrder(tx, gate.vendor.id, {
              phone: o.customer_phone,
              total: Number(o.total) || 0,
            });
          }
        }

        // Giftcards emitidas por esta venta: se anulan (si ya se canjearon,
        // el saldo usado no vuelve).
        const { voidGiftcardsForOrder } = await import("@/lib/giftcards");
        await voidGiftcardsForOrder(tx, {
          vendorId: gate.vendor.id,
          orderId: o.id,
          note: "venta anulada por ajuste post-cierre",
        });

        // Un ajuste negativo por medio cobrado: si la venta tuvo pago
        // combinado, cada medio baja su parte (el arqueo queda bien).
        let payRows: { method: string; total: number }[] = [];
        if (await hasTable(tx, "order_payments")) {
          const pr = await tx.query<{ method: string; total: string }>(
            `SELECT method, SUM(amount) AS total
             FROM order_payments
             WHERE order_id = $1 AND vendor_id = $2 AND kind = 'cobro'
             GROUP BY method`,
            [o.id, gate.vendor.id]
          );
          payRows = (pr || [])
            .map((r) => ({ method: r.method, total: Number(r.total) || 0 }))
            .filter((r) => r.total > 0);
        }
        if (payRows.length === 0) {
          payRows = [
            {
              method: String(o.payment_method || "efectivo"),
              total: Number(o.total) || 0,
            },
          ];
        }

        let inserted = 0;
        const methods: string[] = [];
        for (const r of payRows) {
          const method = r.method in CASH_METHOD_LABELS ? r.method : "efectivo";
          const amount = -Math.round(r.total * 100) / 100;
          if (!(amount < 0)) continue;
          await tx.queryVoid(
            `INSERT INTO cash_closing_adjustments
               (vendor_id, closing_id, amount, method, kind, reason, order_id, created_by)
             VALUES ($1, $2, $3, $4, 'venta_duplicada', $5, $6, $7)`,
            [gate.vendor.id, closingId, amount, method, reason, o.id, userId]
          );
          inserted++;
          methods.push(method);
        }

        return {
          orderNumber:
            o.pickup_number != null ? Number(o.pickup_number) : null,
          methods,
          rows: inserted,
        };
      });
    } catch (e) {
      const code = (e as { code?: string })?.code;
      const msg = e instanceof Error ? e.message : "";
      if (msg === ALREADY_CANCELLED) {
        return NextResponse.json({ error: "La venta ya está anulada" }, { status: 409 });
      }
      if (code === "42P01") return migrationMissing();
      if (code === "23505") {
        return NextResponse.json(
          { error: "Esa venta ya fue ajustada" },
          { status: 409 }
        );
      }
      return NextResponse.json(
        { error: "No se pudo anular la venta" },
        { status: 500 }
      );
    }

    const all = await listClosingAdjustments(gate.vendor.id, [closingId]);
    const totals = summarizeAdjustments(all);
    const adjusted = applyClosingAdjustments(closing, all);

    return NextResponse.json({
      ok: true,
      cancelled: true,
      orderId,
      orderNumber: result.orderNumber,
      methods: result.methods,
      adjustmentRows: result.rows,
      totals,
      closing: {
        id: closing.id,
        adjustment_total: adjusted.adjustment_total,
        adjustment_cash: adjusted.adjustment_cash,
        adjusted_net_total: adjusted.adjusted_net_total,
        adjusted_expected_cash: adjusted.adjusted_expected_cash,
        adjusted_cash_difference: adjusted.adjusted_cash_difference,
      },
    });
  }

  // ── Ajuste de solo números (sin venta) ─────────────────────────────────────
  const rawAmount = Number(body?.amount);
  if (!Number.isFinite(rawAmount) || Math.abs(rawAmount) >= 1e9) {
    return NextResponse.json({ error: "Indicá un monto válido" }, { status: 400 });
  }
  const magnitude = Math.round(Math.abs(rawAmount) * 100) / 100;
  if (!(magnitude > 0)) {
    return NextResponse.json({ error: "El monto tiene que ser mayor a 0" }, { status: 400 });
  }

  const kind: CashAdjustmentKind = KINDS.includes(body?.kind) ? body.kind : "otro";
  const methodRaw = typeof body?.method === "string" ? body.method.trim() : "efectivo";
  const method = methodRaw || "efectivo";
  if (!(method in CASH_METHOD_LABELS)) {
    return NextResponse.json({ error: "Medio de pago inválido" }, { status: 400 });
  }

  if (reason.length < 3) {
    return NextResponse.json(
      { error: "Escribí el motivo del ajuste (qué pasó y por qué)" },
      { status: 400 }
    );
  }

  // Signo: la venta faltante suma; la duplicada resta. "Otro" acepta la
  // dirección elegida (o el signo del monto si no se manda dirección).
  let direction = 1;
  if (kind === "venta_faltante") direction = 1;
  else if (kind === "venta_duplicada") direction = -1;
  else if (body?.direction === "resta") direction = -1;
  else if (body?.direction === "suma") direction = 1;
  else direction = rawAmount < 0 ? -1 : 1;
  const amount = Math.round(magnitude * direction * 100) / 100;

  // Sesión de prueba: sin perfil en la tabla (user.id es "preview:..."), el
  // ajuste queda sin autor en vez de romper el FK.
  const userId = gate.previewSession ? null : gate.user.id;

  let adjustment;
  try {
    adjustment = await queryOne<{ id: string; created_at: string }>(
      `INSERT INTO cash_closing_adjustments
         (vendor_id, closing_id, amount, method, kind, reason, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, created_at`,
      [gate.vendor.id, closingId, amount, method, kind, reason, userId]
    );
  } catch (e) {
    const code = (e as { code?: string })?.code;
    const msg = e instanceof Error ? e.message : "";
    if (code === "42P01" || /relation .*cash_closing_adjustments.* does not exist/i.test(msg)) {
      return migrationMissing();
    }
    return NextResponse.json(
      { error: "No se pudo registrar el ajuste" },
      { status: 500 }
    );
  }
  if (!adjustment) {
    return NextResponse.json({ error: "No se pudo registrar el ajuste" }, { status: 500 });
  }

  const all = await listClosingAdjustments(gate.vendor.id, [closingId]);
  const totals = summarizeAdjustments(all);
  const adjusted = applyClosingAdjustments(closing, all);

  return NextResponse.json({
    ok: true,
    adjustment,
    totals,
    closing: {
      id: closing.id,
      adjustment_total: adjusted.adjustment_total,
      adjustment_cash: adjusted.adjustment_cash,
      adjusted_net_total: adjusted.adjusted_net_total,
      adjusted_expected_cash: adjusted.adjusted_expected_cash,
      adjusted_cash_difference: adjusted.adjusted_cash_difference,
    },
  });
}
