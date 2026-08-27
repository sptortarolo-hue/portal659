import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-utils";
import { queryMany, queryOne, query, withTransaction } from "@/lib/db";

export async function GET(request: Request) {
  if (!(await isAdmin(request))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const url = new URL(request.url);
  const vertical = url.searchParams.get("vertical");
  const neighborhood = url.searchParams.get("neighborhood");
  const verified = url.searchParams.get("verified");
  const search = url.searchParams.get("search");

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (vertical) {
    params.push(vertical);
    conditions.push(`vertical = $${params.length}`);
  }
  if (neighborhood) {
    params.push(neighborhood);
    conditions.push(`neighborhood = $${params.length}`);
  }
  if (verified !== null && verified !== undefined) {
    params.push(verified === "true");
    conditions.push(`verified = $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    const q = `store_name ILIKE $${params.length} OR slug ILIKE $${params.length}`;
    conditions.push(`(${q})`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const vendors = await queryMany(
    `SELECT * FROM vendors ${whereClause} ORDER BY created_at DESC`,
    params
  );
  return NextResponse.json({ vendors });
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

  const vendor = await queryOne<Record<string, unknown>>(
    `INSERT INTO vendors (
       user_id, store_name, slug, vertical, neighborhood,
       description, phone, whatsapp, address, verified, is_admin
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [
      user_id,
      store_name,
      slug || store_name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, ""),
      vertical || "gastronomia",
      neighborhood || "sicardi",
      description || "",
      phone || "",
      whatsapp || "",
      address || "",
      false,
      false,
    ]
  );

  return NextResponse.json({ vendor });
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

  if (action === "toggle_verified") {
    const vendor = await queryOne<{ verified: boolean }>(
      `SELECT verified FROM vendors WHERE id = $1`,
      [vendorId]
    );
    if (!vendor) return NextResponse.json({ error: "Vendor no encontrado" }, { status: 404 });
    await query(`UPDATE vendors SET verified = $1 WHERE id = $2`, [!vendor.verified, vendorId]);
    return NextResponse.json({ ok: true, verified: !vendor.verified });
  }

  if (action === "toggle_admin") {
    const vendor = await queryOne<{ is_admin: boolean }>(
      `SELECT is_admin FROM vendors WHERE id = $1`,
      [vendorId]
    );
    if (!vendor) return NextResponse.json({ error: "Vendor no encontrado" }, { status: 404 });
    await query(`UPDATE vendors SET is_admin = $1 WHERE id = $2`, [!vendor.is_admin, vendorId]);
    return NextResponse.json({ ok: true, is_admin: !vendor.is_admin });
  }

  if (action === "update" && updateData) {
    await updateVendor(vendorId, updateData);
    return NextResponse.json({ ok: true });
  }

  if (action === "set_plan") {
    const { planSlug, days, note } = body;
    if (!planSlug) return NextResponse.json({ error: "planSlug es requerido" }, { status: 400 });

    const plans = await queryMany<{ id: string; slug: string; name: string }>(
      `SELECT id, slug, name FROM plans WHERE slug = ANY($1)`,
      [["gratuito", "pedidos", "gestion"]]
    );
    const plan = plans.find((p) => p.slug === planSlug);
    if (!plan) return NextResponse.json({ error: "Plan inválido" }, { status: 400 });

    if (planSlug === "gratuito") {
      await query(
        `UPDATE vendors
         SET plan_id = $1, plan_status = 'gratuito', plan_expires_at = NULL, trial_ends_at = NULL
         WHERE id = $2`,
        [plan.id, vendorId]
      );
      return NextResponse.json({ ok: true, plan: planSlug });
    }

    const periodDays = days && Number(days) > 0 ? Number(days) : 30;
    const vendor = await queryOne<{ plan_expires_at: string | null }>(
      `SELECT plan_expires_at FROM vendors WHERE id = $1`,
      [vendorId]
    );

    const base = vendor?.plan_expires_at
      ? Math.max(Date.now(), new Date(vendor.plan_expires_at).getTime())
      : Date.now();
    const periodEnd = new Date(base + periodDays * 24 * 60 * 60 * 1000).toISOString();
    const periodStart = new Date(base).toISOString();

    await withTransaction(async (tx) => {
      await tx.queryVoid(
        `UPDATE vendors
         SET plan_id = $1, plan_status = 'active', plan_expires_at = $2, trial_ends_at = NULL
         WHERE id = $3`,
        [plan.id, periodEnd, vendorId]
      );
      await tx.queryVoid(
        `INSERT INTO vendor_subscriptions (
           vendor_id, plan_id, status, current_period_start, current_period_end, note
         ) VALUES ($1, $2, 'active', $3, $4, $5)`,
        [
          vendorId,
          plan.id,
          periodStart,
          periodEnd,
          note || `Activado por administrador (${periodDays} días)`,
        ]
      );
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

  await query(`DELETE FROM vendors WHERE id = $1`, [vendorId]);
  return NextResponse.json({ ok: true });
}

async function updateVendor(vendorId: string, updateData: Record<string, unknown>) {
  const allowed = [
    "store_name", "slug", "vertical", "neighborhood", "description",
    "phone", "whatsapp", "address", "logo_url", "image_url", "hours",
    "instagram", "facebook", "payment_methods", "delivery_options",
    "services_list", "service_area", "free_estimate", "featured",
  ];
  const safeUpdate: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in updateData) safeUpdate[key] = updateData[key];
  }
  if (Object.keys(safeUpdate).length === 0) return;

  const setClauses: string[] = [];
  const values: unknown[] = [vendorId];
  let idx = 2;
  for (const [key, val] of Object.entries(safeUpdate)) {
    setClauses.push(`${key} = $${idx}`);
    values.push(val);
    idx++;
  }
  await query(`UPDATE vendors SET ${setClauses.join(", ")} WHERE id = $1`, values);
}