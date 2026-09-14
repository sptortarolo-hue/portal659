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
    `SELECT v.*,
            sub.paid_at,
            sub.payment_method,
            sub.amount AS sub_amount,
            sub.status AS sub_status,
            sub.current_period_end AS sub_period_end
     FROM vendors v
     LEFT JOIN LATERAL (
       SELECT s.paid_at, s.payment_method, s.amount, s.status, s.current_period_end
       FROM vendor_subscriptions s
       WHERE s.vendor_id = v.id
       ORDER BY s.created_at DESC
       LIMIT 1
     ) sub ON true
     ${whereClause}
     ORDER BY v.created_at DESC`,
    params
  );

  // Bot de WhatsApp: estado habilitado por comercio (tolerante a tabla sin migrar).
  let waEnabled: Record<string, boolean> = {};
  try {
    const rows = await queryMany<{ vendor_id: string; enabled: boolean }>(
      `SELECT vendor_id, enabled FROM vendor_wa_bots`
    );
    for (const r of rows) waEnabled[r.vendor_id] = r.enabled !== false;
  } catch {
    /* tabla vendor_wa_bots aún no migrada */
  }

  const out = vendors.map((v) => ({ ...v, wa_bot_enabled: !!waEnabled[v.id] }));
  return NextResponse.json({ vendors: out });
}

