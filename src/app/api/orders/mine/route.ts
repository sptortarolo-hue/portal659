import { queryMany } from "@/lib/db";
import { getUserId } from "@/lib/auth-utils";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const userId = await getUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const orders = await queryMany<Record<string, unknown>>(
    `SELECT o.*,
            jsonb_build_object(
              'store_name', v.store_name,
              'slug', v.slug,
              'whatsapp', v.whatsapp,
              'phone', v.phone,
              'vertical', v.vertical
            ) AS vendors
     FROM orders o
     LEFT JOIN vendors v ON v.id = o.vendor_id
     WHERE o.customer_id = $1
     ORDER BY o.created_at DESC
     LIMIT 50`,
    [userId]
  );

  return NextResponse.json({ orders: orders || [] });
}