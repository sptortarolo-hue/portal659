import { getVendorByRequest } from "@/lib/vendor-utils";
import { isAdmin } from "@/lib/admin-utils";
import { queryOne } from "@/lib/db";
import { derivePromoFor } from "@/lib/plan-payments";
import { NextResponse } from "next/server";
import type { PlanReceipt, Vendor } from "@/types/database";

export const dynamic = "force-dynamic";

function methodLabel(method: string | null): string {
  if (method === "efectivo") return "Efectivo";
  if (method === "mercadopago") return "Mercado Pago";
  return "Transferencia bancaria";
}

/**
 * Datos de un Recibo X para la vista A4 (y para el panel del admin).
 * GET /api/vendor/suscripcion/recibo/[id]
 * Lo puede leer el dueño del comercio o el admin (no depende de que la
 * sesión del admin tenga comercio propio: antes el A4 le daba 403).
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
    `SELECT * FROM plan_receipts WHERE id = $1 LIMIT 1`,
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

  // Snapshot del descuento o derivado del promo vigente (recibos viejos).
  const promo =
    receipt.promo_pct != null && receipt.promo_list_price != null
      ? { pct: Number(receipt.promo_pct), listPrice: Number(receipt.promo_list_price) }
      : await derivePromoFor(receipt.plan_id, Number(receipt.amount));

  return NextResponse.json({
    admin,
    vendor_id: receipt.vendor_id,
    receipt: {
      id: receipt.id,
      amount: Number(receipt.amount),
      plan_name: receipt.plan_name,
      seq: receipt.seq,
      year: receipt.year,
      method: receipt.method,
      method_label: methodLabel(receipt.method),
      issued_at: receipt.issued_at,
      emailed_at: receipt.emailed_at,
      period_start: receipt.period_start,
      period_end: receipt.period_end,
      promo_pct: promo?.pct ?? null,
      promo_list_price: promo?.listPrice ?? null,
    },
    vendor: v,
  });
}
