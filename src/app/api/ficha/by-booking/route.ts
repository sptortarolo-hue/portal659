import { queryMany, queryOne } from "@/lib/db";
import { NextResponse } from "next/server";
import { withRateLimit } from "@/lib/api-wrapper";
import crypto from "crypto";

/**
 * Crea (o reutiliza) el borrador de ficha para un turno, desde /turno/[token].
 * POST { booking_token, template_id } → { public_token, url, existing }.
 * Público con rate-limit: el booking_token ya acredita a la clienta.
 */
export const POST = withRateLimit(async (request: Request) => {
  const body = await request.json().catch(() => ({}));
  const bookingToken = String(body.booking_token || "").trim();
  const templateId = String(body.template_id || "").trim();
  if (!/^[0-9a-f]{32}$/i.test(bookingToken) || !templateId) {
    return NextResponse.json({ error: "Solicitud inválida" }, { status: 400 });
  }
  try {
    const booking = await queryOne<{
      id: string;
      vendor_id: string;
      customer_phone: string | null;
      service_id: string | null;
    }>(
      `SELECT id, vendor_id::text AS vendor_id, customer_phone, service_id::text AS service_id
       FROM bookings WHERE confirm_token = $1 LIMIT 1`,
      [bookingToken]
    ).catch(() => undefined);
    if (!booking) return NextResponse.json({ error: "Turno no encontrado" }, { status: 404 });

    const tpl = await queryOne<{ id: string; service_ids: string[] }>(
      `SELECT id, service_ids FROM customer_form_templates WHERE id = $1 AND vendor_id = $2 AND active = true LIMIT 1`,
      [templateId, booking.vendor_id]
    ).catch(() => undefined);
    if (!tpl) return NextResponse.json({ error: "Modelo no disponible" }, { status: 404 });
    const attached = Array.isArray(tpl.service_ids) ? tpl.service_ids.map(String) : [];
    if (attached.length > 0 && booking.service_id && !attached.includes(booking.service_id)) {
      return NextResponse.json({ error: "Esa ficha no corresponde a este turno" }, { status: 400 });
    }

    // Reutiliza borrador existente del mismo turno+modelo.
    const existing = await queryOne<{ public_token: string; status: string }>(
      `SELECT public_token, status FROM customer_form_entries
       WHERE vendor_id = $1 AND template_id = $2 AND booking_id = $3 LIMIT 1`,
      [booking.vendor_id, templateId, booking.id]
    ).catch(() => undefined);
    if (existing?.public_token) {
      return NextResponse.json({
        public_token: existing.public_token,
        url: `/ficha/${existing.public_token}`,
        existing: true,
        status: existing.status,
      });
    }

    if (!booking.customer_phone) {
      return NextResponse.json({ error: "El turno no tiene teléfono registrado" }, { status: 400 });
    }
    const count = await queryOne<{ c: number }>(
      `SELECT COUNT(*)::int AS c FROM customer_form_entries WHERE vendor_id = $1 AND template_id = $2 AND customer_phone = $3`,
      [booking.vendor_id, templateId, booking.customer_phone]
    ).catch(() => ({ c: 0 }));
    const row = await queryOne<{ public_token: string }>(
      `INSERT INTO customer_form_entries (vendor_id, template_id, customer_phone, booking_id, answers, session_no, status, public_token)
       VALUES ($1, $2, $3, $4, '{}', $5, 'draft', $6) RETURNING public_token`,
      [booking.vendor_id, templateId, booking.customer_phone, booking.id, (count?.c || 0) + 1, crypto.randomBytes(16).toString("hex")]
    );
    if (!row?.public_token) return NextResponse.json({ error: "No se pudo crear" }, { status: 500 });
    return NextResponse.json({ public_token: row.public_token, url: `/ficha/${row.public_token}`, existing: false, status: "draft" });
  } catch {
    return NextResponse.json({ error: "Fichas no disponibles (falta migración)" }, { status: 503 });
  }
}, { maxRequests: 10 });
