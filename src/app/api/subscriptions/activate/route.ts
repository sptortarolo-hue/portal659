import { getAuthSupabase, getUserId } from "@/lib/auth-utils";
import { getServiceClient } from "@/lib/supabase";
import { NextResponse } from "next/server";

const TRIAL_DAYS = 30;

export async function POST(request: Request) {
  const supabase = getAuthSupabase(request);
  if (!supabase) return NextResponse.json({ error: "Error de conexión" }, { status: 503 });

  const db = getServiceClient();
  if (!db) return NextResponse.json({ error: "Error de conexión" }, { status: 503 });

  const userId = await getUserId(supabase);
  if (!userId) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { planSlug } = await request.json();

  if (planSlug !== "pedidos" && planSlug !== "gestion") {
    return NextResponse.json({ error: "Plan inválido" }, { status: 400 });
  }

  const { data: vendor } = await supabase
    .from("vendors")
    .select("id, vertical, plan_id, plan_status, plan_expires_at, trial_ends_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (!vendor) return NextResponse.json({ error: "No tenés un local" }, { status: 403 });

  if (vendor.vertical !== "gastronomia") {
    return NextResponse.json(
      { error: "Los planes pagos están disponibles solo para gastronomía por ahora" },
      { status: 400 }
    );
  }

  const now = Date.now();
  const trialEnds = new Date(now + TRIAL_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const stillOnTrial =
    vendor.plan_status === "trial" &&
    vendor.trial_ends_at &&
    new Date(vendor.trial_ends_at).getTime() > now;

  const stillActive =
    vendor.plan_status === "active" &&
    vendor.plan_expires_at &&
    new Date(vendor.plan_expires_at).getTime() > now;

  if (stillOnTrial || stillActive) {
    return NextResponse.json(
      { error: "Ya tenés un plan activo o un trial en curso" },
      { status: 400 }
    );
  }

  const { data: plan } = await supabase
    .from("plans")
    .select("id, slug, name")
    .eq("slug", planSlug)
    .single();

  if (!plan) return NextResponse.json({ error: "Plan no encontrado" }, { status: 404 });

  const { error: updateError } = await db
    .from("vendors")
    .update({
      plan_id: plan.id,
      plan_status: "trial",
      trial_ends_at: trialEnds,
      plan_expires_at: trialEnds,
    })
    .eq("id", vendor.id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  const { error: subError } = await db.from("vendor_subscriptions").insert({
    vendor_id: vendor.id,
    plan_id: plan.id,
    status: "trial",
    current_period_start: new Date(now).toISOString(),
    current_period_end: trialEnds,
    note: `Trial ${TRIAL_DAYS} días — ${plan.name}`,
  });

  if (subError) {
    return NextResponse.json({ error: subError.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    plan: { slug: plan.slug, name: plan.name },
    trialEndsAt: trialEnds,
    message: `¡Trial de ${TRIAL_DAYS} días de ${plan.name} activado!`,
  });
}