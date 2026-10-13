import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryMany, queryOne } from "@/lib/db";
import { NextResponse } from "next/server";
import { canSellGiftcards } from "@/lib/giftcards";

/**
 * Historial de una tarjeta (emisión, canjes, ajustes). La tarjeta tiene que
 * ser del comercio (id + vendor_id).
 */
export async function GET(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (!canSellGiftcards(gate.vendor.vertical)) return NextResponse.json({ moves: [] });
  const { searchParams } = new URL(request.url);
  const giftcardId = (searchParams.get("giftcardId") || "").trim();
  if (!giftcardId) return NextResponse.json({ error: "Falta la tarjeta" }, { status: 400 });
  try {
    const own = await queryOne<{ id: string }>(
      `SELECT id FROM giftcards WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
      [giftcardId, gate.vendor.id]
    );
    if (!own) return NextResponse.json({ error: "No encontrada" }, { status: 404 });
    const moves = await queryMany<Record<string, unknown>>(
      `SELECT id, kind, amount, note, created_at FROM giftcard_moves
       WHERE giftcard_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [giftcardId]
    );
    return NextResponse.json({ moves: moves || [] });
  } catch {
    return NextResponse.json({ moves: [], migrationMissing: true }, { status: 503 });
  }
}
