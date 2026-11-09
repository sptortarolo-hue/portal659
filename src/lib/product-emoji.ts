/**
 * Foto de referencia (PNG, Twemoji CC-BY 4.0) para productos sin foto.
 * Las imágenes están en /public/emojis/ (dominio propio, sin CDN).
 *
 * Cómo se decide (en este orden):
 *   1. REGLAS sobre el NOMBRE normalizado (sin tildes, minúsculas).
 *   2. CATEGORIA: sólo una lista corta de rubros informativos.
 *   3. Fallback NEUTRO por vertical (bolsa / remera / farmacia / herramienta):
 *      nunca una comida concreta — "hamburguesa para todo lo gastro" era el
 *      error original (un agua o un hielo parecían una hamburguesa).
 *   4. null → el caller muestra el ícono lucide del vertical.
 *
 * Reglas de las regex (aprendidas a los golpes, NO romperlas):
 *   - El texto se normaliza SIN TILDES: las regex van sin acentos.
 *   - Tokens cortos/ambiguos llevan `\b` (word boundary): sin eso "campera"
 *     matcheaba "pera" (fruta), "Ramon" matcheaba "ramo" (flor), "sales"
 *     matcheaba "ale" (cerveza), "aparte" matcheaba "te" (té).
 *   - Los específicos van ANTES de los genéricos: si "fruta" va primero,
 *     banana/sandía/naranja/uvas nunca se ven.
 *   - Los plurales se cubren con `x|xs` / `x(s)?`.
 */

type Rule = { re: RegExp; file: string };

function rule(re: RegExp, file: string): Rule {
  return { re, file };
}

