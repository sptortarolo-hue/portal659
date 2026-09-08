import { queryMany } from "@/lib/db";
import { NextResponse } from "next/server";
import { withRateLimit } from "@/lib/api-wrapper";
import { formatPhone, isValidPhone } from "@/lib/order-utils";
import { phoneVariantsAR } from "@/lib/phone";

export const GET = withRateLimit(async (request: Request) => {
  const { searchParams } = new URL(request.url);
  const rawPhone = searchParams.get("phone");

  if (!rawPhone) {
    return NextResponse.json({ error: "phone requerido" }, { status: 400 });
  }

  const phoneDigits = formatPhone(rawPhone);
  if (!isValidPhone(phoneDigits)) {
    return NextResponse.json({ error: "Formato de teléfono inválido" }, { status: 400 });
  }

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Buscar por dígitos: matchea customer_phone guardado en cualquier formato.
  const searchVariants = phoneVariantsAR(rawPhone);

  const orders = await queryMany<Record<string, unknown>>(
    `SELECT o.*,
            jsonb_build_object(
              'store_name', v.store_name,
              'slug', v.slug,
              'whatsapp', v.whatsapp,
              'phone', v.phone,
              'prep_time_min', v.prep_time_min,
              'vertical', v.vertical
            ) AS vendors
     FROM orders o
     LEFT JOIN vendors v ON v.id = o.vendor_id
     WHERE regexp_replace(o.customer_phone, '[^0-9]', '', 'g') = ANY($1) AND o.created_at >= $2
     ORDER BY o.created_at DESC
     LIMIT 20`,
    [searchVariants, sevenDaysAgo]
  );

  return NextResponse.json({ orders: orders || [] });
}, { maxRequests: 15 });