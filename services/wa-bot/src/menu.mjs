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