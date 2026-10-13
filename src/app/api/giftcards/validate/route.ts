import { queryOne } from "@/lib/db";
import { NextResponse } from "next/server";
import { withRateLimit } from "@/lib/api-wrapper";

/**
 * Valida una giftcard para canje online (público, sin auth): devuelve solo
 * código + saldo + estado. Rate-limit estricto (es un secreto compartible).
 */
export const GET = withRateLimit(async (request: Request) => {
  const { searchParams } = new URL(request.url);
  const vendorId = (searchParams.get("vendorId") || "").trim();
  const code = (searchParams.get("code") || "").trim().toUpperCase();
  if (!vendorId || !code) {
    return NextResponse.json({ error: "Faltan comercio y código" }, { status: 400 });
  }
  try {
    const card = await queryOne<{ code: string; balance: number; status: string; expires_at: string | null }>(
      `SELECT code, balance, status, expires_at::text AS expires_at
       FROM giftcards WHERE vendor_id = $1 AND code = $2 LIMIT 1`,
      [vendorId, code]
    );
    if (!card) return NextResponse.json({ error: "Código no encontrado" }, { status: 404 });
    if (card.status !== "active") {
      return NextResponse.json({ error: "La tarjeta no está activa" }, { status: 409 });
    }
    if (card.expires_at && card.expires_at < new Date().toISOString().slice(0, 10)) {
      return NextResponse.json({ error: "La tarjeta está vencida" }, { status: 409 });
    }
    const balance = Math.round(Number(card.balance) || 0);
    if (balance <= 0) {
      return NextResponse.json({ error: "La tarjeta no tiene saldo" }, { status: 409 });
    }
    return NextResponse.json({ ok: true, code: card.code, balance, expires_at: card.expires_at ?? null });
  } catch {
    return NextResponse.json({ error: "No se pudo validar" }, { status: 500 });
  }
}, { maxRequests: 20 });
