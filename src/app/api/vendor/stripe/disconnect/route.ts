import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryOne } from "@/lib/db";
import { NextResponse } from "next/server";

/** POST /api/vendor/stripe/disconnect — desvincula la cuenta de Stripe. */
export async function POST(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  try {
    await queryOne(
      `UPDATE vendors SET stripe_account_id = NULL, stripe_connected_at = NULL WHERE id = $1`,
      [gate.vendor.id]
    );
  } catch {
    return NextResponse.json(
      { error: "Falta aplicar la migración migrate-stripe-connect.sql en la base" },
      { status: 503 }
    );
  }
  return NextResponse.json({ ok: true });
}