// El orden importa: primero lo específico, lo genérico al final.
const RULES: Rule[] = [
  // === Comidas ===
  rule(/pancho|hot ?dog/i, "pancho.png"),
  rule(/hamburguesa|burger|lomito/i, "hamburguesa.png"),
  rule(/sandwich|sanguche|sanguch|pebete|chops|tostado/i, "sandwich.png"),
  rule(/pizza|faina/i, "pizza.png"),
  rule(/empanadas?/i, "empanada.png"),
  // `\btacos?\b`: ni "tacón" ni "Taco Fischer" son un taco.
  rule(/\btacos?\b/i, "taco.png"),
  rule(/burrito|wrap|shawarma|shaurma|gyro|kebab|doner/i, "burrito.png"),
  rule(/milanesa|cutlet|escalope|suprema/i, "milanesa.png"),
  rule(/asado|parrilla|chorizo|morcilla|costilla|brochette|vacio|entrana|churrasco/i, "asado.png"),
  // Pan: `\bpan\b` no matchea ni "pancho" ni "panadería". Sin esta regla
  // el pan casero caía al fallback del vertical (hamburguesa en gastro).
  rule(/\bpan(es)?\b|figacita|baguette|chipa/i, "pan.png"),
  rule(/papas fritas|papas|french fries|chips|papa frita/i, "papas.png"),
  rule(/pasta|fideos|spaghetti|tagliatelle|lasagna|raviol|noquis|gnocchi|sorrentinos|canelones/i, "pasta.png"),
  rule(/sushi|sashimi/i, "sushi.png"),
  rule(/sopa|minestrone|consome|caldo|puchero/i, "sopa.png"),
  rule(/arroz|paella|risotto/i, "paella.png"),
  // Sin "mixta": esa palabra se comía "verduras mixtas" y "milanesa mixta".
  rule(/ensalada|salad/i, "ensalada.png"),
  rule(/helado/i, "helado.png"),
  rule(/torta|pastel|flan|pudding|budin|tarta/i, "torta.png"),
  rule(/dona|donut/i, "dona.png"),
  rule(/medialuna|croissant|brioche|factura/i, "medialuna.png"),
  rule(/galleta|galletita|cookie|oreo|alfajor/i, "galleta.png"),
  rule(/chocolate|chocolat|mousse|brownie|bombon|turron/i, "chocolate.png"),
  rule(/huevo|omelette|revuelto/i, "huevo.png"),

  // === Verduras (específicas antes que la genérica) ===
  rule(/zanahoria|carrot|calabaza/i, "zanahoria.png"),
  rule(/tomate/i, "tomate.png"),
  rule(/cebolla|onion/i, "cebolla.png"),
  rule(/ajo|garlic/i, "ajo.png"),
  rule(/pimiento|pimenton|morron/i, "pimiento.png"),
  rule(/champinon|mushroom/i, "champinon.png"),
  rule(/aceituna|alcaparra|oliva/i, "aceituna.png"),
  rule(/acelga|espinaca|brocoli|coliflor|berenjena|repollo|lechuga|apio|zapallo/i, "verduras.png"),
  rule(/verdura|vegetal|hortaliza/i, "verduras.png"),
  rule(/queso|tabla|picada/i, "queso.png"),
  // `\bpapas?\b`: "papaya" NO es papa (antes lo era).
  rule(/\bpapas?\b|potato|tuberculo/i, "papa.png"),

  // === Frutas (la genérica "fruta" va ÚLTIMA de la sección) ===
  rule(/palta|aguacate|avocado/i, "palta.png"),
  rule(/limon|limonada/i, "limon.png"),
  rule(/frutilla|fresa/i, "fresa.png"),
  rule(/banana/i, "banana.png"),
  rule(/naranja/i, "naranja.png"),
  rule(/sandia/i, "sandia.png"),
  rule(/uvas?/i, "uvas.png"),
  // La genérica "fruta" va ÚLTIMA de la sección, con `\bperas?\b` para que
  // "campera" no sea una fruta (el substring "pera" la matcheaba).
  rule(/frut|manzana|\bperas?\b|kiwi|melon|anana|durazno|ciruela|mango|papaya|mandarina/i, "fruta.png"),

  // === Café / bebidas ===
  // "whisky-cola" antes que whisky y que las gaseosas.
  rule(/whisky.?cola|cocacola|coca.?cola|\bcola\b|fernet/i, "whisky-cola.png"),
  rule(/cafe|expresso|latte|cappuccino|macchiato/i, "cafe.png"),
  // `\bte\b`: "salsa aparte" ya no es un té (era "te\b", matcheaba el final
  // de cualquier palabra terminada en -te). "mate" sólo como palabra.
  rule(/\bte\b|\bmate\b|matcha|infusion/i, "te.png"),
  rule(/cerveza|lager|stout|\bale\b|\bipa\b/i, "cerveza.png"),
  rule(/vino|cabernet|malbec|chardonnay/i, "vino.png"),
  rule(/jugo|smoothie|licuado|batido/i, "jugo.png"),
  rule(/gaseosa|refresco|\bsoda\b/i, "jugo.png"),
  rule(/whisky|bourbon|scotch|whiskey/i, "whisky.png"),
  rule(/copa|cocktail|trago|mimosa|aperitivo/i, "copa.png"),

  // === Moda / indumentaria ===
  rule(/pantalon|jeans|denim|shorts|joggins|bermudas/i, "pantalon.png"),
  rule(/remera|camiseta|tshirt|blusa|hoodie|buzo|lana|sueter|sweater|saco|chomba|musculosa|campera|\btop\b/i, "remera.png"),
  rule(/vestido|dress|falda|pollera|gown|enterito/i, "vestido.png"),
  rule(/zapatilla|sneaker|ojotas|crocs/i, "zapatilla.png"),
  // `\bbotas?\b`: una "botella" ya no es un zapato.
  rule(/zapato|calzado|\bbotas?\b|sandalia|mocasin|botines/i, "zapato.png"),
  // `\bcap\b` (word boundary): "capucha" y "cápsula" ya no son gorras.
  rule(/gorra|gorro|sombrero|beanie|boina|\bcap\b|\bcaps?\b/i, "gorra.png"),
  rule(/lentes|anteojos|gafas|sunglasses/i, "lentes.png"),
  rule(/bolso|cartera|mochila|handbag|satchel|bandolera|\bbolsas?\b/i, "bolsa.png"),
  rule(/reloj|watch|cronografo/i, "reloj.png"),

  // === Otros / hogar / herramientas ===
  rule(/jabon|detergente|limpieza|limpiador|shampoo|lavandina|suavizante/i, "jabon.png"),
  rule(/cepillo|escoba|brocha|pincel|plumero/i, "cepillo.png"),
  rule(/lampara|lamparita|iluminacion|velador|foco|\bluz\b/i, "lampara.png"),
  rule(/vela|candle|sahumerio|incienso|aromaterapia/i, "vela.png"),
  // Sin "color" suelto: una "tela de color rojo" no es pintura.
  rule(/pintura|lienzo|acuarela|tempera|esmalte/i, "pintura.png"),
  // `\bramo\b`: "Verdulería Ramón" no es un flor.
  rule(/flor|bouquet|\bramo\b/i, "flor.png"),
  rule(/planta|succulent|cactus|maceta/i, "planta.png"),
  rule(/libro|novela|revista|cuaderno|agenda|comic/i, "libro.png"),
  rule(/farmacia|remedio|medicina|vitamina|aspirina|ibuprofeno|paracetamol|jarabe|pomada|antibiotico/i, "farmacia.png"),
  rule(/herramienta|taladro|ferreteria|destornillador|martillo|pinza|tornillo|clavo|tarugo|sierra|amoladora|morsa|alicate/i, "herramienta.png"),
  rule(/embalaje|envio|packaging|envoltorio/i, "embalaje.png"),

  // === Rubro del local (nombres de comercio / categorías) ===
  rule(/heladeria/i, "helado.png"),
  rule(/panaderia/i, "pan.png"),
  rule(/verduleria|fruteria/i, "verduras.png"),
  rule(/libreria|papeleria/i, "libro.png"),
  rule(/pizzeria/i, "pizza.png"),
  rule(/rotiseria/i, "milanesa.png"),
  rule(/carniceria/i, "asado.png"),
];

