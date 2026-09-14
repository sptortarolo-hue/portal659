import { config } from "./config.mjs";

const SYSTEM = `Sos un asistente de un comercio gastronómico que toma pedidos por WhatsApp.
Dado el mensaje del cliente y la lista de productos disponibles, devolvé SOLO un JSON válido (sin texto adicional) con esta forma:

{
  "complete": boolean,
  "items": [{"name": string, "qty": number, "modifiers": [string]}],
  "method": "pickup" | "delivery" | null,
  "customerName": string | null,
  "customerPhone": string | null,
  "customerAddress": string | null,
  "note": string | null
}

Reglas:
- "complete": true si el mensaje tiene información suficiente para armar el pedido (productos + método + nombre + teléfono; si es delivery también dirección).
- "items": productos pedidos. "name" debe coincidir con alguno de la lista de productos (usá el nombre exacto si existe). "qty" es número (default 1). "modifiers" solo si dice explícitamente (p. ej. "sin cebolla", "doble queso").
- "method": "pickup"/"delivery" si lo aclara, si no null.
- Extraé nombre/teléfono/dirección solo si el cliente los da.
- Si el cliente solo saluda, pregunta, o pide el menú: "complete" false e "items" [].`;

export async function parseWithLlm(message, products) {
  if (!config.llmApiKey) return null;

  const menu = products
    .map((p) => `${p.id}|${p.name}|$${p.price}`)
    .join("\n");

  const res = await fetch(`${config.llmBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.llmApiKey}`,
    },
    body: JSON.stringify({
      model: config.llmModel,
      temperature: 0,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: `Productos disponibles:\n${menu}\n\nMensaje del cliente: "${message}"` },
      ],
    }),
  });

  if (!res.ok) throw new Error(`NVIDIA API error ${res.status}`);
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content || "";
  const json = content.replace(/```json/gi, "").replace(/```/g, "").trim();
  return JSON.parse(json);
}

/** Fallback sin LLM: regla mínima que detecta saludo/pedido de menú. */
export function parseByRules(message) {
  const m = String(message || "").trim();
  if (/^(hola|buenas|buen|hey|hi)\b/i.test(m)) return { complete: false, items: [] };
  if (/menu|menú|carta|precio|cuanto|qué tienen|que tienen/i.test(m)) {
    return { complete: false, items: [], askMenu: true };
  }
  return null;
}