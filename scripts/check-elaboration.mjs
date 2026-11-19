/**
 * Verificación del cálculo de lote de envasado (granel → paquetes).
 * Corre con: node scripts/check-elaboration.mjs
 *
 * Node 24 ejecuta el TypeScript directo (strip-types), así que se testea
 * el MISMO motor que usa la API y la pantalla (`src/lib/packing-math.ts`).
 *
 * Invariantes:
 *   1. El granel se descuenta por el PESAJE real (no por la receta teórica):
 *      3 bolsas de 0,5 kg consumen 1,5 kg / (1 − merma).
 *   2. Con varias líneas de peso (nueces + pasas) el pesaje se reparte
 *      proporcionalmente a la receta (400/100 → 80%/20%).
 *   3. Packaging (unidad) se consume 1 por bolsa, con su merma.
 *   4. El stock faltante se reporta en `missing` con name/need/have.
 *   5. Lotes vacíos / bolsas inválidas no rompen (units=0, totalKg=0).
 *   6. cost_total = Σ líneas; cost_per_unit = cost_total / units.
 */
import {
  computeBatch,
} from "../src/lib/packing-math.ts";

let failures = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}`, extra ?? "");
  }
};
const near = (a, b, eps = 0.5) => Math.abs(a - b) <= eps;

const granel = {
  ingredient_id: "ing-nueces",
  name: "Nueces granel",
  base_unit: "g",
  qty_net: 500,
  unit: "g",
  waste_pct: 8,
  cost_per_unit: 8, // $8 por gramo = $8.000/kg
  stock: 50000,
};
const bolsa = {
  ingredient_id: "ing-bolsa",
  name: "Bolsa 500 g",
  base_unit: "u",
  qty_net: 1,
  unit: "u",
  waste_pct: 0,
  cost_per_unit: 50,
  stock: 100,
};
const sticker = {
  ingredient_id: "ing-sticker",
  name: "Sticker",
  base_unit: "u",
  qty_net: 1,
  unit: "u",
  waste_pct: 2,
  cost_per_unit: 20,
  stock: 100,
};

// 1) Una sola línea de peso: el pesaje manda, con merma.
const r1 = computeBatch([0.5, 0.5, 0.5], [granel, bolsa, sticker]);
check("3 bolsas de 0,5 kg", r1.units === 3 && near(r1.totalKg, 1.5, 0.001));
const granel1 = r1.lines.find((l) => l.ingredient_id === "ing-nueces");
check(
  "granel consumido bruto = 1,5 kg / (1 − 0,08) = 1,630 kg",
  granel1 && near(granel1.qty_consumed_base, 1630.4, 1),
  granel1?.qty_consumed_base
);
const bolsa1 = r1.lines.find((l) => l.ingredient_id === "ing-bolsa");
check("packaging: 3 bolsas", bolsa1 && near(bolsa1.qty_consumed_base, 3, 0.001));
const sticker1 = r1.lines.find((l) => l.ingredient_id === "ing-sticker");
check("sticker con merma 2%: ~3,06 u", sticker1 && near(sticker1.qty_consumed_base, 3.06, 0.01));

// 6) Costo total = Σ líneas; cost_per_unit derivado.
const sum = r1.lines.reduce((s, l) => s + l.cost, 0);
check("cost_total = suma de líneas", near(r1.costTotal, sum, 0.02));
check("cost_per_unit = cost_total / units", near(r1.costPerUnit, r1.costTotal / 3, 0.001));
// El pesaje debe valer lo mismo que 1,63 kg × $8/g ≈ $13.000 + packaging.
check("costo del lote ≈ 13.043 + 150 + 62", near(r1.costTotal, 13043 + 150 + 62, 30), r1.costTotal);

// 2) Dos líneas de peso: reparto proporcional 400/100 (80%/20%).
const pasas = {
  ingredient_id: "ing-pasas",
  name: "Pasas",
  base_unit: "g",
  qty_net: 100,
  unit: "g",
  waste_pct: 0,
  cost_per_unit: 5,
  stock: 50000,
};
const nueces400 = { ...granel, qty_net: 400 };
const r2 = computeBatch([1.0], [nueces400, pasas]);
const n2 = r2.lines.find((l) => l.ingredient_id === "ing-nueces");
const p2 = r2.lines.find((l) => l.ingredient_id === "ing-pasas");
check(
  "nueces reciben 800 g del pesaje (1 kg × 80%)",
  n2 && near(n2.qty_consumed_base, 800 / (1 - 0.08), 1),
  n2?.qty_consumed_base
);
check("pasas reciben 200 g (1 kg × 20%)", p2 && near(p2.qty_consumed_base, 200, 1), p2?.qty_consumed_base);

// 3) Sin líneas de peso: consumo por paquete según receta (con merma).
const r3 = computeBatch([0.4], [
  { ...granel, qty_net: 500, unit: "g" }, // aunque no sea "peso" real en el pesaje, la línea ES de peso
]);
check("línea de peso ocupa pesaje real aunque la receta diga otra cosa", near(r3.lines[0].qty_consumed_base, (0.4 * 1000) / 0.92, 1));

// 4) Stock insuficiente → missing con need/have.
const pobre = { ...granel, stock: 100 };
const r4 = computeBatch([0.5, 0.5], [pobre, bolsa]);
check("faltante de granel reportado", r4.missing.length === 1 && r4.missing[0].ingredient_id === "ing-nueces");
check("missing trae need y have", r4.missing[0].need > 100 && r4.missing[0].have === 100);

// 5) Lote vacío / bolsas inválidas.
const r5 = computeBatch([], [granel]);
check("lote vacío no rompe", r5.units === 0 && r5.totalKg === 0 && r5.costTotal === 0 && r5.costPerUnit === 0);
const r6 = computeBatch([NaN, -1, 0], [granel]);
check("bolsas inválidas se ignoran", r6.units === 0 && r6.totalKg === 0);
const r7 = computeBatch([0.25], [granel, { ...bolsa, stock: null }]);
check("insumo sin control de stock: no entra en missing", r7.missing.length === 0);

console.log(failures === 0 ? "\n✓ check-elaboration: todo OK" : `\n✗ ${failures} falla(s)`);
process.exit(failures === 0 ? 0 : 1);
