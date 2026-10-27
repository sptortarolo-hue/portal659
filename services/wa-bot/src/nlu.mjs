// @ts-nocheck — pendiente de conversión a TypeScript.
import { config } from "./config.mjs";
import { matchProduct } from "./menu.mjs";
import { loadCorrections, formatFewShot } from "./learning.mjs";

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
  // Verificados contra el catálogo real de Gemini (sep-2026: gemini-2.0-flash
  // quedó deprecado — el alias flash-latest auto-trackea y no vuelve a pasar).
  gemini: ["gemini-flash-latest", "gemini-2.5-flash", "gemini-flash-lite-latest", "gemini-2.5-flash-lite"],
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

// ———————————————————————————————————————————————————————————————————————————
// Intent (el "estar atento"): clasificar si el cliente quiere una PERSONA
// (asistencia/pedido con atención) o quiere PEDIR (la app) o es chat.
// 1 llamada gratis por mensaje; sin IA → null (el caller cae a keywords).
// ———————————————————————————————————————————————————————————————————————————

const INTENT_SYSTEM = `Clasificás mensajes de WhatsApp de clientes de un comercio. Respondé SOLO una palabra, sin explicación:
- "persona" — si el cliente necesita hablar con una persona, necesita ayuda, quiere pedir por WhatsApp con atención de alguien, o tiene un problema/queja.
- "pedir" — si el cliente quiere pedir (menciona productos, platos o dice que va a pedir).
- "chat" — saludo, agradecimiento, o cualquier otra cosa.`;

export async function classifyIntent(message) {
  if (!config.llmApiKey) return null;
  const model = await resolveModel();
  if (!model) return null;

  try {
    const res = await fetch(`${config.llmBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.llmApiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 8,
        messages: [
          { role: "system", content: INTENT_SYSTEM },
          { role: "user", content: String(message).slice(0, 500) },
        ],
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 429 || res.status === 503 || res.status === 410 || res.status === 404) {
      markCooldown(model);
      return null; // cae al fallback de keywords al instante
    }
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    const word = String(data?.choices?.[0]?.message?.content || "").trim().toLowerCase();
    if (word.includes("persona")) return "persona";
    if (word.includes("pedir")) return "pedir";
    if (word.includes("chat")) return "chat";
    return null;
  } catch {
    return null;
  }
}

const SYSTEM = `Sos un asistente de un comercio que toma pedidos por WhatsApp.
Dado el mensaje del cliente y la lista de productos disponibles, devolvé SOLO un JSON válido (sin texto adicional) con esta forma:

{
  "complete": boolean,
  "items": [{"name": string, "qty": number, "modifiers": [string], "variant": {"color": string|null, "talle": string|null}, "said": string}],
  "method": "pickup" | "delivery" | null,
  "payment": "efectivo" | "transferencia" | null,
  "customerName": string | null,
  "customerPhone": string | null,
  "customerAddress": string | null,
  "note": string | null,
  "reasoning": string,
  "confidence": number
}

Reglas:
- "complete": true si el mensaje tiene información suficiente para armar el pedido (productos + método + nombre; si es delivery también dirección; si el pago es solo efectivo/transferencia coordinado por WhatsApp, no falta nada de pago).
- "items": productos pedidos. "name" debe coincidir con alguno de la lista de productos (usá el nombre exacto si existe). "qty" es número (default 1; "una docena" = 12, "media docena" = 6). "modifiers" solo si dice explícitamente (p. ej. "sin cebolla", "doble queso", los gustos).
- "said": lo que el cliente LITERALMENTE escribió para ese item (ej. "quiero empanadas" → said "empanadas"). Sirve para saber si el cliente nombró el producto completo o fue genérico.
- "variant": si el producto tiene variantes (las ves entre paréntesis) y el cliente aclara color o talle, extraé la variante (ej. "una remera negra talle M" → {"color": "negro", "talle": "M"}). Si no aclara, null. Si el producto no tiene variantes, null.
- "method": "pickup"/"delivery" si lo aclara, si no null.
- "payment": "transferencia" si dice pagar con transferencia/transfer/alias/CBU, "efectivo" si dice en efectivo/efectivo al recibir, si no null.
- Extraé nombre/teléfono/dirección solo si el cliente los da.
- Si el cliente PREGUNTA si tenemos algo (ej. "¿tenés empanadas?", "¿cuánto sale la pizza?"), NO lo trates como pedido: items [] y complete false.
- Usá el CONTEXTO (carrito actual, preguntas pendientes, últimos mensajes) para entender a qué responde el cliente: si le preguntaste el nombre y contesta un nombre, extraelo; si le preguntaste los gustos y contesta gustos, ponelos en "modifiers" del ítem al que corresponden.
- Si el cliente corrige o re-declara el pedido (ej. "no, mejor solo 3 empanadas"), devolvé en "items" el carrito COMPLETO actualizado (todos los productos que quedan, con sus cantidades finales).
- Si el cliente agrega productos sin re-declarar todo (ej. "agregá una coca"), devolvé SOLO los items nuevos.
- Si el cliente solo saluda, pregunta, o pide el menú: "complete" false e "items" [].
- Si el cliente dice "agregá/sumá/también/más" + un producto: devolvé SOLO ese producto nuevo (no el carrito completo), y complete true. Ej: carrito [empanadas x3], mensaje "agregá una coca" → items [coca x1], complete true.
- Razon� internamente paso a paso antes de responder (qu� productos, cantidades, m�todo, pago, datos faltantes). En "reasoning" pon� en 1 frase por qu� marcaste "complete" true/false. En "confidence" pon� un n�mero 0-1 con tu certeza. Si hay ambig�edad (producto gen�rico, falta m�todo/datos), marc� complete false y ped� solo lo que falta. Nunca inventes productos que no est�n en la lista.

EJEMPLOS de conversaciones mezcladas (usá como guía):

1) Negación + cambio:
Cliente: "quiero 2 empanadas de carne y una coca"
→ items: [{name:"Empanada de carne",qty:2},{name:"Coca-Cola 500ml",qty:1}], complete:false
Cliente: "no, mejor sacá la coca y poné una sprite"
→ items: [{name:"Empanada de carne",qty:2},{name:"Sprite",qty:1}], complete:false
(La coca se quitó, se agregó sprite. Se reemplaza, no se suma.)

2) Multi-intent (pedido + pregunta):
Cliente: "quiero 2 empanadas y ¿tienen pizza?"
→ items: [{name:"Empanada de carne",qty:2}], complete:false
(La pregunta NO es un pedido. Solo se agregan las empanadas.)

3) Corrección de cantidad:
Cliente: "3 empanadas de carne" → items:[{name:"Empanada de carne",qty:3}], complete:false
Cliente: "mejor 5" → items:[{name:"Empanada de carne",qty:5}], complete:false
(Solo cambió la cantidad.)

