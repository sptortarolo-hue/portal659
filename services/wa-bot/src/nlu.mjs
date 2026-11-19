// @ts-nocheck — pendiente de conversión a TypeScript.
import { config } from "./config.mjs";
import { matchProduct } from "./menu.mjs";
import { loadCorrections, formatFewShot } from "./learning.mjs";
import { toolSchemasForLlm, dispatchTool } from "./tools.mjs";

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

// SYSTEM prompt: si hay tools (function calling), usá create_order / not_an_order.
// Si no hay (provider que no las soporta), respondé JSON puro.
const SYSTEM = `Sos el asistente de Portal 659, el centro comercial de tu barrio. El portal es un multicommerce: cada comercio tiene su propia tienda online independiente. Un pedido = una tienda, para siempre (no hay carrito multi-tienda).

REGLA DE ORO: Si tu entorno de ejecución provee tools (create_order / not_an_order), INVOCALAS — NO escribas texto libre ni JSON suelto fuera del tool. Si NO hay tools disponibles, respondé solo un JSON válido según el schema al final de este prompt.

TENÉS DOS CAPAS DE RESPUESTA:

CAPA 1 — INFORMACIÓN DEL PORTAL (el cliente aún NO eligió comercio):
- Si el cliente saluda, pregunta qué es Portal 659, cómo funciona, cómo comprar, cómo pagar, delivery vs retiro, planes para comercios, o qué comercios hay → responder con INFO, NO crear pedido.
- items: [], unknownItems: [], complete: false.
- No inventes precios ni productos. Usá datos reales del catálogo solo si los tenés.

CAPA 2 — PEDIDOS (solo si el cliente YA eligió una tienda):
- El cliente mencionó un comercio específico Y quiere pedir productos de ese comercio.
- Entonces seguís las reglas normales de extraer ítems, cantidades, método, pago, datos.

DEVOLVÉ SOLO un JSON válido (sin texto adicional) con esta forma:

{
  "intent": "info_portal" | "ver_tiendas_abiertas" | "ver_todas_tiendas" | "elegir_tienda" | "pedido" | "sumar_comercio" | "chat",
  "complete": boolean,
  "items": [{"name": string, "qty": number, "unit": "unidad"|"kg"|"pack"|null, "weightKg": number|null, "modifiers": [string], "variant": {"color": string|null, "talle": string|null}, "said": string}],
  "unknownItems": string[],
  "method": "pickup" | "delivery" | null,
  "payment": "efectivo" | "transferencia" | null,
  "customerName": string | null,
  "customerPhone": string | null,
  "customerAddress": string | null,
  "note": string | null,
  "reasoning": string,
  "confidence": number
}

Intents:
- "info_portal": el cliente pregunta qué es Portal 659, cómo funciona, cómo comprar, cómo pagar, delivery vs retiro, planes para comercios.
- "ver_tiendas_abiertas": el cliente quiere ver comercios abiertos cerca.
- "ver_todas_tiendas": el cliente quiere ver todos los comercios de la zona.
- "elegir_tienda": el cliente menciona el nombre de un comercio específico (ej: "Che Sancho", "la esquina", "1").
- "pedido": el cliente quiere pedir productos de un comercio YA ELEGIDO. Tiene ítems reconocibles del menú de ese comercio.
- "sumar_comercio": el cliente tiene un comercio/emprendimiento y quiere sumarlo al portal (planos, cómo darse de alta).
- "chat": saludo, agradecimiento, o cualquier otra cosa que no encaje arriba.

Campos de ítem (solo si intent === "pedido"):
- "name": nombre del producto tal cual está en la lista. NO inventes nombres.
- "qty": número (default 1). "una docena" = 12, "media docena" = 6, "un par" = 2.
- "unit": "unidad" (default), "kg" (venta por peso), "pack" (venta por paquete de pack_size).
- "weightKg": si unit es "kg", el peso en kilos (ej. "medio kilo" → 0.5, "1,5 kg" → 1.5).
- "modifiers": solo si el cliente dice explícitamente ("sin cebolla", "doble queso", gustos).
- "variant": si el producto tiene variantes (color/talle) y el cliente las aclara. Ej: "remera negra talle M" → {color:"negro", talle:"M"}. Si no aclara, null.
- "said": lo que el cliente LITERALMENTE escribió para ese ítem.

Datos del cliente (solo si intent === "pedido"):
- Extraé nombre/teléfono/dirección solo si el cliente los da.
- "method": "pickup" (retiro) o "delivery" (envío/domicilio) si lo aclara.
- "payment": "transferencia" o "efectivo" si lo menciona.

Reglas de negocio:
1. Si el cliente NO eligió comercio todavía (no hay currentVendorId en el contexto), intent NO puede ser "pedido". Debe ser "elegir_tienda" o "info_portal" o "chat".
2. complete=true solo si hay ítems reconocidos Y método Y nombre (y dirección si es delivery). El pago NO bloquea (se coordina por WhatsApp).
3. Si el cliente PREGUNTA ("¿tenés empanadas?", "¿cuánto sale?"), NO es pedido: items [], complete false.
4. Usá el CONTEXTO (carrito actual, preguntas pendientes, historial).
5. Si el cliente corrige el pedido ("no, mejor solo 3 empanadas"), devolvé items = carrito COMPLETO actualizado.
6. Si el cliente agrega ("agregá una coca"), devolvé SOLO ese ítem nuevo.
7. Si el cliente saluda o pregunta info del portal: complete false, items [].
8. NUNCA inventes productos. Si no está en la lista, ponelo en unknownItems y complete:false.
9. Para productos por kg: si dice "medio kilo de X", unit:"kg", weightKg:0.5, qty:1.
10. Para productos por pack: si dice "un paquete de X" o "2 packs de X", unit:"pack", qty:N.
11. Para servicios (estética, plomería): el ítem es el servicio, puede tener duración, profesional, fecha/hora si se menciona.
12. Si el cliente dice "quiero sumar mi comercio", "tengo un negocio", "soy comerciante", "¿cómo me sumo?" → intent "sumar_comercio", complete:false, items[].

EJEMPLOS DE CONVERSACIONES:

CAPA 1 — INFORMACIÓN:
1) Cliente: "hola" → intent:"chat", items:[], complete:false
2) Cliente: "¿qué es Portal 659?" → intent:"info_portal", items:[], complete:false
3) Cliente: "¿cómo comprar?" → intent:"info_portal", items:[], complete:false
4) Cliente: "¿cómo pago?" → intent:"info_portal", items:[], complete:false
5) Cliente: "tengo un comercio, quiero sumarlo" → intent:"sumar_comercio", items:[], complete:false
6) Cliente: "quiero ver todas las tiendas" → intent:"ver_todas_tiendas", items:[], complete:false

CAPA 2 — PEDIDOS (después de elegir tienda):
7) Cliente: "quiero 2 empanadas de carne y una coca" (tienda ya elegida: Che Sancho) → items:[{name:"Empanada de carne",qty:2,unit:"unidad"},{name:"Coca-Cola 500ml",qty:1,unit:"unidad"}], method:null, complete:false
8) Cliente: "medio kilo de milanesa napolitana" → items:[{name:"Milanesa napolitana",qty:1,unit:"kg",weightKg:0.5}], complete:false
9) Cliente: "una remera negra talle M" → items:[{name:"Remera Lisa",qty:1,unit:"unidad",variant:{color:"negro",talle:"M"}}], complete:false
10) Cliente: "envío a calle 5 123, Juan, dos empanadas de carne, transferencia" → items:[{name:"Empanada de carne",qty:2,unit:"unidad"}], method:"delivery", customerAddress:"calle 5 123", customerName:"Juan", payment:"transferencia", complete:true
11) Cliente: "quisiera una pizza grande" (no existe en menú) → items:[], unknownItems:["pizza grande"], complete:false
12) Cliente: "2 de carne y una coca bien fría" → items:[{name:"Empanada de carne",qty:2,unit:"unidad"},{name:"Coca-Cola 500ml",qty:1,unit:"unidad"}], complete:false
13) Cliente: "medio kilo de vacío" → items:[{name:"Vacío",qty:1,unit:"kg",weightKg:0.5}], complete:false
14) Cliente: "la negra talle M" → items:[{name:"Remera Lisa",qty:1,unit:"unidad",variant:{color:"negro",talle:"M"}}], complete:false
15) Cliente: "un paquete de sandwiches de miga" → items:[{name:"Sandwiches de Miga",qty:1,unit:"pack"}], complete:false
16) Cliente: "agregá una coca" → items:[{name:"Coca-Cola 500ml",qty:1,unit:"unidad"}], op:"add", complete:false
17) Cliente: "no, mejor solo 3 empanadas" → items:[{name:"Empanada de carne",qty:3,unit:"unidad"}], op:"setQty", complete:false
18) Cliente: "sin cebolla, doble queso" → items:[{name:"Hamburguesa Clásica",qty:1,unit:"unidad",modifiers:["sin cebolla","doble queso"]}], complete:false
19) Cliente: "quiero un turno de masaje relajante" → items:[{name:"Masaje Relajante",qty:1,unit:"unidad"}], complete:false
20) Cliente: "envíalo a la misma dirección de siempre" → method:"delivery", complete:false

REGLAS DE STOCK Y DESTACADAS:
- Si un producto dice "SIN STOCK" o el stock es 0, nunca elijas ese producto y nunca lo sugieras. Aunque el cliente insista, declinás y preguntás qué otra cosa quiere (o mostrá categorías disponibles/completamos al final).
- Si un producto dice "[DESTACADA hoy]", podés mencionarlo como recomendación si encaja con lo que el cliente pregunta (ej: "¿tienen recomendaciones?", "¿qué está bueno?").
- Nunca inventes stock positivo para productos SIN STOCK.
- Los precios nunca se generan si el producto no tiene precio exacto en el menú — si no estás seguro, items:[] con unknownItems:["<lo que el cliente dijo>"]. Pero si el producto EXISTE en el menú aunque esté "SIN STOCK", tampoco lo agregues aunque el cliente lo pida — explicá está agotado.

REGLAS DE NEGACIÓN:
- "no quiero X" / "sin X" / "sacá X" → QUITAR X del carrito (op:"remove").
- "no quiero nada" / "cancelá" → carrito vacío, complete:false.

OPERACIONES (campo op opcional; si no viene, asumí "add"):
- "add": SUMAR ítems al carrito existente (el default cuando el cliente dice "agregá", "también", "más").
- "remove": QUITAR un ítem del carrito.
- "setQty": REEMPLAZAR el carrito por estos ítems (el cliente dice "solo", "mejor", "nada más").
- "setField": actualizar un dato del cliente sin tocar ítems (ej. nombre, dirección, método, pago). Devuelve items:[] y el campo en customerName/customerAddress/method/payment.

Razoná paso a paso antes de responder. En "reasoning" poné 1 frase por qué marcaste complete true/false. En "confidence" un número 0-1. Nunca inventes productos que no estén en la lista.`;

