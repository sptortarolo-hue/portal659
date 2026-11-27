/**
 * Verificación del empaque por producto (capa de costo opcional).
 * Corre con: node scripts/check-product-packaging.mjs
 *
 * Node ejecuta el TypeScript directo (strip-types), así que se testea el
 * MISMO helper que usan el panel, el asistente de precios y la API.
 *
 * Invariantes:
 *   1. Sin empaque / modo in_recipe: costo efectivo = cost_last.
 *   2. Con empaque simple: costo efectivo = cost_last + packaging_cost.
 *   3. Sin costo de producto NO se inventa uno con el empaque (null).
 *   4. El precio del asistente se calcula sobre el costo efectivo.
 *   5. La suma de líneas y la validación compartida por la API.
 */
import {
  effectiveCostOf,
  effectiveCostFromDb,
  packagingCostOf,
  sumPackagingLines,
  normalizePackagingLines,
  readPackagingMode,
  categoryKey,
} from "../src/lib/product-packaging.ts";
import { priceFromCost } from "../src/lib/cost-reprice.ts";

let failures = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}`, extra ?? "");
  }
};
const idA = "11111111-1111-4111-8111-111111111111";
const idB = "22222222-2222-4222-8222-222222222222";

// 1) Modos que NO suman.
check("sin empaque: efectivo = cost_last", effectiveCostOf({ cost_last: 1200, packaging_cost: 150, packaging_mode: "none" }) === 1200);
check("envasado (in_recipe): no duplica", effectiveCostOf({ cost_last: 1350, packaging_cost: 0, packaging_mode: "in_recipe" }) === 1350);
check("in_recipe con packaging_cost sucio: no suma", effectiveCostOf({ cost_last: 1350, packaging_cost: 150, packaging_mode: "in_recipe" }) === 1350);

// 2) Empaque simple.
check("simple: efectivo = producto + empaque", effectiveCostOf({ cost_last: 1200, packaging_cost: 150, packaging_mode: "simple" }) === 1350);
check("packagingCostOf simple", packagingCostOf({ packaging_cost: 150, packaging_mode: "simple" }) === 150);
check("default de categoría también suma", effectiveCostOf({ cost_last: 1200, packaging_cost: 110, packaging_mode: "category" }) === 1310);
check("category es un modo válido", readPackagingMode("category") === "category");
check("clave de categoría normalizada", categoryKey("  Almacén ") === "almacén");
check("effectiveCostFromDb (trigger ya saneó el modo)", effectiveCostFromDb({ cost_last: 1200, packaging_cost: 150 }) === 1350);
check("redondeo a 4 decimales", effectiveCostOf({ cost_last: 10.11111, packaging_cost: 0.22222, packaging_mode: "simple" }) === 10.3333);

// 3) Sin costo de producto.
check("sin cost_last → null aunque haya empaque", effectiveCostOf({ cost_last: null, packaging_cost: 150, packaging_mode: "simple" }) === null);
check("costo inválido → null", effectiveCostOf({ cost_last: -5, packaging_cost: 150, packaging_mode: "simple" }) === null);

// 4) Conexión con el asistente de precios.
const sinEmpaque = priceFromCost(1200, "markup", 30);
const conEmpaque = priceFromCost(effectiveCostOf({ cost_last: 1200, packaging_cost: 150, packaging_mode: "simple" }), "markup", 30);
check("precio sugerido cambia con el empaque", conEmpaque === 1755 && sinEmpaque === 1560, { sinEmpaque, conEmpaque });

// 5) Líneas y validación.
const lines = [
  { name: "Bolsa", qty: 1, unit_cost: 80 },
  { name: "Etiqueta", qty: 2, unit_cost: 30 },
];
check("suma de líneas con cantidades", sumPackagingLines(lines) === 140, sumPackagingLines(lines));
check("líneas vacías suman 0", sumPackagingLines([]) === 0);
const ok = normalizePackagingLines([{ ingredient_id: idA, qty: 1 }, { ingredient_id: idB, qty: 0.5 }]);
check("normaliza líneas válidas", ok.ok && ok.lines.length === 2 && ok.lines[1].qty === 0.5);
check("rechaza duplicados", normalizePackagingLines([{ ingredient_id: idA, qty: 1 }, { ingredient_id: idA, qty: 2 }]).ok === false);
check("rechaza cantidad 0", normalizePackagingLines([{ ingredient_id: idA, qty: 0 }]).ok === false);
check("rechaza id inválido", normalizePackagingLines([{ ingredient_id: "nope", qty: 1 }]).ok === false);
check("null = sin líneas", normalizePackagingLines(null).ok === true);

console.log(failures === 0 ? "\n✓ check-product-packaging: todo OK" : `\n✗ ${failures} falla(s)`);
process.exit(failures === 0 ? 0 : 1);