4) Agregar sin re-declarar:
Cliente: "2 empanadas de carne" → items:[{name:"Empanada de carne",qty:2}]
Cliente: "agregá una coca" → items:[{name:"Coca-Cola 500ml",qty:1}], complete:true
(Solo el item nuevo. El sistema lo mergea con el carrito.)

5) Cambio de método/pago:
Cliente: "2 empanadas, retiro, efectivo" → method:"pickup", payment:"efectivo", complete:true
Cliente: "mejor delivery a calle 5 123" → method:"delivery", customerAddress:"calle 5 123", payment:"efectivo", complete:true
(Solo cambió método y dirección. Los items no se tocaron.)

6) Cantidades en lenguaje natural:
Cliente: "una docena de empanadas de carne" → items:[{name:"Empanada de carne",qty:12}], complete:false
Cliente: "y media docena de jamón y queso" → items:[{name:"Empanada de jamón y queso",qty:6}], complete:true

7) Cancelación parcial:
Cliente: "2 empanadas y una coca" → items:[{name:"Empanada de carne",qty:2},{name:"Coca-Cola 500ml",qty:1}], complete:false
Cliente: "sacá la coca" → items:[], complete:false
(La coca se quitó. Las empanadas se mantienen.)

8) Negación total:
Cliente: "no quiero nada" / "cancelá" / "olvídalo" → items:[], complete:false, confidence:0.9

9) Pregunta de precio:
Cliente: "¿cuánto sale la pizza?" → items:[], complete:false, confidence:0.9
(Es una pregunta, no un pedido.)

10) Negación + corrección:
Cliente: "quiero 3 empanadas" → items:[{name:"Empanada de carne",qty:3}], complete:false
Cliente: "no, mejor 2 y agregá una coca" → items:[{name:"Empanada de carne",qty:2},{name:"Coca-Cola 500ml",qty:1}], complete:false
(Se corrigió la cantidad Y se agregó un item nuevo.)

REGLAS DE NEGACIÓN:
- "no quiero X" / "sin X" / "sacá X" → QUITAR X del carrito (no agregar).
- "no quiero nada" / "cancelá" / "olvídalo" → carrito vacío, complete:false.
- "no" solo (respondiendo a una pregunta del bot) → no es negación de producto; es respuesta a la pregunta pendiente.

