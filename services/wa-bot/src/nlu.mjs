import { config } from "./config.mjs";
import { matchProduct } from "./menu.mjs";

// NVIDIA rota el catálogo /models (410 Gone) sin aviso. El auto-descubrimiento
// no confía en la lista — la prueba real (POST chat/completions) decide: el
// primer candidato que responde 200 se cachea y se usa hasta que falle de nuevo.
// Tier gratis = responde 200; no gratis / no existe = 402/403/404/410/429.

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

// Alternativas por proveedor (rotación anti-429/410). El primer candidato vivo
// se cachea; si enfrió, rota al siguiente SIN reintentarlo.
const ALTERNATIVAS = {
  gemini: ["gemini-2.0-flash", "gemini-2.5-flash", "gemini-2.0-flash-lite"],
  openrouter: [
    "google/gemma-4-31b-it:free",
    "google/gemma-4-26b-a4b-it:free",
    "nvidia/nemotron-3-super-120b-a12b:free",
    "z-ai/glm-5.2:free",
  ],
};

let resolvedModelCache = null; // modelo verificado que responde 200
// Cooldown cuando un modelo devuelve 429: no lo reintentamos por 5 minutos.
const modelCooldowns = new Map(); // model -> timestamp de cuándo vuelve a poder probarse

function isOpenRouter() {
  return /openrouter\.ai/i.test(config.llmBaseUrl);
}

function isGemini() {
  return /generativelanguage\.googleapis\.com/i.test(config.llmBaseUrl);
}

function proveedor() {
  if (isGemini()) return "gemini";
  if (isOpenRouter()) return "openrouter";
  return "nvidia";
}

/** Cooldown anti-429: al fluir un rate-limit no reintentamos ese modelo por 5 min. */
function isCooledDown(model) {
  const until = modelCooldowns.get(model);
  return !!until && until > Date.now();
}
function markCooldown(model) {
  modelCooldowns.set(model, Date.now() + 5 * 60 * 1000);
}

