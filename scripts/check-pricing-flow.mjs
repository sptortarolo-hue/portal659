/**
 * Verificación del estado derivado del flujo de precios.
 * Corre con: node scripts/check-pricing-flow.mjs
 */
import { getPricingStatus } from "../src/lib/pricing-status.ts";

let failures = 0;
function check(name, cond) {
  if (cond) console.log(`  ✔ ${name}`);
  else { console.error(`  ✘ ${name}`); failures++; }
}

console.log("Estado derivado del flujo de precios:");
const sinCosto = getPricingStatus({ price: 1000, margin_list_id: "l1" });
check("sin costo manda y no calcula lista", sinCosto.stage === "sin_costo" && sinCosto.missing.includes("costo"));

const costo = getPricingStatus({ cost_last: 500, price_source: "factura" });
check("costo sin lista ni precio", costo.stage === "costo" && costo.missing.includes("lista") && costo.missing.includes("precio"));

const conLista = getPricingStatus({ cost_last: 500, margin_list_id: "l1" });
check("costo + lista sin precio", conLista.stage === "con_lista" && conLista.missing.includes("precio"));

const listo = getPricingStatus({ cost_last: 500, margin_list_id: "l1", price: 1000, image_url: "x", category: "c", stock_control: true });
check("listo con lista", listo.stage === "listo" && listo.label === "✓ Listo" && listo.readyFor.includes("micrositio"));

const manual = getPricingStatus({ cost_last: 500, price: 1000, price_source: "manual", pricing_skipped: { list: "Precio manual" } });
check("precio manual marcado, no error", manual.stage === "listo" && manual.label === "⚠️ Precio manual" && manual.skipped.list === "Precio manual");

const combo = getPricingStatus({ cost_last: 500, price: 1000, is_combo: true });
check("combo no se marca para micrositio", !combo.readyFor.includes("micrositio"));

const insumo = getPricingStatus({ cost_last: 500, kind: "ingredient" });
check("insumo solo analytics", insumo.readyFor.length === 1 && insumo.readyFor[0] === "analytics");

if (failures) { console.error(`\n${failures} fallas`); process.exit(1); }
console.log("\nOK: flujo de precios consistente");