REGLAS DE MULTI-INTENT:
- Si el mensaje tiene pedido Y pregunta ("quiero 2 empanadas y ¿tienen pizza?"), procesar el pedido y marcar complete:false (la pregunta se responde por separado).
- Si el mensaje tiene corrección Y agregado ("no, mejor 2 y agregá una coca"), devolver el carrito completo actualizado.

REGLAS DE CANTIDADES:
- "una docena" = 12, "media docena" = 6, "un par" = 2, "el doble" = 2× la cantidad anterior.
- Si el cliente dice solo un número ("3") respondiendo a "¿cuántas?", es la cantidad del producto pendiente.`;

// Telemetría de uso del LLM (expuesta en /health del cerebro): así se verifica
// en 1 comando si el bot está usando IA y con qué modelo respondió por última vez.
export const llmStats = {
  ok: 0, fail: 0, cooldown: 0, lastModel: null, lastAt: null,
  // Telemetría de parseos (Fase 3): de dónde salió el pedido entendido.
  parses: { llm: 0, rules: 0, lowConfidence: 0 },
};

// Cooldown por proveedor (anti-429/410). Clave: `${name}:${model}`.
const providerCooldowns = new Map();
function providerCooled(provider) {
  const until = providerCooldowns.get(`${provider.name}:${provider.model}`);
  return !!until && until > Date.now();
}
function markProviderCooldown(provider) {
  providerCooldowns.set(`${provider.name}:${provider.model}`, Date.now() + 5 * 60 * 1000);
}

export async function llmChat(messages, opts = {}) {
  const providers = Array.isArray(config.llmProviders) && config.llmProviders.length
    ? config.llmProviders
    : [{ name: "legacy", baseUrl: config.llmBaseUrl, apiKey: config.llmApiKey, model: config.llmModel }];
  if (!providers.some((p) => p.apiKey)) return null;

  const maxTokens = opts.max_tokens || 400;
  const temperature = opts.temperature ?? 0;
  const timeout = opts.timeout;

  for (const provider of providers) {
    if (!provider.apiKey) continue;
    if (providerCooled(provider)) continue;

    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${provider.apiKey}`,
    };
    if (provider.name === "openrouter") {
      headers["HTTP-Referer"] = config.llmSiteUrl;
      headers["X-Title"] = config.llmSiteName;
    }

    const body = {
      model: provider.model,
      temperature,
      max_tokens: maxTokens,
      messages,
    };
    // JSON mode: fuerza respuesta en JSON válido (soportado por Gemini, OpenAI, DeepSeek).
    // Evita que el modelo devuelva texto libre que no se pueda parsear.
    if (opts.response_format === "json") {
      body.response_format = { type: "json_object" };
    }

    const t = timeout || (provider.name === "openrouter" ? 30000 : 20000);
    let res;
    try {
      res = await fetch(`${provider.baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(t),
      });
    } catch (e) {
      console.error(`[bot] LLM ${provider.name} fetch error: ${e?.message || e}`);
      continue;
    }

    if (res.status === 429 || res.status === 503 || res.status === 410 || res.status === 404 || res.status === 402 || res.status === 403) {
      markProviderCooldown(provider);
      const snippet = (await res.text().catch(() => "")).slice(0, 200);
      console.warn(`[bot] LLM ${provider.name}/${provider.model} no disponible (${res.status}) - siguiente proveedor | ${snippet}`);
      continue;
    }
    if (!res.ok) {
      const snippet = (await res.text().catch(() => "")).slice(0, 200);
      console.warn(`[bot] LLM ${provider.name} error ${res.status}: ${snippet}`);
      continue;
    }

    const data = await res.json().catch(() => null);
    const content = data?.choices?.[0]?.message?.content || "";
    if (!content) {
      console.warn(`[bot] LLM ${provider.name} sin contenido`);
      continue;
    }
    llmStats.ok++;
    llmStats.lastModel = `${provider.name}:${provider.model}`;
    llmStats.lastAt = new Date().toISOString();
    return { content, provider: `${provider.name}:${provider.model}` };
  }

  llmStats.fail++;
  return null;
}

export async function parseWithLlm(message, products, ctx = null) {
  const hasProvider = Array.isArray(config.llmProviders) && config.llmProviders.some((p) => p.apiKey);
  if (!hasProvider && !config.llmApiKey) {
    if (!parseWithLlm._reported) {
      console.warn("[bot] LLM sin API key - los pedidos caen al fallback de reglas");
      parseWithLlm._reported = true;
    }
    return null;
  }

  const result = await callOnce(message, products, ctx);
  if (result !== null) {
    llmStats.parses.llm++;
    console.log(`[bot] LLM ok: items=${result.items?.length ?? 0}`);
    return { ...result, __llm: true };
  }
  llmStats.fail++;
  return null;
}

async function callOnce(message, products, ctx = null) {
  // Menú enriquecido: por producto, sus grupos de modificadores (opciones +
  // required/máx) y variantes (color/talle). Sin esto la IA no sabe que esas
  // opciones existen y no las extrae.
  const menu = products.slice(0, 40)
    .map((p) => {
      let line = `${p.id}|${p.name}|$${p.price}`;
      const groups = (p.modifiers || [])
        .map((g) => {
          const opts = (Array.isArray(g.options) ? g.options : [])
            .map((o) => (typeof o === "string" ? o : o?.label))
            .filter(Boolean)
            .slice(0, 8);
          if (!opts.length) return null;
          const req = g.required
            ? ` (obligatorio${Number(g.max_selections) > 1 ? `, elegí ${g.max_selections}` : ""})`
            : "";
          return `${g.group_name}: ${opts.join(", ")}${req}`;
        })
        .filter(Boolean);
      if (groups.length) line += ` [${groups.join(" | ")}]`;
      const variants = (p.variants || [])
        .map((v) => `${v.color || "?"}${v.talle ? "/" + v.talle : ""}`)
        .filter((s) => s !== "?")
        .slice(0, 12);
      if (variants.length) line += ` (variantes: ${variants.join(", ")})`;
      return line;
    })
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

  // Few-shot aprendido (correcciones del dueño)
  let fewShot = "";
  if (ctx?.vendorId) {
    try {
      const { loadCorrections, formatFewShot } = await import("./learning.mjs");
      const corr = await loadCorrections(ctx.vendorId);
      fewShot = formatFewShot(corr);
    } catch {}
  }

  const llmResult = await llmChat(
    [
      { role: "system", content: SYSTEM + fewShot },
      { role: "user", content: `Productos disponibles:\n${menu}\n\nMensaje del cliente: "${message}"${contextBlock}` },
    ],
    { max_tokens: 500, temperature: 0, timeout: 25000, response_format: "json" }
  );
  if (!llmResult) return null;

  const content = llmResult.content;
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

// Colores comunes (para variantes moda: "una remera negra talle M"). El stem
// (negro→negr, rojo→roj) matchea el género de la palabra sin exactitud.
const COLORS = ["negro", "blanco", "rojo", "azul", "verde", "amarillo", "gris", "rosa", "naranja", "celeste", "bordo", "beige", "violeta", "fucsia", "marron", "lila"];

/** Nombre "desnudo": sin colores ni "talle X" ("remera negra talle m" →
 *  "remera"). Para matchear candidatos cuando el said trae variantes. */
export function bareName(name) {
  const stems = COLORS.map((c) => c.slice(0, Math.max(3, c.length - 1))).join("|");
  return String(name || "")
    .replace(new RegExp(`\\btalle\\s+\\S+|\\b(?:${stems})\\S*`, "gi"), "")
    .replace(/\s+/g, " ")
    .trim();
}

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
export function extractFromText(text, products) {
  // Casos:
  //  - "3 empanadas y una coca" → [empanadas×3, coca×1]
  //  - "dos pizzas"          → [pizza×2]
  //  - "quiero dos empanadas" → qty detectada aunque haya verbos al principio.
  //  - "una docena de empanadas" → ×12; "media docena de empanadas" → ×6.
  //  - "empanada de jamón y queso 12" → ×12: el texto se prueba COMPLETO
  //    primero (con qty AL FINAL); si matchea un producto NO se parte por
  //    " y " — el split rompía nombres con "y" y la cantidad trailing se perdía.
  //  - "Agregame las empanadas" → verbos de agregado al inicio.
  const whole = parseChunk(String(text), products);
  if (whole) return [whole];

  // Split sobre el texto ORIGINAL: las comas separan pedidos y normalizeEs
  // las destruiría (todo quedaría en un chunk sin separar).
  const out = [];
  // Primero intentar separar por comas/;/+/newline (no rompe nombres con "y").
  let tokens = String(text).split(/[,\n;]|\s*\+\s*/i).map((s) => s.trim()).filter(Boolean);
  // Si no se obtuvo nada con eso, o un chunk no matchea ningún producto,
  // intentar split por " y "/" e " como fallback (compatibilidad).
  const tryParse = (toks) => toks.map((p) => parseChunk(p, products)).filter(Boolean);
  let parsed = tryParse(tokens);
  if (parsed.length === 0) {
    tokens = String(text).split(/[,\n;]| e | y |\s*\+\s*/i);
    parsed = tryParse(tokens);
  }
  // Dedup por offerId (evita duplicar si un chunk se parseó dos veces).
  const seen = new Set();
  for (const it of parsed) {
    const k = it.offerId || it.id;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(it);
  }
  return out;
}

function parseChunk(chunk, products) {
  let c = chunk.trim();
  if (!c) return null;
  // Quitar verbos/intenciones al inicio (quiero/dame/traeme/agregame/etc.)
  c = c.replace(/^(quiero|querria|quisiera|dame|démela|traeme|traigame|agregame|agregá|agrega|sumame|sumá|suma|sumar|mandame|anotate|cargame|me das|me pones|me haces|me traes|me preparas|me cobras)\s+/i, "");
  // Quitar negaciones/relleno de corrección al inicio ("no, mejor solo X" → "X").
  for (let i = 0; i < 4; i++) {
    const filler = /^(no\b[,.;:]?\s*(mejor\b\s*)?(solo\b\s*)?|mejor\b\s*(solo\b\s*)?|solo\b\s*|unicamente\b\s*|bueno\b\s*)/i.exec(c);
    if (!filler || !c.slice(filler[0].length).trim()) break;
    c = c.slice(filler[0].length).trim();
  }
  const norm = normalizeEs(c);
  if (!norm) return null;
  let qty = 1, name = norm;
  // Qty AL PRINCIPIO: "3 empanadas" / "una docena de X".
  const m = /^(\d+|un(?:a|o)?|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)\s+(?:de\s+)?(.*)$/.exec(norm);
  if (m) {
    const rawQty = m[1];
    if (/^\d+$/.test(rawQty)) qty = Number(rawQty);
    else qty = NUM_WORDS[rawQty] ?? 1;
    name = m[2].trim();
  }
  if (!name) return null;
  // "docena de X" → ×12 · "media docena de X" → ×6 (el multiplicador va
  // sobre la cantidad: "una docena" = 1 × 12).
  const docena = /^media\s+docena\s+(?:de\s+)?(.+)$/.exec(name) || /^docena\s+(?:de\s+)?(.+)$/.exec(name);
  if (docena) {
    qty *= name.startsWith("media") ? 6 : 12;
    name = docena[1].trim();
  }
  // Qty AL FINAL (solo si no había al principio): "empanadas 12" → ×12,
  // "empanadas docena" → ×12, "empanadas media docena" → ×6.
  if (!m) {
    const tail = /\s+(\d{1,2}|docena|media\s+docena)$/.exec(norm);
    if (tail) {
      const tailQty = tail[1].toLowerCase().trim();
      const q = /^\d+$/.test(tailQty) ? Number(tailQty) : (tailQty.startsWith("media") ? 6 : 12);
      const nameTail = norm.slice(0, tail.index).trim();
      const p2 = matchProduct(products, nameTail);
      if (p2) {
        qty = q;
        name = nameTail;
      }
    }
  }
  const p = matchProduct(products, name);
  if (!p) {
    // Sin match: reintentar SIN colores/talles ("remera negra talle m" →
    // "remera") — esas palabras rompen la intersección del match.
    const bare = bareName(name) || name;
    if (bare !== name) {
      const p2 = matchProduct(products, bare);
      if (!p2) return null;
      return buildItem(p2, qty, norm, name);
    }
    return null;
  }
  return buildItem(p, qty, norm, name);
}

function buildItem(p, qty, norm, said) {
  // Variantes (moda): "talle M" y color → el item lleva variant y matchVariant
  // (bot) resuelve el variantId. Solo aplica si el producto tiene variantes.
  const variant = {};
  const tm = /talle\s+([a-z0-9]{1,4})\b/i.exec(norm);
  if (tm) variant.talle = tm[1].toUpperCase();
  for (const c of COLORS) {
    const stem = c.slice(0, Math.max(3, c.length - 1));
    if (new RegExp(`\\b${stem}`, "i").test(norm)) { variant.color = c; break; }
  }
  return {
    offerId: p.id,
    name: p.name,
    qty: Math.max(1, qty),
    modifiers: [],
    variant: Object.keys(variant).length ? variant : undefined,
    said: said || name, // lo que el cliente escribió para el producto (sin qty/verbos — si no, TODO quedaba ambiguo)
  };
}

export function normalizeEs(s) {
  return String(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
