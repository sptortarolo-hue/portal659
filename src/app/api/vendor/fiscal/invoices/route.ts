import { queryMany, queryOne } from "@/lib/db";
import { getVendorByRequest } from "@/lib/vendor-utils";
import { resolveVendorPlan } from "@/lib/plans";
import type { Plan, Vendor } from "@/types/database";
import { NextResponse } from "next/server";

/** Historial de comprobantes fiscales del comercio (últimos 50). */
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

  const rows = await queryMany(
    `SELECT i.*, o.pickup_number, o.customer_name, o.method, o.channel
     FROM invoices i LEFT JOIN orders o ON o.id = i.order_id
     WHERE i.vendor_id = $1 ORDER BY i.created_at DESC LIMIT 50`,
    [vendor.id]
  );
  return NextResponse.json({ invoices: rows || [] });
}
