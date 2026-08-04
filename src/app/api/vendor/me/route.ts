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
  } = body;

  if (!store_name || !neighborhood) {
    return NextResponse.json(
      { error: "El nombre del local y el barrio son obligatorios" },
      { status: 400 }
    );
  }

  const VALID_VERTICALS = ["gastronomia", "almacen", "servicio", "otro"];
  const resolvedVertical = VALID_VERTICALS.includes(vertical)
    ? vertical
    : "gastronomia";

  const { data: existing } = await supabase
    .from("vendors")
    .select("id, slug")
    .eq("user_id", user.id)
    .maybeSingle();

  const payload: Record<string, unknown> = {
    store_name,
    neighborhood,
    whatsapp: whatsapp || null,
    phone: phone || null,
    address: address || null,
    hours: hours || null,
    description: description || null,
    image_url: image_url || null,
    logo_url: logo_url || null,
    category: category || "otras",
    vertical: resolvedVertical,
    slug: existing?.slug || slugify(store_name),
    instagram: instagram || null,
    facebook: facebook || null,
    payment_methods: payment_methods || null,
    delivery_options: delivery_options || "ambos",
    services_list: services_list || null,
    service_area: service_area || null,
    free_estimate: free_estimate !== false,
  };

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
