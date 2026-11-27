import { queryMany, queryOne } from "@/lib/db";
import { invoiceCustomerSql } from "@/lib/arca/invoice-customer";
import { getVendorByRequest } from "@/lib/vendor-utils";
import { resolveVendorPlan } from "@/lib/plans";
import type { Plan, Vendor } from "@/types/database";
import { NextResponse } from "next/server";

/** Historial de comprobantes fiscales del comercio (últimos 50). */
export async function GET(request: Request) {
  const { vendor: gateVendor, staffRole: gateStaff } = await getVendorByRequest(request);
  if (gateStaff === "delivery" || gateStaff === "staff") {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
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

  const customer = await invoiceCustomerSql();
  const { searchParams } = new URL(request.url);
  const bookingId = searchParams.get("bookingId");
  const orderId = searchParams.get("orderId");
  const lookup = bookingId
    ? customer.hasBookingRef
      ? { where: "AND i.booking_id = $2", value: bookingId }
      : null
    : orderId
      ? { where: "AND i.order_id = $2", value: orderId }
      : null;
  // Sin la columna booking_id no pueden existir facturas de turno: devolvemos
  // lista vacía en vez de un 42703.
  if (bookingId && !customer.hasBookingRef) {
    return NextResponse.json({ invoices: [] });
  }

  const rows = await queryMany(
    `SELECT i.*, o.pickup_number, ${customer.customerExpr} AS customer_name,
            o.method, o.channel${customer.extraCols}
     FROM invoices i LEFT JOIN orders o ON o.id = i.order_id ${customer.join}
     WHERE i.vendor_id = $1 ${lookup?.where ?? ""}
     ORDER BY i.created_at DESC LIMIT 50`,
    lookup ? [vendor.id, lookup.value] : [vendor.id]
  );
  return NextResponse.json({ invoices: rows || [] });
}
