import { getUserId } from "@/lib/auth-utils";
import { resolveOwnedVendorId } from "@/lib/vendor-utils";
import { query, queryOne } from "@/lib/db";
import { PLAN_IDS } from "@/lib/plans";
import { NextResponse } from "next/server";

const TRIAL_DAYS = 30;

export async function POST(request: Request) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const body = await request.json();
  const planSlug = body?.planSlug;

  // Multi-tienda: override body.vendorId validado como propio, luego la
  // cookie `portal659-vendor-id`, luego el primero del dueño.
  const ownedVendorId = await resolveOwnedVendorId(userId, request, body?.vendorId);
  if (!ownedVendorId) return NextResponse.json({ error: "No tenés un local" }, { status: 403 });

  const vendor = await queryOne<{
    id: string;
    vertical: string;
    plan_id: string | null;
    plan_status: string | null;
    plan_expires_at: string | null;
    trial_ends_at: string | null;
    visibility: "hidden" | "private" | "public" | null;
    visible: boolean | null;
  }>(
    `SELECT id, vertical, plan_id, plan_status, plan_expires_at, trial_ends_at, visibility, visible FROM vendors WHERE id = $1 AND user_id = $2 LIMIT 1`,
    [ownedVendorId, userId]
  );

  if (!vendor) return NextResponse.json({ error: "No tenés un local" }, { status: 403 });

  // En preview (hidden) no corre el reloj: primero hay que publicar el comercio.
  const vis = vendor.visibility ?? (vendor.visible ? "public" : "hidden");
  if (vis === "hidden") {
    return NextResponse.json(
      { error: "Publicá tu comercio antes de activar un plan: en modo prueba ya tenés todo habilitado." },
      { status: 403 }
    );
  }

  if (vendor.vertical !== "gastronomia" && vendor.vertical !== "comercio" && vendor.vertical !== "moda" && vendor.vertical !== "servicio" && vendor.vertical !== "estetica") {
    return NextResponse.json(
      { error: "Los planes pagos están disponibles para gastronomía, comercios de barrio, moda, estética y servicios" },
      { status: 400 }
    );
  }

  // Cada vertical compra su plan: servicios solo Oficios; estética compra
  // "Turnera" (fila `pedidos`) o Gestión integral. Oficios ya no se vende
  // a estética: solo queda accesible como activación/renovación grandfathering
  // para quien ya lo tiene como plan actual.
  const grandfatheredOficios = vendor.vertical === "estetica" && vendor.plan_id === PLAN_IDS.oficios;
  const allowedSlugs =
    vendor.vertical === "servicio"
      ? ["oficios"]
      : vendor.vertical === "estetica"
        ? grandfatheredOficios ? ["oficios", "pedidos", "gestion"] : ["pedidos", "gestion"]
      : ["pedidos", "gestion"];
  if (!allowedSlugs.includes(planSlug)) {
    return NextResponse.json({ error: "Plan inválido para tu rubro" }, { status: 400 });
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

  const plan = await queryOne<{ id: string; slug: string; name: string }>(
    `SELECT id, slug, name FROM plans WHERE slug = $1 LIMIT 1`,
    [planSlug]
  );

  if (!plan) return NextResponse.json({ error: "Plan no encontrado" }, { status: 404 });

  await query(
    `UPDATE vendors SET plan_id = $1, plan_status = 'trial', trial_ends_at = $2, plan_expires_at = $2 WHERE id = $3`,
    [plan.id, trialEnds, vendor.id]
  );

  await query(
    `INSERT INTO vendor_subscriptions (vendor_id, plan_id, status, current_period_start, current_period_end, note)
     VALUES ($1, $2, 'trial', $3, $4, $5)`,
    [vendor.id, plan.id, new Date(now).toISOString(), trialEnds, `Trial ${TRIAL_DAYS} días — ${plan.name}`]
  );

  return NextResponse.json({
    ok: true,
    plan: { slug: plan.slug, name: plan.name },
    trialEndsAt: trialEnds,
    message: `¡Trial de ${TRIAL_DAYS} días de ${plan.name} activado!`,
  });
}