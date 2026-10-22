import { getAuthUser } from "@/lib/auth";
import { query, queryMany } from "@/lib/db";
import { NextResponse } from "next/server";
import { fetchOperatorCarriers } from "@/lib/shipping-server";

export const dynamic = "force-dynamic";

/**
 * Acuse de recibo del encargo por parte de la logística: el operador abrió su
 * panel y el encargo apareció en su lista. El comercio lo ve en el detalle
 * ("👀 La logística lo vio 18:42"). Idempotente: solo sella la primera vez
 * (ack_at IS NULL) y solo encargos de SUS carriers.
 */
export async function POST(request: Request) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const ids: string[] = Array.isArray(body?.shipmentIds)
    ? body.shipmentIds.map((i: unknown) => String(i)).filter(Boolean).slice(0, 200)
    : [];
  if (ids.length === 0) return NextResponse.json({ ok: true, acked: 0 });

  const carriers = await fetchOperatorCarriers(user.id);
  if (carriers.length === 0) return NextResponse.json({ ok: true, acked: 0 });
  const carrierIds = carriers.map((c) => c.id);

  try {
    const pending = await queryMany<{ id: string }>(
      `SELECT id FROM shipments
       WHERE id = ANY($1::uuid[]) AND carrier_id = ANY($2::uuid[])
       LIMIT 200`,
      [ids, carrierIds]
    ).catch(() => [] as { id: string }[]);
    if (pending.length === 0) return NextResponse.json({ ok: true, acked: 0 });

    await query(
      `UPDATE shipments SET ack_at = now(), ack_by_profile = $2
       WHERE id = ANY($1::uuid[]) AND ack_at IS NULL`,
      [pending.map((p) => p.id), user.id]
    );
    return NextResponse.json({ ok: true, acked: pending.length });
  } catch {
    // Migración sin aplicar: sin acuse (todo sigue funcionando).
    return NextResponse.json({ ok: true, acked: 0, ready: false });
  }
}
