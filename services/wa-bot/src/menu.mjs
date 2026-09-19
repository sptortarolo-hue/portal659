import { config } from "./config.mjs";

const cache = new Map(); // vendorId -> { products, at }

export async function getMenu(vendorId) {
  const hit = cache.get(vendorId);
  if (hit && Date.now() - hit.at < 60 * 1000) return hit.products;

  const res = await fetch(`${config.appUrl}/api/wa/menu?vendorId=${encodeURIComponent(vendorId)}`, {
    headers: { Authorization: `Bearer ${config.waBotSecret}` },
  });
  if (!res.ok) throw new Error(`menu error ${res.status}: ${await res.text()}`);

  const data = await res.json();
  const products = data.products || [];
  cache.set(vendorId, { products, at: Date.now() });
  return products;
}

/** Mapea un nombre libre a un producto del menú (exacto → contiene). null si no. */
export function matchProduct(products, name) {
  const n = String(name || "").toLowerCase().trim();
  if (!n) return null;
  const exact = products.find((p) => String(p.name).toLowerCase() === n);
  if (exact) return exact;
  const contains = products.filter((p) => String(p.name).toLowerCase().includes(n) || n.includes(String(p.name).toLowerCase()));
  if (contains.length === 1) return contains[0];
  return null;
}

export function menuSummary(vendorName, products) {
  const lines = products.slice(0, 25).map((p) => `• ${p.name} — $${p.price}`);
  return `🍽️ *Menú de ${vendorName}*\n\n${lines.join("\n")}\n\nRespondé con lo que querés pedir, por ejemplo: "dos hamburguesas y una coca".`;
}

/** Agrupa productos por categoría (orden: primero los que tienen destacados, luego alfabético, "Más" al final). */
export function groupByCategory(products) {
  const groups = new Map();
  for (const p of products) {
    const raw = String(p.category || "").trim();
    const cat = raw || "Más";
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat).push(p);
  }
  const cats = Array.from(groups.entries()).map(([name, items]) => ({
    name,
    hasFeatured: items.some((p) => p.featured_today || p.featured),
    count: items.length,
    items,
  }));
  cats.sort((a, b) => {
    if (a.hasFeatured !== b.hasFeatured) return a.hasFeatured ? -1 : 1;
    if (a.name === "Más") return 1;
    if (b.name === "Más") return -1;
    return a.name.localeCompare(b.name, "es");
  });
  return cats;
}

/** Texto de la lista de categorías numeradas (el primer mensaje del bot). */
export function categoriesLine(cats) {
  return cats.map((c, i) => `${i + 1}. *${c.name}* (${c.count})`).join("\n");
}

/** Lista numerada de productos de UNA categoría (el cliente eligió con un número). */
export function categoryProductsLine(cat, vendorSlug, appUrl) {
  const lines = cat.items.slice(0, 12).map((p, i) => {
    const precio = p.price != null ? ` — $${p.price}` : "";
    const mods = p.modifiers?.length ? " _(con opciones)_" : "";
    return `${i + 1}. ${p.name}${precio}${mods}`;
  });
  let tail = "";
  if (cat.count > 12) {
    tail = `\n…y ${cat.count - 12} más en ${appUrl}/tienda/${vendorSlug || ""}`;
  }
  return `🍽️ *${cat.name}*:\n${lines.join("\n")}${tail}`;
}

// Variantes de saludo/pie para NO mandar el blob exactamente idéntico a cada
// chat nuevo (texto repetido a muchos números = señal de spam). Se rota por
// número de comercio para que un mismo cliente vea siempre el mismo tono.
const GREETINGS = [
  (name) => `🍽️ *Menú de ${name}*\n\n`,
  (name) => `Hola 👋 Bienvenido a *${name}*. Te dejo nuestro menú:\n\n`,
  (name) => `👋 ¡Hola! Este es el menú de *${name}*:\n\n`,
];
const FOOTERS = [
  "Respondé con lo que querés pedir, por ejemplo: \"dos hamburguesas y una coca\".",
  "Decime tu pedido directo, ej: \"una pizza y una gaseosa\".",
  "Escribime tu pedido y te lo preparo, por ejemplo: \"dos empanadas y un agua\".",
];

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function menuGreeting(vendorName) {
  const gi = hashStr(vendorName) % GREETINGS.length;
  return GREETINGS[gi](vendorName);
}

function menuFooter() {
  return FOOTERS[Math.floor(Math.random() * FOOTERS.length)];
}