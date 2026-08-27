import { getAuthUser } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { NextResponse } from "next/server";

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

export async function GET(request: Request) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const vendor = await queryOne<Record<string, unknown>>(
    `SELECT * FROM vendors WHERE user_id = $1 LIMIT 1`,
    [user.id]
  );

  return NextResponse.json({ vendor });
}

export async function POST(request: Request) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const body = await request.json();
  const {
    store_name,
    neighborhood,
    whatsapp,
    phone,
    address,
    hours,
    description,
    image_url,
    logo_url,
    category,
    vertical,
    instagram,
    facebook,
    payment_methods,
    delivery_options,
    services_list,
    service_area,
    free_estimate,
    printer_ip,
    printer_port,
    paper_size,
    auto_print,
  } = body;

  const VALID_VERTICALS = ["gastronomia", "comercio", "servicio", "moda", "salud", "otro"];
  const resolvedVertical = VALID_VERTICALS.includes(vertical)
    ? vertical
    : "gastronomia";

  const existing = await queryOne<{ id: string; slug: string }>(
    `SELECT id, slug FROM vendors WHERE user_id = $1 LIMIT 1`,
    [user.id]
  );

  if (!existing && (!store_name || !neighborhood)) {
    return NextResponse.json(
      { error: "El nombre del local y el barrio son obligatorios" },
      { status: 400 }
    );
  }

  const payload: Record<string, unknown> = {};
  if (store_name !== undefined) payload.store_name = store_name;
  if (neighborhood !== undefined) payload.neighborhood = neighborhood;
  if (whatsapp !== undefined) payload.whatsapp = whatsapp || null;
  if (phone !== undefined) payload.phone = phone || null;
  if (address !== undefined) payload.address = address || null;
  if (hours !== undefined) payload.hours = hours || null;
  if (description !== undefined) payload.description = description || null;
  if (image_url !== undefined) payload.image_url = image_url || null;
  if (logo_url !== undefined) payload.logo_url = logo_url || null;
  if (category !== undefined) payload.category = category || "otras";
  if (vertical !== undefined) payload.vertical = resolvedVertical;
  if (store_name !== undefined) payload.slug = existing?.slug || slugify(store_name);
  if (instagram !== undefined) payload.instagram = instagram || null;
  if (facebook !== undefined) payload.facebook = facebook || null;
  if (payment_methods !== undefined) payload.payment_methods = payment_methods || null;
  if (delivery_options !== undefined) payload.delivery_options = delivery_options || "ambos";
  if (services_list !== undefined) payload.services_list = services_list || null;
  if (service_area !== undefined) payload.service_area = service_area || null;
  if (free_estimate !== undefined) payload.free_estimate = free_estimate !== false;
  if (printer_ip !== undefined) payload.printer_ip = printer_ip || null;
  if (printer_port !== undefined) payload.printer_port = printer_port || 9100;
  if (paper_size !== undefined) payload.paper_size = paper_size || "80mm";
  if (auto_print !== undefined) payload.auto_print = auto_print === true;

  if (existing) {
    const setClauses: string[] = [];
    const values: unknown[] = [existing.id];
    let idx = 2;
    for (const [key, val] of Object.entries(payload)) {
      setClauses.push(`${key} = $${idx}`);
      values.push(val);
      idx++;
    }

    const vendor = await queryOne<Record<string, unknown>>(
      `UPDATE vendors SET ${setClauses.join(", ")} WHERE id = $1 RETURNING *`,
      values
    );

    return NextResponse.json({ vendor });
  }

  const keys = Object.keys(payload);
  const cols = keys.map((k) => `"${k}"`).join(", ");
  const placeholders = keys.map((_, i) => `$${i + 2}`).join(", ");
  const values = keys.map((k) => payload[k]);

  const vendor = await queryOne<Record<string, unknown>>(
    `INSERT INTO vendors (user_id, ${cols}) VALUES ($1, ${placeholders}) RETURNING *`,
    [user.id, ...values]
  );

  await query(
    `INSERT INTO profiles (id, email, full_name, role) VALUES ($1, $2, $3, 'vendor')
     ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, full_name = EXCLUDED.full_name, role = 'vendor'`,
    [user.id, user.email, user.full_name]
  );

  return NextResponse.json({ vendor });
}