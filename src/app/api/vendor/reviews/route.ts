import { getAuthSupabase, getUserId } from "@/lib/auth-utils";
import { resolveVendorPlan } from "@/lib/plans";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const supabase = getAuthSupabase(request);
  if (!supabase) return NextResponse.json({ error: "Error de conexión" }, { status: 503 });

  const userId = await getUserId(supabase);
  if (!userId) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { data: vendor } = await supabase
    .from("vendors")
    .select("id, vertical, plan_id, plan_status, plan_expires_at, trial_ends_at")
    .eq("user_id", userId)
    .single();

  if (!vendor) return NextResponse.json({ error: "No tenés un local" }, { status: 403 });

  const { data: plans } = await supabase.from("plans").select("*");
  const plan = resolveVendorPlan(vendor, plans || []);

  if (!plan.can("reviews_manage")) {
    return NextResponse.json(
      { error: "Responder reseñas requiere el nivel Pedidos o Gestión integral." },
      { status: 403 }
    );
  }

  const { data: reviews } = await supabase
    .from("reviews")
    .select("id, customer_name, product_id, rating, comment, reply, reply_by, replied_at, created_at")
    .eq("vendor_id", vendor.id)
    .order("created_at", { ascending: false })
    .limit(100);

  return NextResponse.json({ reviews: reviews || [] });
}