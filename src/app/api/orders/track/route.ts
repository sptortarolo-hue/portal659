import { queryMany } from "@/lib/db";
import { NextResponse } from "next/server";
import { withRateLimit } from "@/lib/api-wrapper";
import { formatPhone, isValidPhone, normalizePhoneAR } from "@/lib/order-utils";

export const GET = withRateLimit(async (request: Request) => {
  const { searchParams } = new URL(request.url);
  const rawPhone = searchParams.get("phone");

  if (!rawPhone) {
    return NextResponse.json({ error: "phone requerido" }, { status: 400 });
  }

  // Normalizar a E.164 para display/perfil, pero buscar en orders con formatPhone (dígitos)
  const phoneDigits = formatPhone(rawPhone);
  const phoneE164 = normalizePhoneAR(rawPhone);
  if (!isValidPhone(phoneDigits)) {
    return NextResponse.json({ error: "Formato de teléfono inválido" }, { status: 400 });
  }

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Buscar por customer_phone (guardado solo dígitos) y también por variantes E.164
  const searchVariants = [phoneDigits, phoneE164.replace(/^\+/, "")];

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
     WHERE o.customer_phone = ANY($1) AND o.created_at >= $2
     ORDER BY o.created_at DESC
     LIMIT 20`,
    [searchVariants, sevenDaysAgo]
  );

  return NextResponse.json({ orders: orders || [] });
}, { maxRequests: 15 });