import { getAuthUser } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { getVendorByRequest, seedDefaultCategories } from "@/lib/vendor-utils";
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
  const { vendor: resolved, staffRole, previewSession, userId } =
    await getVendorByRequest(request);

  // Sesión de prueba: entra sin usuario registrado.
  if (previewSession && resolved) {
    const vendor = await queryOne<Record<string, unknown>>(
      `SELECT * FROM vendors WHERE id = $1 LIMIT 1`,
      [resolved.id]
    );
    return NextResponse.json({ vendor, staffRole, userId: null, preview: true });
  }

  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  if (!resolved) {
    return NextResponse.json({ vendor: null, staffRole, userId: user.id });
  }

  const vendor = await queryOne<Record<string, unknown>>(
    `SELECT * FROM vendors WHERE id = $1 LIMIT 1`,
    [resolved.id]
  );

  return NextResponse.json({ vendor, staffRole, userId: user.id, preview: previewSession });
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
    delivery_fee,
    free_delivery_min,
    delivery_mode,
    delivery_area_text,
    services_list,
    service_area,
    free_estimate,
    accepting_quotes,
    urgent_enabled,
    urgent_surcharge_pct,
    deposit_default_pct,
    bookings_enabled,
    quote_pref_enabled,
    quote_days,
    quote_slots,
    printer_ip,
    printer_port,
    paper_size,
    auto_print,
    print_mode,
    transfer_alias,
    transfer_cbu,
    transfer_holder,
    block_unpaid_orders,
    open_override,
    prep_time_min,
    print_logo,
    print_address,
    print_phone,
    print_social,
    lat,
    lng,
    food_cost_warn,
    food_cost_bad,
    accepts_online_orders,
    cash_discount_pct,
    kitchen_strict_close,
    storefront_layout,
    require_open_shift,
    reservation_lead_min,
    reservation_tolerance_min,
    floor_bg_url,
  } = body;

  const VALID_VERTICALS = ["gastronomia", "comercio", "servicio", "moda", "salud", "otro"];
  const resolvedVertical = VALID_VERTICALS.includes(vertical)
    ? vertical
    : "gastronomia";

  const { vendor: existing } = await getVendorByRequest(request);

  const existingSlug = existing
    ? (await queryOne<{ slug: string }>(`SELECT slug FROM vendors WHERE id = $1 LIMIT 1`, [existing.id]))?.slug
    : null;

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
  if (store_name !== undefined) payload.slug = existingSlug || slugify(store_name);
  if (instagram !== undefined) payload.instagram = instagram || null;
  if (facebook !== undefined) payload.facebook = facebook || null;
  if (payment_methods !== undefined) payload.payment_methods = payment_methods || null;
  if (delivery_options !== undefined) payload.delivery_options = delivery_options || "ambos";
  if (delivery_fee !== undefined) payload.delivery_fee = delivery_fee != null && delivery_fee !== "" ? Number(delivery_fee) : null;
  if (free_delivery_min !== undefined) payload.free_delivery_min = free_delivery_min != null && free_delivery_min !== "" ? Number(free_delivery_min) : null;
  if (delivery_mode !== undefined) payload.delivery_mode = delivery_mode === "zones" ? "zones" : "flat";
  if (delivery_area_text !== undefined) {
    const t = typeof delivery_area_text === "string" ? delivery_area_text.trim().slice(0, 120) : "";
    payload.delivery_area_text = t || null;
  }
  if (services_list !== undefined) payload.services_list = services_list || null;
  if (service_area !== undefined) payload.service_area = service_area || null;
  if (free_estimate !== undefined) payload.free_estimate = free_estimate !== false;
  if (accepting_quotes !== undefined) payload.accepting_quotes = accepting_quotes !== false;
  if (bookings_enabled !== undefined) payload.bookings_enabled = bookings_enabled !== false;
  if (quote_pref_enabled !== undefined) payload.quote_pref_enabled = quote_pref_enabled !== false;
  if (quote_days !== undefined) {
    const valid = ["lun", "mar", "mie", "jue", "vie", "sab", "dom"];
    const arr = Array.isArray(quote_days) ? quote_days.filter((d: unknown) => valid.includes(String(d))) : [];
    payload.quote_days = JSON.stringify(arr);
  }
  if (quote_slots !== undefined) {
    const arr = Array.isArray(quote_slots)
      ? quote_slots.map((s: unknown) => String(s).trim().slice(0, 20)).filter(Boolean).slice(0, 5)
      : [];
    payload.quote_slots = JSON.stringify(arr);
  }
  if (urgent_enabled !== undefined) payload.urgent_enabled = urgent_enabled === true;
  if (urgent_surcharge_pct !== undefined) {
    const pct = urgent_surcharge_pct == null || urgent_surcharge_pct === "" ? null : Number(urgent_surcharge_pct);
    if (pct !== null && (!Number.isFinite(pct) || pct < 0 || pct >= 100)) {
      return NextResponse.json({ error: "El recargo debe estar entre 0 y 99" }, { status: 400 });
    }
    payload.urgent_surcharge_pct = pct;
  }
  if (deposit_default_pct !== undefined) {
    const pct = deposit_default_pct == null || deposit_default_pct === "" ? null : Number(deposit_default_pct);
    if (pct !== null && (!Number.isFinite(pct) || pct <= 0 || pct > 100)) {
      return NextResponse.json({ error: "La seña debe estar entre 1 y 100" }, { status: 400 });
    }
    payload.deposit_default_pct = pct;
  }
  if (printer_ip !== undefined) payload.printer_ip = printer_ip || null;
  if (printer_port !== undefined) payload.printer_port = printer_port || 9100;
  if (paper_size !== undefined) payload.paper_size = paper_size || "80mm";
  if (auto_print !== undefined) payload.auto_print = auto_print === true;
  if (print_mode !== undefined) payload.print_mode = print_mode === "app" ? "app" : "server";
  if (transfer_alias !== undefined) payload.transfer_alias = transfer_alias || null;
  if (transfer_cbu !== undefined) payload.transfer_cbu = transfer_cbu || null;
  if (transfer_holder !== undefined) payload.transfer_holder = transfer_holder || null;
  if (block_unpaid_orders !== undefined) payload.block_unpaid_orders = block_unpaid_orders === true;
  // Exigir turno de caja abierto para cobrar en Mostrador/Mesas.
  if (require_open_shift !== undefined) payload.require_open_shift = require_open_shift === true;
  // Foto de fondo del plano del salón (URL de /api/vendor/upload, o null).
  if (floor_bg_url !== undefined) {
    payload.floor_bg_url =
      typeof floor_bg_url === "string" && floor_bg_url.trim() ? floor_bg_url.trim().slice(0, 500) : null;
  }
  // Ventana de bloqueo de reservas (minutos, 0-180; NULL/omitido = default 15).
  for (const key of ["reservation_lead_min", "reservation_tolerance_min"] as const) {
    const raw = key === "reservation_lead_min" ? reservation_lead_min : reservation_tolerance_min;
    if (raw !== undefined) {
      const v = raw === null || raw === "" ? 15 : Number(raw);
      if (!Number.isFinite(v) || v < 0 || v > 180) {
        return NextResponse.json({ error: "Los minutos de reserva deben estar entre 0 y 180" }, { status: 400 });
      }
      payload[key] = Math.round(v);
    }
  }
  // Sobrescritura manual de apertura: true=abierto, false=cerrado, null=seguir horarios.
  if (open_override !== undefined) payload.open_override = open_override === null ? null : open_override === true;
  // Control de demora (estimado de preparación). Default 30 min: nunca queda null.
  if (prep_time_min !== undefined) payload.prep_time_min = prep_time_min == null ? 30 : Number(prep_time_min);
  if (print_logo !== undefined) payload.print_logo = print_logo === true;
  if (print_address !== undefined) payload.print_address = print_address === true;
  if (print_phone !== undefined) payload.print_phone = print_phone === true;
  if (print_social !== undefined) payload.print_social = print_social === true;
  if (lat !== undefined) payload.lat = lat != null && lat !== "" && !isNaN(Number(lat)) ? Number(lat) : null;
  if (lng !== undefined) payload.lng = lng != null && lng !== "" && !isNaN(Number(lng)) ? Number(lng) : null;
  // Semáforo food-cost (global por comercio, NULL = defaults 30/35).
  if (food_cost_warn !== undefined || food_cost_bad !== undefined) {
    const w = food_cost_warn != null && food_cost_warn !== "" ? Number(food_cost_warn) : null;
    const b = food_cost_bad != null && food_cost_bad !== "" ? Number(food_cost_bad) : null;
    for (const [label, v] of [["amarillo", w], ["rojo", b]] as const) {
      if (v !== null && (!isFinite(v) || v <= 0 || v >= 100)) {
        return NextResponse.json({ error: `El umbral ${label} debe estar entre 1 y 99` }, { status: 400 });
      }
    }
    if (w !== null && b !== null && w >= b) {
      return NextResponse.json({ error: "El amarillo debe ser menor que el rojo" }, { status: 400 });
    }
    if (food_cost_warn !== undefined) payload.food_cost_warn = w;
    if (food_cost_bad !== undefined) payload.food_cost_bad = b;
  }
  if (accepts_online_orders !== undefined) payload.accepts_online_orders = accepts_online_orders === true;
  if (kitchen_strict_close !== undefined) payload.kitchen_strict_close = kitchen_strict_close !== false;
  // Vista del catálogo online (comercio): lista o vidriera (grilla visual).
  if (storefront_layout !== undefined) payload.storefront_layout = storefront_layout === "vidriera" ? "vidriera" : "lista";
  if (cash_discount_pct !== undefined) {
    if (cash_discount_pct === null || cash_discount_pct === "") {
      payload.cash_discount_pct = null;
    } else {
      const pct = Number(cash_discount_pct);
      if (!isFinite(pct) || pct < 0 || pct >= 100) {
        return NextResponse.json({ error: "El descuento debe estar entre 0 y 99" }, { status: 400 });
      }
      payload.cash_discount_pct = pct;
    }
  }

  if (existing) {
    let vendor: Record<string, unknown> | undefined;
    try {
      const setClauses: string[] = [];
      const values: unknown[] = [existing.id];
      let idx = 2;
      for (const [key, val] of Object.entries(payload)) {
        setClauses.push(`${key} = $${idx}`);
        values.push(val);
        idx++;
      }

      vendor = await queryOne<Record<string, unknown>>(
        `UPDATE vendors SET ${setClauses.join(", ")} WHERE id = $1 RETURNING *`,
        values
      );
    } catch (err: any) {
      const msg = String(err?.message || "");
      // Columnas de migraciones pendientes (servicios): se reintenta sin ellas.
      const droppable = [
        "lat",
        "lng",
        "accepting_quotes",
        "urgent_enabled",
        "urgent_surcharge_pct",
        "deposit_default_pct",
        "bookings_enabled",
        "quote_pref_enabled",
        "quote_days",
        "quote_slots",
        "kitchen_strict_close",
        "delivery_mode",
        "delivery_area_text",
        "storefront_layout",
        "require_open_shift",
        "reservation_lead_min",
        "reservation_tolerance_min",
        "floor_bg_url",
      ].filter((k) => k in payload && msg.includes(k));
      if (droppable.length > 0) {
        for (const k of droppable) delete payload[k];
        if (Object.keys(payload).length === 0) {
          vendor = await queryOne<Record<string, unknown>>(
            `SELECT * FROM vendors WHERE id = $1 LIMIT 1`,
            [existing.id]
          );
        } else {
          const setClauses: string[] = [];
          const values: unknown[] = [existing.id];
          let idx = 2;
          for (const [key, val] of Object.entries(payload)) {
            setClauses.push(`${key} = $${idx}`);
            values.push(val);
            idx++;
          }
          vendor = await queryOne<Record<string, unknown>>(
            `UPDATE vendors SET ${setClauses.join(", ")} WHERE id = $1 RETURNING *`,
            values
          );
        }
      } else {
        throw err;
      }
    }

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

  if (vendor) {
    await seedDefaultCategories(vendor.id as string, resolvedVertical);
  }

  return NextResponse.json({ vendor });
}