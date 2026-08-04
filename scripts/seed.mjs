import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const envPath = join(__dirname, "..", ".env.local");
const envRaw = readFileSync(envPath, "utf-8");
const env = Object.fromEntries(
  envRaw
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey || serviceRoleKey.includes("poner")) {
  console.error("❌ Completá SUPABASE_SERVICE_ROLE_KEY en .env.local primero");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const SEED_USERS = [
  {
    email: "comprador@test.com",
    password: "test123456",
    role: "buyer",
    full_name: "Comprador Test",
    neighborhood: "sicardi",
    phone: "2215550999",
  },
  {
    email: "vendedor1@test.com",
    password: "test123456",
    role: "vendor",
    full_name: "María de las Empanadas",
    neighborhood: "sicardi",
    phone: "2215550101",
  },
  {
    email: "vendedor2@test.com",
    password: "test123456",
    role: "vendor",
    full_name: "Familia Rossi",
    neighborhood: "sicardi",
    phone: "2215550102",
  },
  {
    email: "vendedor3@test.com",
    password: "test123456",
    role: "vendor",
    full_name: "Julián de la Pizza",
    neighborhood: "sicardi",
    phone: "2215550103",
  },
  {
    email: "vendedor4@test.com",
    password: "test123456",
    role: "vendor",
    full_name: "La Familia de la Esquina",
    neighborhood: "garibaldi",
    phone: "2215550104",
  },
  {
    email: "vendedor5@test.com",
    password: "test123456",
    role: "vendor",
    full_name: "Huerta de Sicardi",
    neighborhood: "sicardi",
    phone: "2215550105",
  },
  {
    email: "vendedor6@test.com",
    password: "test123456",
    role: "vendor",
    full_name: "Marcos Electricista",
    neighborhood: "sicardi",
    phone: "2215550106",
  },
];

const SEED_VENDORS = [
  {
    id: "d9e03587-3484-42c6-b7dd-c185e0c6085c",
    email: "vendedor1@test.com",
    store_name: "Las Empanadas de María",
    slug: "las-empanadas-de-maria",
    category: "empanadas",
    vertical: "gastronomia",
    neighborhood: "sicardi",
    whatsapp: "5492215550101",
    address: "Calle 49 y 22, Sicardi",
    hours: "Mar a Dom · 17:00 a 23:00",
    description: "Empanadas caseras al horno, receta de la abuela.",
    payment_methods: "Efectivo, Débito",
    delivery_options: "ambos",
    instagram: "@lasempanadasmoria",
  },
  {
    id: "3be25ae4-b24b-4f4d-9556-0894ff31da66",
    email: "vendedor2@test.com",
    store_name: "Pastas Rossi",
    slug: "pastas-rossi",
    category: "pastas",
    vertical: "gastronomia",
    neighborhood: "sicardi",
    whatsapp: "5492215550102",
    address: "Calle 51 y 18, Sicardi",
    hours: "Jue a Dom · 11:00 a 15:00",
    description: "Pastas frescas hechas a mano todos los jueves.",
    payment_methods: "Efectivo, Débito, Mercado Pago",
    delivery_options: "retiro",
    instagram: "@pastasrossi",
  },
  {
    id: "27813e79-b06a-4420-993f-540d3547b242",
    email: "vendedor3@test.com",
    store_name: "Pizza a la Piedra Sicardi",
    slug: "pizza-a-la-piedra-sicardi",
    category: "pizzas",
    vertical: "gastronomia",
    neighborhood: "sicardi",
    whatsapp: "5492215550103",
    address: "Calle 50 y 20, Sicardi",
    hours: "Vie, Sáb y Dom · 19:00 a 00:00",
    description: "Pizzas a la piedra con masa madre de 48 horas.",
    payment_methods: "Efectivo, Débito, Mercado Pago",
    delivery_options: "ambos",
    facebook: "pizzalapiedrasicardi",
  },
  {
    id: "b1a2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
    email: "vendedor4@test.com",
    store_name: "Rotisería La Esquina de Garibaldi",
    slug: "rotiseria-la-esquina-de-garibaldi",
    category: "asado",
    vertical: "gastronomia",
    neighborhood: "garibaldi",
    whatsapp: "5492215550104",
    address: "Calle 7 y 32, Garibaldi",
    hours: "Mar a Dom · 11:00 a 14:00 y 20:00 a 23:00",
    description: "Pollos al spiedo y milanesas caseras de la esquina.",
    payment_methods: "Efectivo",
    delivery_options: "ambos",
  },
  {
    id: "c5d6e7f8-0001-4000-8000-000000000001",
    email: "vendedor5@test.com",
    store_name: "Verdulería La Huerta",
    slug: "verduleria-la-huerta",
    category: "verduras",
    vertical: "almacen",
    neighborhood: "sicardi",
    whatsapp: "5492215550105",
    address: "Calle 46 y 25, Sicardi",
    hours: "Lun a Sáb · 8:00 a 20:00",
    description: "Frutas y verduras de la quinta, todos los días.",
    payment_methods: "Efectivo, Mercado Pago",
    delivery_options: "ambos",
    instagram: "@lahuertasicardi",
  },
  {
    id: "c5d6e7f8-0002-4000-8000-000000000002",
    email: "vendedor6@test.com",
    store_name: "Marcos Electricista",
    slug: "marcos-electricista",
    category: "oficios",
    vertical: "servicio",
    neighborhood: "sicardi",
    whatsapp: "5492215550106",
    address: "Sicardi y alrededores",
    hours: "Lun a Sáb · 8:00 a 18:00",
    description: "Instalaciones, arreglos y urgencias eléctricas en el barrio.",
    services_list: "Instalaciones eléctricas, Reparaciones, Urgencias 24hs, Tableros, Iluminación",
    service_area: "Sicardi, Garibaldi y alrededores",
    free_estimate: true,
    delivery_options: "domicilio",
  },
];

const SEED_PRODUCTS = [
  // Las Empanadas de María (d9e03587-3484-42c6-b7dd-c185e0c6085c)
  {
    id: "265a2306-84cf-4598-a26a-b6ec8d038f6e",
    vendor_id: "d9e03587-3484-42c6-b7dd-c185e0c6085c",
    name: "Docena de empanadas de carne",
    description: "Carne cortada a cuchillo, 12 unidades",
    price: 5200,
    category: "empanadas",
    neighborhood: "sicardi",
    featured_today: true,
  },
  {
    id: "cd53fc8e-f79f-476a-bf57-b67179070b53",
    vendor_id: "d9e03587-3484-42c6-b7dd-c185e0c6085c",
    name: "Docena de empanadas de pollo",
    description: "Pollo y verduras, 12 unidades",
    price: 5200,
    category: "empanadas",
    neighborhood: "sicardi",
  },
  {
    id: "ffc8e1d5-93e7-46a9-9b88-146dfbed500a",
    vendor_id: "d9e03587-3484-42c6-b7dd-c185e0c6085c",
    name: "Docena de jamón y queso",
    description: "Jamón cocido y queso derretido",
    price: 5400,
    category: "empanadas",
    neighborhood: "sicardi",
  },
  {
    id: "be036664-1ba8-43dc-ac2f-33357f856a11",
    vendor_id: "d9e03587-3484-42c6-b7dd-c185e0c6085c",
    name: "Empanada suelta",
    description: "A elegir entre los gustos del día",
    price: 500,
    category: "empanadas",
    neighborhood: "sicardi",
  },
  // Pastas Rossi (3be25ae4-b24b-4f4d-9556-0894ff31da66)
  {
    id: "cbfbabf2-a211-4f68-9e6b-0484b761eb88",
    vendor_id: "3be25ae4-b24b-4f4d-9556-0894ff31da66",
    name: "Ravioles de ricota y espinaca x12",
    description: "Con salsa de tomate casera",
    price: 4800,
    category: "pastas",
    neighborhood: "sicardi",
    featured_today: true,
  },
  {
    id: "67b0e11a-32de-47c8-b95f-af041c6c000c",
    vendor_id: "3be25ae4-b24b-4f4d-9556-0894ff31da66",
    name: "Ñoquis de papa x1kg",
    description: "Listos para hervir",
    price: 4500,
    category: "pastas",
    neighborhood: "sicardi",
  },
  {
    id: "c25f616a-37aa-4e10-b1d1-aaa6c4179efd",
    vendor_id: "3be25ae4-b24b-4f4d-9556-0894ff31da66",
    name: "Tallarines caseros x1kg",
    description: "Huevos frescos de campo",
    price: 4200,
    category: "pastas",
    neighborhood: "sicardi",
  },
  {
    id: "f4a138ee-cbca-4552-8bf5-775040c7e691",
    vendor_id: "3be25ae4-b24b-4f4d-9556-0894ff31da66",
    name: "Salsa bolognesa (600ml)",
    description: "Receta de la familia",
    price: 3800,
    category: "pastas",
    neighborhood: "sicardi",
  },
  // Pizza a la Piedra Sicardi (27813e79-b06a-4420-993f-540d3547b242)
  {
    id: "6f9b960c-8e73-4c98-a0d8-90ab03276dba",
    vendor_id: "27813e79-b06a-4420-993f-540d3547b242",
    name: "Muzza grande",
    description: "Mozzarella y salsa de tomate",
    price: 6800,
    category: "pizzas",
    neighborhood: "sicardi",
  },
  {
    id: "3ce02cc2-d6e3-4b35-a3dc-6470bc8c8298",
    vendor_id: "27813e79-b06a-4420-993f-540d3547b242",
    name: "Fugazzeta",
    description: "Cebolla y provolone",
    price: 7200,
    category: "pizzas",
    neighborhood: "sicardi",
  },
  {
    id: "376004ff-461e-40fa-8862-9ad95011663d",
    vendor_id: "27813e79-b06a-4420-993f-540d3547b242",
    name: "Napolitana",
    description: "Tomate, ajo y orégano",
    price: 7500,
    category: "pizzas",
    neighborhood: "sicardi",
    featured_today: true,
  },
  {
    id: "5ec505cc-0fac-4667-a6d9-22f99a577267",
    vendor_id: "27813e79-b06a-4420-993f-540d3547b242",
    name: "Fainá",
    description: "Porción de garbanzo",
    price: 1200,
    category: "pizzas",
    neighborhood: "sicardi",
  },
  // Rotisería La Esquina de Garibaldi (b1a2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d)
  {
    id: "f0a11111-2222-4333-8444-555566667777",
    vendor_id: "b1a2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
    name: "Pollo al spiedo entero",
    description: "Con ensalada mixta",
    price: 8500,
    category: "asado",
    neighborhood: "garibaldi",
    featured_today: true,
  },
  {
    id: "f0a22222-3333-4444-8555-666677778888",
    vendor_id: "b1a2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
    name: "Milanesas de pollo x4",
    description: "Caseras, con puré o papas",
    price: 6200,
    category: "asado",
    neighborhood: "garibaldi",
  },
  {
    id: "f0a33333-4444-4555-8666-777788889999",
    vendor_id: "b1a2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
    name: "Papas fritas para 2",
    description: "Crocantes, con cheddar y verdeo",
    price: 3500,
    category: "asado",
    neighborhood: "garibaldi",
  },
  {
    id: "f0a44444-5555-4666-8777-888899990000",
    vendor_id: "b1a2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
    name: "Flan casero con dulce de leche",
    description: "Postre de la casa",
    price: 2800,
    category: "asado",
    neighborhood: "garibaldi",
  },
  // Bebidas (un plato por local para demo de categorías)
  {
    id: "11111111-2222-4333-8444-555566667000",
    vendor_id: "d9e03587-3484-42c6-b7dd-c185e0c6085c",
    name: "Gaseosa 1.5L",
    description: "Coca-Cola, Sprite o Fanta bien fría",
    price: 2500,
    category: "bebidas",
    neighborhood: "sicardi",
  },
  {
    id: "22222222-3333-4444-8555-666677778111",
    vendor_id: "3be25ae4-b24b-4f4d-9556-0894ff31da66",
    name: "Vino tinto x1L",
    description: "Malbec de bodega local",
    price: 6500,
    category: "bebidas",
    neighborhood: "sicardi",
  },
  {
    id: "33333333-4444-4555-8666-777788889222",
    vendor_id: "27813e79-b06a-4420-993f-540d3547b242",
    name: "Cerveza artesanal x1L",
    description: "Rubia o negra de barrio",
    price: 4000,
    category: "bebidas",
    neighborhood: "sicardi",
  },
  {
    id: "44444444-5555-4666-8777-888899990333",
    vendor_id: "b1a2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
    name: "Gaseosa 1.5L",
    description: "Coca-Cola, Sprite o Fanta bien fría",
    price: 2500,
    category: "bebidas",
    neighborhood: "garibaldi",
  },
  // Verdulería La Huerta (c5d6e7f8-0001-4000-8000-000000000001)
  {
    id: "a1000000-0001-4000-8000-000000000001",
    vendor_id: "c5d6e7f8-0001-4000-8000-000000000001",
    name: "Bolsa de papas (5kg)",
    description: "Papas blancas de la quinta",
    price: 5500,
    category: "verduras",
    neighborhood: "sicardi",
  },
  {
    id: "a1000000-0002-4000-8000-000000000002",
    vendor_id: "c5d6e7f8-0001-4000-8000-000000000001",
    name: "Tomate perita (1kg)",
    description: "Maduro en la planta",
    price: 3200,
    category: "verduras",
    neighborhood: "sicardi",
  },
  {
    id: "a1000000-0003-4000-8000-000000000003",
    vendor_id: "c5d6e7f8-0001-4000-8000-000000000001",
    name: "Docena de huevos",
    description: "Huevos de campo",
    price: 4200,
    category: "almacen",
    neighborhood: "sicardi",
  },
];

const SEED_CATEGORIES = [
  { vendor_id: "d9e03587-3484-42c6-b7dd-c185e0c6085c", name: "Empanadas", position: 0 },
  { vendor_id: "d9e03587-3484-42c6-b7dd-c185e0c6085c", name: "Bebidas", position: 1 },
  { vendor_id: "3be25ae4-b24b-4f4d-9556-0894ff31da66", name: "Pastas", position: 0 },
  { vendor_id: "3be25ae4-b24b-4f4d-9556-0894ff31da66", name: "Bebidas", position: 1 },
  { vendor_id: "27813e79-b06a-4420-993f-540d3547b242", name: "Pizzas", position: 0 },
  { vendor_id: "27813e79-b06a-4420-993f-540d3547b242", name: "Bebidas", position: 1 },
  { vendor_id: "b1a2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d", name: "Asado", position: 0 },
  { vendor_id: "b1a2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d", name: "Bebidas", position: 1 },
  { vendor_id: "c5d6e7f8-0001-4000-8000-000000000001", name: "Verduras", position: 0 },
  { vendor_id: "c5d6e7f8-0001-4000-8000-000000000001", name: "Almacén", position: 1 },
];

const SEED_ORDERS = [
  {
    id: "6d20dfcf-44d1-4dcc-9ac6-aca2f4754591",
    vendor_id: "d9e03587-3484-42c6-b7dd-c185e0c6085c",
    customer_name: "Cliente Test",
    customer_phone: "2215557777",
    method: "delivery",
    items: [{ qty: 2, name: "Empanadas", price: 5200 }],
    total: 10400,
    status: "new",
  },
  {
    id: "154f4986-c757-470c-b632-49e63cf0db47",
    vendor_id: "d9e03587-3484-42c6-b7dd-c185e0c6085c",
    customer_name: "Cliente Test",
    customer_phone: "2215557777",
    customer_address: "Calle 40 y 12",
    method: "delivery",
    items: [{ qty: 2, name: "Docena de empanadas de carne", price: 5200 }],
    total: 10400,
    status: "new",
  },
];

async function clean() {
  const seedEmails = SEED_USERS.map((u) => u.email);

  const { data: { users }, error: listError } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  if (listError) throw listError;

  for (const u of users) {
    if (seedEmails.includes(u.email)) {
      const { error } = await supabase.auth.admin.deleteUser(u.id);
      if (error) console.log(`  ⚠️  No se pudo borrar ${u.email}: ${error.message}`);
    }
  }

  const { error: profileError } = await supabase
    .from("profiles")
    .delete()
    .in("email", seedEmails);
  if (profileError) throw profileError;
}

async function seed() {
  await clean();

  const userIdByEmail = {};

  for (const u of SEED_USERS) {
    process.stdout.write(`Creando ${u.email} (${u.role})… `);

    const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
      email: u.email,
      password: u.password,
      email_confirm: true,
      user_metadata: { full_name: u.full_name, role: u.role },
    });

    if (authError) {
      console.log(`❌ ${authError.message}`);
      process.exit(1);
    }

    const userId = authUser.user.id;
    userIdByEmail[u.email] = userId;

    const { error: profileError } = await supabase.from("profiles").upsert({
      id: userId,
      email: u.email,
      full_name: u.full_name,
      neighborhood: u.neighborhood,
      phone: u.phone,
      role: u.role,
      verified: true,
    }, { onConflict: "id" });

    if (profileError) {
      console.log(`❌ profile: ${profileError.message}`);
      process.exit(1);
    }

    console.log("✔");
  }

  for (const v of SEED_VENDORS) {
    const { error } = await supabase.from("vendors").insert({
      id: v.id,
      user_id: userIdByEmail[v.email],
      store_name: v.store_name,
      slug: v.slug,
      category: v.category,
      vertical: v.vertical,
      neighborhood: v.neighborhood,
      whatsapp: v.whatsapp,
      address: v.address,
      hours: v.hours,
      description: v.description,
      verified: true,
      payment_methods: v.payment_methods || null,
      delivery_options: v.delivery_options || "ambos",
      instagram: v.instagram || null,
      facebook: v.facebook || null,
      services_list: v.services_list || null,
      service_area: v.service_area || null,
      free_estimate: v.free_estimate !== false,
    });
    if (error) {
      console.log(`❌ vendor ${v.slug}: ${error.message}`);
      process.exit(1);
    }
  }
  console.log(`✔ ${SEED_VENDORS.length} locales`);

  const { error: productError } = await supabase.from("products").insert(SEED_PRODUCTS);
  if (productError) {
    console.log(`❌ products: ${productError.message}`);
    process.exit(1);
  }
  console.log(`✔ ${SEED_PRODUCTS.length} platos`);

  const { error: categoryError } = await supabase
    .from("vendor_categories")
    .insert(SEED_CATEGORIES);
  if (categoryError) {
    console.log(`❌ categories: ${categoryError.message}`);
    process.exit(1);
  }
  console.log(`✔ ${SEED_CATEGORIES.length} categorías`);

  const { error: orderError } = await supabase.from("orders").insert(SEED_ORDERS);
  if (orderError) {
    console.log(`❌ orders: ${orderError.message}`);
    process.exit(1);
  }
  console.log(`✔ ${SEED_ORDERS.length} pedidos`);

  console.log("\n✅ Seed de Portal 659 completado.");
  console.log("  comprador@test.com / test123456 (buyer)");
  console.log("  vendedor1@test.com / test123456 (María)");
  console.log("  vendedor2@test.com / test123456 (Rossi)");
  console.log("  vendedor3@test.com / test123456 (Pizza)");
  console.log("  vendedor4@test.com / test123456 (Esquina, Garibaldi)");
  console.log("  vendedor5@test.com / test123456 (Verdulería, Almacén)");
  console.log("  vendedor6@test.com / test123456 (Electricista, Servicio)");
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
