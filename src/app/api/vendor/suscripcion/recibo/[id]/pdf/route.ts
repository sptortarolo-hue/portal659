import { getVendorByRequest } from "@/lib/vendor-utils";
import { isAdmin } from "@/lib/admin-utils";
import { queryOne } from "@/lib/db";
import { buildPlanReceiptPdf } from "@/lib/plan-receipt-pdf";
import { derivePromoFor } from "@/lib/plan-payments";
import { NextResponse } from "next/server";
import type { PlanReceipt, Vendor } from "@/types/database";

export const dynamic = "force-dynamic";

/**
 * PDF del Recibo X (documento no válido como factura) de un pago de plan.
 * GET /api/vendor/suscripcion/recibo/[id]/pdf
 * Lo baja el dueño del comercio o el admin.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const admin = await isAdmin(request);
  const { vendor } = await getVendorByRequest(request);
  if (!admin && !vendor) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const receipt = await queryOne<PlanReceipt & { vendor_id: string; plan_id: string | null }>(
    `SELECT r.*, v.id AS vendor_id
       FROM plan_receipts r JOIN vendors v ON v.id = r.vendor_id
      WHERE r.id = $1 LIMIT 1`,
    [id]
  ).catch(() => undefined);

  if (!receipt) return NextResponse.json({ error: "Recibo no encontrado" }, { status: 404 });
  if (!admin && vendor?.id !== receipt.vendor_id) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const v = await queryOne<Pick<Vendor, "store_name" | "address" | "phone" | "whatsapp">>(
    `SELECT store_name, address, phone, whatsapp FROM vendors WHERE id = $1 LIMIT 1`,
    [receipt.vendor_id]
  );
  if (!v) return NextResponse.json({ error: "Comercio no encontrado" }, { status: 404 });

  // Mismo criterio que el A4 y el mail: snapshot del recibo, o derivado del
  // promo vigente si el monto coincide (recibos viejos sin la columna).
  const promo =
    receipt.promo_pct != null && receipt.promo_list_price != null
      ? { pct: Number(receipt.promo_pct), listPrice: Number(receipt.promo_list_price) }
      : await derivePromoFor(receipt.plan_id, Number(receipt.amount));
  const priceNote = promo
    ? `precio promo −${promo.pct}% (lista $${promo.listPrice.toLocaleString("es-AR")})`
    : "precio de lista";

  const pdf = await buildPlanReceiptPdf({
    vendor: v,
    receiptNumber: `${String(receipt.seq).padStart(4, "0")}/${receipt.year}`,
    issuedAt: receipt.issued_at,
    planName: receipt.plan_name || "Plan",
    amount: Number(receipt.amount),
    periodStart: receipt.period_start,
    periodEnd: receipt.period_end,
    method: receipt.method === "transferencia" ? "Transferencia bancaria" : receipt.method,
    priceNote,
  });

  const fname = `recibo-X-${String(receipt.seq).padStart(4, "0")}-${receipt.year}.pdf`;
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${fname}"`,
      "Cache-Control": "no-store",
    },
  });
}