export async function POST(request: Request) {
  if (!(await isAdmin(request))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const body = await request.json();
  const { store_name, slug, vertical, neighborhood, description, phone, whatsapp, address, user_id } = body;

  if (!store_name) {
    return NextResponse.json({ error: "store_name es requerido" }, { status: 400 });
  }

  const vendor = await queryOne<Record<string, unknown>>(
    `INSERT INTO vendors (
       user_id, store_name, slug, vertical, neighborhood,
       description, phone, whatsapp, address, verified, is_admin
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [
      user_id || null,
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
    const vendor = await queryOne<{ is_admin: boolean; user_id: string | null }>(
      `SELECT is_admin, user_id FROM vendors WHERE id = $1`,
      [vendorId]
    );
    if (!vendor) return NextResponse.json({ error: "Vendor no encontrado" }, { status: 404 });
    const next = !vendor.is_admin;
    await query(`UPDATE vendors SET is_admin = $1 WHERE id = $2`, [next, vendorId]);
    // El permiso real está en profiles.is_admin (getAuthUser lee de profiles).
    if (vendor.user_id) {
      await query(`UPDATE profiles SET is_admin = $1 WHERE id = $2`, [next, vendor.user_id]);
    }
    return NextResponse.json({ ok: true, is_admin: next });
  }

  // Kill switch del bot de WhatsApp: habilita/deshabilita el bot de un comercio.
  // La tabla existe tras migrate-pilot-whatsapp-bot.sql; sin migrar devuelve
  // un 500 claro para que se aplique la migración.
  if (action === "toggle_wa_bot") {
    const vendor = await queryOne<{ id: string }>(
      `SELECT id FROM vendors WHERE id = $1`,
      [vendorId]
    );
    if (!vendor) return NextResponse.json({ error: "Vendor no encontrado" }, { status: 404 });

    try {
      const cur = await queryOne<{ enabled: boolean }>(
        `SELECT enabled FROM vendor_wa_bots WHERE vendor_id = $1`,
        [vendorId]
      );
      const next = cur ? !cur.enabled : true;
      await query(
        `INSERT INTO vendor_wa_bots (vendor_id, enabled)
         VALUES ($1, $2)
         ON CONFLICT (vendor_id) DO UPDATE SET enabled = $2, updated_at = now()`,
        [vendorId, next]
      );
      return NextResponse.json({ ok: true, enabled: next });
    } catch {
      return NextResponse.json(
        { error: "Tabla vendor_wa_bots no existe. Aplicar migrate-pilot-whatsapp-bot.sql" },
        { status: 500 }
      );
    }
  }

  if (action === "toggle_visible") {
    const vendor = await queryOne<{ visible: boolean }>(
      `SELECT visible FROM vendors WHERE id = $1`,
      [vendorId]
    );
    if (!vendor) return NextResponse.json({ error: "Vendor no encontrado" }, { status: 404 });
    await query(`UPDATE vendors SET visible = $1 WHERE id = $2`, [!vendor.visible, vendorId]);
    return NextResponse.json({ ok: true, visible: !vendor.visible });
  }

  // Publicación con aprobación: rechazar limpia la solicitud pendiente.
  if (action === "clear_publish_request") {
    await query(`UPDATE vendors SET publish_requested_at = NULL WHERE id = $1`, [vendorId]);
    return NextResponse.json({ ok: true, requested: false });
  }

  // Aprobar publicación: visible + limpia la solicitud.
  if (action === "approve_publish") {
    const vendor = await queryOne<{ id: string }>(
      `SELECT id FROM vendors WHERE id = $1`,
      [vendorId]
    );
    if (!vendor) return NextResponse.json({ error: "Vendor no encontrado" }, { status: 404 });
    await query(
      `UPDATE vendors SET visible = true, publish_requested_at = NULL WHERE id = $1`,
      [vendorId]
    );
    return NextResponse.json({ ok: true, visible: true });
  }

  if (action === "assign_user") {
    const { userId } = body;
    await query(`UPDATE vendors SET user_id = $1 WHERE id = $2`, [userId || null, vendorId]);
    return NextResponse.json({ ok: true, user_id: userId || null });
  }

  if (action === "update" && updateData) {
    await updateVendor(vendorId, updateData);
    return NextResponse.json({ ok: true });
  }

  if (action === "set_plan") {
    const { planSlug, days, note, paymentMethod, amount } = body;
    if (!planSlug) return NextResponse.json({ error: "planSlug es requerido" }, { status: 400 });

    // Cobro manual (el pago es por fuera: efectivo / transferencia / MP).
    // Se registra en la suscripción; null = sin cobrar.
    const validMethods = ["efectivo", "transferencia", "mercadopago"];
    const method = paymentMethod && validMethods.includes(paymentMethod) ? paymentMethod : null;
    const billedAmount = amount != null && Number(amount) >= 0 ? Number(amount) : null;

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
           vendor_id, plan_id, status, current_period_start, current_period_end,
           note, payment_method, amount, paid_at
         ) VALUES ($1, $2, 'active', $3, $4, $5, $6, $7, $8)`,
        [
          vendorId,
          plan.id,
          periodStart,
          periodEnd,
          note || `Activado por administrador (${periodDays} días)`,
          method,
          billedAmount,
          method ? new Date().toISOString() : null,
        ]
      );
    });

    return NextResponse.json({ ok: true, plan: planSlug, periodEnd, paymentMethod: method });
  }

  // Registrar cobro manual de la última suscripción del comercio
  // (efectivo / transferencia / mercadopago). No toca el plan, solo el pago.
  if (action === "record_payment") {
    const { paymentMethod, amount, subscriptionId } = body;
    const validMethods = ["efectivo", "transferencia", "mercadopago"];
    if (!paymentMethod || !validMethods.includes(paymentMethod)) {
      return NextResponse.json({ error: "paymentMethod inválido (efectivo / transferencia / mercadopago)" }, { status: 400 });
    }
    const billedAmount = amount != null && Number(amount) >= 0 ? Number(amount) : null;

    const sub = subscriptionId
      ? await queryOne<{ id: string }>(
          `SELECT id FROM vendor_subscriptions WHERE id = $1 AND vendor_id = $2`,
          [subscriptionId, vendorId]
        )
      : await queryOne<{ id: string }>(
          `SELECT id FROM vendor_subscriptions WHERE vendor_id = $1 ORDER BY created_at DESC LIMIT 1`,
          [vendorId]
        );
    if (!sub) return NextResponse.json({ error: "El comercio no tiene suscripciones para cobrar" }, { status: 404 });

    await query(
      `UPDATE vendor_subscriptions SET payment_method = $1, amount = $2, paid_at = now() WHERE id = $3`,
      [paymentMethod, billedAmount, sub.id]
    );
    return NextResponse.json({ ok: true, subscriptionId: sub.id, paymentMethod, amount: billedAmount });
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
    "services_list", "service_area", "free_estimate", "featured", "visible",
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