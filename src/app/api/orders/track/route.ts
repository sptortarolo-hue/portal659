import { getServiceClient } from "@/lib/supabase";
import { NextResponse } from "next/server";
import { withRateLimit } from "@/lib/api-wrapper";
import { formatPhone, isValidPhone } from "@/lib/order-utils";

export const GET = withRateLimit(async (request: Request) => {
  const supabase = getServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "Error de conexión" }, { status: 503 });
  }

  const { searchParams } = new URL(request.url);
  const rawPhone = searchParams.get("phone");

  if (!rawPhone) {
    return NextResponse.json({ error: "phone requerido" }, { status: 400 });
  }

  const phone = formatPhone(rawPhone);
  if (!isValidPhone(phone)) {
    return NextResponse.json({ error: "Formato de teléfono inválido" }, { status: 400 });
  }

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("orders")
    .select("*, vendors(store_name, slug, whatsapp, phone, prep_time_min)")
    .eq("customer_phone", phone)
    .gte("created_at", sevenDaysAgo)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ orders: data || [] });
}, { maxRequests: 15 });
