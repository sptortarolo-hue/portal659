// Seed de datos de prueba para desarrollo.
// Requiere el server de Next corriendo (npm run dev) porque delega en GET /api/seed,
// que ya está migrado a Postgres (pg). La API está bloqueada en producción.
//
// Uso:
//   npm run dev            (en otra terminal)
//   node scripts/seed.mjs  (o: npm run dev y curl http://localhost:3000/api/seed)

const BASE = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

async function main() {
  try {
    const res = await fetch(`${BASE}/api/seed`);
    if (!res.ok) {
      console.error(`❌ GET /api/seed falló (${res.status}). ¿Está corriendo 'npm run dev'?`);
      console.error("   En producción esta ruta está deshabilitada.");
      process.exit(1);
    }
    const data = await res.json();
    for (const r of data.results || []) {
      console.log(r.error ? `⚠️  ${r.email}: ${r.error}` : `✅ ${r.email} (${r.offers ?? 0} productos)`);
    }
    console.log("\nSeed completado. Total:", (data.results || []).length);
  } catch (e) {
    console.error("❌ No se pudo conectar al server de desarrollo en", BASE, "—", e.message);
    console.error("   Levantá 'npm run dev' primero.");
    process.exit(1);
  }
}

main();