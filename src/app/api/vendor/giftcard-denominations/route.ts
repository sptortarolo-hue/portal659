import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryMany, queryOne } from "@/lib/db";
import { NextResponse } from "next/server";
import { canSellGiftcards, normalizeGiftAmount } from "@/lib/giftcards";

/**
 * Montos fijos de giftcard por comercio (comercio/moda; estética legacy
 * vende con monto abierto y puede no tener filas).
 * - GET: lista ordenada por monto.
 * - POST { amount }: agrega (dedupe por unique).
 * - POST { action: "delete", id }: borra.
 * - POST { action: "toggle", id, active }: prende/apaga.
 */
export async function GET(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (!canSellGiftcards(gate.vendor.vertical)) {
    return NextResponse.json({ denominations: [] });
  }
  try {
    const rows = await queryMany<{ id: string; amount: number; active: boolean; position: number }>(
      `SELECT id, amount, active, position FROM giftcard_denominations
       WHERE vendor_id = $1 ORDER BY amount ASC`,
      [gate.vendor.id]
    );
    return NextResponse.json({ denominations: rows || [] });
  } catch {
    return NextResponse.json({ denominations: [], migrationMissing: true }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (!canSellGiftcards(gate.vendor.vertical)) {
    return NextResponse.json({ error: "Giftcards no disponibles para este rubro" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const action = String(body.action || "add");
  try {
    if (action === "delete") {
      const id = String(body.id || "");
      if (!id) return NextResponse.json({ error: "Falta el id" }, { status: 400 });
      await queryOne(`DELETE FROM giftcard_denominations WHERE id = $1 AND vendor_id = $2`, [
        id,
        gate.vendor.id,
      ]);
      return NextResponse.json({ ok: true });
    }
    if (action === "toggle") {
      const id = String(body.id || "");
      if (!id) return NextResponse.json({ error: "Falta el id" }, { status: 400 });
      const updated = await queryOne<{ id: string; active: boolean }>(
        `UPDATE giftcard_denominations SET active = $3 WHERE id = $1 AND vendor_id = $2 RETURNING id, active`,
        [id, gate.vendor.id, body.active !== false]
      );
      if (!updated) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
      return NextResponse.json({ denomination: updated });
    }
    // add (default)
    const amount = normalizeGiftAmount(body.amount);
    if (!amount) return NextResponse.json({ error: "Monto inválido" }, { status: 400 });
    try {
      const row = await queryOne<{ id: string; amount: number; active: boolean }>(
        `INSERT INTO giftcard_denominations (vendor_id, amount, position)
         VALUES ($1, $2, (SELECT COUNT(*) FROM giftcard_denominations WHERE vendor_id = $1))
         RETURNING id, amount, active`,
        [gate.vendor.id, amount]
      );
      return NextResponse.json({ denomination: row });
    } catch (e) {
      if (/duplicate|unique/i.test((e as Error)?.message || "")) {
        return NextResponse.json({ error: "Ese monto ya está en la lista" }, { status: 409 });
      }
      throw e;
    }
  } catch {
    return NextResponse.json(
      { error: "Falta aplicar la migración migrate-giftcard-denominations.sql en la base" },
      { status: 503 }
    );
  }
}
