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

/**
 * Aprobar una logística auto-registrada: activa el carrier Y su fila de
 * carrier_operators (fetchOperatorCarriers exige los dos activos).
 * POST { action: "approve", id } | { action: "reject", id, note }
 */
async function handleApproval(body: Record<string, unknown>, action: string) {
  const id = String(body?.id ?? "").trim();
  if (!id) return NextResponse.json({ error: "Falta el id" }, { status: 400 });
  try {
    if (action === "approve") {
      await query(`UPDATE carriers SET active = true WHERE id = $1`, [id]);
      await query(
        `UPDATE carrier_operators SET active = true WHERE carrier_id = $1`,
        [id]
      );
      return NextResponse.json({ ok: true, approved: true });
    }
    // reject: baja lógica con nota (queda en el historial, no opera).
    const note = typeof body?.note === "string" && body.note.trim()
      ? `[Rechazada por el admin] ${body.note.trim().slice(0, 300)}`
      : "[Rechazada por el admin]";
    await query(`UPDATE carriers SET active = false WHERE id = $1`, [id]);
    await query(
      `UPDATE carrier_operators SET active = false WHERE carrier_id = $1`,
      [id]
    );
    await query(
      `UPDATE carriers SET notes = COALESCE(notes || ' · ', '') || $2 WHERE id = $1`,
      [id, note]
    );
    return NextResponse.json({ ok: true, rejected: true });
  } catch {
    return NextResponse.json({ error: "No se pudo actualizar la solicitud" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!(await isAdmin(request))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const action = String(body?.action ?? "").trim();
  if (action === "approve" || action === "reject") {
    return handleApproval(body, action);
  }
  const name = String(body?.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "Falta el nombre" }, { status: 400 });
  const waPhones = body?.wa_phones ? String(body.wa_phones).trim().slice(0, 400) || null : null;
  const waInvite = body?.wa_invite_url ? String(body.wa_invite_url).trim().slice(0, 500) || null : null;
  const contactName = body?.contact_name ? String(body.contact_name).trim().slice(0, 120) || null : null;
  const coverage = body?.coverage ? String(body.coverage).trim().slice(0, 300) || null : null;
  const vehicle = body?.vehicle ? String(body.vehicle).trim().slice(0, 60) || null : null;
  try {
    // Tres niveles de tolerancia: con todas las columnas nuevas, solo con
    // las de WA (carrier-wa) o legacy plano.
    try {
      const row = await queryOne<Record<string, unknown>>(
        `INSERT INTO carriers (name, phone, email, notes, wa_phones, wa_invite_url, contact_name, coverage, vehicle)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          name.slice(0, 120),
          body?.phone ? String(body.phone).trim().slice(0, 40) || null : null,
          body?.email ? String(body.email).trim().slice(0, 120) || null : null,
          body?.notes ? String(body.notes).trim().slice(0, 500) || null : null,
          waPhones,
          waInvite,
          contactName,
          coverage,
          vehicle,
        ]
      );
      return NextResponse.json({ ok: true, carrier: row });
    } catch {
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
        return NextResponse.json({ ok: true, carrier: row, legacy: "wa" });
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
  const contactName = body?.contact_name !== undefined ? String(body.contact_name ?? "").trim().slice(0, 120) || null : null;
  const coverage = body?.coverage !== undefined ? String(body.coverage ?? "").trim().slice(0, 300) || null : null;
  const vehicle = body?.vehicle !== undefined ? String(body.vehicle ?? "").trim().slice(0, 60) || null : null;
  try {
    // Con columnas nuevas; si la migración no está, reintenta legacy (los
    // campos de WA y del autoregistro se ignoran en ese caso).
    try {
      await query(
        `UPDATE carriers SET
           name = $2,
           phone = $3,
           email = $4,
           notes = $5,
           active = $6,
           wa_phones = $7,
           wa_invite_url = $8,
           contact_name = $9,
           coverage = $10,
           vehicle = $11
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
          contactName,
          coverage,
          vehicle,
        ]
      );
      return NextResponse.json({ ok: true });
    } catch {
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
        return NextResponse.json({ ok: true, legacy: "wa" });
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
    }
  } catch {
    return NextResponse.json({ error: "No se pudo actualizar" }, { status: 500 });
  }
}
