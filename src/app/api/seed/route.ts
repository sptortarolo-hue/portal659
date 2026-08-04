import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    return NextResponse.json(
      { error: "Faltan variables de entorno" },
      { status: 500 }
    );
  }

  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const results: any[] = [];

  const vendors = [
    {
      email: "vendedor1@test.com",
      password: "test123456",
      full_name: "María de las Empanadas",
      phone: "2215550101",
      store_name: "Las Empanadas de María",
      slug: "las-empanadas-de-maria",
      category: "empanadas",
      vertical: "gastronomia",
      whatsapp: "5492215550101",
      address: "Calle 49 y 22, Sicardi",
      hours: "Mar a Dom · 17:00 a 23:00",
      description: "Empanadas caseras al horno, receta de la abuela.",
      offers: [
        { name: "Docena de empanadas de carne", price: 5200, description: "Carne cortada a cuchillo, 12 unidades", featured: true },
        { name: "Docena de empanadas de pollo", price: 5200, description: "Pollo y verduras, 12 unidades" },
        { name: "Docena de jamón y queso", price: 5400, description: "Jamón cocido y queso derretido" },
        { name: "Empanada suelta", price: 500, description: "A elegir entre los gustos del día" },
      ],
    },
    {
      email: "vendedor2@test.com",
      password: "test123456",
      full_name: "Familia Rossi",
      phone: "2215550102",
      store_name: "Pastas Rossi",
      slug: "pastas-rossi",
      category: "pastas",
      vertical: "gastronomia",
      whatsapp: "5492215550102",
      address: "Calle 51 y 18, Sicardi",
      hours: "Jue a Dom · 11:00 a 15:00",
      description: "Pastas frescas hechas a mano todos los jueves.",
      offers: [
        { name: "Ravioles de ricota y espinaca x12", price: 4800, description: "Con salsa de tomate casera", featured: true },
        { name: "Ñoquis de papa x1kg", price: 4500, description: "Listos para hervir" },
        { name: "Tallarines caseros x1kg", price: 4200, description: "Huevos frescos de campo" },
        { name: "Salsa bolognesa (600ml)", price: 3800, description: "Receta de la familia" },
      ],
    },
    {
      email: "vendedor3@test.com",
      password: "test123456",
      full_name: "Julián de la Pizza",
      phone: "2215550103",
      store_name: "Pizza a la Piedra Sicardi",
      slug: "pizza-a-la-piedra-sicardi",
      category: "pizzas",
      vertical: "gastronomia",
      whatsapp: "5492215550103",
      address: "Calle 50 y 20, Sicardi",
      hours: "Vie, Sáb y Dom · 19:00 a 00:00",
      description: "Pizzas a la piedra con masa madre de 48 horas.",
      offers: [
        { name: "Muzza grande", price: 6800, description: "Mozzarella y salsa de tomate" },
        { name: "Fugazzeta", price: 7200, description: "Cebolla y provolone" },
        { name: "Napolitana", price: 7500, description: "Tomate, ajo y orégano", featured: true },
        { name: "Fainá", price: 1200, description: "Porción de garbanzo" },
      ],
    },
    {
      email: "vendedor5@test.com",
      password: "test123456",
      full_name: "Huerta de Sicardi",
      phone: "2215550105",
      store_name: "Verdulería La Huerta",
      slug: "verduleria-la-huerta",
      category: "verduras",
      vertical: "almacen",
      whatsapp: "5492215550105",
      address: "Calle 46 y 25, Sicardi",
      hours: "Lun a Sáb · 8:00 a 20:00",
      description: "Frutas y verduras de la quinta, todos los días.",
      offers: [
        { name: "Bolsa de papas (5kg)", price: 5500, description: "Papas blancas de la quinta" },
        { name: "Tomate perita (1kg)", price: 3200, description: "Maduro en la planta" },
        { name: "Docena de huevos", price: 4200, description: "Huevos de campo" },
      ],
    },
    {
      email: "vendedor6@test.com",
      password: "test123456",
      full_name: "Marcos Electricista",
      phone: "2215550106",
      store_name: "Marcos Electricista",
      slug: "marcos-electricista",
      category: "oficios",
      vertical: "servicio",
      whatsapp: "5492215550106",
      address: "Sicardi y alrededores",
      hours: "Lun a Sáb · 8:00 a 18:00",
      description: "Instalaciones, arreglos y urgencias eléctricas en el barrio.",
      offers: [],
    },
  ];

  const buyers = [
    {
      email: "comprador@test.com",
      password: "test123456",
      full_name: "Comprador Test",
      phone: "2215550999",
      neighborhood: "sicardi",
    },
  ];

  for (const b of buyers) {
    const { data: authUser, error: authError } =
      await supabase.auth.admin.createUser({
        email: b.email,
        password: b.password,
        email_confirm: true,
        user_metadata: { full_name: b.full_name, role: "buyer" },
      });

    if (authError) {
      results.push({ email: b.email, error: authError.message });
      continue;
    }

    await supabase.from("profiles").upsert({
      id: authUser.user.id,
      email: b.email,
      full_name: b.full_name,
      neighborhood: b.neighborhood,
      phone: b.phone,
      role: "buyer",
      verified: true,
    });

    results.push({ email: b.email, status: "ok" });
  }

  for (const v of vendors) {
    const { data: authUser, error: authError } =
      await supabase.auth.admin.createUser({
        email: v.email,
        password: v.password,
        email_confirm: true,
        user_metadata: { full_name: v.full_name, role: "vendor" },
      });

    if (authError) {
      results.push({ email: v.email, error: authError.message });
      continue;
    }

    const userId = authUser.user.id;

    await supabase.from("profiles").upsert({
      id: userId,
      email: v.email,
      full_name: v.full_name,
      neighborhood: "sicardi",
      phone: v.phone,
      role: "vendor",
      verified: true,
    });

    const { data: vendor, error: vendorError } = await supabase
      .from("vendors")
      .upsert({
        user_id: userId,
        store_name: v.store_name,
        slug: v.slug,
        category: v.category,
        vertical: v.vertical,
        neighborhood: "sicardi",
        whatsapp: v.whatsapp,
        address: v.address,
        hours: v.hours,
        description: v.description,
        accepting_quotes: true,
        verified: true,
      })
      .select()
      .single();

    if (vendorError) {
      results.push({ email: v.email, error: vendorError.message });
      continue;
    }

    let offerCount = 0;
    for (const o of v.offers) {
      const { error } = await supabase.from("products").insert({
        vendor_id: vendor.id,
        name: o.name,
        description: o.description,
        price: o.price,
        currency: "ARS",
        category: v.category,
        neighborhood: "sicardi",
        type: "food",
        available: true,
        featured_today: o.featured,
      });
      if (!error) offerCount++;
    }

    results.push({
      email: v.email,
      status: "ok",
      slug: v.slug,
      offers: offerCount,
      microsite: `/tienda/${v.slug}`,
    });
  }

  return NextResponse.json({ results });
}
