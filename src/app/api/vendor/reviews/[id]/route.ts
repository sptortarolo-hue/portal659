import { getAuthSupabase, getUserId } from "@/lib/auth-utils";
import { getServiceClient } from "@/lib/supabase";
import { resolveVendorPlan } from "@/lib/plans";
import { NextResponse } from "next/server";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = getAuthSupabase(request);
  if (!supabase) return NextResponse.json({ error: "Error de conexión" }, { status: 503 });

  const userId = await getUserId(supabase);
  if (!userId) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { data: vendor } = await supabase
    .from("vendors")
    .select("id, store_name, vertical, plan_id, plan_status, plan_expires_at, trial_ends_at")
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

  const { id } = await params;
  const body = await request.json();
  const { reply } = body;

  if (typeof reply !== "string" || reply.trim().length === 0) {
    return NextResponse.json({ error: "Escribí una respuesta" }, { status: 400 });
  }
  if (reply.trim().length > 600) {
    return NextResponse.json({ error: "La respuesta es muy larga (máx. 600 caracteres)" }, { status: 400 });
  }

  const { data: review } = await supabase
    .from("reviews")
    .select("id")
    .eq("id", id)
    .eq("vendor_id", vendor.id)
    .maybeSingle();

  if (!review) return NextResponse.json({ error: "Reseña no encontrada" }, { status: 404 });

  const svc = getServiceClient();
  if (!svc) return NextResponse.json({ error: "Error de conexión" }, { status: 503 });

  const { error } = await svc
    .from("reviews")
    .update({ reply: reply.trim(), reply_by: vendor.store_name, replied_at: new Date().toISOString() })
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}