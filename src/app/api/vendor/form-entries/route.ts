import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryMany, queryOne } from "@/lib/db";
import { sanitizeAnswers, type FormField } from "@/lib/ficha-templates";
import { toE164 } from "@/lib/phone";
import { NextResponse } from "next/server";
import crypto from "crypto";

/**
 * Sesiones de ficha por clienta (panel del comercio).
 * - GET ?phone=&templateId?: timeline (con nombre del modelo).
 * - POST { template_id, customer_phone, booking_id?, answers? }: crea la
 *   sesión (session_no auto + public_token para /ficha/[token]).
 */
export async function GET(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (gate.vendor.vertical !== "estetica") return NextResponse.json({ entries: [] });
  const { searchParams } = new URL(request.url);
  const phone = toE164(searchParams.get("phone") || "");
  if (!phone) return NextResponse.json({ entries: [] });
  const templateId = searchParams.get("templateId") || null;
  try {
    const params: unknown[] = [gate.vendor.id, phone];
    let extra = "";
    if (templateId) {
      params.push(templateId);
      extra = "AND e.template_id = $3";
    }
    const entries = await queryMany<Record<string, unknown>>(
      `SELECT e.*, t.name AS template_name
       FROM customer_form_entries e
       JOIN customer_form_templates t ON t.id = e.template_id
       WHERE e.vendor_id = $1 AND e.customer_phone = $2 ${extra}
       ORDER BY e.created_at DESC LIMIT 50`,
      params
    );
    return NextResponse.json({ entries: entries || [] });
  } catch {
    return NextResponse.json({ entries: [], migrationMissing: true }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (gate.vendor.vertical !== "estetica") {
    return NextResponse.json({ error: "Solo disponible para estética" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const templateId = String(body.template_id || "");
  const phone = toE164(String(body.customer_phone || ""));
  if (!templateId || !phone) {
    return NextResponse.json({ error: "Faltan modelo y teléfono de la clienta" }, { status: 400 });
  }
  try {
    const tpl = await queryOne<{ id: string; fields: FormField[] }>(
      `SELECT id, fields FROM customer_form_templates WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
      [templateId, gate.vendor.id]
    );
    if (!tpl) return NextResponse.json({ error: "Modelo no encontrado" }, { status: 404 });
    const fields = Array.isArray(tpl.fields) ? tpl.fields : [];
    const answers = sanitizeAnswers(fields, body.answers);

    let bookingId: string | null =
      typeof body.booking_id === "string" && body.booking_id ? body.booking_id : null;
    if (bookingId) {
      const bk = await queryOne<{ id: string }>(
        `SELECT id FROM bookings WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
        [bookingId, gate.vendor.id]
      ).catch(() => null);
      if (!bk) bookingId = null;
    }

    const count = await queryOne<{ c: number }>(
      `SELECT COUNT(*)::int AS c FROM customer_form_entries WHERE vendor_id = $1 AND template_id = $2 AND customer_phone = $3`,
      [gate.vendor.id, templateId, phone]
    ).catch(() => ({ c: 0 }));

    const row = await queryOne<Record<string, unknown>>(
      `INSERT INTO customer_form_entries (vendor_id, template_id, customer_phone, booking_id, answers, session_no, status, public_token)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        gate.vendor.id,
        templateId,
        phone,
        bookingId,
        JSON.stringify(answers),
        (count?.c || 0) + 1,
        body.status === "complete" ? "complete" : "draft",
        crypto.randomBytes(16).toString("hex"),
      ]
    );
    return NextResponse.json({ entry: row });
  } catch {
    return NextResponse.json(
      { error: "Falta aplicar la migración migrate-estetica-customer-forms.sql en la base" },
      { status: 503 }
    );
  }
}
