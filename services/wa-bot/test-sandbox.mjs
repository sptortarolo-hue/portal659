// @ts-nocheck
// Verifica que el modo sandbox del Playground/Laboratorio NO produzca efectos
// reales: ni escrituras al app, ni lecturas de clientes por teléfono, ni
// token de sandbox filtrándose fuera de su request.
process.env.DATABASE_URL = "";

const { runInSandbox, isSandbox, appFetch } = await import("./src/sandbox.mjs");

let fails = 0;
const ok = (label, cond) => {
  console.log(`${cond ? ">>> OK" : "!!! FALLA"}: ${label}`);
  if (!cond) fails++;
};

const calls = [];
globalThis.fetch = async (url, opts) => {
  calls.push({ url: String(url), method: String(opts?.method || "GET") });
  return new Response(JSON.stringify({ ok: true, items: [{ id: "x", name: "Empanada", price: 1000 }] }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
};

ok("fuera del sandbox no hay flag", isSandbox() === false);

// Catálogo: se deja pasar (para que el playground vea el menú real).
await appFetch("https://app.local/api/wa/menu?vendorId=1");
ok("sandbox: lectura de catálogo permitida", calls.at(-1)?.url.includes("/menu"));

await runInSandbox(async () => {
  // Escrituras: nunca llegan al app.
  const before = calls.length;
  await appFetch("https://app.local/api/wa/order", { method: "POST", body: "{}" });
  await appFetch("https://app.local/api/wa/quote", { method: "POST", body: "{}" });
  await appFetch("https://app.local/api/wa/favorites", { method: "POST", body: "{}" });
  await appFetch("https://app.local/api/wa/handoff", { method: "POST", body: "{}" });
  await appFetch("https://app.local/api/wa/receipt", { method: "POST", body: "{}" });
  ok("sandbox: 0 escrituras reales al app", calls.length === before);

  // Datos de clientes: nunca se consultan por teléfono real.
  await appFetch("https://app.local/api/wa/portal-orders?phone=5491100001234");
  await appFetch("https://app.local/api/wa/customer?vendorId=1&phone=5491100001234");
  ok("sandbox: 0 lecturas de clientes reales", calls.length === before);

  ok("dentro del sandbox el flag está prendido", isSandbox() === true);
  await appFetch("https://app.local/api/wa/order", { method: "POST", body: "{}" });
  ok("sandbox async: tampoco escribe", calls.length === before);
});
ok("el flag no se filtra después del request", isSandbox() === false);

console.log(`\n=== SANDBOX: ${fails === 0 ? "TODO OK" : `${fails} FALLAS`} ===`);
process.exit(fails ? 1 : 0);
