import { NextResponse } from "next/server";
import { withTransaction } from "@/lib/db";
import { hashPassword } from "@/lib/auth";

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not allowed" }, { status: 404 });
  }

  const results: any[] = [];

  const vendors = [
    {
      email: "vendedor1@test.com", password: "test123456", full_name: "María de las Empanadas",
      phone: "2215550101", store_name: "Las Empanadas de María", slug: "las-empanadas-de-maria",
      category: "empanadas", vertical: "gastronomia", whatsapp: "5492215550101", neighborhood: "sicardi",
      address: "Calle 49 y 22, Sicardi", hours: "Mar a Dom · 17:00 a 23:00",
      description: "Empanadas caseras al horno, receta de la abuela.",
      payment_methods: "Efectivo, Débito", delivery_options: "ambos", instagram: "@lasempanadasmoria",
      offers: [
        { name: "Docena de empanadas de carne", price: 5200, description: "Carne cortada a cuchillo, 12 unidades", featured: true },
        { name: "Docena de empanadas de pollo", price: 5200, description: "Pollo y verduras, 12 unidades" },
        { name: "Docena de jamón y queso", price: 5400, description: "Jamón cocido y queso derretido" },
        { name: "Empanada suelta", price: 500, description: "A elegir entre los gustos del día" },
      ],
    },
    {
      email: "vendedor2@test.com", password: "test123456", full_name: "Familia Rossi",
      phone: "2215550102", store_name: "Pastas Rossi", slug: "pastas-rossi",
      category: "pastas", vertical: "gastronomia", whatsapp: "5492215550102", neighborhood: "sicardi",
      address: "Calle 51 y 18, Sicardi", hours: "Jue a Dom · 11:00 a 15:00",
      description: "Pastas frescas hechas a mano todos los jueves.",
      payment_methods: "Efectivo, Débito, Mercado Pago", delivery_options: "retiro", instagram: "@pastasrossi",
      offers: [
        { name: "Ravioles de ricota y espinaca x12", price: 4800, description: "Con salsa de tomate casera", featured: true },
        { name: "Ñoquis de papa x1kg", price: 4500, description: "Listos para hervir" },
        { name: "Tallarines caseros x1kg", price: 4200, description: "Huevos frescos de campo" },
        { name: "Salsa bolognesa (600ml)", price: 3800, description: "Receta de la familia" },
      ],
    },
    {
      email: "vendedor3@test.com", password: "test123456", full_name: "Julián de la Pizza",
      phone: "2215550103", store_name: "Pizza a la Piedra Sicardi", slug: "pizza-a-la-piedra-sicardi",
      category: "pizzas", vertical: "gastronomia", whatsapp: "5492215550103", neighborhood: "sicardi",
      address: "Calle 50 y 20, Sicardi", hours: "Vie, Sáb y Dom · 19:00 a 00:00",
      description: "Pizzas a la piedra con masa madre de 48 horas.",
      payment_methods: "Efectivo, Débito, Mercado Pago", delivery_options: "ambos", facebook: "pizzalapiedrasicardi",
      offers: [
        { name: "Muzza grande", price: 6800, description: "Mozzarella y salsa de tomate" },
        { name: "Fugazzeta", price: 7200, description: "Cebolla y provolone" },
        { name: "Napolitana", price: 7500, description: "Tomate, ajo y orégano", featured: true },
        { name: "Fainá", price: 1200, description: "Porción de garbanzo" },
      ],
    },
    {
      email: "vendedor4@test.com", password: "test123456", full_name: "Rotisería La Esquina",
      phone: "2215550104", store_name: "Rotisería La Esquina de Garibaldi", slug: "rotiseria-la-esquina-de-garibaldi",
      category: "asado", vertical: "gastronomia", whatsapp: "5492215550104", neighborhood: "garibaldi",
      address: "Calle 20 y 51, Garibaldi", hours: "Mar a Sáb · 11:00 a 15:00",
      description: "Comida casera, guisos y platos del día.",
      payment_methods: "Efectivo", delivery_options: "ambos",
      offers: [
        { name: "Milanesa a la napolitana", price: 6500, description: "Con puré de papas" },
        { name: "Guiso de lentejas", price: 4200, description: "Porción generosa" },
        { name: "Ensalada cesar", price: 3800, description: "Pollo, crutones y parmesano" },
      ],
    },
    {
      email: "vendedor5@test.com", password: "test123456", full_name: "Huerta de Sicardi",
      phone: "2215550105", store_name: "Verdulería La Huerta", slug: "verduleria-la-huerta",
      category: "verdulería", vertical: "comercio", whatsapp: "5492215550105", neighborhood: "sicardi",
      address: "Calle 46 y 25, Sicardi", hours: "Lun a Sáb · 8:00 a 20:00",
      description: "Frutas y verduras de la quinta, todos los días.",
      payment_methods: "Efectivo, Mercado Pago", delivery_options: "ambos", instagram: "@lahuertasicardi",
      offers: [
        { name: "Bolsa de papas (5kg)", price: 5500, description: "Papas blancas de la quinta" },
        { name: "Tomate perita (1kg)", price: 3200, description: "Maduro en la planta" },
        { name: "Docena de huevos", price: 4200, description: "Huevos de campo" },
      ],
    },
    {
      email: "vendedor6@test.com", password: "test123456", full_name: "Marcos Electricista",
      phone: "2215550106", store_name: "Marcos Electricista", slug: "marcos-electricista",
      category: "electricista", vertical: "servicio", whatsapp: "5492215550106", neighborhood: "sicardi",
      address: "Sicardi y alrededores", hours: "Lun a Sáb · 8:00 a 18:00",
      description: "Instalaciones, arreglos y urgencias eléctricas en el barrio.",
      services_list: "Instalaciones eléctricas, Reparaciones, Urgencias 24hs, Tableros, Iluminación",
      service_area: "Sicardi, Garibaldi y alrededores", free_estimate: true, delivery_options: "domicilio", offers: [],
    },
    {
      email: "vendedor7@test.com", password: "test123456", full_name: "Lucía Moda",
      phone: "2215550107", store_name: "Lucía Indumentaria", slug: "lucia-indumentaria",
      category: "ropa", vertical: "moda", whatsapp: "5492215550107", neighborhood: "garibaldi",
      address: "Calle 22 y 49, Garibaldi", hours: "Mar a Sáb · 10:00 a 19:00",
      description: "Ropa de marca propia, accesorios y calzado para toda la familia.",
      payment_methods: "Efectivo, Débito, Mercado Pago", delivery_options: "ambos", instagram: "@luciaindumentaria",
      offers: [
        { name: "Remera básica algodón", price: 3500, description: "Varios colores, talle S a XL" },
        { name: "Jeans straight fit", price: 8500, description: "Denim importado, talle 36 a 42" },
        { name: "Bolso cuero sintético", price: 6200, description: "Con correa larga y bolsillo interior" },
      ],
    },
    {
      email: "vendedor8@test.com", password: "test123456", full_name: "Farmacia del Barrio",
      phone: "2215550108", store_name: "Farmacia Sicardi", slug: "farmacia-sicardi",
      category: "farmacia", vertical: "salud", whatsapp: "5492215550108", neighborhood: "sicardi",
      address: "Calle 48 y 22, Sicardi", hours: "Lun a Dom · 8:00 a 22:00",
      description: "Farmacia de barrio con delivery sin cargo en la zona.",
      payment_methods: "Efectivo, Débito, Mercado Pago", delivery_options: "ambos",
      offers: [
        { name: "Kit de jeringas descartables x10", price: 2800, description: "Uso descartable, variedad de puntas" },
        { name: "Protector solar FPS50", price: 4500, description: "150ml, resistente al agua" },
      ],
    },
    {
      email: "vendedor9@test.com", password: "test123456", full_name: "Papelería Don Pencas",
      phone: "2215550109", store_name: "Papelería Don Pencas", slug: "papeleria-don-pencas",
      category: "librería", vertical: "comercio", whatsapp: "5492215550109", neighborhood: "garibaldi",
      address: "Calle 50 y 20, Garibaldi", hours: "Lun a Vie · 9:00 a 18:00",
      description: "Librería y papelería con todo para la escuela y la oficina.",
      payment_methods: "Efectivo, Débito", delivery_options: "retiro",
      offers: [
        { name: "Cuaderno tapa dura 100 hojas", price: 1800, description: "Rayado, cuadriculado o liso" },
        { name: "Fonda de resma A4", price: 3200, description: "500 hojas, 75g" },
        { name: "Caja de 12 marcadores", price: 2400, description: "Colores variados" },
      ],
    },
    {
      email: "vendedor10@test.com", password: "test123456", full_name: "Pet Shop Los Patines",
      phone: "2215550110", store_name: "Pet Shop Los Patines", slug: "pet-shop-los-patines",
      category: "pet shop", vertical: "comercio", whatsapp: "5492215550110", neighborhood: "sicardi",
      address: "Calle 47 y 23, Sicardi", hours: "Lun a Sáb · 9:00 a 19:00",
      description: "Todo para tu mascota: alimentos, accesorios, peluquería y más.",
      payment_methods: "Efectivo, Débito, Mercado Pago", delivery_options: "ambos", instagram: "@petshoplospatines",
      offers: [
        { name: "Balanceado premium perro 15kg", price: 18500, description: "Carne y arroz, todas las razas" },
        { name: "Paseador de perros (sesión)", price: 3500, description: "1 hora, zona Sicardi" },
        { name: "Juguete interactivo gato", price: 2800, description: "Con plumas y pelota" },
      ],
    },
  ];

  const buyers = [
    { email: "comprador@test.com", password: "test123456", full_name: "Comprador Test", phone: "2215550999", neighborhood: "sicardi" },
  ];

  for (const b of buyers) {
    try {
      await withTransaction(async (tx) => {
        await tx.queryVoid(
          `INSERT INTO profiles (email, password_hash, full_name, neighborhood, phone, role, email_confirmed, verified)
           VALUES ($1, $2, $3, $4, $5, 'buyer', true, true)`,
          [b.email, await hashPassword(b.password), b.full_name, b.neighborhood, b.phone]
        );
      });
      results.push({ email: b.email, status: "ok" });
    } catch (e: unknown) {
      results.push({ email: b.email, error: e instanceof Error ? e.message : "error" });
    }
  }

  for (const v of vendors) {
    try {
      await withTransaction(async (tx) => {
        const profRows = await tx.query<{ id: string }>(
          `INSERT INTO profiles (email, password_hash, full_name, neighborhood, phone, role, email_confirmed, verified)
           VALUES ($1, $2, $3, $4, $5, 'vendor', true, true)
           ON CONFLICT (email) DO NOTHING
           RETURNING id`,
          [v.email, await hashPassword(v.password), v.full_name, v.neighborhood || "sicardi", v.phone]
        );
        let userId = profRows[0]?.id;
        if (!userId) {
          const existing = await tx.query<{ id: string }>(`SELECT id FROM profiles WHERE email = $1 LIMIT 1`, [v.email]);
          userId = existing[0].id;
        }

        const vendRows = await tx.query<{ id: string }>(
          `INSERT INTO vendors (user_id, store_name, slug, category, vertical, neighborhood, whatsapp, phone, address, hours, description, accepting_quotes, verified, instagram, facebook, payment_methods, delivery_options, services_list, service_area, free_estimate)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true,true,$12,$13,$14,$15,$16,$17,$18)
           ON CONFLICT (slug) DO UPDATE SET store_name = EXCLUDED.store_name
           RETURNING id`,
          [userId, v.store_name, v.slug, v.category, v.vertical, v.neighborhood || "sicardi", v.whatsapp,
           v.phone || null, v.address || null, v.hours || null, v.description || null,
           v.instagram || null, v.facebook || null, v.payment_methods || null,
           v.delivery_options || "ambos", v.services_list || null, v.service_area || null,
           v.free_estimate !== false]
        );
        const vendorId = vendRows[0].id;

        let offerCount = 0;
        for (const o of v.offers) {
          await tx.queryVoid(
            `INSERT INTO products (vendor_id, name, description, price, currency, category, neighborhood, type, available, featured_today)
             VALUES ($1,$2,$3,$4,'ARS',$5,$6,'food',true,$7)`,
            [vendorId, o.name, o.description, o.price, v.category, v.neighborhood || "sicardi", (o as any).featured ?? false]
          );
          offerCount++;
        }

        return { userId, vendorId, offerCount };
      });

      results.push({ email: v.email, status: "ok", slug: v.slug, offers: v.offers.length, microsite: `/tienda/${v.slug}` });
    } catch (e: unknown) {
      results.push({ email: v.email, error: e instanceof Error ? e.message : "error" });
    }
  }

  return NextResponse.json({ results });
}