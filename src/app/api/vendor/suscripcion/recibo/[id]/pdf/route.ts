import { getVendorByRequest } from "@/lib/vendor-utils";
import { isAdmin } from "@/lib/admin-utils";
import { queryOne } from "@/lib/db";
import { buildPlanReceiptPdf } from "@/lib/plan-receipt-pdf";
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
  const { vendor } = await getVendorByRequest(request);
  const admin = vendor ? false : await isAdmin(request);
  if (!vendor && !admin) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const receipt = await queryOne<PlanReceipt & { vendor_id: string }>(
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

  const pdf = await buildPlanReceiptPdf({
    vendor: v,
    receiptNumber: `${String(receipt.seq).padStart(4, "0")}/${receipt.year}`,
    issuedAt: receipt.issued_at,
    planName: receipt.plan_name || "Plan",
    amount: Number(receipt.amount),
    periodStart: receipt.period_start,
    periodEnd: receipt.period_end,
    method: receipt.method === "transferencia" ? "Transferencia bancaria" : receipt.method,
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
