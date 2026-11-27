/**
 * Verificación del selector de categoría al crear productos desde una factura.
 * Corre con: node scripts/check-invoice-category.mjs
 *
 * Comprueba que el alta rápida de Compras y el asistente de precios envíen
 * `category` a POST /api/vendor/offers, que el selector permita crear una
 * categoría nueva inline y que el servidor canonice el nombre (sin migración).
 */
import { readFileSync } from "node:fs";

let failures = 0;
function check(name, cond) {
  if (cond) console.log(`  ✔ ${name}`);
  else { console.error(`  ✘ ${name}`); failures++; }
}
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

console.log("Categoría al crear producto desde factura — check de cableado\n");

const picker = read("src/components/dashboard/category-select.tsx");
const purchases = read("src/components/dashboard/purchases-manager.tsx");
const guide = read("src/app/vendor/precios/asistente/page.tsx");
const offers = read("src/app/api/vendor/offers/route.ts");
const categoriesApi = read("src/app/api/vendor/categories/route.ts");

console.log("1. Selector reutilizable");
check('opción "Sin categoría" (→ otras)', picker.includes("Sin categoría"));
check('opción "+ Nueva categoría…"', picker.includes("+ Nueva categoría"));
check("alta inline por POST /api/vendor/categories", /fetch\("\/api\/vendor\/categories"/.test(picker));
check("duplicado case-insensitive selecciona la existente", /toLowerCase\(\) === name\.toLowerCase\(\)/.test(picker));
check("botones del alta inline son type=button", (picker.match(/type="button"/g) || []).length >= 2);
check("administra el valor como nombre (products.category es texto)", /onChange: \(name: string\) => void/.test(picker));

console.log("\n2. Compras (QuickCreateSheet)");
check("carga GET /api/vendor/categories", purchases.includes('getJson<{ categories?: CategoryOption[] }>("/api/vendor/categories")'));
check("pasa categories al PurchaseForm", purchases.includes("categories={categories}"));
check("pasa categories al QuickCreateSheet", purchases.includes("categories={categories}"));
check("envía category en el alta", purchases.includes("category: category || undefined"));
check("actualiza la lista al crear categoría", purchases.includes("setCategories((prev) => [...prev.filter"));
check("copy ya no promete completar categoría en el catálogo", !purchases.includes("categoría se completan en el catálogo"));

console.log("\n3. Asistente de precios");
check("carga categorías al iniciar", guide.includes('getJson<{ categories?: CategoryOption[] }>("/api/vendor/categories")'));
check("renderiza el CategorySelect", guide.includes("<CategorySelect"));
check("envía category en createCurrentLine", guide.includes("category: categoryChoice || undefined"));
check("actualiza la lista al crear categoría", guide.includes("setCategories((prev) => [...prev.filter"));

console.log("\n4. Servidor (sin cambios, ya soporta category)");
check("offers POST lee category del body", /const \{ name, description, price, category,/.test(offers));
check("offers POST canoniza con resolveCategoryName", /resolveCategoryName\(vendor\.id, category\)/.test(offers));
check("categories POST existe", /export async function POST/.test(categoriesApi));
check("índice único por nombre (normalized)", /lower\(name\)|lower\(btrim\(name\)\)/.test(categoriesApi) || categoriesApi.includes("Ya existe una categoría"));

console.log(`\n${failures === 0 ? "OK" : `FALLARON ${failures}`} — categoría en alta desde factura`);
process.exit(failures === 0 ? 0 : 1);
