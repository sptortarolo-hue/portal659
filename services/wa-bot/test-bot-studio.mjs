// @ts-nocheck
// Test del Bot Studio (Fase 1): la capa de configuración es ADITIVA.
// Sin DB, getBotConfig debe devolver null y el motor decidir por slug/env
// exactamente como antes (falla abierto).
process.env.BOT_TAKE_ORDERS = "";
process.env.DATABASE_URL = "";

const { getBotConfig, clearBotConfigCache } = await import("./src/bot-config.mjs");
const { clearState } = await import("./src/state.mjs");

let fails = 0;
const ok = (label, cond) => {
  console.log(`${cond ? ">>> OK" : "!!! FALLA"}: ${label}`);
  if (!cond) fails++;
};

clearBotConfigCache();
ok("sin DB: bot central cae a config null (modo histórico)", (await getBotConfig("portal-id", true)) === null);
ok("sin DB: comercio cae a config null (conserje)", (await getBotConfig("store-id", false)) === null);
await clearState("portal-vendor", "5491100005555");

console.log(`\n=== BOT STUDIO: ${fails === 0 ? "TODO OK" : `${fails} FALLAS`} ===`);
process.exit(fails ? 1 : 0);
