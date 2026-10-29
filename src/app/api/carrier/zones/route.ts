import { getAuthUser } from "@/lib/auth";
import { queryMany, queryOne, query } from "@/lib/db";
import { NextResponse } from "next/server";
import { fetchOperatorCarriers } from "@/lib/shipping-server";

export const dynamic = "force-dynamic";

/**
 * Zonas de cobertura de la logística (self-service).
 *
 * La logística (o el repartidor independiente) crea/edita/borra las zonas
 * que cubre y su tarifa por envío. El admin también puede hacerlo desde
 * /admin/logisticas. Scope estricto: solo ve y edita las zonas cuyo
 * carrier_id es uno de sus carriers.
 *
 * GET: lista sus zonas (incluye carrier_fee).
 * POST: crea zona (carrier_id = su carrier).
 * PATCH: edita (id, name, description, price, carrier_fee, etaDays, active, position).
 * DELETE: soft-delete (active=false) si tiene envíos en curso; hard-delete solo si no hay shipments.
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
    const rows = await queryMany<Record<string, unknown>>(
      `SELECT z.*, c.name AS carrier_name
         FROM shipping_zones z
         LEFT JOIN carriers c ON c.id = z.carrier_id
        WHERE z.carrier_id = ANY($1::uuid[])
        ORDER BY z.position ASC, z.created_at ASC`,
      [carrierIds]
    );
    return NextResponse.json({
      zones: (rows || []).map((r) => ({
        id: String(r.id),
        name: String(r.name),
        description: r.description != null ? String(r.description) : null,
        price: Number(r.price) || 0,
        carrierFee: r.carrier_fee != null ? Number(r.carrier_fee) : null,
        etaDays: r.eta_days != null ? Number(r.eta_days) : null,
        carrierId: String(r.carrier_id),
        carrierName: String(r.carrier_name),
        active: r.active !== false,
        position: r.position != null ? Number(r.position) : 0,
        createdBy: r.created_by != null ? String(r.created_by) : null,
      })),
      ready: true,
      carriers,
    });
  } catch {
    return NextResponse.json({ error: "Falta aplicar la migración de envíos" }, { status: 503 });
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
  const name = String(body?.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "Falta el nombre de la zona" }, { status: 400 });
  // El precio al comprador lo define el portal/admin, no la logística.
  // Si la logística no lo envía, queda en 0 (el admin lo completa).
  const price = body?.price != null ? Number(body.price) : 0;
  const carrierId = String(body?.carrierId ?? "").trim();
  if (!carrierId || !carrierIds.has(carrierId)) {
    return NextResponse.json({ error: "Esa logística no te pertenece" }, { status: 403 });
  }
  const carrierFee = body?.carrierFee != null ? Number(body.carrierFee) : null;
  if (carrierFee != null && (!Number.isFinite(carrierFee) || carrierFee < 0)) {
    return NextResponse.json({ error: "Tarifa de la logística inválida" }, { status: 400 });
  }
  const etaDays = Number.isFinite(Number(body?.etaDays)) ? Math.max(0, Math.floor(Number(body.etaDays))) : 2;

  try {
    const row = await queryOne<Record<string, unknown>>(
      `INSERT INTO shipping_zones (name, description, price, eta_days, carrier_id, position, carrier_fee, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        name.slice(0, 120),
        body?.description ? String(body.description).trim().slice(0, 300) || null : null,
        Math.round(price * 100) / 100,
        etaDays,
        carrierId,
        Number.isFinite(Number(body?.position)) ? Math.floor(Number(body.position)) : 0,
        carrierFee != null ? Math.round(carrierFee * 100) / 100 : null,
        user.id,
      ]
    );
    return NextResponse.json({ ok: true, zone: row });
  } catch {
    return NextResponse.json({ error: "No se pudo crear la zona" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const carriers = await fetchOperatorCarriers(user.id);
  const carrierIds = new Set(carriers.map((c) => c.id));

  const body = await request.json().catch(() => ({}));
  const id = String(body?.id ?? "").trim();
  if (!id) return NextResponse.json({ error: "Falta el id" }, { status: 400 });

  // Verificar que la zona pertenece a una logística del operador.
  const zone = await queryOne<{ carrier_id: string | null }>(
    `SELECT carrier_id FROM shipping_zones WHERE id = $1 LIMIT 1`,
    [id]
  ).catch(() => undefined);
  if (!zone?.carrier_id || !carrierIds.has(String(zone.carrier_id))) {
    return NextResponse.json({ error: "Esa zona no es de tu logística" }, { status: 403 });
  }

  const price = body?.price != null ? Number(body.price) : null;
  const carrierFee = body?.carrierFee != null ? Number(body.carrierFee) : undefined;
  try {
    await query(
      `UPDATE shipping_zones SET
         name = COALESCE($2, name),
         description = $3,
         price = COALESCE($4, price),
         eta_days = COALESCE($5, eta_days),
         position = COALESCE($6, position),
         active = COALESCE($7, active),
         carrier_fee = COALESCE($8, carrier_fee)
       WHERE id = $1`,
      [
        id,
        body?.name ? String(body.name).trim().slice(0, 120) : null,
        body?.description !== undefined ? (body.description ? String(body.description).trim().slice(0, 300) : null) : null,
        price != null && Number.isFinite(price) && price >= 0 ? Math.round(price * 100) / 100 : null,
        body?.etaDays !== undefined ? (Number.isFinite(Number(body.etaDays)) ? Math.max(0, Math.floor(Number(body.etaDays))) : null) : null,
        body?.position !== undefined ? (Number.isFinite(Number(body.position)) ? Math.floor(Number(body.position)) : null) : null,
        body?.active !== undefined ? body.active !== false : null,
        carrierFee !== undefined && Number.isFinite(carrierFee) && carrierFee >= 0 ? Math.round(carrierFee * 100) / 100 : null,
      ]
    );
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "No se pudo actualizar la zona" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const carriers = await fetchOperatorCarriers(user.id);
  const carrierIds = new Set(carriers.map((c) => c.id));

  const body = await request.json().catch(() => ({}));
  const id = String(body?.id ?? "").trim();
  if (!id) return NextResponse.json({ error: "Falta el id" }, { status: 400 });

  const zone = await queryOne<{ carrier_id: string | null }>(
    `SELECT carrier_id FROM shipping_zones WHERE id = $1 LIMIT 1`,
    [id]
  ).catch(() => undefined);
  if (!zone?.carrier_id || !carrierIds.has(String(zone.carrier_id))) {
    return NextResponse.json({ error: "Esa zona no es de tu logística" }, { status: 403 });
  }

  // Soft-delete si tiene envíos en curso; hard-delete solo si no hay shipments.
  try {
    const inUse = await queryOne<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM shipments WHERE shipping_zone_id = $1 AND status IN ('requested','picked_up','in_transit','failed_attempt')`,
      [id]
    );
    if (inUse && Number(inUse.n) > 0) {
      await query(`UPDATE shipping_zones SET active = false WHERE id = $1`, [id]);
      return NextResponse.json({ ok: true, soft: true, message: "Zona pausada (tiene envíos en curso)" });
    }
    await query(`DELETE FROM shipping_zones WHERE id = $1`, [id]);
    return NextResponse.json({ ok: true, deleted: true });
  } catch {
    return NextResponse.json({ error: "No se pudo borrar la zona" }, { status: 500 });
  }
}
