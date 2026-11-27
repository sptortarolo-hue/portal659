/**
 * Verificación del precio tipeado en altas de producto.
 * Corre con: node scripts/check-price-input.mjs
 *
 * Invariantes (mismo helper para cliente y servidor):
 *   1. Vacío / null → sin precio (400).
 *   2. Precio 0 → válido (antes el servidor lo rechazaba con `!price`).
 *   3. Coma y punto decimal → mismo número.
 *   4. Negativos / basura → sin precio.
 */
import { parsePriceInput } from "../src/lib/price-input.ts";

let failures = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}`, extra ?? "");
  }
};

check("vacío → null", parsePriceInput("") === null);
check("espacios → null", parsePriceInput("   ") === null);
check("null → null", parsePriceInput(null) === null);
check("undefined → null", parsePriceInput(undefined) === null);
check('"0" → 0 (válido)', parsePriceInput("0") === 0);
check("número 0 → 0", parsePriceInput(0) === 0);
check('"1500,50" → 1500.5', parsePriceInput("1500,50") === 1500.5);
check('"1500.50" → 1500.5', parsePriceInput("1500.50") === 1500.5);
check('" 12,5 " → 12.5', parsePriceInput(" 12,5 ") === 12.5);
check("negativo → null", parsePriceInput("-1") === null);
check("basura → null", parsePriceInput("abc") === null);
check("NaN → null", parsePriceInput(Number.NaN) === null);

console.log(failures === 0 ? "\n✓ check-price-input: todo OK" : `\n✗ ${failures} falla(s)`);
process.exit(failures === 0 ? 0 : 1);
