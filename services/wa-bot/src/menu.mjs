import { config } from "./config.mjs";

const cache = new Map(); // vendorId -> { products, at }

export async function getMenu(vendorId) {
  const hit = cache.get(vendorId);
  if (hit && Date.now() - hit.at < 60 * 1000) return hit.products;

  try {
    const res = await fetch(`${config.appUrl}/api/wa/menu?vendorId=${encodeURIComponent(vendorId)}`, {
      headers: { Authorization: `Bearer ${config.waBotSecret}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.error(`[bot] menu error ${res.status}`);
      return hit?.products || [];
    }
    const data = await res.json();
    const products = data.products || [];
    cache.set(vendorId, { products, at: Date.now() });
    return products;
  } catch (e) {
    console.error(`[bot] menu fetch fail: ${e.message}`);
    return hit?.products || []; // fallback: caché vieja si la hubo
  }
}

/** Versión sync que lee SOLO el cache (poblado por getMenu en la conversación).
 *  Para el total estimado del resumen: si no hay cache, devuelve [] (sin total). */
export function getMenuSync(vendorId) {
  const hit = cache.get(vendorId);
  return hit?.products || [];
}

/** Mapea un nombre libre a un producto del menú. Mejorado con stem + "contains" para typos/variantes. */
export function matchProduct(products, name) {
  const n = normalizeForMatch(name);
  if (!n) return null;

  // Los tokens de interés: las palabras de la búsqueda del cliente.
  const wanted = n.split(" ").filter(Boolean);

  // Exacto: nombre del producto = búsqueda.
  const exact = products.find((p) => normalizeForMatch(p.name) === n);
  if (exact) return exact;

  // "Contenido": todas las palabras del producto aparecen (o viceversa).
  const contains = products.filter((p) => {
    const pn = normalizeForMatch(p.name);
    const toks = pn.split(" ");
    const w = wanted.every((t) => toks.includes(t));
    return w && toks.every((t2) => wanted.includes(t2));
  });
  if (contains.length === 1) return contains[0];
  if (contains.length > 1) {
    // Si hay varios que cubren todo, devolver el más corto (más específico).
    contains.sort((a, b) => a.name.length - b.name.length);
    return contains[0];
  }

  // "Intersección": todas las palabras que el cliente escribió están (parcialmente) en el producto.
  const interseccion = products.filter((p) => {
    const toks = normalizeForMatch(p.name).split(" ");
    return wanted.every((t) => toks.some((t2) => t2.startsWith(t) || t.startsWith(t2)));
  });
  if (interseccion.length === 1) return interseccion[0];
  if (interseccion.length > 1) {
    // Priorizar el producto con menos tokens (menos ambiguo).
    interseccion.sort((a, b) => normalizeForMatch(a.name).split(" ").length - normalizeForMatch(b.name).split(" ").length);
    return interseccion[0];
  }

  // Por defecto: null — preferimos no arriesgar que agregar algo que no pidió.
  return null;
}

function normalizeForMatch(name) {
  return String(name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    // quitar plurales comunes del español para match aproximado (empanadas→empanada)
    .replace(/([sr])s\b/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export function menuSummary(vendorName, products) {
  const lines = products.slice(0, 25).map((p) => `• ${p.name} — $${p.price}`);
  return `🍽️ *Menú de ${vendorName}*\n\n${lines.join("\n")}\n\nRespondé con lo que querés pedir, por ejemplo: "dos hamburguesas y una coca".`;
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