import { isAdmin } from "@/lib/admin-utils";
import { queryMany, queryOne, query } from "@/lib/db";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Admin: ABM del catálogo de zonas extendidas (shipping_zones) y gestión de
 * operadores (carrier_operators). Solo is_admin (profiles).
 * GET lista zonas + operadores; POST crea zona; PATCH edita; DELETE baja (soft).
 */

export async function GET(request: Request) {
  if (!(await isAdmin(request))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  try {
    const zones = await queryMany<Record<string, unknown>>(
      `SELECT z.*, c.name AS carrier_name,
              r.fee AS carrier_fee
       FROM shipping_zones z
       LEFT JOIN carriers c ON c.id = z.carrier_id
       LEFT JOIN carrier_zone_rates r
         ON r.shipping_zone_id = z.id AND r.carrier_id = z.carrier_id
       ORDER BY z.position ASC, z.created_at ASC`,
      []
    ).catch(() =>
      // Sin la migración de tarifas (carrier_zone_rates no existe): el admin
      // ve el catálogo igual, sin la columna de tarifa.
      queryMany<Record<string, unknown>>(
        `SELECT z.*, c.name AS carrier_name
         FROM shipping_zones z
         LEFT JOIN carriers c ON c.id = z.carrier_id
         ORDER BY z.position ASC, z.created_at ASC`,
        []
      )
    );
    let operators: Record<string, unknown>[] = [];
    try {
      operators = await queryMany<Record<string, unknown>>(
        `SELECT o.id, o.carrier_id, o.profile_id, o.display_name, o.active, o.created_at,
                c.name AS carrier_name, p.email AS operator_email, p.full_name AS operator_name
         FROM carrier_operators o
         JOIN carriers c ON c.id = o.carrier_id
         JOIN profiles p ON p.id = o.profile_id
         ORDER BY c.name ASC, o.created_at ASC`,
        []
      );
    } catch {
      operators = [];
    }
    return NextResponse.json({ zones: zones || [], operators });
  } catch {
    return NextResponse.json({ error: "Falta aplicar la migración de envíos" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  if (!(await isAdmin(request))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));

  // Dos recursos en un mismo endpoint por recurso discriminado:
  //  { kind: "zone", name, price, etaDays, carrierId, description }
  //  { kind: "operator", carrierId, email }
  const kind = String(body?.kind ?? "zone");

  if (kind === "operator") {
    const email = String(body?.email ?? "").trim().toLowerCase();
    const carrierId = String(body?.carrierId ?? "").trim();
    if (!email || !carrierId) return NextResponse.json({ error: "Faltan el email y la logística" }, { status: 400 });
    try {
      const profile = await queryOne<{ id: string }>(
        `SELECT id FROM profiles WHERE lower(email) = $1 LIMIT 1`,
        [email]
      );
      if (!profile) {
        return NextResponse.json({ error: "No hay un usuario con ese email (tiene que estar registrado)" }, { status: 404 });
      }
      const existing = await queryOne<{ id: string }>(
        `SELECT id FROM carrier_operators WHERE profile_id = $1 AND carrier_id = $2 LIMIT 1`,
        [profile.id, carrierId]
      );
      if (existing) {
        return NextResponse.json({ error: "Ya es operador de esa logística" }, { status: 409 });
      }
      const row = await queryOne<Record<string, unknown>>(
        `INSERT INTO carrier_operators (carrier_id, profile_id, display_name)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [carrierId, profile.id, body?.displayName ? String(body.displayName).trim().slice(0, 80) || null : null]
      );
      return NextResponse.json({ ok: true, operator: row });
    } catch {
      return NextResponse.json({ error: "No se pudo dar de alta el operador" }, { status: 500 });
    }
  }

  const name = String(body?.name ?? "").trim();
  const price = Number(body?.price);
  if (!name || !Number.isFinite(price) || price <= 0) {
    return NextResponse.json({ error: "Faltan el nombre y el precio de la zona" }, { status: 400 });
  }
  try {
    const row = await queryOne<Record<string, unknown>>(
      `INSERT INTO shipping_zones (name, description, price, eta_days, carrier_id, position)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        name.slice(0, 120),
        body?.description ? String(body.description).trim().slice(0, 300) || null : null,
        Math.round(price * 100) / 100,
        Number.isFinite(Number(body?.etaDays)) ? Math.max(0, Math.floor(Number(body.etaDays))) : 2,
        body?.carrierId ? String(body.carrierId) : null,
        Number.isFinite(Number(body?.position)) ? Math.floor(Number(body.position)) : 0,
      ]
    );
    return NextResponse.json({ ok: true, zone: row });
  } catch {
    return NextResponse.json({ error: "No se pudo crear la zona" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  if (!(await isAdmin(request))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));

  const kind = String(body?.kind ?? "zone");
  if (kind === "operator") {
    const id = String(body?.id ?? "");
    if (!id) return NextResponse.json({ error: "Falta el id" }, { status: 400 });
    try {
      await query(`UPDATE carrier_operators SET active = $2 WHERE id = $1`, [id, body?.active !== false]);
      return NextResponse.json({ ok: true });
    } catch {
      return NextResponse.json({ error: "No se pudo actualizar" }, { status: 500 });
    }
  }

  // Tarifa de la logística para una zona (la ve/edita el admin; la puede
  // cambiar también la propia logística desde su panel).
  if (kind === "zone_rate") {
    const id = String(body?.id ?? "").trim();
    if (!id) return NextResponse.json({ error: "Falta el id de la zona" }, { status: 400 });
    const fee = Number(body?.fee);
    if (!Number.isFinite(fee) || fee < 0) {
      return NextResponse.json({ error: "Tarifa inválida" }, { status: 400 });
    }
    try {
      const carrierId = await queryOne<{ carrier_id: string | null }>(
        `SELECT carrier_id FROM shipping_zones WHERE id = $1 LIMIT 1`,
        [id]
      );
      if (!carrierId?.carrier_id) {
        return NextResponse.json({ error: "La zona no tiene logística asignada" }, { status: 400 });
      }
      await query(
        `INSERT INTO carrier_zone_rates (carrier_id, shipping_zone_id, fee, updated_at)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (carrier_id, shipping_zone_id)
         DO UPDATE SET fee = EXCLUDED.fee, updated_at = now()`,
        [String(carrierId.carrier_id), id, Math.round(fee * 100) / 100]
      );
      return NextResponse.json({ ok: true });
    } catch {
      return NextResponse.json(
        { error: "Falta aplicar la migración migrate-shipment-carrier-fee.sql" },
        { status: 503 }
      );
    }
  }

  const id = String(body?.id ?? "").trim();
  if (!id) return NextResponse.json({ error: "Falta el id" }, { status: 400 });
  const price = Number(body?.price);
  try {
    await query(
      `UPDATE shipping_zones SET
         name = $2, description = $3,
         price = $4, eta_days = $5, carrier_id = $6, position = $7,
         active = $8
       WHERE id = $1`,
      [
        id,
        String(body?.name ?? "").trim().slice(0, 120) || "",
        body?.description ? String(body.description).trim().slice(0, 300) || null : null,
        Number.isFinite(price) && price >= 0 ? Math.round(price * 100) / 100 : 0,
        Number.isFinite(Number(body?.etaDays)) ? Math.max(0, Math.floor(Number(body.etaDays))) : 2,
        body?.carrierId ? String(body.carrierId) : null,
        Number.isFinite(Number(body?.position)) ? Math.floor(Number(body.position)) : 0,
        body?.active !== false,
      ]
    );
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "No se pudo actualizar la zona" }, { status: 500 });
  }
}
