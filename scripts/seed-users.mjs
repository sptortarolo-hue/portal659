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

const testUsers = [
  {
    email: "comprador@test.com",
    password: "test123456",
    role: "buyer",
    full_name: "Comprador Test",
    neighborhood: "sicardi",
    phone: "2215550101",
  },
  {
    email: "vendedor@test.com",
    password: "test123456",
    role: "vendor",
    full_name: "Vendedor Test",
    neighborhood: "garibaldi",
    phone: "2215550102",
  },
  {
    email: "admin@test.com",
    password: "test123456",
    role: "admin",
    full_name: "Admin Test",
    neighborhood: "arana",
    phone: "2215550103",
  },
];

async function seed() {
  for (const u of testUsers) {
    process.stdout.write(`Creando ${u.email} (${u.role})… `);

    const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
      email: u.email,
      password: u.password,
      email_confirm: true,
      user_metadata: { full_name: u.full_name, role: u.role },
    });

    if (authError) {
      console.log(`❌ ${authError.message}`);
      continue;
    }

    const userId = authUser.user.id;

    const { error: profileError } = await supabase.from("profiles").insert({
      id: userId,
      email: u.email,
      full_name: u.full_name,
      neighborhood: u.neighborhood,
      phone: u.phone,
      role: u.role,
      verified: true,
    });

    if (profileError) {
      console.log(`❌ profile: ${profileError.message}`);
      continue;
    }

    console.log(`✔`);

    if (u.role === "vendor") {
      process.stdout.write(`  Creando tienda… `);
      const { error: vendorError } = await supabase.from("vendors").insert({
        user_id: userId,
        store_name: "Tienda de Prueba",
        category: "reformas",
        neighborhood: u.neighborhood,
        whatsapp: u.phone,
        accepting_quotes: true,
        verified: true,
      });

      console.log(vendorError ? `❌ ${vendorError.message}` : "✔");
    }
  }

  console.log("\n✅ Seed completado.\n");
  console.log("Usuarios creados:");
  console.log("  comprador@test.com / test123456 (buyer)");
  console.log("  vendedor@test.com / test123456 (vendor)");
  console.log("  admin@test.com / test123456 (admin)");
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
