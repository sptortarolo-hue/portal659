import { isAdmin } from "@/lib/admin-utils";
import { queryMany, queryOne, query } from "@/lib/db";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Admin: ABM de logísticas partner (carriers). Solo is_admin (profiles).
 * GET lista con conteo de pedidos; POST crea; PATCH edita; DELETE soft-off
 * (active=false — los envíos históricos referencian la fila por FK).
 */

export async function GET(request: Request) {
  if (!(await isAdmin(request))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  try {
    const rows = await queryMany<Record<string, unknown>>(
      `SELECT c.*,
              (SELECT COUNT(*) FROM shipments s WHERE s.carrier_id = c.id) AS shipments_count,
              (SELECT COUNT(*) FROM shipping_zones z WHERE z.carrier_id = c.id AND z.active = true) AS zones_count
       FROM carriers c
       ORDER BY c.name ASC`,
      []
    );
    return NextResponse.json({ carriers: rows || [] });
  } catch {
    return NextResponse.json({ error: "Falta aplicar la migración de envíos" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  if (!(await isAdmin(request))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const name = String(body?.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "Falta el nombre" }, { status: 400 });
  const waPhones = body?.wa_phones ? String(body.wa_phones).trim().slice(0, 400) || null : null;
  const waInvite = body?.wa_invite_url ? String(body.wa_invite_url).trim().slice(0, 500) || null : null;
  try {
    // Con columnas nuevas (migrate-carrier-wa.sql); si no están aplicadas,
    // reintenta en modo legacy para no romper el alta.
    try {
      const row = await queryOne<Record<string, unknown>>(
        `INSERT INTO carriers (name, phone, email, notes, wa_phones, wa_invite_url)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [
          name.slice(0, 120),
          body?.phone ? String(body.phone).trim().slice(0, 40) || null : null,
          body?.email ? String(body.email).trim().slice(0, 120) || null : null,
          body?.notes ? String(body.notes).trim().slice(0, 500) || null : null,
          waPhones,
          waInvite,
        ]
      );
      return NextResponse.json({ ok: true, carrier: row });
    } catch {
      const row = await queryOne<Record<string, unknown>>(
        `INSERT INTO carriers (name, phone, email, notes)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [
          name.slice(0, 120),
          body?.phone ? String(body.phone).trim().slice(0, 40) || null : null,
          body?.email ? String(body.email).trim().slice(0, 120) || null : null,
          body?.notes ? String(body.notes).trim().slice(0, 500) || null : null,
        ]
      );
      return NextResponse.json({ ok: true, carrier: row, legacy: true });
    }
  } catch {
    return NextResponse.json({ error: "No se pudo crear la logística" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  if (!(await isAdmin(request))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const id = String(body?.id ?? "").trim();
  if (!id) return NextResponse.json({ error: "Falta el id" }, { status: 400 });
  const waPhones = body?.wa_phones !== undefined ? String(body.wa_phones ?? "").trim().slice(0, 400) || null : null;
  const waInvite = body?.wa_invite_url !== undefined ? String(body.wa_invite_url ?? "").trim().slice(0, 500) || null : null;
  try {
    // Con columnas nuevas; si la migración no está, reintenta legacy (los
    // campos de WA se ignoran en ese caso).
    try {
      await query(
        `UPDATE carriers SET
           name = $2,
           phone = $3,
           email = $4,
           notes = $5,
           active = $6,
           wa_phones = $7,
           wa_invite_url = $8
         WHERE id = $1`,
        [
          id,
          String(body?.name ?? "").trim().slice(0, 120) || null,
          body?.phone ? String(body.phone).trim().slice(0, 40) || null : null,
          body?.email ? String(body.email).trim().slice(0, 120) || null : null,
          body?.notes ? String(body.notes).trim().slice(0, 500) || null : null,
          body?.active !== false,
          waPhones,
          waInvite,
        ]
      );
      return NextResponse.json({ ok: true });
    } catch {
      await query(
        `UPDATE carriers SET
           name = $2,
           phone = $3,
           email = $4,
           notes = $5,
           active = $6
         WHERE id = $1`,
        [
          id,
          String(body?.name ?? "").trim().slice(0, 120) || null,
          body?.phone ? String(body.phone).trim().slice(0, 40) || null : null,
          body?.email ? String(body.email).trim().slice(0, 120) || null : null,
          body?.notes ? String(body.notes).trim().slice(0, 500) || null : null,
          body?.active !== false,
        ]
      );
      return NextResponse.json({ ok: true, legacy: true });
    }
  } catch {
    return NextResponse.json({ error: "No se pudo actualizar" }, { status: 500 });
  }
}
