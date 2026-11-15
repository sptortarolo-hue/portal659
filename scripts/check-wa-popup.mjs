/**
 * Check: los botones que abren WhatsApp después de un await usan el patrón
 * openWaWindowSync() ANTES del await (si no, el navegador los bloquea como
 * popup y no pasa nada). Es el bug que se reportó con "Avisar recibido /
 * Avisar confirmado".
 *
 *   node scripts/check-wa-popup.mjs
 */
import fs from "fs";
import path from "path";

function fail(msg) {
  console.error(`[check-wa-popup] FAIL: ${msg}`);
  process.exit(1);
}
function ok(msg) {
  console.log(`[check-wa-popup] OK: ${msg}`);
}

const files = [
  "src/components/dashboard/order-detail-modal.tsx",
  "src/components/dashboard/dashboard-servicio.tsx",
  "src/components/dashboard/booking-card.tsx",
  "src/components/dashboard/booking-cobro-modal.tsx",
];

// Patrón: un handler async que contiene `await fetch(` y, más adelante, abre
// WhatsApp. Si no hay un openWaWindowSync() antes del primer await del handler,
// el popup va a ser bloqueado.
for (const rel of files) {
  const src = fs.readFileSync(path.join(process.cwd(), rel), "utf8");
  // Buscamos cada bloque async () => { ... } que contenga await fetch o
  // await buildQuoteShareText y verificamos que, si llama a navigateWaWindow
  // o window.open con wa.me, haya un openWaWindowSync antes.
  const asyncBlocks = [...src.matchAll(/onClick=\{async \(\) => \{([\s\S]*?)\}\}/g)];
  for (const m of asyncBlocks) {
    const block = m[1];
    const hasAsyncWork = /await (fetch|buildQuoteShareText|res\.json)/.test(block);
    const opensWa = /navigateWaWindow\(|window\.open\([^)]*wa\.me/.test(block);
    if (hasAsyncWork && opensWa) {
      if (!block.includes("openWaWindowSync()")) {
        fail(`${rel}: handler async que abre WhatsApp sin openWaWindowSync() antes del await -> popup blocker`);
      }
      // El openWaWindowSync debe venir ANTES del primer await.
      const idxOpen = block.indexOf("openWaWindowSync()");
      const idxAwait = block.search(/await (fetch|buildQuoteShareText|res\.json)/);
      if (idxOpen > idxAwait) {
        fail(`${rel}: openWaWindowSync() está DESPUÉS del await -> popup blocker`);
      }
    }
  }
  ok(`${rel}: handlers async que abren WhatsApp usan openWaWindowSync() antes del await`);
}

// El helper debe existir.
if (!fs.existsSync(path.join(process.cwd(), "src/lib/open-wa.ts"))) {
  fail("falta src/lib/open-wa.ts");
}
ok("helper open-wa.ts presente");

console.log("[check-wa-popup] TODO OK");