/**
 * Categorías que SÍ clasifican (lista corta a propósito): "Bebidas",
 * "Minutas" o "Limpieza" genéricas clasificaban TODO igual (todo lo de
 * Bebidas era jugo, incluso el agua). Acá sólo entran rubros informativos.
 */
const CATEGORY_RULES: Rule[] = [
  rule(/verduras?|vegetales|verduleria|hortalizas/i, "verduras.png"),
  rule(/frutas?|fruteria|frutillas/i, "fruta.png"),
  rule(/panaderia/i, "pan.png"),
  rule(/heladeria/i, "helado.png"),
  rule(/libreria|papeleria/i, "libro.png"),
  rule(/ferreteria/i, "herramienta.png"),
  rule(/limpieza/i, "jabon.png"),
  rule(/infusiones|cafeteria/i, "cafe.png"),
  rule(/pizzeria/i, "pizza.png"),
  rule(/rotiseria/i, "milanesa.png"),
];

/**
 * Fallback NEUTRO por vertical. Regla: nunca una foto que "prometa" un
 * producto concreto (la hamburguesa para gastronomía clasificaba mal todo
 * lo que no matcheaba: agua, hielo, servilletas). Lo neutro no miente.
 * Los verticales sin emoji neutral (gastronomía, estética) van a null → ícono.
 */
const VERTICAL_FALLBACK: Record<string, string> = {
  comercio: "/emojis/bolsa.png",
  moda: "/emojis/remera.png",
  salud: "/emojis/farmacia.png",
  servicio: "/emojis/herramienta.png",
  taller: "/emojis/herramienta.png",
  otro: "/emojis/embalaje.png",
};

function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function firstMatch(text: string, rules: Rule[]): string | null {
  for (const rule of rules) {
    if (rule.re.test(text)) return `/emojis/${rule.file}`;
  }
  return null;
}

/**
 * Devuelve la ruta a la imagen de referencia cuando el producto no tiene foto.
 * Orden: nombre → categoría (sólo rubros informativos) → fallback neutral por
 * vertical → null (el caller muestra el ícono lucide del vertical).
 */
export function getProductEmojiImage(
  name?: string,
  category?: string | null,
  vertical?: string | null,
): string | null {
  const nameText = normalizeText(name ?? "");
  const categoryText = normalizeText(category ?? "");

  // 1. El nombre manda siempre (mira ANTES la categoría para que "Sopa"
  //    bajo la categoría "Bebidas" no se vuelva jugo).
  const byName = firstMatch(nameText, RULES);
  if (byName) return byName;

  // 2. Categoría, sólo si es informativa de verdad.
  if (categoryText) {
    const byCategory = firstMatch(categoryText, CATEGORY_RULES);
    if (byCategory) return byCategory;
  }

  // 3. Fallback neutral por vertical.
  if (vertical && VERTICAL_FALLBACK[vertical]) {
    return VERTICAL_FALLBACK[vertical];
  }

  return null;
}
