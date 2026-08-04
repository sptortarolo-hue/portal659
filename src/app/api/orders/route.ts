import { getSupabase } from "@/lib/supabase";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json({ error: "Error de conexión" }, { status: 503 });
  }

  const body = await request.json();
  const {
    vendorId,
    customerName,
    customerPhone,
    customerAddress,
    method,
    items,
    total,
  } = body;

  if (!vendorId || !customerName || !customerPhone || !items || !total) {
    return NextResponse.json(
      { error: "Faltan datos requeridos" },
      { status: 400 }
    );
  }

  const { data, error } = await supabase.from("orders").insert({
    vendor_id: vendorId,
    customer_name: customerName,
    customer_phone: customerPhone,
    customer_address: customerAddress || null,
    method: method === "pickup" ? "pickup" : "delivery",
    items,
    total,
    status: "new",
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
