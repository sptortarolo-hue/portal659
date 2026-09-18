import { config } from "./config.mjs";

// NVIDIA rota el catálogo /models (410 Gone) sin aviso. El auto-descubrimiento
// no confía en la lista — la prueba real (POST chat/completions) decide: el
// primer candidato que responde 200 se cachea y se usa hasta que falle de nuevo.
// Tier gratis = responde 200; no gratis / no existe = 402/403/404/410.

const PREFERRED = [
  "google/gemma-4-31b-it", // verificado gratis con la cuenta actual
  "google/gemma-3-12b-it",
  "google/gemma-3-4b-it",
  "deepseek-ai/deepseek-v4-flash-0731",
  "meta/llama2-70b",
  "mistralai/mistral-large",
  "mistralai/mistral-large-2-instruct",
  "mistralai/mixtral-8x22b-v0.1",
  "nvidia/llama3-chatqa-1.5-70b",
];
// Patrones que excluimos del catálogo (no sirven para chat libre del bot).
const EXCLUDE = /vision|guard|embed|rerank|code|chatqa|nemo(retriever|guard)/i;

let resolvedModelCache = null; // modelo verificado que responde 200

async function resolveModel() {
  if (process.env.LLM_MODEL) return process.env.LLM_MODEL; // pin manual, siempre gana
  if (resolvedModelCache) return resolvedModelCache;
  // Default rápido: si el modelo configurado funciona, quedamos con ese
  // (evitamos el escaneo en el primer mensaje).
  const first = await pickLiveModel();
  return first || config.llmModel;
}

/** Itera candidatos (preferidos → resto del catálogo) y devuelve el 1ro que responda 200. */
async function pickLiveModel() {
  let catalogIds = [];
  try {
    const res = await fetch(`${config.llmBaseUrl}/models`, {
      headers: { Authorization: `Bearer ${config.llmApiKey}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) {
      const data = await res.json();
      catalogIds = (data.data || []).map((m) => m.id).filter(Boolean);
    }
  } catch (e) {
    console.error(`[bot] LLM /models error: ${e?.message}`);
  }

  const candidates = [];
  // 1. El default si está en el catálogo (o si el catálogo no responde, igual se lo prueba).
  if (config.llmModel && !candidates.includes(config.llmModel)) candidates.push(config.llmModel);
  // 2. Preferidos conocidos-gratis, en orden.
  for (const id of PREFERRED) {
    if (!candidates.includes(id) && (catalogIds.length === 0 || catalogIds.includes(id))) candidates.push(id);
  }
  // 3. Resto del catálogo que parezca texto instruct.
  for (const id of catalogIds) {
    if (candidates.includes(id) || EXCLUDE.test(id)) continue;
    if (/instruct|chat|llama|gemma|mistral|qwen|gemma/i.test(id)) candidates.push(id);
  }

  for (const id of candidates.slice(0, 12)) {
    const ok = await probeModel(id);
    if (ok) {
      resolvedModelCache = id;
      console.log(`[bot] LLM modelo verificado activo y gratis: ${id}`);
      return id;
    }
    console.warn(`[bot] LLM candidato ${id} no sirve (no-200) — probe siguiente`);
  }
  console.error("[bot] LLM: ningún modelo del catálogo respondió 200 — bot caerá al fallback de reglas");
  return null;
}

/** Un mensaje mínimo real: 200 = usarlo; otro = descarte. */
async function probeModel(id) {
  try {
    const res = await fetch(`${config.llmBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.llmApiKey}`,
      },
      body: JSON.stringify({
        model: id,
        messages: [{ role: "user", content: "ok" }],
        max_tokens: 4,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

const SYSTEM = `Sos un asistente de un comercio gastronómico que toma pedidos por WhatsApp.
Dado el mensaje del cliente y la lista de productos disponibles, devolvé SOLO un JSON válido (sin texto adicional) con esta forma:

{
  "complete": boolean,
  "items": [{"name": string, "qty": number, "modifiers": [string]}],
  "method": "pickup" | "delivery" | null,
  "payment": "efectivo" | "transferencia" | null,
  "customerName": string | null,
  "customerPhone": string | null,
  "customerAddress": string | null,
  "note": string | null
}

Reglas:
- "complete": true si el mensaje tiene información suficiente para armar el pedido (productos + método + nombre + teléfono; si es delivery también dirección).
- "items": productos pedidos. "name" debe coincidir con alguno de la lista de productos (usá el nombre exacto si existe). "qty" es número (default 1). "modifiers" solo si dice explícitamente (p. ej. "sin cebolla", "doble queso").
- "method": "pickup"/"delivery" si lo aclara, si no null.
- "payment": "transferencia" si dice pagar con transferencia/transfer/alias/CBU, "efectivo" si dice en efectivo/efectivo al recibir, si no null.
- Extraé nombre/teléfono/dirección solo si el cliente los da.
- Si el cliente solo saluda, pregunta, o pide el menú: "complete" false e "items" [].`;

export async function parseWithLlm(message, products) {
  if (!config.llmApiKey) {
    if (!parseWithLlm._reported) {
      console.warn("[bot] LLM sin LLM_API_KEY — los pedidos caen al fallback de reglas");
      parseWithLlm._reported = true;
    }
    return null;
  }

  const model = await resolveModel();
  if (!model) return null;

  const parsed = await callOnce(message, products, model);
  if (parsed !== null) return parsed;

  // Si el modelo verificado pinchó (410/404/402), hay que re-descubrir y reintentar
  // 1 vez con el siguiente. Así sobrevivimos deprecaciones futuras de NVIDIA.
  if (parseWithLlm._modelDeprecated) {
    parseWithLlm._modelDeprecated = false;
    resolvedModelCache = null;
    console.log("[bot] LLM re-descubriendo modelo tras fallo del verificado");
    const fresh = await resolveModel();
    if (fresh) {
      const retry = await callOnce(message, products, fresh);
      if (retry !== null) return retry;
    }
  }
  return null;
}

async function callOnce(message, products, model) {
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
        model,
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

  if (res.status === 410 || res.status === 404) {
    parseWithLlm._modelDeprecated = true;
    console.error(`[bot] LLM modelo ${model} deprecado/no existe (${res.status}) — re-descubriendo en el próximo mensaje`);
    return null;
  }
  if (res.status === 402 || res.status === 403) {
    parseWithLlm._modelDeprecated = true; // no gratis / no autorizado → probar otro
    console.error(`[bot] LLM modelo ${model} no está en el tier gratis (${res.status}) — probando otro`);
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
