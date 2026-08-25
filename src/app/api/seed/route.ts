import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not allowed" }, { status: 404 });
  }

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
      neighborhood: "sicardi",
      address: "Calle 49 y 22, Sicardi",
      hours: "Mar a Dom · 17:00 a 23:00",
      description: "Empanadas caseras al horno, receta de la abuela.",
      payment_methods: "Efectivo, Débito",
      delivery_options: "ambos",
      instagram: "@lasempanadasmoria",
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
      neighborhood: "sicardi",
      address: "Calle 51 y 18, Sicardi",
      hours: "Jue a Dom · 11:00 a 15:00",
      description: "Pastas frescas hechas a mano todos los jueves.",
      payment_methods: "Efectivo, Débito, Mercado Pago",
      delivery_options: "retiro",
      instagram: "@pastasrossi",
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
      neighborhood: "sicardi",
      address: "Calle 50 y 20, Sicardi",
      hours: "Vie, Sáb y Dom · 19:00 a 00:00",
      description: "Pizzas a la piedra con masa madre de 48 horas.",
      payment_methods: "Efectivo, Débito, Mercado Pago",
      delivery_options: "ambos",
      facebook: "pizzalapiedrasicardi",
      offers: [
        { name: "Muzza grande", price: 6800, description: "Mozzarella y salsa de tomate" },
        { name: "Fugazzeta", price: 7200, description: "Cebolla y provolone" },
        { name: "Napolitana", price: 7500, description: "Tomate, ajo y orégano", featured: true },
        { name: "Fainá", price: 1200, description: "Porción de garbanzo" },
      ],
    },
    {
      email: "vendedor4@test.com",
      password: "test123456",
      full_name: "Rotisería La Esquina",
      phone: "2215550104",
      store_name: "Rotisería La Esquina de Garibaldi",
      slug: "rotiseria-la-esquina-de-garibaldi",
      category: "asado",
      vertical: "gastronomia",
      whatsapp: "5492215550104",
      neighborhood: "garibaldi",
      address: "Calle 20 y 51, Garibaldi",
      hours: "Mar a Sáb · 11:00 a 15:00",
      description: "Comida casera, guisos y platos del día.",
      payment_methods: "Efectivo",
      delivery_options: "ambos",
      offers: [
        { name: "Milanesa a la napolitana", price: 6500, description: "Con puré de papas" },
        { name: "Guiso de lentejas", price: 4200, description: "Porción generosa" },
        { name: "Ensalada cesar", price: 3800, description: "Pollo, crutones y parmesano" },
      ],
    },
    {
      email: "vendedor5@test.com",
      password: "test123456",
      full_name: "Huerta de Sicardi",
      phone: "2215550105",
      store_name: "Verdulería La Huerta",
      slug: "verduleria-la-huerta",
      category: "verdulería",
      vertical: "comercio",
      whatsapp: "5492215550105",
      neighborhood: "sicardi",
      address: "Calle 46 y 25, Sicardi",
      hours: "Lun a Sáb · 8:00 a 20:00",
      description: "Frutas y verduras de la quinta, todos los días.",
      payment_methods: "Efectivo, Mercado Pago",
      delivery_options: "ambos",
      instagram: "@lahuertasicardi",
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
      category: "electricista",
      vertical: "servicio",
      whatsapp: "5492215550106",
      neighborhood: "sicardi",
      address: "Sicardi y alrededores",
      hours: "Lun a Sáb · 8:00 a 18:00",
      description: "Instalaciones, arreglos y urgencias eléctricas en el barrio.",
      services_list: "Instalaciones eléctricas, Reparaciones, Urgencias 24hs, Tableros, Iluminación",
      service_area: "Sicardi, Garibaldi y alrededores",
      free_estimate: true,
      delivery_options: "domicilio",
      offers: [],
    },
    {
      email: "vendedor7@test.com",
      password: "test123456",
      full_name: "Lucía Moda",
      phone: "2215550107",
      store_name: "Lucía Indumentaria",
      slug: "lucia-indumentaria",
      category: "ropa",
      vertical: "moda",
      whatsapp: "5492215550107",
      neighborhood: "garibaldi",
      address: "Calle 22 y 49, Garibaldi",
      hours: "Mar a Sáb · 10:00 a 19:00",
      description: "Ropa de marca propia, accesorios y calzado para toda la familia.",
      payment_methods: "Efectivo, Débito, Mercado Pago",
      delivery_options: "ambos",
      instagram: "@luciaindumentaria",
      offers: [
        { name: "Remera básica algodón", price: 3500, description: "Varios colores, talle S a XL" },
        { name: "Jeans straight fit", price: 8500, description: "Denim importado, talle 36 a 42" },
        { name: "Bolso cuero sintético", price: 6200, description: "Con correa larga y bolsillo interior" },
      ],
    },
    {
      email: "vendedor8@test.com",
      password: "test123456",
      full_name: "Farmacia del Barrio",
      phone: "2215550108",
      store_name: "Farmacia Sicardi",
      slug: "farmacia-sicardi",
      category: "farmacia",
      vertical: "salud",
      whatsapp: "5492215550108",
      neighborhood: "sicardi",
      address: "Calle 48 y 22, Sicardi",
      hours: "Lun a Dom · 8:00 a 22:00",
      description: "Farmacia de barrio con delivery sin cargo en la zona.",
      payment_methods: "Efectivo, Débito, Mercado Pago",
      delivery_options: "ambos",
      offers: [
        { name: "Kit de jeringas descartables x10", price: 2800, description: "Uso descartable, variedad de puntas" },
        { name: "Protector solar FPS50", price: 4500, description: "150ml, resistente al agua" },
      ],
    },
    {
      email: "vendedor9@test.com",
      password: "test123456",
      full_name: "Papelería Don Pencas",
      phone: "2215550109",
      store_name: "Papelería Don Pencas",
      slug: "papeleria-don-pencas",
      category: "librería",
      vertical: "varios",
      whatsapp: "5492215550109",
      neighborhood: "garibaldi",
      address: "Calle 50 y 20, Garibaldi",
      hours: "Lun a Vie · 9:00 a 18:00",
      description: "Librería y papelería con todo para la escuela y la oficina.",
      payment_methods: "Efectivo, Débito",
      delivery_options: "retiro",
      offers: [
        { name: "Cuaderno tapa dura 100 hojas", price: 1800, description: "Rayado, cuadriculado o liso" },
        { name: "Fonda de resma A4", price: 3200, description: "500 hojas, 75g" },
        { name: "Caja de 12 marcadores", price: 2400, description: "Colores variados, punta双" },
      ],
    },
    {
      email: "vendedor10@test.com",
      password: "test123456",
      full_name: "Pet Shop Los Patines",
      phone: "2215550110",
      store_name: "Pet Shop Los Patines",
      slug: "pet-shop-los-patines",
      category: "pet shop",
      vertical: "mascotas",
      whatsapp: "5492215550110",
      neighborhood: "sicardi",
      address: "Calle 47 y 23, Sicardi",
      hours: "Lun a Sáb · 9:00 a 19:00",
      description: "Todo para tu mascota: alimentos, accesorios, peluquería y más.",
      payment_methods: "Efectivo, Débito, Mercado Pago",
      delivery_options: "ambos",
      instagram: "@petshoplospatines",
      offers: [
        { name: "Balanceado premium perro 15kg", price: 18500, description: "Carne y arroz, todas las razas" },
        { name: "Paseador de perros (sesión)", price: 3500, description: "1 hora, zona Sicardi" },
        { name: "Juguete interactivo gato", price: 2800, description: "Con plumas y pelota" },
      ],
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
      neighborhood: v.neighborhood || "sicardi",
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
        neighborhood: v.neighborhood || "sicardi",
        whatsapp: v.whatsapp,
        phone: v.phone || null,
        address: v.address,
        hours: v.hours,
        description: v.description,
        accepting_quotes: true,
        verified: true,
        instagram: v.instagram || null,
        facebook: v.facebook || null,
        payment_methods: v.payment_methods || null,
        delivery_options: v.delivery_options || "ambos",
        services_list: v.services_list || null,
        service_area: v.service_area || null,
        free_estimate: v.free_estimate !== false,
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
        neighborhood: v.neighborhood || "sicardi",
        type: "food",
        available: true,
        featured_today: (o as any).featured ?? false,
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
