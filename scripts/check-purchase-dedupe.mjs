/**
 * Verificación del dedupe de compras.
 * Corre con: node scripts/check-purchase-dedupe.mjs
 *
 * Node 24 ejecuta TypeScript directo (strip-types): se testea el MISMO código
 * puro que usan las rutas de compras y de lectura de facturas.
 *
 * Regresión principal: dos facturas nuevas del MISMO proveedor, con los
 * MISMOS productos y el MISMO monto pero distinto n° de comprobante, NO
 * deben ser marcadas como duplicadas. Antes el nivel "possible" (monto ±3%,
 * fecha ±30 días, sin mirar n° ni líneas) daba un falso positivo que bloqueaba.
 */
import { readFileSync } from "node:fs";
import {
  amountClose,
  isPossibleDuplicate,
  lineIdentity,
  linesCompatible,
  normalizeReceiptNumber,
  normalizeUnit,
  possibleReason,
  receiptNumbersDiffer,
  withinDays,
  EXACT_FILE_REASON,
  POSSIBLE_DAYS,
  STRONG_REASON,
} from "../src/lib/purchase-dedupe-core.ts";

let failures = 0;
function check(name, cond) {
  if (cond) console.log(`  ✔ ${name}`);
  else { console.error(`  ✘ ${name}`); failures++; }
}
const line = (key, qty, unit = "u", total = 0) => ({ key, qty, unit, total });

console.log("Dedupe de compras — check de invariantes\n");

// ── 1. Normalización compartida JS/SQL ──────────────────────────────────────
console.log("1. Normalización de comprobante y unidades");
check('"0001" y "1" normalizan igual', normalizeReceiptNumber("0001") === normalizeReceiptNumber("1"));
check("sin puntuación", normalizeReceiptNumber("A-1/23") === "a123");
check("distintos números ⇒ distintos", receiptNumbersDiffer("A-100", "B-200") === true);
check("mismo número con ceros ⇒ iguales", receiptNumbersDiffer("0001", "1") === false);
check("uno sin número no descarta", receiptNumbersDiffer("A-100", "") === false);
check('unidades: "unidades" → "u"', normalizeUnit("unidades") === "u");
check('unidades: "Kilos" → "kg"', normalizeUnit("Kilos") === "kg");

// ── 2. Caso del bug: compra recurrente, misma línea y monto, otro n° ───────
console.log("\n2. Factura nueva con mismos productos y monto");
const itemsA = [line("ing-123", 2, "kg", 1000), line("ing-456", 1, "u", 500)];
const existing = {
  id: "compra-vieja",
  purchased_at: "2026-11-20",
  receipt_number: "0001",
  total: 1500,
  lines: itemsA,
};
check(
  "mismo proveedor + mismas líneas + mismo monto pero n° distinto ⇒ NO duplicado",
  isPossibleDuplicate({ receiptNumber: "0002", total: 1500, purchasedAt: "2026-11-20", lines: itemsA }, existing) === false
);
check(
  "n° distinto aunque difiera el monto un 1% ⇒ NO duplicado",
  isPossibleDuplicate({ receiptNumber: "0002", total: 1515, purchasedAt: "2026-11-20", lines: itemsA }, existing) === false
);

// ── 3. Sospechosos legítimos (solo advertencia) ────────────────────────────
console.log("\n3. Posibles duplicados (deben ADVERTIR, nunca bloquear)");
check(
  "sin n° en ambos, mismas líneas y fecha cercana ⇒ posible",
  isPossibleDuplicate({ receiptNumber: null, total: 1500, purchasedAt: "2026-11-21", lines: itemsA }, existing) === true
);
check(
  "mismo n° y monto similar (no exacto) ⇒ posible",
  isPossibleDuplicate({ receiptNumber: "0001", total: 1510, purchasedAt: "2026-11-20", lines: itemsA }, existing) === true
);
check("razón legible sin n°", /sin n°/.test(possibleReason(null, existing)));
check("razón legible con n°", /comprobante/.test(possibleReason("0001", existing)));
check("razón strong explica el n°", STRONG_REASON.includes("n°"));
check("razón exact_file explica el archivo", EXACT_FILE_REASON.includes("mismo archivo"));

// ── 4. Descartadores del nivel possible ────────────────────────────────────
console.log("\n4. Filtros que evitan falsos positivos");
check(
  "fecha lejana ⇒ NO duplicado",
  isPossibleDuplicate({ receiptNumber: null, total: 1500, purchasedAt: "2026-12-10", lines: itemsA }, existing) === false
);
check(
  "líneas distintas ⇒ NO duplicado",
  isPossibleDuplicate({ receiptNumber: null, total: 1500, purchasedAt: "2026-11-20", lines: [line("ing-999", 1, "u", 1500)] }, existing) === false
);
check(
  "monto fuera de ±3% ⇒ NO duplicado",
  isPossibleDuplicate({ receiptNumber: null, total: 1800, purchasedAt: "2026-11-20", lines: itemsA }, existing) === false
);
check(`ventana de ${POSSIBLE_DAYS} días (no 30)`, POSSIBLE_DAYS === 3);
check("±3% dentro", amountClose(1000, 1020) === true);
check("±3% fuera", amountClose(1000, 1100) === false);
check("sin fecha no descarta", withinDays(null, "2026-11-20") === true);

// ── 5. Comparación de líneas ───────────────────────────────────────────────
console.log("\n5. Firmas de línea");
check("orden distinto = mismas líneas", linesCompatible([line("a", 1, "kg"), line("b", 2, "u")], [line("b", 2, "u"), line("a", 1, "kg")]) === true);
check("cantidad distinta = líneas distintas", linesCompatible([line("a", 1, "kg")], [line("a", 2, "kg")]) === false);
check("unidades equivalentes", lineIdentity(line("a", 1, "kilogramos")) === lineIdentity(line("a", 1, "kg")));
check("sin señal (lista vacía) no descarta", linesCompatible([], [line("a", 1)]) === true);

// ── 6. Contratos en las rutas (regresión de "no te deja ingresar") ─────────
console.log("\n6. Contratos de las rutas y el panel");
const postRoute = readFileSync(new URL("../src/app/api/vendor/purchases/route.ts", import.meta.url), "utf8");
const dedupe = readFileSync(new URL("../src/lib/purchase-dedupe.ts", import.meta.url), "utf8");
const panel = readFileSync(new URL("../src/components/dashboard/purchases-manager.tsx", import.meta.url), "utf8");
check("POST solo bloquea exact_file", /duplicate\?\.type === "exact_file" && !allowDuplicate/.test(postRoute));
check("POST devuelve duplicate_warning", /duplicate_warning: duplicateWarning/.test(postRoute));
check("POST ya no dice 'Esta compra ya está registrada'", !postRoute.includes("Esta compra ya está registrada"));
check("dedupe usa la decisión pura", /isPossibleDuplicate\(/.test(dedupe));
check("dedupe pasa líneas", /fetchCandidateLines\(/.test(dedupe));
check("panel explica que no bloquea", panel.includes("no te bloquea"));
check("panel ofrece cargar igual", panel.includes("Es nueva, cargar igual"));

console.log(`\n${failures === 0 ? "OK" : `FALLARON ${failures}`} — dedupe de compras`);
process.exit(failures === 0 ? 0 : 1);
