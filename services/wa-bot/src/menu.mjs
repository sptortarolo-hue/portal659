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
  return menuGreeting(vendorName) + lines.join("\n") + "\n\n" + menuFooter();
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