// Telemetría de uso del LLM (expuesta en /health del cerebro): así se verifica
// en 1 comando si el bot está usando IA y con qué modelo respondió por última vez.
export const llmStats = {
  ok: 0, fail: 0, cooldown: 0, lastModel: null, lastAt: null,
  // Telemetría de tokens (fase 1 agente): cuanto cuesta cada conversación.
  usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, calls: 0 },
  // Telemetría de parseos (Fase 3): de dónde salió el pedido entendido.
  parses: { llm: 0, rules: 0, lowConfidence: 0 },
};

// ———————————————————————————————————————————————————————————————————————————
// Function calling (OpenAI tools schema): el API valida la salida y la IA
// no puede devolver texto libre mal-formado. Fallback a prompt-with-JSON para
// proveedores que no soporten tools (openrouter free, algunos modelos).
// Las tools viven en ./tools.mjs (registry schema+handler): un solo lugar.
// ———————————————————————————————————————————————————————————————————————————
const TOOLS = toolSchemasForLlm();

// Cooldown por proveedor (anti-429/410). Clave: `${name}:${model}`.
const providerCooldowns = new Map();
function providerCooled(provider) {
  const until = providerCooldowns.get(`${provider.name}:${provider.model}`);
  return !!until && until > Date.now();
}

