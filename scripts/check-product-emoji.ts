/**
 * Verificación de las imágenes de referencia para productos sin foto.
 * Corre con: node scripts/check-product-emoji.ts
 *
 * Congela las reglas que se aprendieron a los golpes:
 *   1. cada nombre conocido devuelve SU imagen (específico antes que genérico);
 *   2. los trampas clásicos ya NO matchean lo que matcheaban por substring
 *      (campera→fruta, "Ramon"→flor, "sales"→cerveza, "aparte"→té,
 *      "capucha"→gorra, "papaya"→papa, "color"→pintura);
 *   3. sin match se devuelve null o un fallback NEUTRO del vertical
 *      (nunca una comida concreta: el agua no es una hamburguesa);
 *   4. toda imagen devuelta existe de verdad en public/emojis;
 *   5. la categoría genérica ("Bebidas") no clasifica todo igual;
 *   6. determinismo: misma entrada => misma salida.
 */
import { existsSync, readdirSync } from "node:fs";
import { getProductEmojiImage } from "../src/lib/product-emoji.ts";

let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${name}`, extra ?? "");
  }
};

type Case = {
  name: string;
  category?: string | null;
  vertical?: string | null;
  expect: string | null;
};

const E = (file: string) => `/emojis/${file}`;

// --- 1. El nombre conocido devuelve su imagen ---
const BY_NAME: Case[] = [
  { name: "Empanadas de carne", expect: E("empanada.png") },
  { name: "Pancho", expect: E("pancho.png") },
  { name: "Hamburguesa completa", expect: E("hamburguesa.png") },
  { name: "Sándwich de miga", expect: E("sandwich.png") },
  { name: "Chops", expect: E("sandwich.png") },
  { name: "Pizza de muzarella", expect: E("pizza.png") },
  { name: "Fainá", expect: E("pizza.png") },
  { name: "Burrito", expect: E("burrito.png") },
  { name: "Wrap de pollo", expect: E("burrito.png") },
  { name: "Milanesa de carne", expect: E("milanesa.png") },
  { name: "Sopa de pollo", expect: E("sopa.png") },
  { name: "Fideos con tuco", expect: E("pasta.png") },
  { name: "Ñoquis de papa", expect: E("pasta.png") },
  { name: "Sushi", expect: E("sushi.png") },
  { name: "Arroz con pollo", expect: E("paella.png") },
  { name: "Verduras mixtas", expect: E("verduras.png") },
  { name: "Helado 2 bochas", expect: E("helado.png") },
  { name: "Flan casero", expect: E("torta.png") },
  { name: "Medialunas", expect: E("medialuna.png") },
  { name: "Factura", expect: E("medialuna.png") },
  { name: "Alfajor de chocolate", expect: E("galleta.png") },
  { name: "Huevo frito", expect: E("huevo.png") },
  { name: "Papas fritas", expect: E("papas.png") },
  { name: "Papa", expect: E("papa.png") },
  { name: "Pan casero", expect: E("pan.png") },
  { name: "Tomate", expect: E("tomate.png") },
  { name: "Zanahoria", expect: E("zanahoria.png") },
  { name: "Cebolla", expect: E("cebolla.png") },
  { name: "Pimiento morrón", expect: E("pimiento.png") },
  { name: "Champiñones", expect: E("champinon.png") },
  { name: "Aceitunas", expect: E("aceituna.png") },
  { name: "Queso cremoso", expect: E("queso.png") },
  // frutas: la específica gana sobre la genérica
  { name: "Frutillas", expect: E("fresa.png") },
  { name: "Banana", expect: E("banana.png") },
  { name: "Naranja", expect: E("naranja.png") },
  { name: "Sandía", expect: E("sandia.png") },
  { name: "Uvas", expect: E("uvas.png") },
  { name: "Palta", expect: E("palta.png") },
  { name: "Limón", expect: E("limon.png") },
  { name: "Papaya", expect: E("fruta.png") },
  // bebidas
  { name: "Café con leche", expect: E("cafe.png") },
  { name: "Té verde", expect: E("te.png") },
  { name: "Cerveza IPA", expect: E("cerveza.png") },
  { name: "Vino tinto", expect: E("vino.png") },
  { name: "Jugo de naranja", expect: E("naranja.png") },
  { name: "Coca Cola", expect: E("whisky-cola.png") },
  // moda
  { name: "Pantalón jean", expect: E("pantalon.png") },
  { name: "Remera", expect: E("remera.png") },
  { name: "Hoodie", expect: E("remera.png") },
  { name: "Vestido", expect: E("vestido.png") },
  { name: "Zapatillas", expect: E("zapatilla.png") },
  { name: "Ojotas", expect: E("zapatilla.png") },
  { name: "Zapatos", expect: E("zapato.png") },
  { name: "Botas", expect: E("zapato.png") },
  { name: "Lentes de sol", expect: E("lentes.png") },
  { name: "Cartera", expect: E("bolsa.png") },
  { name: "Reloj", expect: E("reloj.png") },
  // hogar / otros
  { name: "Shampoo", expect: E("jabon.png") },
  { name: "Cepillo de dientes", expect: E("cepillo.png") },
  { name: "Foco led", expect: E("lampara.png") },
  { name: "Velas", expect: E("vela.png") },
  { name: "Pintura", expect: E("pintura.png") },
  { name: "Planta", expect: E("planta.png") },
  { name: "Cuaderno", expect: E("libro.png") },
  { name: "Aspirina", expect: E("farmacia.png") },
  { name: "Tornillos", expect: E("herramienta.png") },
];

// --- 2. Rubro del local (antes todo esto era una hamburguesa) ---
const BY_RUBRO: Case[] = [
  { name: "Panadería Don Pan", expect: E("pan.png") },
  { name: "Heladería Italia", expect: E("helado.png") },
  { name: "Verdulería Ramón", expect: E("verduras.png") },
  { name: "Librería Anita", expect: E("libro.png") },
  { name: "Pizzería Napoli", expect: E("pizza.png") },
  { name: "Rotisería Esquina", expect: E("milanesa.png") },
  { name: "Ferretería Nueva", expect: E("herramienta.png") },
];

// --- 3. Trampas: el substring ya no dispara la imagen equivocada ---
const TRAPS: Case[] = [
  { name: "Campera", vertical: null, expect: E("remera.png") }, // antes fruta: "campera" contiene "pera"
  { name: "Capucha", vertical: null, expect: null }, // antes gorra: "capucha" contiene "cap"
  { name: "Tela de color rojo", vertical: null, expect: null }, // antes pintura
  { name: "Sales de baño", vertical: null, expect: null }, // antes cerveza
  { name: "Salsa aparte", vertical: null, expect: null }, // antes té
  { name: "Botella de agua", vertical: null, expect: null }, // antes jugo
  { name: "Botiquín", vertical: null, expect: null }, // antes zapato
  { name: "Zapatos de tacon", vertical: null, expect: E("zapato.png") }, // antes taco
  { name: "Tacos de pescado", vertical: null, expect: E("taco.png") }, // word-boundary: sigue siendo taco
  { name: "Papaya", vertical: null, expect: E("fruta.png") }, // antes papa
  { name: "Perejil", vertical: null, expect: null },
  { name: "Servilletas", vertical: null, expect: null }, // antes hamburguesa
];

// --- 4. La categoría genérica NO clasifica todo igual ---
const CATEGORIES: Case[] = [
  { name: "Agua mineral 500ml", category: "Bebidas", vertical: null, expect: null },
  { name: "Hielo", category: "Bebidas", vertical: null, expect: null },
  { name: "Vino", category: "Bebidas", vertical: null, expect: E("vino.png") }, // el nombre manda igual
  { name: "Sopa", category: "Bebidas", vertical: null, expect: E("sopa.png") }, // nombre gana sobre categoría engañosa
  { name: "Producto X", category: "Limpieza", vertical: null, expect: E("jabon.png") }, // categoría informativa
  { name: "Agua mineral", category: "Minutas", vertical: null, expect: null }, // categoría genérica: no clasifica
  { name: "Zapallitos", category: "Verduras", vertical: null, expect: E("verduras.png") },
  { name: "Facturas", category: "Panadería", vertical: null, expect: E("medialuna.png") },
];

// --- 5. Fallback NEUTRO por vertical (nunca una comida concreta) ---
const VERTICALS: Case[] = [
  { name: "Producto X", vertical: "comercio", expect: E("bolsa.png") },
  { name: "Producto X", vertical: "moda", expect: E("remera.png") },
  { name: "Producto X", vertical: "salud", expect: E("farmacia.png") },
  { name: "Producto X", vertical: "servicio", expect: E("herramienta.png") },
  { name: "Producto X", vertical: "taller", expect: E("herramienta.png") },
  { name: "Producto X", vertical: "otro", expect: E("embalaje.png") },
  // gastro y estética NO tienen fallback: van al ícono lucide (null)
  { name: "Producto X", vertical: "gastronomia", expect: null },
  { name: "Silla plegable", vertical: "gastronomia", expect: null },
  { name: "Producto X", vertical: "estetica", expect: null },
  { name: "Corte de pelo", vertical: "estetica", expect: null },
];

const runAll = (cases: Case[], title: string) => {
  console.log(`\n${title}`);
  for (const c of cases) {
    const got = getProductEmojiImage(c.name, c.category, c.vertical);
    const label = `${c.name}${c.category ? ` (cat: ${c.category})` : ""}${c.vertical ? ` [${c.vertical}]` : ""}`;
    check(`${label} → ${c.expect ?? "null (ícono)"}`, got === c.expect, got);
  }
};

runAll(BY_NAME, "1. El nombre conocido devuelve su imagen");
runAll(BY_RUBRO, "2. Rubro del local");
runAll(TRAPS, "3. Trampas: el substring ya no acierta la imagen equivocada");
runAll(CATEGORIES, "4. La categoría genérica no clasifica todo igual");
runAll(VERTICALS, "5. Fallback neutro por vertical");

console.log("\n6. Invariantes");

// Determinismo.
const probes = ["Banana", "Campera", "Panadería Don Pan", "Agua"];
const detA = probes.map((n) => getProductEmojiImage(n, null, "gastronomia"));
const detB = probes.map((n) => getProductEmojiImage(n, null, "gastronomia"));
check("misma entrada => misma salida", JSON.stringify(detA) === JSON.stringify(detB));

// Entradas vacías / nulas no rompen.
check("nombre undefined no rompe", getProductEmojiImage(undefined, undefined, undefined) === null);
check("nombre vacío no rompe", getProductEmojiImage("", "", "") === null);

// Toda imagen devuelta existe de verdad en public/emojis (atrapa typos y
// carpetas no desplegadas).
const emojiDir = "public/emojis";
const available = new Set(readdirSync(emojiDir).filter((f) => f.endsWith(".png")));
const returned = new Set(
  BY_NAME.concat(BY_RUBRO, TRAPS, CATEGORIES, VERTICALS)
    .map((c) => getProductEmojiImage(c.name, c.category, c.vertical))
    .filter((p): p is string => !!p)
);
const missing = [...returned].filter((p) => !existsSync(`${emojiDir}/${p.replace("/emojis/", "")}`));
check("todas las imágenes devueltas existen en public/emojis", missing.length === 0, missing);
check("el directorio de emojis tiene contenido", available.size > 0, available.size);

// Nunca una comida concreta como fallback de vertical: la promesa original.
const neutral = ["bolsa.png", "remera.png", "farmacia.png", "herramienta.png", "embalaje.png"];
const fallbackFiles = new Set(
  VERTICALS.filter((c) => c.expect)
    .map((c) => (c.expect ?? "").replace("/emojis/", ""))
    .filter((f) => neutral.includes(f))
);
check("el fallback de vertical sólo usa imágenes neutras", fallbackFiles.size === neutral.length);

if (failures > 0) {
  console.log(`\n${failures} verificaci${failures === 1 ? "ón" : "ones"} fallaron`);
  process.exit(1);
}
console.log("\ntodas las verificaciones pasaron");
