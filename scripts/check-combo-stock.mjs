/**
 * Verifica el fix de stock de combos:
 *  - stock.ts resuelve componentes desde la DB cuando falta combo_members.
 *  - webhook MP adjunta combo_members resueltos desde DB.
 *
 * Corre con: node scripts/check-combo-stock.mjs
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (p) => readFileSync(join(root, p), "utf8");

const stock = read("src/lib/stock.ts");
const webhook = read("src/app/api/webhooks/mercadopago/route.ts");

let failures = 0;
const check = (label, cond) => {
  if (cond) console.log(`  OK  ${label}`);
  else { console.log(`  FAIL ${label}`); failures++; }
};

console.log("check-combo-stock");

check("stock.ts define resolveComboMembersFromDb", /async function resolveComboMembersFromDb/.test(stock));
check("stock.ts consulta combo_items", /FROM combo_items WHERE combo_product_id/.test(stock));
check("stock.ts tolerante a tabla inexistente", /to_regclass\('public\.combo_items'\)/.test(stock));
check("stock.ts resuelve desde DB cuando falta combo_members", /resolveComboMembersFromDb\(tx, String\(item\.product_id\)\)/.test(stock));

check("webhook MP resuelve combo_members desde DB", /FROM combo_items WHERE combo_product_id = \$1/.test(webhook));
check("webhook MP persiste desglose (UPDATE orders)", /UPDATE orders SET items = \$1 WHERE id = \$2/.test(webhook));

check("stock.ts descuenta combo si stock_control prendido", /UPDATE products SET stock = stock - \$1[\s\S]*?WHERE id = \$2 AND stock_control = true AND COALESCE\(stock, 0\) >= \$1/.test(stock));

console.log(failures === 0
  ? "\ncheck-combo-stock: OK (todas las invariantes se cumplen)"
  : `\ncheck-combo-stock: ${failures} invariante(s) rota(s)`);
process.exit(failures === 0 ? 0 : 1);