import { queryOne } from "@/lib/db";
import { withRateLimit } from "@/lib/api-wrapper";
import { isValidPhone } from "@/lib/order-utils";
import { phoneVariants } from "@/lib/device-merge";
import { NextResponse } from "next/server";

export const GET = withRateLimit(async (request: Request) => {
  const { searchParams } = new URL(request.url);
  const rawPhone = searchParams.get("phone");

  if (!rawPhone) {
    return NextResponse.json({ error: "phone requerido" }, { status: 400 });
  }

  if (!isValidPhone(rawPhone)) {
    return NextResponse.json({ error: "Formato de teléfono inválido" }, { status: 400 });
  }

  const variants = phoneVariants(rawPhone);

  const last = await queryOne<{ customer_name: string | null; neighborhood: string | null }>(
    `SELECT customer_name, neighborhood
     FROM orders o
     WHERE regexp_replace(o.customer_phone, '[^0-9]', '', 'g') = ANY($1::text[])
       AND o.created_at >= now() - interval '90 days'
     ORDER BY o.created_at DESC
     LIMIT 1`,
    [variants]
  );

  if (!last) {
    return NextResponse.json({ ok: true, found: false });
  }

  return NextResponse.json({
    ok: true,
    found: true,
    name: last.customer_name || null,
    neighborhood: last.neighborhood || null,
  });
}, { maxRequests: 20 });