// Cache de soporte de tools por proveedor/modelo. Si falla con tools, los desactivamos.
const providerToolSupport = new Map();
function providerSupportsTools(key) {
  const cached = providerToolSupport.get(key);
  return cached !== false;
}
function markProviderToolUnsupported(key) {
  providerToolSupport.set(key, false);
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
    // Function calling: en vez de pedir JSON libre, proveemos tools y forzamos tool_choice
    if (opts.tools && providerSupportsTools(`${provider.name}:${provider.model}`)) {
      body.tools = opts.tools;
      body.tool_choice = opts.tool_choice || 'required';
    }
    // JSON mode: fuerza respuesta en JSON válido (soportado por Gemini, OpenAI, DeepSeek).
    // Evita que el modelo devuelva texto libre que no se pueda parsear.
    else if (opts.response_format === "json") {
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
      // ¿Provider no soporta tools? Desactivar para este model y seguir con el next
      if (opts.tools && /tool|function_call|tool_choice/i.test(snippet)) {
        markProviderToolUnsupported(`${provider.name}:${provider.model}`);
        console.warn(`[bot] LLM ${provider.name}/${provider.model} no soporta tools - desactivando para este modelo`);
        continue;
      }
      console.warn(`[bot] LLM ${provider.name} error ${res.status}: ${snippet}`);
      continue;
    }

    const data = await res.json().catch(() => null);
    // Tokens consumidos (para llmStats.usage)
    const _u = data?.usage;
    if (_u && typeof _u === "object") {
      llmStats.usage.prompt_tokens += Number(_u.prompt_tokens) || 0;
      llmStats.usage.completion_tokens += Number(_u.completion_tokens) || 0;
      llmStats.usage.total_tokens += Number(_u.total_tokens) || 0;
      llmStats.usage.calls += 1;
    }
    // ¿El modelo respondió con tool_calls? (los queremos sobre content en este caso)
    const toolCalls = data?.choices?.[0]?.message?.tool_calls;
    if (opts.tools && Array.isArray(toolCalls) && toolCalls[0]?.function?.name) {
      const tc = toolCalls[0];
      const functionName = tc.function.name;
      let args = {};
      try { args = JSON.parse(tc.function.arguments || '{}'); } catch (e) { console.error(`[bot] LLM tool args parse err: ${e?.message}`); }
      if (functionName === 'create_order' || functionName === 'not_an_order') {
        llmStats.ok++;
        llmStats.lastModel = `${provider.name}:${provider.model}`;
        llmStats.lastAt = new Date().toISOString();
        return { content: tc.function.arguments || '{}', provider: `${provider.name}:${provider.model}`, __toolCall: { name: functionName, args } };
      }
    }
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

/** Quick gate: evita que el LLM se alborote con mensajes de navegación /
 *  saludos / números de menú — en esos mensajes las reglas bastan. */
export function shouldAttemptNLParsing(message) {
  const t = String(message || "").trim();
  if (t.length < 3) return false;
  // Navegación de menú / comandos
  if (/^(hola|buenas|chau|gracias|ok|si|no|cancelar|menu|menú|inicio|volver|comercios|ayuda)$/i.test(t)) return false;
  if (/^[0-9*#]+[\s.,!]*$/.test(t)) return false;
  // Cantidad suelta o solo números (sólo tiene sentido en menú)
  if (/^\d+(?:[.,]\d+)?\s*(kg|kilos?|g|gramos?|unidades?|uds?)?$/i.test(t)) return false;
  // Intent de compra explícita o cantidad+palabra: ahí sí intentamos
  const orderKeywords = /(agrega|agregá|agregame|sumame|sumá|suma|añade|añadá|dame|traeme|traé|pedime|pedime|mandame|mandá|quiero|quisiera|quería|querés|quisiera|tene(s|és)|tiene(n|s)|hay|stock|disponible|sale|cuesta|vale|comprar|seleccion|selecciona|enca(r|rga)r|pedir|pedido|cargar|cargá|enviar|entrega|delivery|para llevar|para retiro|para entrega|modific(a|o|áme))/i;
  const hasQtyWord = /\b(uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|media docena|docena|unidad|unidades|kilo|kg|gramo)\b/i;
  const hasPriceMix = /(\$|pesos|total)\s*\d/.test(t);
  const hasUnitPlusWord = /\b\d+(?:[.,]\d+)?\s*(kg|kilos?|g|gramos?|unidades?)\s+[a-záéíóúñ]/i.test(t);
  return orderKeywords.test(t) || hasQtyWord.test(t) || hasPriceMix || hasUnitPlusWord;
}

export async function parseWithLlm(message, products, ctx = null) {
  if (!shouldAttemptNLParsing(message)) {
    return null; // rules take the wheel
  }
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
      let line = `${p.id}|${p.name}|${p.price}`;
      if (p.stock_control) {
        line += Number(p.stock) > 0
          ? ` [stock: ${p.stock}]`
          : ` [SIN STOCK]`;
      }
      if (p.featured_today) line += ` [DESTACADA hoy]`;
      if (p.pack_size) line += ` [pack de ${p.pack_size} unidades]`;
      if (p.unit === 'kg') line += ` [venta por kg]`;
      else if (p.weight_step_kg) line += ` [pesable, paso ${p.weight_step_kg}kg]`;
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

  const STAGE_LABEL = {
    idle: 'BROWSING (el cliente puede preguntar info o iniciar un pedido)',
    flow: 'ORDERING (el cliente armó parte del pedido, está agregando ítems o datos)',
    confirm: 'CONFIRMING (verificar resumen; el cliente puede cambiar cualquier cosa)',
    awaiting_receipt: 'AWAITING_RECEIPT (esperando comprobante de transferencia)',
    completed: 'DONE',
  };
  const stageLabel = STAGE_LABEL[ctx?.stage] || `${ctx?.stage || 'BROWSING'}`;
  const storeName = ctx?.storeName || 'Portal 659';
  const systemWithVertical =
    SYSTEM.replace('{vertical}', ctx?.vertical || 'desconocida').replace('{stage}', stageLabel)
    + `\nTu comercio es: ${storeName}. Eres el asistente de ${storeName}, no de otro comercio, y tu misión es ayudar a este comercio y sus productos.`;
  const llmResult = await llmChat(
    [
      { role: "system", content: systemWithVertical + fewShot },
      { role: "user", content: `Productos disponibles:\n${menu}\n\nMensaje del cliente: "${message}"${contextBlock}` },
    ],
    { max_tokens: 600, temperature: 0, timeout: 25000, response_format: "json", tools: TOOLS, tool_choice: 'required' }
  );
  if (!llmResult) return null;

  if (llmResult.__toolCall) {
    const { name, args } = llmResult.__toolCall;
    const out = await dispatchTool(name, args, { products, pending: ctx?.pending, cart: ctx?.cart, stage: ctx?.stage, vendorId: ctx?.vendorId });
    if (out) return out;
  }
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
  const customerName = null; // parseByRules no extrae nombres (salvo la regla de nombre suelto al final)

  // Texto combinado con pago/método: "envío a calle 5 123, Juan, transferencia"
  // Después de la dirección, buscaremos un nombre entre comas que no sea verbo de pago.
  let nameFromCombined = null;
  if (customerAddress) {
    const afterAddr = m.slice(addrMatch.index + addrMatch[0].length);
    const parts = afterAddr.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
    const paymentVerbs = /^(transferencia|transferir|efectivo|cash|cbu|alias|tarjeta|mercadopago|mp)$/i;
    const methodVerbs = /^(retiro|retirar|envío|envio|delivery|domicilio|despachen)$/i;
    for (const part of parts) {
      if (paymentVerbs.test(part)) continue;
      if (methodVerbs.test(part)) continue;
      if (/^(si|no|ok|dale|gracias|hola|chau)$/i.test(part)) continue;
      if (part.length >= 2 && part.length <= 40 && !/\d/.test(part)) {
        nameFromCombined = part;
        break;
      }
    }
  }

  if (Array.isArray(products) && products.length > 0) {
    const items = extractFromText(m, products);
    if (items.length) {
      // complete solo si NO faltan campos obligatorios: nombre, y dirección si es delivery.
      // payment se pide pero no bloquea (el comercio coordina por WA).
      const missing = [];
      if (!nameFromCombined) missing.push("name");
      if (method === "delivery" && !customerAddress) missing.push("address");
      return { complete: missing.length === 0, items, method, customerName: nameFromCombined, customerAddress, payment, note: null, missing };
    }
  }
  // Sin items pero con datos: igual devolverlos (el bot los usa para avanzar).
  if (method || payment || customerAddress) {
    return { complete: false, items: [], method, customerName: nameFromCombined, customerAddress, payment, note: null };
  }

  // Nombre suelto: el cliente responde solo su nombre (ej. "Juan Pérez") cuando
  // el bot le preguntó "¿A nombre de quién va el pedido?". Detectamos 2+
  // palabras, sin verbos de pedido, sin método de entrega, sin pago, y sin que
  // matchee un producto del menú. Una sola palabra también vale si tiene
  // letras (un "1" o "54911000000" NUNCA es un nombre).
  const words = m.split(/\s+/).filter(Boolean);
  const singleWordName = words.length === 1 && /[a-záéíóúñ]{3,}/i.test(m);
  const looksLikeName = (words.length >= 2 || singleWordName) &&
    !/(quiero|quería|quisiera|dame|démela|traeme|agregá|agrega|sumá|sumar|mandame|anotate|cargame|me das|me pones|me haces|me traes|me preparas|me cobras|retiro|retirar|envío|envio|delivery|domicilio|despachen|efectivo|transferencia|transferir|cbu|alias|cancelar|ayuda|menu|menú|comercios|hola|chau|ok|si|no)\b/i.test(m) &&
    (!Array.isArray(products) || !products.some((p) => normalizeEs(p.name).split(" ").some((w) => w.length >= 3 && normalizeEs(m).includes(w))));
  if (looksLikeName) {
    return { complete: false, items: [], method: null, customerName: m, customerAddress: null, payment: null, note: null };
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
  c = c.replace(/^(agrgame|agregame|agregá|agrega|quiero|querria|quisiera|dame|démela|traeme|traigame|sumame|sumá|suma|sumar|mandame|anotate|cargame|me das|me pones|me haces|me traes|me preparas|me cobras)\s+/i, "");
  // Quitar artículo/determinante liderando el chunk ("la coca" → "coca").
  c = c.replace(/^(?:la|el|los|las|una|un|unos|unas|de|del|al)\s+/i, "");
  // Quitar relleno al final ("ah", "eh", "bueno", etc.)
  c = c.replace(/\s+(ah|eh|bueno|liste|ok|vale)\s*$/i, "");
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
    // Fallback: artículos/preposiciones casuales del habla argentina ("kilo de
    // helado", "un alfajor con...") — probamos el nombre sin palabras-función.
    const STOP = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'un', 'una', 'unos', 'unas', 'a', 'en', 'con', 'por', 'para']);
    const clean = (name || '').split(/\s+/).filter((w) => { const lw = String(w || '').toLowerCase(); return !STOP.has(lw) && lw.length > 1; }).join(' ').trim();
    if (clean && clean !== name) {
      const p3 = matchProduct(products, clean);
      if (p3) return buildItem(p3, qty, norm, name);
    }
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

/** Quita el verbo de intención de agregar al inicio y los determinativos
 *  (la/el/un/una/de…) que lo acompañan: "falta la pastafrola" → "pastafrola",
 *  "me falta la de ricota" → "ricota", "sumá coca" → "coca".
 *  Devuelve el texto sin cambios si no matchea (el caller decide qué hacer). */
export function stripAddVerb(text) {
  const s = String(text || "").trim();
  const m = s.match(/^(?:me\s+|le\s+)?(?:falta|faltar[ií]a|sum[aá]|agreg[aá](?:me|lo|la|los|las)?|agregame|tra[eé](?:me|lo|la|los|las)?|carg[aá]|dame)\s*[:,]?\s*(?:(?:la|el|los|las|una|un|unos|unas|de|del|al)\s+)*/i);
  if (!m) return s;
  const stripped = s.slice(m[0].length).trim();
  return stripped.length >= 2 ? stripped : s;
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
