import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryMany, queryOne, withTransaction } from "@/lib/db";
import { NextResponse } from "next/server";
import { canSellGiftcards, newGiftCode, normalizeGiftAmount } from "@/lib/giftcards";

/**
 * Giftcards (estética, comercio, moda): emisión + canje manual en panel.
 * - GET: lista (con saldo). ?code= busca una puntual.
 * - POST { action: "sell", amount, customer_name?, customer_phone?, expires_at? }:
 *   emite código con saldo = monto (se cobra por caja/MP aparte).
 * - POST { action: "issue_order", order_id }: emite los códigos de las
 *   giftcards vendidas en ese pedido (1 por unidad, idempotente).
 * - POST { action: "mark_sent", id }: marca la tarjeta como enviada.
 * - POST { action: "redeem", code, amount, note? }: descuenta saldo con
 *   historial (409 si no alcanza). En 0 queda 'redeemed'.
 * - POST { action: "void", id }: anula.
 */
export async function GET(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (!canSellGiftcards(gate.vendor.vertical)) return NextResponse.json({ giftcards: [] });
  try {
    const { searchParams } = new URL(request.url);
    const code = (searchParams.get("code") || "").trim().toUpperCase();
    const orderId = (searchParams.get("orderId") || "").trim();
    if (orderId) {
      // Códigos emitidos por una venta (detalle del pedido). Tolerante a
      // migración sin aplicar: sin la columna no hay vínculo posible.
      const has = await queryOne<{ e: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'giftcards' AND column_name = 'order_id') AS e`
      ).catch(() => null);
      if (!has?.e) return NextResponse.json({ giftcards: [] });
      const rows = await queryMany<Record<string, unknown>>(
        `SELECT * FROM giftcards WHERE vendor_id = $1 AND order_id = $2 ORDER BY created_at DESC`,
        [gate.vendor.id, orderId]
      );
      return NextResponse.json({ giftcards: rows || [] });
    }
    const rows = code
      ? await queryMany<Record<string, unknown>>(
          `SELECT * FROM giftcards WHERE vendor_id = $1 AND code = $2 LIMIT 1`,
          [gate.vendor.id, code]
        )
      : await queryMany<Record<string, unknown>>(
          `SELECT * FROM giftcards WHERE vendor_id = $1 ORDER BY created_at DESC LIMIT 100`,
          [gate.vendor.id]
        );
    return NextResponse.json({ giftcards: rows || [] });
  } catch {
    return NextResponse.json({ giftcards: [], migrationMissing: true }, { status: 503 });
  }
}

function newCode(vertical: string | null | undefined): string {
  return newGiftCode(vertical);
}

export async function POST(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (!canSellGiftcards(gate.vendor.vertical)) {
    return NextResponse.json({ error: "Giftcards no disponibles para este rubro" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const action = String(body.action || "");

  try {
    if (action === "sell") {
      const amount = normalizeGiftAmount(body.amount);
      if (!amount) {
        return NextResponse.json({ error: "El monto debe ser mayor a 0" }, { status: 400 });
      }
      const expiresRaw = typeof body.expires_at === "string" ? body.expires_at.trim() : "";
      const expiresAt = /^\d{4}-\d{2}-\d{2}$/.test(expiresRaw) ? expiresRaw : null;
      // Código único (reintenta ante colisión).
      let card: Record<string, unknown> | undefined;
      for (let i = 0; i < 5 && !card; i++) {
        try {
          card = await queryOne<Record<string, unknown>>(
            `INSERT INTO giftcards (vendor_id, code, amount, balance, customer_name, customer_phone, expires_at)
             VALUES ($1, $2, $3, $3, $4, $5, $6) RETURNING *`,
            [
              gate.vendor.id,
              newCode(gate.vendor.vertical),
              amount,
              String(body.customer_name || "").trim().slice(0, 120) || null,
              String(body.customer_phone || "").trim().slice(0, 40) || null,
              expiresAt,
            ]
          );
        } catch (e) {
          if (!/duplicate|unique/i.test((e as Error)?.message || "")) throw e;
        }
      }
      if (!card) return NextResponse.json({ error: "No se pudo generar el código" }, { status: 500 });
      return NextResponse.json({ giftcard: card });
    }

    if (action === "redeem") {
      const code = String(body.code || "").trim().toUpperCase();
      const amount = Math.round(Number(body.amount) || 0);
      if (!code || !amount || amount <= 0) {
        return NextResponse.json({ error: "Faltan código y monto válido" }, { status: 400 });
      }
      const card = await queryOne<{ id: string; balance: number; status: string; expires_at: string | null }>(
        `SELECT id, balance, status, expires_at::text AS expires_at FROM giftcards WHERE vendor_id = $1 AND code = $2 LIMIT 1`,
        [gate.vendor.id, code]
      );
      if (!card) return NextResponse.json({ error: "Código no encontrado" }, { status: 404 });
      if (card.status !== "active") {
        return NextResponse.json({ error: "La tarjeta no está activa" }, { status: 409 });
      }
      if (card.expires_at && card.expires_at < new Date().toISOString().slice(0, 10)) {
        return NextResponse.json({ error: "La tarjeta está vencida" }, { status: 409 });
      }
      if (Number(card.balance) < amount) {
        return NextResponse.json(
          { error: `Saldo insuficiente ($${Number(card.balance).toLocaleString("es-AR")})` },
          { status: 409 }
        );
      }
      const note = String(body.note || "").trim().slice(0, 200) || null;
      const updated = await queryOne<Record<string, unknown>>(
        `UPDATE giftcards SET balance = balance - $3,
           status = CASE WHEN balance - $3 <= 0 THEN 'redeemed' ELSE 'active' END
         WHERE id = $1 AND vendor_id = $2 RETURNING *`,
        [card.id, gate.vendor.id, amount]
      );
      await queryOne(
        `INSERT INTO giftcard_moves (giftcard_id, kind, amount, note) VALUES ($1, 'redeem', $2, $3)`,
        [card.id, amount, note]
      ).catch(() => undefined);
      return NextResponse.json({ giftcard: updated });
    }

    if (action === "void") {
      const id = String(body.id || "");
      if (!id) return NextResponse.json({ error: "Falta el id" }, { status: 400 });
      const updated = await queryOne<Record<string, unknown>>(
        `UPDATE giftcards SET status = 'void' WHERE id = $1 AND vendor_id = $2 RETURNING *`,
        [id, gate.vendor.id]
      );
      if (!updated) return NextResponse.json({ error: "No encontrada" }, { status: 404 });
      return NextResponse.json({ giftcard: updated });
    }

    if (action === "issue_order") {
      const orderId = String(body.order_id || body.orderId || "");
      if (!orderId) return NextResponse.json({ error: "Falta el pedido" }, { status: 400 });
      const order = await queryOne<{
        id: string; items: unknown; customer_name: string | null; customer_phone: string | null;
        is_preview: boolean | null; pickup_number: number | null; status: string;
      }>(
        `SELECT id, items, customer_name, customer_phone, is_preview, pickup_number, status
         FROM orders WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
        [orderId, gate.vendor.id]
      );
      if (!order) return NextResponse.json({ error: "Pedido no encontrado" }, { status: 404 });
      if (order.status === "cancelled") {
        return NextResponse.json({ error: "El pedido está cancelado" }, { status: 400 });
      }
      const { issueGiftcardsForOrder } = await import("@/lib/giftcards");
      const issued = await withTransaction((tx) =>
        issueGiftcardsForOrder(tx, {
          vendorId: gate.vendor.id,
          orderId: order.id,
          items: (Array.isArray(order.items) ? order.items : []) as any[],
          customerName: order.customer_name,
          customerPhone: order.customer_phone,
          isPreview: order.is_preview === true,
          note: `Pedido #${order.pickup_number ?? order.id.slice(0, 8)}`,
        })
      );
      return NextResponse.json({ issued });
    }

    if (action === "mark_sent") {
      const id = String(body.id || "");
      if (!id) return NextResponse.json({ error: "Falta el id" }, { status: 400 });
      const updated = await queryOne<Record<string, unknown>>(
        `UPDATE giftcards SET sent_at = now() WHERE id = $1 AND vendor_id = $2 RETURNING *`,
        [id, gate.vendor.id]
      ).catch(() => null);
      if (!updated) return NextResponse.json({ error: "No encontrada" }, { status: 404 });
      return NextResponse.json({ giftcard: updated });
    }

    return NextResponse.json({ error: "Acción inválida" }, { status: 400 });
  } catch {
    return NextResponse.json(
      { error: "Falta aplicar la migración migrate-estetica-giftcards.sql en la base" },
      { status: 503 }
    );
  }
}
