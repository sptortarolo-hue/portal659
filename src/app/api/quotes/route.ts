import { getServiceClient } from "@/lib/supabase";
import { NextResponse } from "next/server";
import { withRateLimit } from "@/lib/api-wrapper";

export const POST = withRateLimit(async (request: Request) => {
  const supabase = getServiceClient();
  if (!supabase) return NextResponse.json({ error: "Error de conexión" }, { status: 503 });

  const body = await request.json();
  const { vendorId, customerName, customerPhone, serviceName, description, preferredDate, preferredTime } = body;

  if (!vendorId || !customerName || !customerPhone || !description) {
    return NextResponse.json({ error: "Faltan datos requeridos" }, { status: 400 });
  }

  const { data, error } = await supabase.from("quotes").insert({
    vendor_id: vendorId,
    customer_name: customerName,
    customer_phone: customerPhone,
    service_name: serviceName || null,
    description,
    preferred_date: preferredDate || null,
    preferred_time: preferredTime || null,
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
      title: "Nuevo presupuesto solicitado",
      body: `${customerName} solicitó presupuesto: "${description.slice(0, 80)}${description.length > 80 ? '...' : ''}"`,
      type: "quote",
      link: "/vendor/dashboard",
    });
  }

  return NextResponse.json({ ok: true, quoteId: data?.id });
}, { maxRequests: 10 });

export async function GET(request: Request) {
  const supabase = getServiceClient();
  if (!supabase) return NextResponse.json({ error: "Error de conexión" }, { status: 503 });

  const { searchParams } = new URL(request.url);
  const vendorId = searchParams.get("vendorId");
  if (!vendorId) return NextResponse.json({ error: "Missing vendorId" }, { status: 400 });

  const { data, error } = await supabase
    .from("quotes")
    .select("*")
    .eq("vendor_id", vendorId)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ quotes: data });
}
