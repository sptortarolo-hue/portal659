import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-utils";
import { queryMany } from "@/lib/db";

export async function GET(request: Request) {
  if (!(await isAdmin(request))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const url = new URL(request.url);
  const vendorId = url.searchParams.get("vendor_id");
  const dateFrom = url.searchParams.get("date_from");
  const dateTo = url.searchParams.get("date_to");
  const status = url.searchParams.get("status");

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (vendorId) {
    params.push(vendorId);
    conditions.push(`osl.order_id = $${params.length}`);
  }
  if (dateFrom) {
    params.push(dateFrom);
    conditions.push(`osl.created_at >= $${params.length}`);
  }
  if (dateTo) {
    params.push(dateTo);
    conditions.push(`osl.created_at <= $${params.length}`);
  }
  if (status) {
    params.push(status);
    conditions.push(`osl.status = $${params.length}`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const logs = await queryMany<Record<string, unknown>>(
    `SELECT osl.*, o.total, o.customer_name, v.store_name
     FROM order_status_log osl
     LEFT JOIN orders o ON o.id = osl.order_id
     LEFT JOIN vendors v ON v.id = o.vendor_id
     ${whereClause}
     ORDER BY osl.created_at DESC
     LIMIT 200`,
    params
  );
  return NextResponse.json({ logs });
}