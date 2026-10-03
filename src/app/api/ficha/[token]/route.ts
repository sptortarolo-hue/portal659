import { queryOne } from "@/lib/db";
import { sanitizeAnswers, type FormField } from "@/lib/ficha-templates";
import { NextResponse } from "next/server";
import { withRateLimit } from "@/lib/api-wrapper";

/**
 * Llenado público de ficha (sin cuenta): la clienta abre /ficha/[token].
 * - GET: template (campos) + entry (respuestas, estado). 404 si no existe.
 * - POST { answers, status? }: guarda borrador o completa (merge sanitizado).
 * Rate-limit 10/min. El token es por entry (no reutilizable entre clientas).
 */
export const GET = withRateLimit(async (request: Request, { params }: { params: Promise<{ token: string }> }) => {
  const { token } = await params;
  if (!/^[0-9a-f]{32}$/i.test(token)) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  try {
    const row = await queryOne<{
      entry_id: string;
      answers: Record<string, unknown>;
      session_no: number;
      status: string;
      vendor_id: string;
      store_name: string;
      template_name: string;
      fields: FormField[];
    }>(
      `SELECT e.id AS entry_id, e.answers, e.session_no, e.status,
              e.vendor_id::text AS vendor_id, v.store_name,
              t.name AS template_name, t.fields
       FROM customer_form_entries e
       JOIN customer_form_templates t ON t.id = e.template_id
       JOIN vendors v ON v.id = e.vendor_id
       WHERE e.public_token = $1 LIMIT 1`,
      [token]
    );
    if (!row) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
    return NextResponse.json({
      entry: {
        id: row.entry_id,
        answers: row.answers && typeof row.answers === "object" ? row.answers : {},
        session_no: row.session_no,
        status: row.status,
      },
      vendor: { id: row.vendor_id, store_name: row.store_name },
      template: { name: row.template_name, fields: Array.isArray(row.fields) ? row.fields : [] },
    });
  } catch {
    return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  }
}, { maxRequests: 20 });

export const POST = withRateLimit(async (request: Request, { params }: { params: Promise<{ token: string }> }) => {
  const { token } = await params;
  if (!/^[0-9a-f]{32}$/i.test(token)) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  try {
    const current = await queryOne<{ id: string; answers: Record<string, unknown>; template_id: string }>(
      `SELECT id, answers, template_id::text AS template_id FROM customer_form_entries WHERE public_token = $1 LIMIT 1`,
      [token]
    );
    if (!current) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
    const tpl = await queryOne<{ fields: FormField[] }>(
      `SELECT fields FROM customer_form_templates WHERE id = $1 LIMIT 1`,
      [current.template_id]
    ).catch(() => null);
    const fields = tpl && Array.isArray(tpl.fields) ? tpl.fields : [];
    const base = (current.answers && typeof current.answers === "object" ? current.answers : {}) as Record<string, unknown>;
    const merged = { ...base, ...sanitizeAnswers(fields, body.answers) };
    const status = body.status === "complete" ? "complete" : "draft";
    const row = await queryOne<{ status: string }>(
      `UPDATE customer_form_entries SET answers = $1, status = $2 WHERE id = $3 RETURNING status`,
      [JSON.stringify(merged), status, current.id]
    );
    return NextResponse.json({ ok: true, status: row?.status || status });
  } catch {
    return NextResponse.json({ error: "No se pudo guardar" }, { status: 500 });
  }
}, { maxRequests: 10 });
