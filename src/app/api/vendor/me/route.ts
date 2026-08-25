import { getAuthSupabase } from "@/lib/auth-utils";
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

async function getAuth(request: Request) {
  const supabase = getAuthSupabase(request);
  if (!supabase) return { supabase: null, user: null };
  const { data } = await supabase.auth.getUser();
  return { supabase, user: data?.user || null };
}

export async function GET(request: Request) {
  const { supabase, user } = await getAuth(request);
  if (!supabase) {
    return NextResponse.json({ error: "Error de conexión" }, { status: 503 });
  }
  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { data: vendor } = await supabase
    .from("vendors")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  return NextResponse.json({ vendor });
}

export async function POST(request: Request) {
  const { supabase, user } = await getAuth(request);
  if (!supabase) {
    return NextResponse.json({ error: "Error de conexión" }, { status: 503 });
  }
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

  const VALID_VERTICALS = ["gastronomia", "comercio", "servicio", "moda", "salud", "varios", "mascotas", "otro"];
  const resolvedVertical = VALID_VERTICALS.includes(vertical)
    ? vertical
    : "gastronomia";

  const { data: existing } = await supabase
    .from("vendors")
    .select("id, slug")
    .eq("user_id", user.id)
    .maybeSingle();

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
    const { data, error } = await supabase
      .from("vendors")
      .update(payload)
      .eq("id", existing.id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ vendor: data });
  }

  const { data, error } = await supabase
    .from("vendors")
    .insert({ user_id: user.id, ...payload })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { error: profileError } = await supabase
    .from("profiles")
    .upsert({
      id: user.id,
      email: user.email,
      full_name: user.user_metadata?.full_name || null,
      role: "vendor",
    });

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  }

  return NextResponse.json({ vendor: data });
}
