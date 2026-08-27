import { NextResponse } from "next/server";
import { getAuthSupabase, getUserId } from "@/lib/auth-utils";
import { getServiceClient } from "@/lib/supabase";
import { isAdmin } from "@/lib/admin-utils";

export async function GET(request: Request) {
  if (!(await isAdmin(request))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const supabase = getAuthSupabase(request)!;
  const url = new URL(request.url);

  const vertical = url.searchParams.get("vertical");
  const neighborhood = url.searchParams.get("neighborhood");
  const verified = url.searchParams.get("verified");
  const search = url.searchParams.get("search");

  let query = supabase.from("vendors").select("*").order("created_at", { ascending: false });

  if (vertical) query = query.eq("vertical", vertical);
  if (neighborhood) query = query.eq("neighborhood", neighborhood);
  if (verified !== null && verified !== undefined) query = query.eq("verified", verified === "true");
  if (search) {
    query = query.or(`store_name.ilike.%${search}%,slug.ilike.%${search}%`);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ vendors: data || [] });
}

export async function POST(request: Request) {
  if (!(await isAdmin(request))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const body = await request.json();
  const { store_name, slug, vertical, neighborhood, description, phone, whatsapp, address, user_id } = body;

  if (!store_name || !user_id) {
    return NextResponse.json({ error: "store_name y user_id son requeridos" }, { status: 400 });
  }

  const supabase = getServiceClient();
  if (!supabase) return NextResponse.json({ error: "Error de conexión" }, { status: 503 });

  const { data, error } = await supabase.from("vendors").insert({
    user_id,
    store_name,
    slug: slug || store_name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, ""),
    vertical: vertical || "gastronomia",
    neighborhood: neighborhood || "sicardi",
    description: description || "",
    phone: phone || "",
    whatsapp: whatsapp || "",
    address: address || "",
    verified: false,
    is_admin: false,
  }).select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ vendor: data });
}

export async function PATCH(request: Request) {
  if (!(await isAdmin(request))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const body = await request.json();
  const { vendorId, action, data: updateData } = body;

  if (!vendorId) {
    return NextResponse.json({ error: "vendorId es requerido" }, { status: 400 });
  }

  const supabase = getServiceClient();
  if (!supabase) return NextResponse.json({ error: "Error de conexión" }, { status: 503 });

  if (action === "toggle_verified") {
    const { data: vendor } = await supabase.from("vendors").select("verified").eq("id", vendorId).single();
    if (!vendor) return NextResponse.json({ error: "Vendor no encontrado" }, { status: 404 });
    const { error } = await supabase.from("vendors").update({ verified: !vendor.verified }).eq("id", vendorId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, verified: !vendor.verified });
  }

  if (action === "toggle_admin") {
    const { data: vendor } = await supabase.from("vendors").select("is_admin").eq("id", vendorId).single();
    if (!vendor) return NextResponse.json({ error: "Vendor no encontrado" }, { status: 404 });
    const { error } = await supabase.from("vendors").update({ is_admin: !vendor.is_admin }).eq("id", vendorId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, is_admin: !vendor.is_admin });
  }

  if (action === "update" && updateData) {
    const { error } = await supabase.from("vendors").update(updateData).eq("id", vendorId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (action === "set_plan") {
    const { planSlug, days, note } = body;
    if (!planSlug) return NextResponse.json({ error: "planSlug es requerido" }, { status: 400 });

    const { data: plans } = await supabase
      .from("plans")
      .select("id, slug, name")
      .in("slug", ["gratuito", "pedidos", "gestion"]);
    const plan = (plans || []).find((p) => p.slug === planSlug);
    if (!plan) return NextResponse.json({ error: "Plan inválido" }, { status: 400 });

    if (planSlug === "gratuito") {
      const { error } = await supabase
        .from("vendors")
        .update({
          plan_id: plan.id,
          plan_status: "gratuito",
          plan_expires_at: null,
          trial_ends_at: null,
        })
        .eq("id", vendorId);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true, plan: planSlug });
    }

    const periodDays = days && Number(days) > 0 ? Number(days) : 30;
    const { data: vendor } = await supabase
      .from("vendors")
      .select("plan_expires_at")
      .eq("id", vendorId)
      .single();

    const base = vendor?.plan_expires_at
      ? Math.max(Date.now(), new Date(vendor.plan_expires_at).getTime())
      : Date.now();
    const periodEnd = new Date(base + periodDays * 24 * 60 * 60 * 1000).toISOString();
    const periodStart = new Date(base).toISOString();

    const { error: updateError } = await supabase
      .from("vendors")
      .update({
        plan_id: plan.id,
        plan_status: "active",
        plan_expires_at: periodEnd,
        trial_ends_at: null,
      })
      .eq("id", vendorId);
    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

    await supabase.from("vendor_subscriptions").insert({
      vendor_id: vendorId,
      plan_id: plan.id,
      status: "active",
      current_period_start: periodStart,
      current_period_end: periodEnd,
      note: note || `Activado por administrador (${periodDays} días)`,
    });

    return NextResponse.json({ ok: true, plan: planSlug, periodEnd });
  }

  return NextResponse.json({ error: "Acción inválida" }, { status: 400 });
}

export async function DELETE(request: Request) {
  if (!(await isAdmin(request))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const body = await request.json();
  const { vendorId } = body;

  if (!vendorId) {
    return NextResponse.json({ error: "vendorId es requerido" }, { status: 400 });
  }

  const supabase = getServiceClient();
  if (!supabase) return NextResponse.json({ error: "Error de conexión" }, { status: 503 });
  const { error } = await supabase.from("vendors").delete().eq("id", vendorId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
