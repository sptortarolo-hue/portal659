import { getUserId } from "@/lib/auth-utils";
import { query, queryOne } from "@/lib/db";
import { NextResponse } from "next/server";

const TRIAL_DAYS = 30;

export async function POST(request: Request) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { planSlug } = await request.json();

  if (planSlug !== "pedidos" && planSlug !== "gestion") {
    return NextResponse.json({ error: "Plan inválido" }, { status: 400 });
  }

  const vendor = await queryOne<{
    id: string;
    vertical: string;
    plan_id: string | null;
    plan_status: string | null;
    plan_expires_at: string | null;
    trial_ends_at: string | null;
    visible: boolean | null;
  }>(
    `SELECT id, vertical, plan_id, plan_status, plan_expires_at, trial_ends_at, visible FROM vendors WHERE user_id = $1 LIMIT 1`,
    [userId]
  );

  if (!vendor) return NextResponse.json({ error: "No tenés un local" }, { status: 403 });

  // En preview no corre el reloj: primero hay que publicar el comercio.
  if (vendor.visible === false) {
    return NextResponse.json(
      { error: "Publicá tu comercio antes de activar un plan: en modo prueba ya tenés todo habilitado." },
      { status: 403 }
    );
  }

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