/**
 * Verificación del motor de redondeo de precios (Fase A).
 * Corre con: node scripts/check-price-rounding.mjs
 *
 * Node 24 ejecuta el TypeScript directo (strip-types): se testea el MISMO
 * código que usan las rutas server y el panel:
 *   - src/lib/price-rounding.ts (applyRounding / resolveRounding / equivalencias)
 *   - src/lib/cost-reprice.ts   (priceFromCost + redondeo, fórmula única)
 *
 * Invariantes:
 *   1. Default neutro === Math.round (compatibilidad total con lo histórico).
 *   2. nearest = mitad abajo/mitad arriba, empate → arriba (VTEX/Dux/RMH).
 *   3. up/down en múltiplos (10/100/500).
 *   4. Terminaciones ,90/,95/,99 (step 1) y 90/95/99 (step 100).
 *   5. resolveRounding sanea basura sin lanzar (tail >= step → 0, etc.).
 *   6. priceFromCost sigue la fórmula única y respeta la regla.
 *   7. Equivalencias de ganancia: markup ↔ margen ↔ food cost (mismos números).
 */
import {
  applyRounding,
  describeRounding,
  equivalentsFromFoodCost,
  equivalentsFromMargin,
  equivalentsFromMarkup,
  gainFromPriceCost,
  isDefaultRounding,
  resolveRounding,
  roundingExample,
  tailOptionsFor,
} from "../src/lib/price-rounding.ts";
import { priceFromCost, promoFromRatio } from "../src/lib/cost-reprice.ts";

let failures = 0;
function check(name, cond) {
  if (cond) {
    console.log(`  ✔ ${name}`);
  } else {
    console.error(`  ✘ ${name}`);
    failures++;
  }
}

console.log("Redondeo de precios — check de invariantes\n");

// ── 1. Default neutro === Math.round ───────────────────────────────────────
console.log("1. Default neutro (step 1, nearest, tail 0)");
check("1.340 → 1.234 (sin tocar)", applyRounding(1234, null) === 1234);
check("1.234,56 → 1.235 (round)", applyRounding(1234.56, null) === 1235);
check("1.234,49 → 1.234 (round)", applyRounding(1234.49, null) === 1234);
check("0,5 → 1 (empate arriba)", applyRounding(0.5, null) === 1);
check("isDefaultRounding(null) === true", isDefaultRounding(null) === true);
check("resolveRounding({basura}) === default", JSON.stringify(resolveRounding({ step: "x", mode: 5, tail: -3 })) === JSON.stringify({ step: 1, mode: "nearest", tail: 0 }));

// ── 2. nearest con múltiplos ───────────────────────────────────────────────
console.log("\n2. nearest con múltiplos");
const N100 = { step: 100, mode: "nearest", tail: 0 };
check("1.340 → 1.300", applyRounding(1340, N100) === 1300);
check("1.350 → 1.400 (empate arriba)", applyRounding(1350, N100) === 1400);
check("1.349 → 1.300", applyRounding(1349, N100) === 1300);
check("990 → 1.000", applyRounding(990, N100) === 1000);
const N10 = { step: 10, mode: "nearest", tail: 0 };
check("1.234 → 1.230 (step 10)", applyRounding(1234, N10) === 1230);
check("1.235 → 1.240 (step 10, empate)", applyRounding(1235, N10) === 1240);

// ── 3. up / down ───────────────────────────────────────────────────────────
console.log("\n3. up / down");
const U100 = { step: 100, mode: "up", tail: 0 };
const D100 = { step: 100, mode: "down", tail: 0 };
check("1.340 up → 1.400", applyRounding(1340, U100) === 1400);
check("1.300 up → 1.300 (ya es múltiplo)", applyRounding(1300, U100) === 1300);
check("1.340 down → 1.300", applyRounding(1340, D100) === 1300);
check("1.300 down → 1.300", applyRounding(1300, D100) === 1300);
const U500 = { step: 500, mode: "up", tail: 0 };
check("1.234 up step 500 → 1.500", applyRounding(1234, U500) === 1500);

