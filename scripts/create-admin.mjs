import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  const email = "sptortarolo@gmail.com";
  const password = "123456";

  console.log("Buscando usuario...");

  const { data: users, error: listError } = await supabase.auth.admin.listUsers();
  if (listError) {
    console.error("Error listando usuarios:", listError.message);
    process.exit(1);
  }

  const user = users.users.find((u) => u.email === email);

  if (!user) {
    console.log("Usuario no existe. Creando...");
    const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        first_name: "santiago",
        last_name: "tortarolo",
        full_name: "santiago tortarolo",
        whatsapp: "",
        role: "vendor",
        vertical: "gastronomia",
      },
    });
    if (authError) {
      console.error("Error creando usuario:", authError.message);
      process.exit(1);
    }
    console.log("Usuario creado:", authUser.user.id);

    const { error: vendorError } = await supabase.from("vendors").upsert({
      user_id: authUser.user.id,
      store_name: "Portal 659 Admin",
      slug: "admin-portal659",
      category: "admin",
      vertical: "gastronomia",
      neighborhood: "sicardi",
      accepting_quotes: false,
      verified: true,
      is_admin: true,
    });
    if (vendorError) {
      console.error("Error creando vendor:", vendorError.message);
      process.exit(1);
    }
    console.log("Admin creado con exito!");
  } else {
    console.log("Usuario encontrado:", user.id);

    const { data: vendor } = await supabase
      .from("vendors")
      .select("id, store_name, is_admin")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!vendor) {
      console.log("Sin vendor record. Creando...");
      const { error } = await supabase.from("vendors").upsert({
        user_id: user.id,
        store_name: "Portal 659 Admin",
        slug: "admin-portal659",
        category: "admin",
        vertical: "gastronomia",
        neighborhood: "sicardi",
        accepting_quotes: false,
        verified: true,
        is_admin: true,
      });
      if (error) {
        console.error("Error:", error.message);
        process.exit(1);
      }
      console.log("Vendor admin creado!");
    } else if (!vendor.is_admin) {
      console.log("Promoviendo a admin...");
      const { error } = await supabase
        .from("vendors")
        .update({ is_admin: true })
        .eq("id", vendor.id);
      if (error) {
        console.error("Error:", error.message);
        process.exit(1);
      }
      console.log("Promovido a admin!");
    } else {
      console.log("Ya es admin!");
    }
  }

  console.log("\nEmail:", email);
  console.log("Contrasena:", password);
  console.log("URL:", url);
}

main();
