import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryMany } from "@/lib/db";
import { triggeredAlerts, type FormField } from "@/lib/ficha-templates";
import { NextResponse } from "next/server";

/**
 * Alertas de fichas por clienta (para 🚨 en la agenda).
 * GET /api/vendor/form-entries/alerts → { [phone]: [{ template, session_no, labels[] }] }
 * Solo entries `complete` recientes (200 últimas) con campos `alert` disparados.
 */
export async function GET(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (gate.vendor.vertical !== "estetica") return NextResponse.json({ alerts: {} });
  try {
    const rows = await queryMany<{
      customer_phone: string;
      template_id: string;
      template_name: string;
      session_no: number;
      answers: Record<string, unknown>;
      fields: FormField[];
    }>(
      `SELECT e.customer_phone, e.template_id::text AS template_id, t.name AS template_name,
              e.session_no, e.answers, t.fields
       FROM customer_form_entries e
       JOIN customer_form_templates t ON t.id = e.template_id
       WHERE e.vendor_id = $1 AND e.status = 'complete'
       ORDER BY e.created_at DESC LIMIT 200`,
      [gate.vendor.id]
    );
    const out: Record<string, { template: string; session_no: number; labels: string[] }[]> = {};
    const seen = new Set<string>();
    for (const r of rows || []) {
      const fields = Array.isArray(r.fields) ? r.fields : [];
      const answers = (r.answers && typeof r.answers === "object" ? r.answers : {}) as Record<string, unknown>;
      const hits = triggeredAlerts(fields, answers);
      if (hits.length === 0) continue;
      // Una entrada por (clienta, modelo): la más reciente.
      const key = `${r.customer_phone}|${r.template_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const phone = String(r.customer_phone);
      if (!out[phone]) out[phone] = [];
      out[phone].push({
        template: String(r.template_name ?? ""),
        session_no: Number(r.session_no) || 0,
        labels: hits.map((h) => h.label),
      });
    }
    return NextResponse.json({ alerts: out });
  } catch {
    return NextResponse.json({ alerts: {}, migrationMissing: true }, { status: 503 });
  }
}