// ── 4. Terminaciones ───────────────────────────────────────────────────────
console.log("\n4. Terminaciones");
const T1_99 = { step: 1, mode: "nearest", tail: 0.99 };
check("1.234,10 tail ,99 → 1.233,99", applyRounding(1234.1, T1_99) === 1233.99);
check("1.234,50 tail ,99 → 1.234,99", applyRounding(1234.5, T1_99) === 1234.99);
const T100_99 = { step: 100, mode: "up", tail: 99 };
check("1.234 tail 99 up → 1.299", applyRounding(1234, T100_99) === 1299);
check("1.234 tail 99 nearest → 1.199", applyRounding(1234, { step: 100, mode: "nearest", tail: 99 }) === 1199);
check("1.234 tail 99 down → 1.199", applyRounding(1234, { step: 100, mode: "down", tail: 99 }) === 1199);
const T100_90 = { step: 100, mode: "up", tail: 90 };
check("1.234 tail 90 up → 1.290", applyRounding(1234, T100_90) === 1290);
const T10_95 = { step: 10, mode: "nearest", tail: 0.95 };
check("1.234 tail ,95 step 10 → 1.230,95 (X0,95)", applyRounding(1234, T10_95) === 1230.95);
const T1_95up = { step: 1, mode: "up", tail: 0.95 };
check("1.234 tail ,95 step 1 up → 1.234,95", applyRounding(1234, T1_95up) === 1234.95);
check("tail >= step se invalida a 0 (resolve)", resolveRounding({ step: 10, mode: "nearest", tail: 90 }).tail === 0);
check("tailOptionsFor(100) incluye termina-en-99", tailOptionsFor(100).some((p) => p.tail === 99));
check("tailOptionsFor(10) excluye termina-en-99", !tailOptionsFor(10).some((p) => p.tail === 99));

// ── 5. Saneamiento ─────────────────────────────────────────────────────────
console.log("\n5. Saneamiento");
check("step 0 → default 1", resolveRounding({ step: 0, mode: "nearest", tail: 0 }).step === 1);
check("step -5 → default 1", resolveRounding({ step: -5 }).step === 1);
check("mode inválido → nearest", resolveRounding({ step: 10, mode: "sideways" }).mode === "nearest");
check("step 1.234.567 se topea", resolveRounding({ step: 1234567 }).step === 100000);
check("negativo → 0", applyRounding(-10, N100) === 0);
check("NaN → 0", applyRounding(NaN, N100) === 0);
check("describeRounding con regla default", describeRounding(null).includes("Sin redondeo"));
check("describeRounding múltiplo", describeRounding(N100) === "Múltiplo de $100 · al más cercano");
check("describeRounding terminación", describeRounding(T100_99).includes("Termina en 99"));
check("roundingExample", roundingExample(1340, N100) === "$1.340 → $1.300");
check("roundingExample default → null", roundingExample(1340, null) === null);

// ── 6. Fórmula única precio-desde-costo ────────────────────────────────────
console.log("\n6. priceFromCost (fórmula única)");
check("markup 50 sin regla → 1.500", priceFromCost(1000, "markup", 50) === 1500);
check("margin 50 sin regla → 2.000", priceFromCost(1000, "margin", 50) === 2000);
check("markup 50 con step 100 up → 1.500", priceFromCost(1000, "markup", 50, U100) === 1500);
check("markup 47 con step 100 up → 1.500", priceFromCost(1000, "markup", 47, U100) === 1500);
check("markup 47 con step 100 nearest → 1.500", priceFromCost(1000, "markup", 47, N100) === 1500);
check("sin costo → null", priceFromCost(null, "markup", 50) === null);
check("margen >= 100 → null", priceFromCost(1000, "margin", 100) === null);
check("promo hereda redondeo", promoFromRatio(1500, 1000, 800, true, U100) === 1200);
check("promo sin regla (cociente)", promoFromRatio(1500, 1000, 800, true) === 1200);

// ── 7. Equivalencias de ganancia ───────────────────────────────────────────
console.log("\n7. Equivalencias (markup ↔ margen ↔ food cost)");
const eq = equivalentsFromMarkup(50);
check("recargo 50% → margen 33,3%", eq.margin === 33.3);
check("recargo 50% → food cost 66,7%", eq.foodCost === 66.7);
const eq2 = equivalentsFromMargin(33.3);
check("margen 33,3% → recargo ≈ 50%", Math.abs(eq2.markup - 50) < 0.2);
const eq3 = equivalentsFromFoodCost(30);
check("food cost 30% → margen 70%", eq3.margin === 70);
check("food cost 30% → recargo ≈ 233,3%", Math.abs(eq3.markup - 233.3) < 0.2);
const g = gainFromPriceCost(1500, 1000);
check("precio 1.500 / costo 1.000 → margen 33,3%", g.margin === 33.3);
check("ganancia con precio 0 → null", gainFromPriceCost(0, 1000) === null);

console.log(failures === 0 ? "\nOK — todos los invariantes cumplen" : `\nFALLAN ${failures} invariantes`);
process.exit(failures === 0 ? 0 : 1);
