import { gateRequest } from "@/lib/subscription-gate";
import { queryMany } from "@/lib/db";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  if (!gate.plan.can("reviews_manage")) {
    return NextResponse.json(
      { error: "Responder reseñas requiere un plan pago (Pedidos, Gestión integral u Oficios)." },
      { status: 403 }
    );
  }

  const reviews = await queryMany<Record<string, unknown>>(
    `SELECT id, customer_name, product_id, rating, comment, reply, reply_by, replied_at, created_at
     FROM reviews WHERE vendor_id = $1 ORDER BY created_at DESC LIMIT 100`,
    [gate.vendor.id]
  );

  return NextResponse.json({ reviews });
}