import { getVendorByRequest } from "@/lib/vendor-utils";
import { queryMany, queryOne } from "@/lib/db";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q");
  const status = searchParams.get("status");
  const method = searchParams.get("method");
  const paymentMethod = searchParams.get("payment_method");
  const dateFrom = searchParams.get("date_from");
  const dateTo = searchParams.get("date_to");
  const page = Math.max(1, Number(searchParams.get("page") || 1));
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get("page_size") || 25)));

  const conditions: string[] = ["vendor_id = $1"];
  const params: unknown[] = [vendor.id];
  let idx = 2;

  if (q) {
    params.push(`%${q.toLowerCase()}%`);
    conditions.push(`(lower(customer_name) LIKE $${idx} OR customer_phone ILIKE $${idx} OR id::text LIKE $${idx})`);
    idx++;
  }
  if (status) {
    params.push(status);
    conditions.push(`status = $${idx}`);
    idx++;
  }
  if (method) {
    params.push(method);
    conditions.push(`method = $${idx}`);
    idx++;
  }
  if (paymentMethod) {
    params.push(paymentMethod);
    conditions.push(`payment_method = $${idx}`);
    idx++;
  }
  if (dateFrom) {
    params.push(`${dateFrom}T00:00:00`);
    conditions.push(`created_at >= $${idx}::timestamptz`);
    idx++;
  }
  if (dateTo) {
    params.push(`${dateTo}T23:59:59`);
    conditions.push(`created_at <= $${idx}::timestamptz`);
    idx++;
  }

  const where = conditions.join(" AND ");
  const offset = (page - 1) * pageSize;

  const [orders, totalRow] = await Promise.all([
    queryMany<Record<string, unknown>>(
      `SELECT * FROM orders WHERE ${where} ORDER BY created_at DESC LIMIT ${pageSize} OFFSET ${offset}`,
      params
    ),
    queryOne<{ c: number }>(
      `SELECT count(*)::int AS c FROM orders WHERE ${where}`,
      params
    ),
  ]);

  return NextResponse.json({
    orders: orders || [],
    total: totalRow?.c || 0,
    page,
    pageSize,
  });
}