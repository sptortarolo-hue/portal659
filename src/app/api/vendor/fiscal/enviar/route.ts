import { queryMany, queryOne } from "@/lib/db";
import { getVendorByRequest } from "@/lib/vendor-utils";
import { resolveVendorPlan } from "@/lib/plans";
import { getInvoicePdfBundle } from "@/lib/arca/invoice-pdf";
import { invoiceEmail, sendEmail } from "@/lib/email";
import type { Plan, Vendor } from "@/types/database";
import { NextResponse } from "next/server";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Envía el comprobante por email con el PDF adjunto.
 * POST /api/vendor/fiscal/enviar { invoiceId, to }
 */
export async function POST(request: Request) {
  const { vendor: gateVendor } = await getVendorByRequest(request);
  if (!gateVendor) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  const vendor = await queryOne<Vendor>(
    `SELECT * FROM vendors WHERE id = $1 LIMIT 1`,
    [gateVendor.id]
  );
  if (!vendor) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const plans = await queryMany<Plan>(`SELECT * FROM plans`);
  const plan = resolveVendorPlan(vendor, plans || []);
  if (!plan.can("fiscal")) {
    return NextResponse.json(
      { error: "Facturación electrónica exclusiva del plan Gestión integral", code: "plan_limit" },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const invoiceId = String(body.invoiceId || "");
  const to = String(body.to || "").trim().toLowerCase();
  if (!invoiceId) return NextResponse.json({ error: "invoiceId requerido" }, { status: 400 });
  if (!EMAIL_RE.test(to)) {
    return NextResponse.json({ error: "Email inválido" }, { status: 400 });
  }
  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json(
      { error: "Email no configurado en el portal (falta RESEND_API_KEY)" },
      { status: 409 }
    );
  }

  const bundle = await getInvoicePdfBundle(vendor, invoiceId);
  if (!bundle) return NextResponse.json({ error: "Comprobante no encontrado" }, { status: 404 });

  const isNc = Number(bundle.invoice.cbte_tipo) === 13;
  const docLabel = isNc ? "Nota de Crédito C" : "Factura C";
  const docNumber = `${String(bundle.invoice.punto_venta).padStart(4, "0")}-${String(bundle.invoice.cbte_nro).padStart(8, "0")}`;
  const { subject, html } = invoiceEmail({
    storeName: vendor.store_name || "tu comercio",
    docLabel,
    docNumber,
    total: Number(bundle.invoice.total),
  });

  const sent = await sendEmail({
    to,
    subject,
    html,
    attachments: [{ filename: bundle.fname, content: bundle.pdf.toString("base64") }],
  });
  if (!sent) {
    return NextResponse.json({ error: "No se pudo enviar el email" }, { status: 502 });
  }
  return NextResponse.json({ ok: true, to });
}
