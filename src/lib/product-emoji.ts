/**
 * Foto de referencia (PNG, Twemoji CC-BY 4.0) para productos sin foto.
 * Las imágenes están en /public/emojis/ (dominio propio, sin CDN).
 *
 * Reglas: primera coincidencia (sobre `nombre + categoría`, ya normalizado) gana.
 * Si ninguna matchea, fallback por vertical. Si nada, null → cae al ícono lucide.
 *
 * Nota: `re` puede ser poco específico en los bordes (ej "salchicha" matchearía
 * al patrón salchicha), pero es suficiente para un placeholder estético.
 */

type Rule = { re: RegExp; file: string };

function rule(re: RegExp, file: string): Rule {
  return { re, file };
}

// El orden importa: los más específicos van primero.
const RULES: Rule[] = [
  // === Comidas ===
  rule(/pancho|hot ?dog/i, "pancho.png"),
  rule(/hamburguesa|burger|lomito/i, "hamburguesa.png"),
  rule(/sandwich|sanguche|sanguch|pebete/i, "sandwich.png"),
  rule(/pizza|faina/i, "pizza.png"),
  rule(/empanada/i, "empanada.png"),
  rule(/taco/i, "taco.png"),
  rule(/burrito/i, "burrito.png"),
  rule(/milanesa|cutlet|escalope/i, "milanesa.png"),
  rule(/asado|parrilla|chorizo|morcilla|costilla|brochette|vacío|entraña/i, "asado.png"),
  rule(/papas fritas|papas|french fries|chips|puita/i, "papas.png"),
  rule(/fideos|pasta|spaghetti|tagliatelle|lasagna|raviol/i, "pasta.png"),
  rule(/sushi|sashimi/i, "sushi.png"),
  rule(/sopa|minestrone|consome/i, "sopa.png"),
  rule(/arroz|paella|risotto/i, "paella.png"),
  rule(/ensalada|salad|mixta/i, "ensalada.png"),
  rule(/helado|helado/i, "helado.png"),
  rule(/torta|pastel|flan|pudding/i, "torta.png"),
  rule(/dona|donut/i, "dona.png"),
  rule(/medialuna|croissant|brioche/i, "medialuna.png"),
  rule(/galleta|galletita|cookie|alfajor/i, "galleta.png"),
  rule(/chocolate|chocolat|mousse|brownie/i, "chocolate.png"),
  rule(/huevo|huevos|omelette|revuelto/i, "huevo.png"),
  rule(/zanahoria|carrot|calabaza/i, "zanahoria.png"),
  rule(/tomate/i, "tomate.png"),
  rule(/limon|limonada/i, "limon.png"),
  rule(/palta|aguacate|avocado/i, "palta.png"),
  rule(/cebolla|onion/i, "cebolla.png"),
  rule(/ajo|garlic/i, "ajo.png"),
  rule(/papa|potato|tuberculo/i, "papa.png"),
  rule(/pimiento|pimenton|morron/i, "pimiento.png"),
  rule(/champinon|mushroom|seta/i, "champinon.png"),
  rule(/aceituna|alcaparra|oliva/i, "aceituna.png"),
  rule(/verdura|vegetal|lechuga|apio|zapallo/i, "verduras.png"),
  rule(/queso|tabla|picada/i, "queso.png"),
  rule(/fruta|manzana|naranja|pera|banana|uva|sandia|melon|frutilla|kiwi/i, "fruta.png"),
  rule(/naranja|orange|clementina/i, "naranja.png"),
  rule(/banana|platan/i, "banana.png"),
  rule(/fresa|frutilla/i, "fresa.png"),
  rule(/limon|lima|lemon/i, "limon.png"),
  rule(/uva|uvas/i, "uvas.png"),
  rule(/sandia|sandía/i, "sandia.png"),

  // === Café / bebidas ===
  rule(/cafe|café|latte|cappuccino|expresso|macchiato/i, "cafe.png"),
  rule(/te\b|te britanico|mate\b|matcha/i, "te.png"),
  rule(/cerveza|lager|ale|ipa|stout/i, "cerveza.png"),
  rule(/vino|cabernet|malbec|chardonnay/i, "vino.png"),
  rule(/jugo|smoothie|licuado|batido|expressido/i, "jugo.png"),
  rule(/cerveza|copa|cocktail|trago|mixed|mimosa/i, "copa.png"),
  rule(/whisky|bourbon|scotch|whiskey/i, "whisky.png"),
  rule(/bebida|refresco|gaseosa|soda/i, "jugo.png"),

  // === Moda / indumentaria ===
  rule(/pantalon|jeans|denim|pantalones|shorts|joggins/i, "pantalon.png"),
  rule(/remera|camiseta|tshirt|t-shirt|tshirt|blusa|hoodie|buzo|lana|sueter|saco/i, "remera.png"),
  rule(/vestido|dress|falda| pollera|gown|abito/i, "vestido.png"),
  rule(/zapato|zapatilla|calzado|sneaker|bota|sandalia/i, "zapato.png"),
  rule(/gorra|cap|sombrero|beanie|boina/i, "gorra.png"),
  rule(/lentes|anteojos|gafas|sunglasses/i, "lentes.png"),
  rule(/bolsa|bolso|cartera|mochila|handbag|satchel/i, "bolsa.png"),
  rule(/reloj|watch|cronografo/i, "reloj.png"),

  // === Otros / hogar / herramientas ===
  rule(/jabon|limpieza|detergente/i, "jabon.png"),
  rule(/cepillo|escoba|brocha/i, "cepillo.png"),
  rule(/lampara|lamp|iluminacion|luz/i, "lampara.png"),
  rule(/vela|candle|aromaterapia/i, "vela.png"),
  rule(/pintura|color|lienzo/i, "pintura.png"),
  rule(/flor|bouquet|ramo/i, "flor.png"),
  rule(/planta|succulent|cactus/i, "planta.png"),
  rule(/libro|libros|novela|revista/i, "libro.png"),
  rule(/farmacia|remedio|medicina|vitamina|aspirina/i, "farmacia.png"),
  rule(/herramienta|taladro|ferreteria/i, "herramienta.png"),
  rule(/embalaje|envio|packaging|manual/i, "embalaje.png"),
];

const VERTICAL_FALLBACK: Record<string, string> = {
  gastronomia: "/emojis/hamburguesa.png",
  comercio: "/emojis/bolsa.png",
  moda: "/emojis/remera.png",
  salud: "/emojis/farmacia.png",
  servicio: "/emojis/herramienta.png",
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

/**
 * Devuelve la ruta a la imagen de referencia cuando el producto no tiene foto.
 * Orden: keyword match en `nombre+categoria` → fallback por vertical → null.
 */
export function getProductEmojiImage(
  name?: string,
  category?: string | null,
  vertical?: string | null,
): string | null {
  const text = normalizeText(`${name ?? ""} ${category ?? ""}`);

  for (const rule of RULES) {
    if (rule.re.test(text)) {
      return `/emojis/${rule.file}`;
    }
  }

  if (vertical && VERTICAL_FALLBACK[vertical]) {
    return VERTICAL_FALLBACK[vertical];
  }

  return null;
}
