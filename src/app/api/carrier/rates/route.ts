import { getAuthUser } from "@/lib/auth";
import { queryMany, queryOne } from "@/lib/db";
import { NextResponse } from "next/server";
import { fetchOperatorCarriers } from "@/lib/shipping-server";

export const dynamic = "force-dynamic";

/**
 * Tarifas de la logística (carrier_zone_rates): cada logística define
 * cuánto le cobra al local por zona. La edita desde su panel
 * (/envios/tarifas); el admin puede verla/editarla en /admin/logisticas.
 *
 * Auth: operador logueado (carrier_operators activo). Scope estricto a
 * SUS carriers (nunca ve ni escribe tarifas de otra logística).
 */
export async function GET(request: Request) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const carriers = await fetchOperatorCarriers(user.id);
  if (carriers.length === 0) {
    return NextResponse.json({ zones: [], ready: true, carriers: [] });
  }
  const carrierIds = carriers.map((c) => c.id);

  try {
    // Zonas del catálogo asignadas a la logística + su tarifa vigente.
    const rows = await queryMany<Record<string, unknown>>(
      `SELECT z.id AS zone_id, z.name AS zone_name, z.description, z.price,
              z.eta_days, z.active, z.position,
              z.carrier_id,
              c.name AS carrier_name,
              r.fee
         FROM shipping_zones z
         LEFT JOIN carriers c ON c.id = z.carrier_id
         LEFT JOIN carrier_zone_rates r
           ON r.shipping_zone_id = z.id AND r.carrier_id = z.carrier_id
        WHERE z.carrier_id = ANY($1::uuid[])
        ORDER BY z.position ASC, z.created_at ASC
        LIMIT 200`,
      [carrierIds]
    );
    return NextResponse.json({
      zones: (rows || []).map((r) => ({
        zoneId: String(r.zone_id),
        zoneName: String(r.zone_name),
        description: r.description != null ? String(r.description) : null,
        price: Number(r.price) || 0,
        etaDays: r.eta_days != null ? Number(r.eta_days) : null,
        active: r.active !== false,
        carrierId: String(r.carrier_id),
        carrierName: String(r.carrier_name),
        fee: r.fee != null ? Number(r.fee) : null,
      })),
      ready: true,
      carriers,
    });
  } catch {
    // Migración sin aplicar (carrier_zone_rates no existe).
    return NextResponse.json({ zones: [], ready: false, carriers });
  }
}

export async function POST(request: Request) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const carriers = await fetchOperatorCarriers(user.id);
  if (carriers.length === 0) {
    return NextResponse.json({ error: "No sos operador de ninguna logística" }, { status: 403 });
  }
  const carrierIds = new Set(carriers.map((c) => c.id));

  const body = await request.json().catch(() => ({}));
  // Acepta un único {zoneId, fee} o un lote {rates: [{zoneId, fee}]}.
  type RateIn = { zoneId?: unknown; fee?: unknown };
  const raw: RateIn[] = Array.isArray(body?.rates)
    ? (body.rates as RateIn[])
    : [body as RateIn];

  const parsed: { zoneId: string; carrierId: string; fee: number }[] = [];
  for (const item of raw) {
    const zoneId = String(item?.zoneId ?? "").trim();
    const fee = Number(item?.fee);
    if (!zoneId || !Number.isFinite(fee) || fee < 0 || fee > 99_999_999) {
      return NextResponse.json({ error: "Tarifa inválida (revisá zona y monto)" }, { status: 400 });
    }
    // La zona tiene que ser de una logística del operador (nunca ajena).
    const zone = await queryOne<{ carrier_id: string | null }>(
      `SELECT carrier_id FROM shipping_zones WHERE id = $1 LIMIT 1`,
      [zoneId]
    ).catch(() => undefined);
    if (!zone?.carrier_id || !carrierIds.has(String(zone.carrier_id))) {
      return NextResponse.json({ error: "Esa zona no es de tu logística" }, { status: 403 });
    }
    parsed.push({ zoneId, carrierId: String(zone.carrier_id), fee: Math.round(fee * 100) / 100 });
  }
  if (parsed.length === 0) {
    return NextResponse.json({ error: "Nada para guardar" }, { status: 400 });
  }

  try {
    for (const p of parsed) {
      await queryOne(
        `INSERT INTO carrier_zone_rates (carrier_id, shipping_zone_id, fee, updated_at)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (carrier_id, shipping_zone_id)
         DO UPDATE SET fee = EXCLUDED.fee, updated_at = now()`,
        [p.carrierId, p.zoneId, p.fee]
      );
    }
    return NextResponse.json({ ok: true, saved: parsed.length });
  } catch {
    return NextResponse.json(
      { error: "Falta aplicar la migración migrate-shipment-carrier-fee.sql" },
      { status: 503 }
    );
  }
}
