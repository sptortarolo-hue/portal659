import { NextResponse } from "next/server";
import { getAuthSupabase } from "@/lib/auth-utils";
import { isAdmin } from "@/lib/admin-utils";

export async function GET(request: Request) {
  if (!(await isAdmin(request))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const supabase = getAuthSupabase(request)!;
  const url = new URL(request.url);

  const vendorId = url.searchParams.get("vendor_id");
  const dateFrom = url.searchParams.get("date_from");
  const dateTo = url.searchParams.get("date_to");
  const status = url.searchParams.get("status");

  let query = supabase
    .from("order_status_log")
    .select("*, orders(total, customer_name, vendors(store_name))")
    .order("created_at", { ascending: false })
    .limit(200);

  if (vendorId) {
    query = query.eq("order_id", vendorId);
  }
  if (dateFrom) {
    query = query.gte("created_at", dateFrom);
  }
  if (dateTo) {
    query = query.lte("created_at", dateTo);
  }
  if (status) {
    query = query.eq("new_status", status);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ logs: data || [] });
}
