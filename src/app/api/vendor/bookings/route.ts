import { getAuthSupabase } from "@/lib/auth-utils";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const supabase = getAuthSupabase(request);
  if (!supabase) return NextResponse.json({ error: "Error de conexión" }, { status: 503 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { data: vendor } = await supabase.from("vendors").select("id").eq("user_id", user.id).maybeSingle();
  if (!vendor) return NextResponse.json({ bookings: [] });

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const date = searchParams.get("date");

  let query = supabase
    .from("bookings")
    .select("*, products(name)")
    .eq("vendor_id", vendor.id)
    .order("booking_date", { ascending: true })
    .order("booking_time", { ascending: true });

  if (status) query = query.eq("status", status);
  if (date) query = query.eq("booking_date", date);

  const { data: bookings } = await query;
  return NextResponse.json({ bookings: bookings || [] });
}
