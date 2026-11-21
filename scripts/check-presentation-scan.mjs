/**
 * Verificación estática: las presentaciones (productos hijos) deben ser
 * encontrables por código/SKU al escanear en el Mostrador y al buscar en el
 * Catálogo, aunque estén ocultas del listado principal.
 * Corre con: node scripts/check-presentation-scan.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

let failures = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}`, extra ?? "");
  }
};

const mostrador = read("src/components/vendor/mostrador.tsx");
const menuStudio = read("src/components/dashboard/menu-studio.tsx");

check("mostrador: existe memo scanProducts que aplana presentaciones",
  /const scanProducts = useMemo\(\(\) => \{[\s\S]*?presentations/.test(mostrador));
check("mostrador: resolveScanCode match SKU usa scanProducts",
  /const hit = scanProducts\.find\(\(p\) => \(\(p as any\)\.sku \|\| ""\)\.toLowerCase\(\) === q/.test(mostrador));
check("mostrador: match por nombre usa scanProducts",
  /const named = scanProducts\.filter\(/.test(mostrador));
check("mostrador: findProductByScalePlu usa scanProducts",
  /scanProducts\.find\(\(p\) => p\.available !== false && normalizePlu\(p\.scale_plu\) === n\)/.test(mostrador));
check("menu-studio: filteredOffers también matchea por sku",
  /o\.name\.toLowerCase\(\)\.includes\(q\) \|\| \(o\.sku \|\| ""\)\.toLowerCase\(\)\.includes\(q\)/.test(menuStudio));
check("menu-studio: Offer tiene scale_plu opcional",
  /scale_plu\?: string \| null;/.test(menuStudio));

console.log(failures === 0 ? "\nTodo OK" : `\n${failures} fallo(s)`);
process.exit(failures === 0 ? 0 : 1);