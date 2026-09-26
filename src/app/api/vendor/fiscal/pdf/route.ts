import { queryMany, queryOne } from "@/lib/db";
import { getVendorByRequest } from "@/lib/vendor-utils";
import { resolveVendorPlan } from "@/lib/plans";
import { getInvoicePdfBundle } from "@/lib/arca/invoice-pdf";
import type { Plan, Vendor } from "@/types/database";
import { NextResponse } from "next/server";

/**
 * PDF A4 del comprobante (generado bajo demanda, no en cada emisión).
 * GET /api/vendor/fiscal/pdf?invoiceId=[&format=url] → archivo o {pdf_url}.
 */
export async function GET(request: Request) {
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

  const { searchParams } = new URL(request.url);
  const invoiceId = searchParams.get("invoiceId") || "";
  if (!invoiceId) return NextResponse.json({ error: "invoiceId requerido" }, { status: 400 });

  const bundle = await getInvoicePdfBundle(vendor, invoiceId);
  if (!bundle) return NextResponse.json({ error: "Comprobante no encontrado" }, { status: 404 });

  if (searchParams.get("format") === "url") {
    return NextResponse.json({ ok: true, pdf_url: bundle.publicUrl, fname: bundle.fname });
  }

  return new NextResponse(new Uint8Array(bundle.pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${bundle.fname}"`,
      "Cache-Control": "public, max-age=3600",
    },
  });
}
