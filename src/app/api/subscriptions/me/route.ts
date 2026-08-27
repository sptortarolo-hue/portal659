import { getAuthSupabase, getUserId } from "@/lib/auth-utils";
import { resolveVendorPlan, daysLeft } from "@/lib/plans";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const supabase = getAuthSupabase(request);
  if (!supabase) return NextResponse.json({ error: "Error de conexión" }, { status: 503 });

  const userId = await getUserId(supabase);
  if (!userId) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const [vendorRes, plansRes, historyRes] = await Promise.all([
    supabase.from("vendors").select("*").eq("user_id", userId).maybeSingle(),
    supabase.from("plans").select("*").order("sort", { ascending: true }),
    supabase
      .from("vendor_subscriptions")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(24),
  ]);

  const vendor = vendorRes.data;
  if (!vendor) return NextResponse.json({ error: "No tenés un local" }, { status: 403 });

  const plans = plansRes.data || [];
  const effective = resolveVendorPlan(vendor, plans);

  const { count } = await supabase
    .from("products")
    .select("id", { count: "exact", head: true })
    .eq("vendor_id", vendor.id);

  const usage = {
    products: count || 0,
    maxProducts: effective.maxProducts,
    overLimit: effective.maxProducts != null && (count || 0) > effective.maxProducts,
    percent: effective.maxProducts != null
      ? Math.min(100, Math.round(((count || 0) / effective.maxProducts) * 100))
      : (count || 0) > 0 ? 100 : 0,
  };

  return NextResponse.json({
    vendorId: vendor.id,
    vertical: vendor.vertical,
    plans,
    effective: {
      slug: effective.slug,
      status: effective.status,
      trialActive: effective.trialActive,
      active: effective.active,
      expired: effective.expired,
      eligibleForPaid: effective.eligibleForPaid,
      name: effective.plan?.name ?? null,
      badge: effective.plan?.badge ?? null,
      priceMonthly: effective.plan?.price_monthly ?? 0,
      analyticsDays: effective.analyticsDays,
    },
    trial: {
      endsAt: effective.trialEndsAt,
      daysLeft: daysLeft(effective.trialEndsAt),
      hasTrial: effective.hasTrial,
    },
    usage,
    history: historyRes.data || [],
  });
}