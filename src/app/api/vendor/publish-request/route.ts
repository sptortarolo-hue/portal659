import { query } from "@/lib/db";
import { getVendorByRequest } from "@/lib/vendor-utils";
import { NextResponse } from "next/server";

/**
 * Solicitud de publicación (la aprueba el admin).
 * POST { action: "request" } → marca publish_requested_at.
 * POST { action: "cancel" } → retira la solicitud.
 * Solo dueño (no repartidores).
 */
export async function POST(request: Request) {
  const { vendor: resolved, staffRole } = await getVendorByRequest(request);
  if (!resolved || staffRole === "delivery") {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const { action } = body as { action?: string };

  if (action === "request") {
    await query(
      `UPDATE vendors SET publish_requested_at = now() WHERE id = $1`,
      [resolved.id]
    );
    return NextResponse.json({ ok: true, requested: true });
  }

  if (action === "cancel") {
    await query(`UPDATE vendors SET publish_requested_at = NULL WHERE id = $1`, [
      resolved.id,
    ]);
    return NextResponse.json({ ok: true, requested: false });
  }

  return NextResponse.json({ error: "Acción inválida" }, { status: 400 });
}
