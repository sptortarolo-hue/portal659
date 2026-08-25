import { getServiceClient } from "@/lib/supabase";
import { NextResponse } from "next/server";
import { withRateLimit } from "@/lib/api-wrapper";

export const POST = withRateLimit(async (request: Request) => {
  const supabase = getServiceClient();
  if (!supabase) return NextResponse.json({ error: "Error de conexión" }, { status: 503 });

  const body = await request.json();
  const { vendorId, productName, bookingDate, bookingTime, notes, customerName, customerPhone } = body;

  if (!vendorId || !bookingDate || !bookingTime || !customerName || !customerPhone) {
    return NextResponse.json({ error: "Faltan datos requeridos" }, { status: 400 });
  }

  const { data, error } = await supabase.from("bookings").insert({
    vendor_id: vendorId,
    product_id: vendorId,
    customer_id: "anonymous",
    product_name: productName || null,
    booking_date: bookingDate,
    booking_time: bookingTime,
    notes: notes || null,
    status: "pending",
  }).select("id").single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: vendor } = await supabase
    .from("vendors")
    .select("user_id, store_name")
    .eq("id", vendorId)
    .single();

  if (vendor?.user_id) {
    await supabase.from("notifications").insert({
      user_id: vendor.user_id,
      title: "Nuevo turno reservado",
      body: `${customerName} reservó turno para ${bookingDate} a las ${bookingTime}${productName ? ` — ${productName}` : ""}`,
      type: "booking",
      link: "/vendor/dashboard",
    });
  }

  return NextResponse.json({ ok: true, bookingId: data?.id });
}, { maxRequests: 10 });
