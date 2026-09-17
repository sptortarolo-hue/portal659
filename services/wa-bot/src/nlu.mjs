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
  if (!config.llmApiKey) {
    // Logueado una vez por proceso (bot/index.mjs lo anuncia al arrancar).
    if (!parseWithLlm._reported) {
      console.warn("[bot] LLM sin LLM_API_KEY — los pedidos caen al fallback de reglas");
      parseWithLlm._reported = true;
    }
    return null;
  }

  const menu = products
    .map((p) => `${p.id}|${p.name}|$${p.price}`)
    .join("\n");

  let res;
  try {
    res = await fetch(`${config.llmBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.llmApiKey}`,
      },
      body: JSON.stringify({
        model: config.llmModel,
        temperature: 0,
        max_tokens: 400,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: `Productos disponibles:\n${menu}\n\nMensaje del cliente: "${message}"` },
        ],
      }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    console.error(`[bot] LLM fetch error: ${e?.name || "Error"}: ${e?.message || e}`);
    return null;
  }

  if (!res.ok) {
    const snippet = (await res.text().catch(() => "")).slice(0, 300);
    console.error(`[bot] LLM error ${res.status}: ${snippet}`);
    return null;
  }

  const data = await res.json().catch((e) => ({ __jsonErr: e.message }));
  if (data?.__jsonErr) {
    console.error(`[bot] LLM json inválido: ${data.__jsonErr}`);
    return null;
  }
  const content = data?.choices?.[0]?.message?.content || "";
  const json = content.replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = json.indexOf("{");
  const end = json.lastIndexOf("}");
  if (start < 0 || end <= start) {
    console.error(`[bot] LLM sin JSON usable: ${content.slice(0, 200)}`);
    return null;
  }
  try {
    return JSON.parse(json.slice(start, end + 1));
  } catch (e) {
    console.error(`[bot] LLM parse JSON err: ${e.message} — raw: ${json.slice(0, 200)}`);
    return null;
  }
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