async function resolveModel() {
  const pin = process.env.LLM_MODEL || null;
  if (pin && !isCooledDown(pin)) return pin;
  if (resolvedModelCache && !isCooledDown(resolvedModelCache)) return resolvedModelCache;

  const kind = proveedor();
  if (kind === "nvidia") {
    const first = await pickLiveModel();
    return first || config.llmModel;
  }

  // Gemini/OpenRouter: rotar alternativas respetando el cooldown. Antes la
  // rama OpenRouter devolvía el pin aunque estuviera en 429 → cada mensaje
  // reintentaba el modelo rate-limited con timeout de 60s (respuestas
  // lentísimas además de fallidas).
  const candidates = [];
  if (config.llmModel && !candidates.includes(config.llmModel)) candidates.push(config.llmModel);
  for (const a of ALTERNATIVAS[kind] || []) {
    if (!candidates.includes(a)) candidates.push(a);
  }
  const live = candidates.find((m) => !isCooledDown(m));
  if (live) {
    resolvedModelCache = live;
    console.log(`[bot] LLM usando ${live} (${kind}, rotado)`);
    return live;
  }
  console.log("[bot] LLM: todos los modelos en cooldown — este mensaje cae al fallback de reglas");
  return null;
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

const SYSTEM = `Sos un asistente de un comercio que toma pedidos por WhatsApp.
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
- "complete": true si el mensaje tiene información suficiente para armar el pedido (productos + método + nombre; si es delivery también dirección; si el pago es solo efectivo/transferencia coordinado por WhatsApp, no falta nada de pago).
- "items": productos pedidos. "name" debe coincidir con alguno de la lista de productos (usá el nombre exacto si existe). "qty" es número (default 1; "una docena" = 12, "media docena" = 6). "modifiers" solo si dice explícitamente (p. ej. "sin cebolla", "doble queso").
- "method": "pickup"/"delivery" si lo aclara, si no null.
- "payment": "transferencia" si dice pagar con transferencia/transfer/alias/CBU, "efectivo" si dice en efectivo/efectivo al recibir, si no null.
- Extraé nombre/teléfono/dirección solo si el cliente los da.
- Usá el CONTEXTO (carrito actual, preguntas pendientes, últimos mensajes) para entender a qué responde el cliente: si le preguntaste el nombre y contesta un nombre, extraelo; si le preguntaste la dirección y contesta una dirección, extraela.
- Si el cliente corrige o re-declara el pedido (ej. "no, mejor solo 3 empanadas"), devolvé en "items" el carrito COMPLETO actualizado (todos los productos que quedan, con sus cantidades finales).
- Si el cliente agrega productos sin re-declarar todo (ej. "agregá una coca"), devolvé SOLO los items nuevos.
- Si el cliente solo saluda, pregunta, o pide el menú: "complete" false e "items" [].`;

// Telemetría de uso del LLM (expuesta en /health del cerebro): así se verifica
// en 1 comando si el bot está usando IA y con qué modelo respondió por última vez.
export const llmStats = { ok: 0, fail: 0, cooldown: 0, lastModel: null, lastAt: null };

export async function parseWithLlm(message, products, ctx = null) {
  if (!config.llmApiKey) {
    if (!parseWithLlm._reported) {
      console.warn("[bot] LLM sin LLM_API_KEY — los pedidos caen al fallback de reglas");
      parseWithLlm._reported = true;
    }
    return null;
  }

  const model = await resolveModel();
  if (!model) {
    llmStats.cooldown++;
    return null;
  }

  const parsed = await callOnce(message, products, model, ctx);
  if (parsed !== null) {
    llmStats.ok++;
    llmStats.lastModel = model;
    llmStats.lastAt = new Date().toISOString();
    console.log(`[bot] LLM ok (${model}): items=${parsed.items?.length ?? 0}`);
    return { ...parsed, __llm: true };
  }

  // Si el modelo pinchó (410/404/402/429), rotar alternativas 1 vez.
  if (parseWithLlm._modelDeprecated) {
    parseWithLlm._modelDeprecated = false;
    resolvedModelCache = null;
    console.log("[bot] LLM re-descubriendo modelo tras fallo del verificado");

    // Gemini/OpenRouter: reintento rotando alternativas del proveedor.
    const kind = proveedor();
    if (kind === "openrouter" || kind === "gemini") {
      const alts = [...(ALTERNATIVAS[kind] || []), config.llmModel].filter(
        (alt) => alt && alt !== model && !isCooledDown(alt)
      );
      // dedupe de defensa
      const uniq = [...new Set(alts)];
      for (const alt of uniq) {
        console.log(`[bot] ${kind} retry con ${alt}`);
        const retry = await callOnce(message, products, alt, ctx);
        if (retry !== null) {
          llmStats.ok++;
          llmStats.lastModel = alt;
          llmStats.lastAt = new Date().toISOString();
          console.log(`[bot] LLM ok (${alt}): items=${retry.items?.length ?? 0}`);
          resolvedModelCache = alt;
          return { ...retry, __llm: true };
        }
      }
      llmStats.fail++;
      return null;
    }

    const fresh = await resolveModel();
    if (fresh) {
      const retry = await callOnce(message, products, fresh, ctx);
      if (retry !== null) {
        llmStats.ok++;
        llmStats.lastModel = fresh;
        llmStats.lastAt = new Date().toISOString();
        console.log(`[bot] LLM ok (${fresh}): items=${retry.items?.length ?? 0}`);
        return { ...retry, __llm: true };
      }
    }
  }
  llmStats.fail++;
  return null;
}

async function callOnce(message, products, model, ctx = null) {
  const menu = products
    .map((p) => `${p.id}|${p.name}|$${p.price}`)
    .join("\n");

  // Contexto de conversación: carrito actual + qué se le preguntó + historial.
  // Es lo que hace que la IA extraiga EXACTAMENTE lo que falta (nombre cuando
  // se le preguntó el nombre, dirección cuando se le preguntó la dirección) y
  // entienda re-declaraciones ("no, mejor solo 3") vs agregados.
  const parts = [];
  if (ctx?.cart?.length) {
    parts.push(`Carrito actual del pedido:\n${ctx.cart.map((i) => `- ${i.name} x${i.qty}`).join("\n")}`);
  }
  if (ctx?.pending?.length) {
    parts.push(`Le acabás de preguntar (extraé SOLO lo que falta): ${ctx.pending.join(", ")}`);
  }
  if (ctx?.history?.length) {
    parts.push(`Últimos mensajes del chat:\n${ctx.history.map((h) => `${h.role === "bot" ? "BOT" : "CLIENTE"}: ${h.text}`).join("\n")}`);
  }
  const contextBlock = parts.length ? `\n\n${parts.join("\n\n")}` : "";

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${config.llmApiKey}`,
  };
  if (isOpenRouter()) {
    headers["HTTP-Referer"] = config.llmSiteUrl;
    headers["X-Title"] = config.llmSiteName;
  }

  let res;
  try {
    res = await fetch(`${config.llmBaseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 400,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: `Productos disponibles:\n${menu}\n\nMensaje del cliente: "${message}"${contextBlock}` },
        ],
      }),
      signal: AbortSignal.timeout(isOpenRouter() ? 60_000 : 30_000),
    });
  } catch (e) {
    console.error(`[bot] LLM fetch error: ${e?.name || "Error"}: ${e?.message || e}`);
    return null;
  }

  if (res.status === 410 || res.status === 404 || res.status === 429) {
    markCooldown(model);
    parseWithLlm._modelDeprecated = true;
    const snippet = (await res.text().catch(() => "")).slice(0, 300);
    console.error(`[bot] LLM modelo ${model} no responde o fue rate-limited (${res.status}) — re-descubriendo en el próximo mensaje | ${snippet}`);
    return null;
  }
  if (res.status === 402 || res.status === 403) {
    parseWithLlm._modelDeprecated = true;
    const snippet = (await res.text().catch(() => "")).slice(0, 300);
    console.error(`[bot] LLM modelo ${model} no está en el tier gratis (${res.status}) — probando otro | ${snippet}`);
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

// ———————————————————————————————————————————————————————————————————————————
// Reglas sin LLM: detectar saludo, pedir el menú, o parsear pedidos en prosa
// ("3 empanadas de carne y una coca") cuando el modelo de IA está caído.
// ———————————————————————————————————————————————————————————————————————————

const NUM_WORDS = {
  un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5,
  seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12,
};

export function parseByRules(message, products) {
  // Prioridad: el match de reglas mínimas (greeting/menú) gana sobre el extractor.
  const m = String(message || "").trim();
  if (/^(hola|buenas|buen|hey|hi)\b/i.test(m)) return { complete: false, items: [], greeting: true };
  if (/menu|menú|carta|precios?|cuanto|que tenés|qué tienen/i.test(m)) {
    return { complete: false, items: [], askMenu: true };
  }

  // Método/pago se extraen del texto SIEMPRE (aunque no haya productos en el
  // mensaje): las respuestas combinadas tipo "envío, Juan, transferencia" o
  // "retiro, Juan" no traen ítems pero traen datos que el bot necesita.
  const method = /(envío|envio|delivery|domicilio|despachen)/i.test(m) ? "delivery"
    : /(retiro|retirar|paso por|voy por)/i.test(m) ? "pickup" : null;
  const payment = /(transferencia|transferir|cbu|alias)/i.test(m) ? "transferencia"
    : /(efectivo|cash)/i.test(m) ? "efectivo" : null;
  // Dirección: tras "envío a X" hasta la siguiente coma/tope de separación de
  // items ("envío a calle 5 123, Juan, transferencia" → "calle 5 123").
  const addrMatch = m.match(/(?:envío|envio|delivery|domicilio)\s+a\s+(?:la\s+)?([^,;\n]+)/i);
  const customerAddress = addrMatch ? String(addrMatch[1]).trim().slice(0, 80) : null;

  if (Array.isArray(products) && products.length > 0) {
    const items = extractFromText(m, products);
    if (items.length) {
      return { complete: true, items, method, customerName: null, customerAddress, payment, note: null };
    }
  }
  // Sin items pero con datos: igual devolverlos (el bot los usa para avanzar).
  if (method || payment || customerAddress) {
    return { complete: false, items: [], method, customerName: null, customerAddress, payment, note: null };
  }
  return null;
}

function extractFromText(text, products) {
  // Casos:
  //  - "3 empanadas y una coca" → [empanadas×3, coca×1]
  //  - "dos pizzas"          → [pizza×2]
  //  - "quiero dos empanadas" → qty detectada aunque haya verbos al principio.
  //  - "una docena de empanadas" → ×12; "media docena de empanadas" → ×6.
  // Split sobre el texto ORIGINAL: las comas separan pedidos y normalizeEs
  // las destruiría (todo quedaría en un chunk sin separar).
  const out = [];
  const tokens = String(text).split(/[,\n;]| e | y |\s*\+\s*/i);
  for (const part of tokens) {
    let chunk = part.trim();
    if (!chunk) continue;
    // Quitar verbos/intenciones al inicio (quiero/dame/traeme/etc.)
    chunk = chunk.replace(/^(quiero|querria|quisiera|dame|démela|traeme|traigame|me das|me pones|me haces|me traes|me preparas|me cobras)\s+/i, "");
    // Quitar negaciones/relleno de corrección al inicio ("no, mejor solo X" → "X").
    for (let i = 0; i < 4; i++) {
      const filler = /^(no\b[,.;:]?\s*(mejor\b\s*)?(solo\b\s*)?|mejor\b\s*(solo\b\s*)?|solo\b\s*|unicamente\b\s*|bueno\b\s*)/i.exec(chunk);
      if (!filler || !chunk.slice(filler[0].length).trim()) break;
      chunk = chunk.slice(filler[0].length).trim();
    }
    const norm = normalizeEs(chunk);
    const m = /^(\d+|un(?:a|o)?|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)\s+(?:de\s+)?(.*)$/.exec(norm);
    let qty = 1, name = norm;
    if (m) {
      const rawQty = m[1];
      if (/^\d+$/.test(rawQty)) qty = Number(rawQty);
      else qty = NUM_WORDS[rawQty] ?? 1;
      name = m[2].trim();
    }
    if (!name) continue;
    // "docena de X" → ×12 · "media docena de X" → ×6 (el multiplicador va
    // sobre la cantidad: "una docena" = 1 × 12).
    const docena = /^media\s+docena\s+(?:de\s+)?(.+)$/.exec(name) || /^docena\s+(?:de\s+)?(.+)$/.exec(name);
    if (docena) {
      qty *= name.startsWith("media") ? 6 : 12;
      name = docena[1].trim();
    }
    const p = matchProduct(products, name);
    if (p) out.push({ offerId: p.id, name: p.name, qty: Math.max(1, qty), modifiers: [] });
  }
  return out;
}

function normalizeEs(s) {
  return String(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
