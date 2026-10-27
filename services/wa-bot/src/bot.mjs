// @ts-nocheck — pendiente de conversión a TypeScript (tipos JSDoc + // @ts-check).
// Ver menu.mjs y metrics.mjs para el patrón de anotación.
import { config } from "./config.mjs";
import { getState, setState, clearState, forEachConversation } from "./state.mjs";
import { getMenu, getMenuSync, matchProduct, matchAllProducts, normalizeForMatch, menuSummary } from "./menu.mjs";
import { parseWithLlm, parseByRules, normalizeEs, extractFromText, bareName, 
classifyIntent, llmStats } from "./nlu.mjs";
import { saveCorrection } from "./learning.mjs";
import { getClientByVendor, sendText, sendTyping, sendPaused } from "./relay.mjs";
import { feedPush } from "./metrics.mjs";

const DEFAULT_STATE = {
  step: "idle",
  items: [],          // { offerId, qty, modifiers, name }
  method: null,
  payment: null,
  customerName: null,
  customerAddress: null,
  note: null,
  welcomed: false,    // saludo una sola vez por chat
  handoffCount: 0,
  pausedUntil: 0,
  orderId: null,
  history: [],        // [{ role: "user"|"bot", text }] — contexto para la IA (cap 8)
  pendingMods: null,  // { offerId, group, options, max } — opciones requeridas pendientes
  pendingProduct: null, // { label, options, qty, fromRedeclare } — producto genérico a desambiguar
  pendingConfirm: null, // { items } - confirmacion de baja confianza
};

const AWAITING_RECEIPT_TTL = 15 * 60; // 15 min para acreditar el comprobante
const HANDOFF_PAUSE_MIN = 30;
const MAX_PARSE_MISSES = 2;

// Regexes
const RE_CANCEL   = /^(cancelar|no gracias|basta)\b/i;
const RE_CONFIRM  = /^(sí|si|dale|ok|okey|bueno|perfecto|confirmo|confirmar|listo)(?=[\s.,!¡]|$)/i;
const RE_NO       = /^(no|nop|cancelar todo)\s*[.!?]*$/i;
const RE_HUMAN    = /hablar con (una )?persona|hablar con alguien|humano|dueño|dueña|atención humana/i;
const RE_MENU     = /\b(menú|menu|carta)\b/i;
const RE_PICKUP   = /\b(retiro|retirar|paso por|voy por|busco)\b/i;
const RE_DELIVERY = /\b(envío|envio|delivery|domicilio|despachen)\b/i;
const RE_TRANSFER = /\b(transferencia|transferir|cbu|alias)\b/i;
const RE_CASH     = /\b(efectivo|cash)\b/i;
const RE_GREETING = /^(hola|buenas|buen día|buenos días|buenas tardes|buenas noches|hi|hey|hello)\b/i;
// Intención de PREGUNTA ("empanadas tenés?", "cuánto sale la pizza?", "hay coca?"):
// se RESPONDE con la lista, nunca se ordena.
const RE_ASKWORDS = /\b(tenés|tenes|tienen|hay|queda|quedan|cuánto|cuanto|cuánta|cuantas|precio|precios|sale|cuesta|cuestan|vale)\b/i;

function normalizePhone(waId) {
  const s = String(waId || "");
  if (s.includes("@lid")) return "lid:" + s.split("@")[0];
  const stripped = s.includes("@") ? s.split("@")[0] : s;
  const n = stripped.replace(/[^\d]/g, "");
  if (!n) return "";
  return n.startsWith("549") ? n : "549" + n.replace(/^54/, "");
}

function acceptsTransfer(vendor) {
  return !!(vendor.transfer_alias || vendor.transfer_cbu);
}

function shopUrl(vendor) {
  return vendor.slug ? `${config.publicUrl}/tienda/${vendor.slug}` : "";
}

function isQuestion(text) {
  const t = String(text || "");
  return /\?/.test(t) || (RE_ASKWORDS.test(t) && t.split(" ").length <= 6);
}

/** Link público de seguimiento del pedido (/seguimiento/[token]): el cliente
 *  sigue el pedido en vivo y ahí se lo invita a registrarse. */
function trackUrl(token) {
  return token ? `${config.publicUrl}/seguimiento/${token}` : "";
}

// ———————————————————————————————————————————————————————————————————————————
// Entrada principal
// ———————————————————————————————————————————————————————————————————————————

// Los parsers (LLM y reglas) devuelven items { name, qty, modifiers } SIN id.
// El API de pedido exige `offerId` (pricing.ts resuelve por id, no por nombre).
// Acá se enriquecen los items con el offerId REAL del menú, matcheando el
// nombre contra los productos disponibles. Sin esto, CADA pedido confirmado
// fallaba con "Uno de los productos ya no está disponible" (pricing.ts).
function resolveOfferIds(products, items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((p) => {
      const prod =
        (p.offerId && products.find((x) => String(x.id) === String(p.offerId))) ||
        matchProduct(products, p.name);
      const variant = prod ? matchVariant(prod, p) : null;
      return {
        offerId: prod?.id || p.offerId || p.id,
        variantId: variant?.id,
        name: p.name,
        qty: Math.max(1, Number(p.qty) || 1),
        modifiers: Array.isArray(p.modifiers) ? p.modifiers : [],
        said: p.said,
        variant: p.variant,
      };
    })
    .filter((p) => p.offerId);
}

/** Matchea la variante (color/talle) de un item contra las variantes reales
 *  del producto. Tolerante a género/acento ("negra"→negro). Solo productos con
 *  variantes; sin match → null (producto genérico, el server cobra precio base). */
function matchVariant(product, item) {
  if (!Array.isArray(product?.variants) || !product.variants.length) return null;
  const v = item?.variant || {};
  const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/[^a-z0-9]/g, "").trim();
  const color = norm(v.color);
  const talle = norm(v.talle);
  if (!color && !talle) return null;
  let found = null;
  if (color && talle) {
    found = product.variants.find((x) => norm(x.color) === color && norm(x.talle) === talle);
    if (!found) found = product.variants.find((x) => norm(x.color).includes(color) && norm(x.talle) === talle);
    if (!found) found = product.variants.find((x) => norm(x.color) === color && norm(x.talle).includes(talle));
  }
  if (!found && color) {
    found = product.variants.find((x) => norm(x.color) === color);
    if (!found) found = product.variants.find((x) => norm(x.color).includes(color) || color.includes(norm(x.color)));
  }
  if (!found && talle) {
    found = product.variants.find((x) => norm(x.talle) === talle);
  }
  return found?.id ? found : null;
}

function enrichParsed(products, parsed) {
  if (!parsed) return parsed;
  parsed.items = resolveOfferIds(products, parsed.items);
  return parsed;
}

// Teléfono real: el relay manda SenderAlt (el teléfono del emisor cuando el
// chat es LID — los no-contactos llegan como xxxxx@lid sin teléfono). Gana
// sobre el lid: del chat JID; si no hay, lid: como fallback.
function phoneFor(waId, waPhone) {
  const p = String(waPhone || "").replace(/[^\d]/g, "");
  if (p.length >= 6) return normalizePhone(p);
  return normalizePhone(waId);
}

/** ¿Este relay es el número central de Portal 659 (infraestructura del bot)?
 *  Identificación por slug del vendor (tolera renombres históricos). */
function isPortalVendor(vendor) {
  const slug = String(vendor?.slug || "").toLowerCase();
  return ["portal659-bot", "portal-central", "admin-portal659"].includes(slug);
}

export async function handleInbound({ vendor, waId, body, waPhone }) {
  // Modo portal SOLO para el relay del número central de Portal 659: se
  // identifica por slug del vendor (infraestructura del bot), NO por env
  // global — así el número de un comercio con su propio APK nunca cae en el
  // flujo multi-comercio y sigue el flujo por-comercio de siempre.
  if (isPortalVendor(vendor)) {
    return await handlePortalInbound({ vendor, waId, body, waPhone });
  }
  const text = String(body || "").trim();
  const state = (await getState(vendor.id, waId)) || { ...DEFAULT_STATE };
  if (!Array.isArray(state.history)) state.history = [];
  // El teléfono real del relay actualiza un lid: previo (el primer mensaje
  // puede no haberlo traído).
  const ph = phoneFor(waId, waPhone);
  if (!state.customerPhone || (String(state.customerPhone).startsWith("lid:") && !ph.startsWith("lid:"))) {
    state.customerPhone = ph;
  }
  const replies = [];

  try {
    if (!vendor.enabled) return { replies: [], handoff: true };

    // Arrays FRESCOS por conversación: el spread copia la REFERENCIA de los
    // arrays del DEFAULT_STATE → cualquier mergeItems escribía en el array
    // compartido y las conversaciones nuevas arrancaban con el carrito de otra.
    if (!state.items || !Array.isArray(state.items) || state.items === DEFAULT_STATE.items) state.items = [];
    if (!Array.isArray(state.history) || state.history === DEFAULT_STATE.history) state.history = [];

    // Hora de la última actividad del cliente: la usa el sweep de inactividad
    // (pregunta pendiente sin contestar → "va a ser atendido por una persona").
    state.touchedAt = Date.now();

    // Cancelación global (siempre disponible, incluso durante la pausa de
    // handoff — antes el check de pausa la bloqueaba y el bot callaba hasta
    // para cancelar).
    if (RE_CANCEL.test(text)) {
      state._cleared = true;
      await clearState(vendor.id, waId);
      return { replies: ["Ok, cancelé todo. Cuando quieras retomamos. 👍"] };
    }

    // Handoff explícito (disponible incluso durante la pausa).
    if (RE_HUMAN.test(text) || RE_AYUDA.test(text)) {
      return await handoffHuman(vendor, waId, text, state);
    }

// Pausa por handoff reciente: el dueño atiende, el bot calla. El aviso al
// cliente ("una persona te va a atender") sale UNA sola vez — en el handoff
// mismo — nunca acá: durante la pausa es silencio total.
if (state.pausedUntil && state.pausedUntil > Date.now()) {
  return { replies: [] };
}

    // Historial para el contexto del LLM (cap 8 mensajes).
    state.history.push({ role: "user", text: text.slice(0, 200) });
    if (state.history.length > 16) state.history = state.history.slice(-16);

    // Modo conserje (BOT_TAKE_ORDERS no está en "1"): saludar, compartir el
    // menú online, preguntar si hubo un problema para pedir (handoff a la
    // persona) y escuchar consultas/sugerencias — sin armar el pedido. El
    // flujo de pedidos queda intacto pero no se entra con esto.
    if (!config.takeOrders) {
      await handleConcierge({ vendor, text, state, replies, waId });
      return await persist(state, vendor.id, waId, replies);
    }

    // En flujo: completar lo que falta (o corregir).
    if (state.step !== "idle") {
      await handleStep({ vendor, text, state, replies, waId });
      return await persist(state, vendor.id, waId, replies);
    }

    // Idle: saludo / menú / pedido nuevo.
    await handleIdle({ vendor, text, state, replies, waId });
    return await persist(state, vendor.id, waId, replies);

  } catch (e) {
    console.error("[bot] error:", e?.message, "|", e?.stack?.split("\n")[1]);
    // Preservar el estado (mutations previas) antes de devolver el error.
    try { if (vendor?.id) await persist(state, vendor.id, waId, replies); } catch {}
    const msg = String(e?.message || "");
    // Errores de negocio del API de pedidos (mensajes ya amigables: comercio
    // cerrado, tope del plan, modificador inexistente, stock, pack) → mostrar
    // tal cual: "Uy, hubo un error" genérico hacía que el cliente no entienda
    // por qué su "sí" no confirmaba. El estado NO se limpia: puede corregir.
    if (msg && !/fetch|network|timeout|ENOTFOUND|ECONNREFUSED|EAI_AGAIN|etag/i.test(msg)) {
      const fixHint = state.step === "confirm"
        ? "\n\nEscribí qué querés cambiar del pedido, o *cancelar* y arrancamos de nuevo."
        : "";
      return { replies: [`${msg}${fixHint}`] };
    }
    // No limpiar el state: un error transitorio no debe resetear el pedido.
    return { replies: ["Uy, hubo un error. Mandame el mensaje de nuevo en un segundo. 🙏"] };
  }
}

// Contexto para la llamada IA: carrito actual + qué se le preguntó + historial.
function llmCtx(state, vendor) {
  return { cart: state.items, pending: missingFields(state, vendor), history: state.history, vendorId: vendor?.id || vendor?.vendorId || null };
}

// ———————————————————————————————————————————————————————————————————————————
// Preguntas ("empanadas tenés?") → respuesta con la lista, nunca pedido
// ———————————————————————————————————————————————————————————————————————————

/** Productos que el cliente pregunta, desde el texto de la pregunta.
 *  "empanadas tenés?" → [empanada de carne, empanada jamón y queso]. */
function matchesFromQuestion(text, products) {
  const t = String(text).replace(/\?/g, " ")
    .replace(/\b(tenés|tenes|tienen|hay|queda|quedan|cuánto|cuanto|cuánta|cuantas|sale|cuesta|cuestan|precio|precios|vale)\b/gi, " ")
    .replace(/\b(de|del|la|el|los|las|un|una|unos|unas)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return [];
  const direct = matchAllProducts(products, t);
  if (direct.length) return direct;
  const out = [];
  for (const w of t.split(" ")) {
    if (w.length < 3) continue;
    const m = matchAllProducts(products, w);
    for (const x of m) {
      if (!out.find((y) => y.id === x.id)) out.push(x);
    }
  }
  return out;
}

function answerText(products) {
  const lines = products.slice(0, 8).map((p) => `• ${p.name} — $${Number(p.price).toLocaleString("es-AR")}`);
  return `Sí, tenemos:\n${lines.join("\n")}\n\n¿Querés pedir alguna? Decime cuál y cuántas. 🥟`;
}

function noMatchText(products, vendor) {
  const lines = products.slice(0, 8).map((p) => `• ${p.name} — $${Number(p.price).toLocaleString("es-AR")}`);
  return `De eso no tengo por ahora. Esto es lo que hay:\n${lines.join("\n")}\n\n¿Algo de acá? 🥟`;
}

// ———————————————————————————————————————————————————————————————————————————
// Miss → clarificación con alternativas del menú (fallback tiered)
// ———————————————————————————————————————————————————————————————————————————

/** Sugerencias del menú por match parcial del texto ("quiero empanad"). */
function alternativesText(text, products) {
  const norm = normalizeEs(String(text));
  const words = [...new Set(norm.split(" ").filter((w) => w.length >= 4))].slice(0, 3);
  const out = [];
  for (const w of words) {
    const m = matchProduct(products, w);
    if (m && !out.find((x) => x.id === m.id)) out.push(m);
  }
  if (!out.length) return null;
  const lines = out.slice(0, 4).map((p) => `• ${p.name} — $${Number(p.price).toLocaleString("es-AR")}`);
  return `¿Quizás querés decir:\n${lines.join("\n")}\n\nDecime cuál y cuántas. 🙏`;
}

// ———————————————————————————————————————————————————————————————————————————
// Idle: primer contacto / pedido de una
// ———————————————————————————————————————————————————————————————————————————

async function handleIdle({ vendor, text, state, replies, waId }) {
  // `t` = texto recortado. El bloque pendingConfirm de acá abajo lo usa y NO
  // estaba definido en esta función → ReferenceError → el catch respondía
  // "Uy, hubo un error" EN LOOP: el cliente contestaba el "¿sí o no?" y el
  // bot se trababa para siempre (la causa del "no llego a hacer un pedido").
  const t = text.trim();
  // Saludo solo la PRIMERA vez (welcomed flag). Después se contesta con las
  // preguntas pendientes, nunca el mismo texto otra vez.
  if (!state.welcomed && RE_GREETING.test(text) && text.length < 40) {
    state.welcomed = true;
    replies.push(greetingText(vendor));
    return;
  }
  if (RE_GREETING.test(text) && text.length < 40 && state.welcomed) {
    state.welcomed = true;
    replies.push(shortReGreet(state, vendor));
    return;
  }

  // Menú pedido → link.
  if (RE_MENU.test(text)) {
    state.welcomed = true;
    replies.push(`📋 Menú online con fotos y precios:\n${shopUrl(vendor)}\n\n¿Qué vas a pedir? Escribilo acá y te lo confirmo.`);
    return;
  }

  // Pedido: IA primero, reglas después.
  const products = await getMenu(vendor.id);

  // Confirmaci?n de baja confianza pendiente.
  if (state.pendingConfirm) {
    const pc = state.pendingConfirm;
    if (/^(s[i\u00ed]|si|yes|ok|dale|confirmo|claro)\b/i.test(t)) {
      const items = pc.items || [];
      if (items.length) {
        mergeItems(state, items.map((p) => ({ offerId: p.offerId || p.id, variantId: p.variantId, name: p.name, qty: Math.max(1, Number(p.qty) || 1), modifiers: p.modifiers || [] })));
        applyContactFields(state, pc.parsed || {});
      }
      state.pendingConfirm = null;
      state.handoffCount = 0;
      if (maybeAskRequiredMods(state, products, replies)) return;
      advanceAndAsk(state, vendor, replies);
      return;
    }
    if (/^(no|nop|cancelar)\b/i.test(t)) {
      state.pendingConfirm = null;
      replies.push("Ok, descartado. Mandame tu pedido de nuevo.");
      return;
    }
    // cualquier otra cosa: limpiar y procesar como nuevo pedido
    state.pendingConfirm = null;
  }


  // Pregunta ("empanadas tenés?", "cuánto sale la pizza?") → RESPONDER con la
  // lista, nunca ordenar (antes el match se trataba como pedido y agregaba a
  // ciegas).
  if (isQuestion(text)) {
    const matches = matchesFromQuestion(text, products);
    replies.push(matches.length ? answerText(matches) : noMatchText(products, vendor));
    return;
  }

  let _parsed = (await parseWithLlm(text, products, llmCtx(state, vendor)).catch(() => null)) || parseByRules(text, products);
  // Telemetría (Fase 3): de dónde salió el parseo.
  if (_parsed?.__llm) llmStats.parses.llm++; else if (_parsed) llmStats.parses.rules++;
  // Baja confianza del LLM -> pedir confirmación antes de armar el pedido.
  if (_parsed && typeof _parsed.confidence === "number" && _parsed.confidence < 0.5 && Array.isArray(_parsed.items) && _parsed.items.length) {
    llmStats.parses.lowConfidence++;
    state.pendingConfirm = { items: _parsed.items, parsed: _parsed };
    state.welcomed = true;
    const resumen = _parsed.items.map((p) => `${p.qty || 1}× ${p.name}`).join(", ");
    replies.push(`No estoy seguro de haber entendido bien: ¿es ${resumen}? (respondé *sí* o *no*)`);
    return await persist(state, vendor.id, waId, replies);
  }
  let parsed = enrichParsed(products, _parsed);

  if (parsed?.items?.length) {
    state.welcomed = true;
    // Desambiguación: mención genérica → preguntar cuál/cuántas antes de agregar.
    // Con 1 solo candidato → attach inmediato. Los campos se aplican igual.
    const isAddition0 = /\b(agrega|agregá|agregar|también|tambien|sumá|suma|sumar|más|mas)(?=[\s.,!¡]|$)/i.test(text);
    const shouldMerge0 = isAddition0 && state.items.length > 0;
    const amb = ambiguousItems(products, parsed.items);
    if (amb.length) {
      const pp = amb[0];
      const exactItems = parsed.items.filter((p) => !amb.includes(p));
      const soloAmbiguo = exactItems.length === 0;
      if (exactItems.length) applyExactItems(state, exactItems, shouldMerge0);
      applyContactFields(state, parsed);
      const options = matchAllProducts(products, bareName(pp.said) || pp.said);
      if (options.length === 1) {
        attachChosen(state, options[0], pp.qty, soloAmbiguo && !shouldMerge0, pp);
        state.handoffCount = 0;
        if (maybeAskRequiredMods(state, products, replies)) return;
        advanceAndAsk(state, vendor, replies);
        return;
      }
      state.pendingProduct = { label: pp.said, options, qty: Number(pp.qty) || 1, fromRedeclare: soloAmbiguo && !shouldMerge0 };
      state.step = "flow";
      state.pendingFields = missingFields(state, vendor);
      const extra = state.pendingFields.length ? "\n\n" + pendingQuestions(state) : "";
      replies.push(pendingProductAsk(state) + extra);
      return;
    }
    const isAddition = /\b(agrega|agregar|tambi\u00e9n|tambien|suma|sumar|m\u00e1s|mas)(?=[\s.,!]|$)/i.test(text);
    if (isAddition && state.items.length > 0) {
      mergeItems(state, (parsed.items || []).map((p) => ({
        offerId: p.offerId || p.id,
        variantId: p.variantId,
        name: p.name,
        qty: Math.max(1, Number(p.qty) || 1),
        modifiers: p.modifiers || [],
      })));
      applyContactFields(state, parsed);
    } else {
      applyParsed(state, parsed, waId);
    }
    // Opciones requeridas (gustos): preguntar antes de seguir con el resto.
    if (maybeAskRequiredMods(state, products, replies)) return;
    advanceAndAsk(state, vendor, replies);
    return;
  }

  // Nada entendido: contar miss; a los 2 → handoff.
  state.handoffCount = (state.handoffCount || 0) + 1;
  if (state.handoffCount >= MAX_PARSE_MISSES) {
    return handoffHuman(vendor, waId, text, state);
  }
  const alts = alternativesText(text, products);
  replies.push(`No te entendí bien. Escribime el pedido directo, ej: *"2 empanadas de carne y una coca"*. O mirá el menú: ${shopUrl(vendor)}` + (alts ? "\n\n" + alts : ""));
}

// ———————————————————————————————————————————————————————————————————————————
// Edición del carrito en confirmación: "sacá la coca", "poné 3 empanadas",
// "cambiá 2 por 3 empanadas". Devuelve true si manejó el texto.
// ———————————————————————————————————————————————————————————————————————————
function applyCartEdit(state, text) {
  const t = String(text || "").trim().toLowerCase();
  if (!state.items || state.items.length === 0) return false;

  // 1) Remoción: "sacá/quita/elimina/borra X"
  const removeMatch = t.match(/^(sac[aá]|quit[aá]|elimina|elimin[aá]|borr[aá]|saca|quita|elimina|borra)\s+(.+)$/i);
  if (removeMatch) {
    const search = removeMatch[2].trim();
    const idx = findCartItemIndex(state.items, search);
    if (idx === -1) {
      return { handled: true, msg: `No encontré "${search}" en tu pedido. Tu pedido tiene: ${state.items.map((i) => i.name).join(", ")}.` };
    }
    const removed = state.items.splice(idx, 1)[0];
    return { handled: true, msg: `Listo, saqué ${removed.name} del pedido.` };
  }

  // 2) Cambio de cantidad: "poné 3 empanadas" / "poné 3 de empanadas" /
  //    "cambiá empanadas a 3" / "cambiá 2 por 3 empanadas" / "empanadas a 3"
  let qtyMatch = t.match(/^(pon[eé]|cambi[aá]|modific[aá]|ajust[aá])\s+(\d+)\s+(?:de\s+)?(.+)$/i);
  if (qtyMatch) {
    const newQty = Number(qtyMatch[2]);
    const search = qtyMatch[3].trim();
    const idx = findCartItemIndex(state.items, search);
    if (idx === -1) {
      return { handled: true, msg: `No encontré "${search}" en tu pedido. Tu pedido tiene: ${state.items.map((i) => i.name).join(", ")}.` };
    }
    if (newQty <= 0) {
      const removed = state.items.splice(idx, 1)[0];
      return { handled: true, msg: `Listo, saqué ${removed.name} del pedido.` };
    }
    state.items[idx].qty = newQty;
    return { handled: true, msg: `Listo, cambié ${state.items[idx].name} a ${newQty}.` };
  }
  qtyMatch = t.match(/^(pon[eé]|cambi[aá])\s+(.+?)\s+(?:a|por)\s+(\d+)$/i);
  if (qtyMatch) {
    const search = qtyMatch[2].trim();
    const newQty = Number(qtyMatch[3]);
    const idx = findCartItemIndex(state.items, search);
    if (idx === -1) {
      return { handled: true, msg: `No encontré "${search}" en tu pedido. Tu pedido tiene: ${state.items.map((i) => i.name).join(", ")}.` };
    }
    if (newQty <= 0) {
      const removed = state.items.splice(idx, 1)[0];
      return { handled: true, msg: `Listo, saqué ${removed.name} del pedido.` };
    }
    state.items[idx].qty = newQty;
    return { handled: true, msg: `Listo, cambié ${state.items[idx].name} a ${newQty}.` };
  }

  return false;
}

/** Busca el índice de un item del carrito por nombre (fuzzy). */
function findCartItemIndex(items, search) {
  const s = normalizeForMatch(search);
  if (!s) return -1;
  // Match exacto primero (normalizado con stem).
  let idx = items.findIndex((i) => normalizeForMatch(i.name) === s);
  if (idx !== -1) return idx;
  // Contenido: el nombre contiene el search (o viceversa).
  idx = items.findIndex((i) => {
    const n = normalizeForMatch(i.name);
    return n.includes(s) || s.includes(n);
  });
  if (idx !== -1) return idx;
  // Fuzzy: alguna palabra del search está en el nombre.
  const words = s.split(/\s+/).filter((w) => w.length >= 3);
  idx = items.findIndex((i) => {
    const n = normalizeForMatch(i.name);
    return words.some((w) => n.split(/\s+/).some((nw) => nw === w || nw.includes(w) || w.includes(nw)));
  });
  return idx;
}

// ———————————————————————————————————————————————————————————————————————————
// En flujo: respuesta del cliente completa o corrige el pedido
// ———————————————————————————————————————————————————————————————————————————

async function handleStep({ vendor, text, state, replies, waId }) {
  let t = text.trim();

  // En confirm: "sí" crea; "no" cancela; edición del carrito (sacar/cambiar
  // cantidad) se aplica sin reiniciar el pedido; el resto = corrección.
  if (state.step === "confirm") {
    // Edición del carrito: "sacá la coca", "poné 3 empanadas", etc.
    const edit = applyCartEdit(state, t);
    if (edit) {
      if (state.items.length === 0) {
        replies.push("Tu pedido quedó vacío. Mandame tu pedido de nuevo, o escribí *cancelar*.");
        state.step = "idle";
        return;
      }
      replies.push(edit.msg);
      replies.push(summaryText(state, vendor));
      replies.push("¿Confirmás? 1️⃣ Sí  2️⃣ No  3️⃣ Modificar");
      return;
    }
    // Opciones numeradas: 1=Sí, 2=No, 3=Modificar
    if (/^(1|1️⃣)$/.test(t)) t = "sí";
    if (/^(2|2️⃣)$/.test(t)) t = "no";
    if (/^(3|3️⃣)$/.test(t)) {
      replies.push("¿Qué querés modificar? (ej: \"sacá la coca\", \"poné 3 empanadas\", o *cancelar* para empezar de nuevo)");
      return;
    }
    if (RE_CONFIRM.test(t)) {
      let order;
      try {
        order = await createOrder(vendor.id, state);
      } catch (e) {
        const msg = String(e?.message || "");
        // Manejo amigable: si el comercio está cerrado o sin stock, sugerir
        // alternativas (solo en el bot del portal, que tiene visión multi-tienda).
        const isPortal = Array.isArray(state.portalVendorList) || state.portalVendorList !== undefined;
        if (isPortal && /cerrad/i.test(msg)) {
          replies.push(`${msg}`);
          try {
            const portalData = await fetchPortalMenu("");
            const openStores = (portalData.vendors || portalData.stores || [])
              .filter((s) => s.store_open === true && s.id !== vendor.id)
              .slice(0, 4);
            if (openStores.length > 0) {
              replies.push("Pero estas tiendas están abiertas ahora:");
              replies.push(openStores.map((s, i) => `${i + 1}) *${s.store_name}*`).join("\\n"));
              replies.push("¿Querés pedir de alguna? Escribí el nombre o el número.");
            } else {
              replies.push("No hay otras tiendas abiertas en la zona ahora. Escribí *comercios* para ver todas.");
            }
          } catch { /* best-effort */ }
          return await persist(state, vendor.id, waId, replies);
        }
        if (/stock|agotado|sin stock/i.test(msg)) {
          replies.push(`${msg}`);
          replies.push("¿Querés cambiar ese producto por otro? Mandame tu pedido corregido. 🙏");
          return await persist(state, vendor.id, waId, replies);
        }
        // Otros errores: mostrar tal cual (comportamiento existente).
        throw e;
      }
      // Aprendizaje: guardamos el pedido exitoso como ejemplo para futuras correcciones.
      // Aprendizaje: guardamos el pedido exitoso como ejemplo para futuras correcciones.
      try {
        const lastUser = (state.history || []).filter((h) => h.role === "user").slice(-1)[0]?.text || "";
        await saveCorrection(vendor.id, {
          customerMsg: lastUser,
          corrected: {
            items: state.items.map((i) => ({ name: i.name, qty: i.qty, modifiers: i.modifiers || [] })),
            method: state.method,
            payment: state.payment,
            customerName: state.customerName,
            customerAddress: state.customerAddress,
          },
          outcome: "success",
        });
      } catch {}
      if (state.payment === "transferencia") {
        state.step = "awaiting_receipt";
        state.orderId = order.orderId || order.id;
        replies.push("✅ Pedido confirmado. Quedó pendiente de pago.");
        replies.push(transferText(vendor, order.total));
        if (order.trackToken) {
          replies.push(`📦 Seguí tu pedido acá: ${trackUrl(order.trackToken)}`);
        }
        replies.push("Mandame el comprobante (foto o PDF) por acá. Después de verificarlo, te confirmo. 🙌");
      } else {
        replies.push("✅ ¡Pedido confirmado! Te avisamos por acá cuando esté listo.");
        if (order.trackToken) {
          replies.push(`📦 Seguí tu pedido acá: ${trackUrl(order.trackToken)}`);
        }
        state._cleared = true;
        await clearState(vendor.id, waId);
        // Upselling: sugerir productos complementarios de la misma tienda.
        try {
          const products = await getMenu(vendor.id);
          const orderedNames = (state.items || []).map((i) => String(i.name || "").toLowerCase());
          const hasDrink = orderedNames.some((n) => /coca|sprite|gaseosa|agua|jugo|cerveza|vino|bebida/.test(n));
          const hasFood = orderedNames.some((n) => /empanada|pizza|milanesa|hamburguesa|sandwich|tarta|pasta/.test(n));
          if (hasFood && !hasDrink && products.length > 0) {
            const drinks = products.filter((p) => /bebida|gaseosa|coca|sprite|agua|jugo|cerveza/i.test(String(p.category || "") + " " + String(p.name || ""))).slice(0, 3);
            if (drinks.length > 0) {
              replies.push(`💡 Los que piden ${orderedNames[0]} suelen agregar: ${drinks.map((d) => `${d.name} ($${d.price})`).join(", ")}.`);
            }
          }
        } catch { /* best-effort */ }
        // El canal queda abierto: el cliente puede pedir de otra tienda.
        replies.push("¿Querés pedir de otra tienda? Mandame el nombre del producto o escribí *comercios*. 🛒");
      }
      return;
    }
    if (RE_NO.test(t)) {
      state._cleared = true;
      await clearState(vendor.id, waId);
      replies.push("Dale, lo cancelamos. Cuando quieras retomamos. 👍");
      return;
    }
// Corrección: el cliente pide cambiar algo → re-parsear y actualizar el resumen.
    // También se aplican cambios de método/dirección/nombre/pago (antes solo
    // re-parseaba items: "mejor lo retiro" o "ahora efectivo" en el confirm
    // se ignoraban con el mensaje genérico).
    const products = await getMenu(vendor.id);
    const parsed = enrichParsed(
      products,
      (await parseWithLlm(t, products, llmCtx(state, vendor)).catch(() => null)) || parseByRules(t, products)
    );
    let changed = false;
    if (parsed?.method && parsed.method !== state.method) { state.method = parsed.method; changed = true; }
    if (parsed?.customerAddress && parsed.customerAddress !== state.customerAddress) { state.customerAddress = parsed.customerAddress; changed = true; }
    if (parsed?.customerName && parsed.customerName !== state.customerName) { state.customerName = parsed.customerName; changed = true; }
    if (parsed?.payment && parsed.payment !== state.payment) { state.payment = parsed.payment; changed = true; }
    if (parsed?.items?.length) {
      const isAddition = /\b(agrega|agregar|tambi\u00e9n|tambien|suma|sumar|m\u00e1s|mas)(?=[\s.,!]|$)/i.test(t);
      if (isAddition && state.items.length > 0) {
        mergeItems(state, (parsed.items || []).map((p) => ({
          offerId: p.offerId || p.id,
          variantId: p.variantId,
          name: p.name,
          qty: Math.max(1, Number(p.qty) || 1),
          modifiers: p.modifiers || [],
        })));
      } else {
        applyParsed(state, parsed, waId);
      }
      changed = true;
    }
    if (changed) {
      if (maybeAskRequiredMods(state, products, replies)) return;
      advanceAndAsk(state, vendor, replies);
      return;
    }
    replies.push(`Para cambiar el pedido escribime qué querés (ej: *"cambia la coca por una sprite"*). O contestame *sí* para confirmar.`);
    return;
  }

  // En awaiting_receipt: solo esperamos el comprobante.
  if (state.step === "awaiting_receipt") {
    replies.push("Estoy esperando tu comprobante (foto o PDF). Si cambiás de idea, escribime *cancelar*.");
    return;
  }

  // Pasos method/address/name/payment: el mensaje puede traer TODO junto
  // ("envío a calle 5 123, Juan Pérez, transferencia"). Extraemos todo lo que falte.
  const products = await getMenu(vendor.id);

  // Pendiente: producto genérico a desambiguar ("quiero empanadas" → ¿cuál y cuántas?).
  if (state.pendingProduct) {
    const pp = state.pendingProduct;
    let chosen = null;
    let chosenQty = 1;
    let resolutionItem = null;
    // Número solo: con 1 opción es la CANTIDAD; con varias, cuál (por índice).
    const numOnly = /^(\d+)\s*$/.exec(t);
    if (numOnly) {
      const n = Number(numOnly[1]);
      if (pp.options.length === 1) {
        chosen = pp.options[0];
        chosenQty = n;
      } else if (n >= 1 && n <= pp.options.length) {
        chosen = pp.options[n - 1];
        // Sin qty propia del mensaje → la cantidad pendiente del pedido original
        // ("solo 3 empanadas" → "1" → carne ×3).
        chosenQty = Number(pp.qty) || 1;
      }
    }
    // Nombre (+ qty): "3 de carne", "2 jamón", "carne".
    if (!chosen) {
      const found = extractFromText(t, pp.options);
      if (found.length) {
        chosen = pp.options.find((o) => o.id === found[0].offerId);
        // La qty del mensaje gana; si no tenía, la pendiente ("carne" tras
        // "solo 3 empanadas" → ×3).
        chosenQty = found[0].qty > 1 ? found[0].qty : (Number(pp.qty) || 1);
        resolutionItem = found[0];
      } else {
        const m = matchProduct(pp.options, t);
        if (m) { chosen = m; chosenQty = Number(pp.qty) || 1; }
      }
    }
    if (!chosen) {
      state.handoffCount = (state.handoffCount || 0) + 1;
      if (state.handoffCount >= MAX_PARSE_MISSES) {
        state.pendingProduct = null;
        return handoffHuman(vendor, waId, text, state);
      }
      replies.push(pendingProductAsk(state));
      return;
    }
    // Attach: si el producto ya está en el carrito → SET (corrigió la cantidad);
    // si es re-declaración ("solo") → reemplaza todo; si no → agrega.
    // La variante del mensaje (si el cliente la aclaró acá) se resuelve igual.
    attachChosen(state, chosen, chosenQty, !!pp.fromRedeclare, resolutionItem);
    state.pendingProduct = null;
    state.handoffCount = 0;
    if (maybeAskRequiredMods(state, products, replies)) return;
    advanceAndAsk(state, vendor, replies);
    return;
  }

  // Pendiente: opciones requeridas de un producto (ej. gustos del helado).
  // El mensaje entero son las opciones → matchear contra las del grupo y adjuntarlas.
  if (state.pendingMods) {
    const pm = state.pendingMods;
    const item = state.items.find((i) => String(i.offerId) === String(pm.offerId));
    const matched = [];
    // Tokenizar y normalizar: maneja plurales, tildes y opciones con par�ntesis/descripci�n.
    const optTokens = (o) => normLabel(o).split(" ").filter(Boolean).map((w) => w.replace(/(es|s)$/i, ""));
    for (const s of splitLabels(t)) {
      const ns = normLabel(s);
      if (!ns) continue;
      const nTokens = ns.split(" ").filter(Boolean).map((w) => w.replace(/(es|s)$/i, ""));
      // 1) match exacto / contenci�n directa
      let opt = pm.options.find((o) => {
        const no = normLabel(o);
        return no === ns || no.includes(ns) || ns.includes(no);
      });
      // 2) match por token (cualquier palabra coincide, con stem)
      if (!opt) {
        opt = pm.options.find((o) => {
          const ot = optTokens(o);
          return nTokens.some((nt) => ot.some((otk) => otk === nt || otk.includes(nt) || nt.includes(otk)));
        });
      }
      // 3) si la opci�n tiene par�ntesis/descripci�n, probar el primer token
      if (!opt) {
        opt = pm.options.find((o) => {
          const first = normLabel(o).split(" ")[0];
          return first && nTokens.some((nt) => first === nt || first.includes(nt) || nt.includes(first));
        });
      }
      if (opt && !matched.includes(opt)) matched.push(opt);
    }
    if (matched.length) {
      if (matched.length > pm.max) {
        replies.push(`Elegí hasta ${pm.max} ${pm.group.toLowerCase()} (mandaste ${matched.length}). Mandá solo ${pm.max}.`);
        return await persist(state, vendor.id, waId, replies);
      }
      if (item) {
        const others = (item.modifiers || []).filter((m) => {
          const label = typeof m === "string" ? m : m?.label;
          if (!label) return false;
          return !pm.options.some((o) => normLabel(o) === normLabel(label));
        });
        item.modifiers = [...others, ...matched.slice(0, pm.max)];
      }
      state.pendingMods = null;
      state.handoffCount = 0;
      advanceAndAsk(state, vendor, replies);
      return;
    }
    // Fallback: si el texto es corto y no es comando, adjuntarlo crudo como
    // modificador para no trabar el pedido (la cocina lo lee tal cual).
    const low = t.toLowerCase();
    const isCmd = /^(cancelar|ayuda|menu|menú|comercios|hola|chau|ok|si|no)$/i.test(low);
    if (!isCmd && t.length > 0 && t.length <= 60) {
      if (item) {
        const others = (item.modifiers || []).filter((m) => {
          const label = typeof m === "string" ? m : m?.label;
          if (!label) return false;
          return !pm.options.some((o) => normLabel(o) === normLabel(label));
        });
        item.modifiers = [...others, t];
      }
      state.pendingMods = null;
      state.handoffCount = 0;
      advanceAndAsk(state, vendor, replies);
      return;
    }
    // No matche� ninguna opci�n: repetir la pregunta con la lista completa.
    state.handoffCount = (state.handoffCount || 0) + 1;
    if (state.handoffCount >= MAX_PARSE_MISSES) {
      state.pendingMods = null;
      return handoffHuman(vendor, waId, text, state);
    }
    const lista = pm.options.join(", ");
    replies.push(`No entendí qué ${pm.group.toLowerCase()} querés. Opciones: ${lista}. Escribí las que querés (ej: "${pm.options.slice(0, 2).join(" y ")}").`);
    return;
  }

  // Pregunta mid-flow ("tenés coca?") → responder con la lista; el flujo sigue
  // intacto (el carrito y las preguntas pendientes quedan).
  if (isQuestion(t)) {
    const matches = matchesFromQuestion(t, products);
    const answer = matches.length ? answerText(matches) : noMatchText(products, vendor);
    replies.push(answer + "\n\n" + pendingQuestions(state));
    return;
  }

  const parsed = enrichParsed(
    products,
    (await parseWithLlm(t, products, llmCtx(state, vendor)).catch(() => null)) || parseByRules(t, products)
  );

  let got = false;
  // Se actualizan SIEMPRE (no solo si falta): el cliente puede cambiar de idea
  // en medio del flujo ("mejor retiro" tras decir "envío", "mejor efectivo"…).
  // Un valor re-afirmado (ej. "retiro" cuando ya era retiro) cuenta como progreso:
  // evita handoff prematuro por repetir una confirmación.
  if (parsed?.method) { state.method = parsed.method; got = true; }
  if (parsed?.customerAddress) { state.customerAddress = parsed.customerAddress; got = true; }
  if (parsed?.customerName) { state.customerName = parsed.customerName; got = true; }
  if (parsed?.payment) { state.payment = parsed.payment; got = true; }

  // Productos en la respuesta: distinguir AGREGAR de RE-DECLARAR.
  //  - Verbos de suma ("agregá/también/más") y el parseo NO devolvió el
  //    carrito completo → se SUMAN los items nuevos.
  //  - El parseo devolvió el carrito completo (todos los items actuales
  //    presentes) → REEMPLAZA (es el pedido actualizado; antes siempre sumaba:
  //    repetir el pedido lo duplicaba ×4).
  //  - Sin verbos de suma → reemplaza igual (mensaje = pedido actualizado).
  // (lookahead en vez de \b: "agregá/también/sumá" terminan en vocal acentuada,
  //  que JS NO trata como word-char — con \b el match fallaba y "agregá otra
  //  coca" no sumaba).
  if (parsed?.items?.length) {
    got = true;
    // (la versión anterior tenía los acentos como bytes rotos: "agregǭ/mǭs"
    //  no matcheaba NADA → "agregá una coca" REEMPLAZABA el carrito entero
    //  en vez de sumarlo — pedidos que se perdían a mitad de flujo)
    const isAddition = /\b(agrega|agregá|agregar|también|tambien|sumá|suma|sumar|más|mas)(?=[\s.,!¡]|$)/i.test(t);
    const fullCart =
      state.items.length > 0 &&
      state.items.every((i) => parsed.items.some((p) => (p.offerId || p.id) === i.offerId));
    const shouldMerge = isAddition && !fullCart;

        // Desambiguación (patrón PRODUCTNO): mención genérica ("empanadas" ≠
        // "Empanada de carne") → preguntar cuál/cuántas ANTES de agregar a ciegas.
    // Con 1 SOLO candidato no hay ambigüedad de cuál → attach inmediato
    // ("quiero 1 coca" → Coca-Cola ×1, sin pregunta innecesaria).
    // Los items EXACTOS del mismo mensaje se agregan igual (no se pierden) y
    // los campos (método/pago/dirección/nombre) también se aplican.
    const amb = ambiguousItems(products, parsed.items);
    if (amb.length) {
      const pp = amb[0];
      const exactItems = parsed.items.filter((p) => !amb.includes(p));
      const soloAmbiguo = exactItems.length === 0;
      if (exactItems.length) applyExactItems(state, exactItems, shouldMerge);
      applyContactFields(state, parsed);
      const options = matchAllProducts(products, bareName(pp.said) || pp.said);
      if (options.length === 1) {
        attachChosen(state, options[0], pp.qty, soloAmbiguo && !shouldMerge, pp);
        state.handoffCount = 0;
        if (maybeAskRequiredMods(state, products, replies)) return;
        advanceAndAsk(state, vendor, replies);
        return;
      }
      state.pendingProduct = { label: pp.said, options, qty: Number(pp.qty) || 1, fromRedeclare: soloAmbiguo && !shouldMerge };
      state.step = "flow";
      state.pendingFields = missingFields(state, vendor);
      const extra = state.pendingFields.length ? "\n\n" + pendingQuestions(state) : "";
      replies.push(pendingProductAsk(state) + extra);
      return;
    }

    if (shouldMerge) {
      mergeItems(state, parsed.items);
    } else {
      state.items = parsed.items.map((p) => ({
        offerId: p.offerId || p.id,
        name: p.name,
        qty: Math.max(1, Number(p.qty) || 1),
        modifiers: p.modifiers || [],
      }));
    }
    got = true;
  }

  const fieldsNow = missingFields(state, vendor);
  const RESPUESTAS_FLUJO = /^(sí|si|no|dale|ok|okey|bueno|perfecto|cancelar|no gracias|basta|listo|confirmo|confirmar|hola|buenas|hi|hey|buen)(?=[\s.,!¡]|$)/i;

  // Saludo en medio del flujo: responder con las preguntas pendientes, sin contar miss.
  if (!got && RE_GREETING.test(t) && t.length < 40) {
    replies.push(pendingQuestions(state));
    return;
  }

  // "sí" en medio del flujo: si ya está todo completo, saltar a confirmar.
  // (Si falta algo, se vuelven a preguntar las mismas — el "sí" NO debe
  //  tratarse como nombre: antes la heurística lo capturaba y confirmaba
  //  con "Nombre: sí".)
  if (!got && RE_CONFIRM.test(t)) {
    const still = missingFields(state, vendor);
    if (still.length === 0) {
      state.step = "confirm";
      replies.push(summaryText(state, vendor));
      return;
    }
    replies.push(pendingQuestions(state));
    return;
  }

  // "no" en medio del flujo = cancela.
  if (!got && RE_NO.test(t)) {
    state._cleared = true;
    await clearState(vendor.id, waId);
    replies.push("Dale, lo cancelamos. Cuando quieras retomamos. 👍");
    return;
  }

  // ——— Heurísticas de reglas (el LLM gratis suele estar caído/429) ———
  // 1) Nombre: cuando falta, el texto es corto, sin dígitos (una dirección las
  //    tiene) y no es una consigna propia del flujo → tomarlo como nombre.
  if (!got && fieldsNow.includes("name") && t.length < 40 && !/\d/.test(t) && !RESPUESTAS_FLUJO.test(t) && !RE_MENU.test(t)) {
    state.customerName = t;
    got = true;
  }
  // 2) Dirección: cuando falta, con dígitos o prefijo de calle y no hay items
  //    ni otra cosa consumida → tomarla como dirección.
  if (!got && fieldsNow.includes("address") && t.length >= 4 && !RESPUESTAS_FLUJO.test(t) && !RE_MENU.test(t)) {
    state.customerAddress = t;
    got = true;
  }

  if (got) {
    state.handoffCount = 0;
    // Opciones requeridas: si el item agregado exige opciones, preguntarlas ya.
    if (maybeAskRequiredMods(state, products, replies)) return;
    advanceAndAsk(state, vendor, replies);
    return;
  }

  // No entendió la respuesta: repetir las preguntas pendientes (combinadas).
  state.handoffCount = (state.handoffCount || 0) + 1;
  if (state.handoffCount >= MAX_PARSE_MISSES) {
    return handoffHuman(vendor, waId, text, state);
  }
  const alts = alternativesText(t, products);
  replies.push(pendingQuestions(state) + "\n\nNo entendí eso — respondé lo que te pregunto arriba. 🙏" + (alts ? "\n\n" + alts : ""));
}

// ———————————————————————————————————————————————————————————————————————————
// Preguntas combinadas: UN solo mensaje con TODO lo que falta
// ———————————————————————————————————————————————————————————————————————————

function advanceAndAsk(state, vendor, replies) {
  const missing = missingFields(state, vendor);

  if (missing.length === 0) {
    // Todo completo: resumen (con total estimado) + confirmación.
    state.step = "confirm";
    console.log(`[bot] transición → confirm (items=${state.items.length}, vendor=${vendor?.store_name || vendor?.id || "?"})`);
    replies.push(summaryText(state, vendor));
    return;
  }

  state.step = "flow";
  state.pendingFields = missing;
  replies.push(pendingQuestions(state));
}

function missingFields(state, vendor) {
  const out = [];
  // Si el comercio solo acepta un método de entrega, no preguntar.
  const deliveryOpts = vendor?.delivery_options || "ambos";
  if (!state.method) {
    if (deliveryOpts === "retiro") state.method = "pickup";
    else if (deliveryOpts === "domicilio") state.method = "delivery";
    else out.push("method");
  }
  if (state.method === "delivery" && !state.customerAddress) out.push("address");
  if (!state.customerName) out.push("name");
  if (!state.payment && acceptsTransfer(vendor)) out.push("payment");
  return out;
}

function pendingQuestions(state) {
  const fields = state.pendingFields || missingFields(state);
  const lines = [];
  if (fields.includes("method")) lines.push("1️⃣ ¿Lo *retirás* por el local o te lo *enviamos* a domicilio?");
  if (fields.includes("address")) lines.push("📍 ¿A qué dirección te lo llevamos?");
  if (fields.includes("name")) lines.push("👤 ¿A nombre de quién va el pedido?");
  if (fields.includes("payment")) lines.push("💳 ¿Pagás en *efectivo* o por *transferencia*?");
  const cart = state.items.length
    ? `Tu pedido:\n${state.items.map((i) => `• ${itemDisplay(i)}`).join("\n")}\n\n`
    : "";
  const questions = lines.length ? `${lines.join("\n")}\n\n` : "";
  return `${cart}${questions}Respondé todo junto en un mensaje (ej: *"envío a calle 5 123, Juan, transferencia"*), o de a una cosa. 👇`;
}

function itemDisplay(i) {
  const mods = (i.modifiers || []).map((m) => (typeof m === "string" ? m : m?.label)).filter(Boolean);
  return `${i.name} ×${i.qty}${mods.length ? ` (${mods.join(", ")})` : ""}`;
}

// ———————————————————————————————————————————————————————————————————————————
// Opciones requeridas (ej. gustos del helado: el producto exige el grupo)
// ———————————————————————————————————————————————————————————————————————————

const normLabel = (s) =>
  String(s || "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim();

const splitLabels = (t) =>
  String(t).split(/[,\n;]| e | y |\s*\+\s*/i).map((s) => s.trim()).filter(Boolean);

/** Items del parseo que son GENÉRICOS/PARCIALES: lo que el cliente escribió
 *  no coincide con el nombre completo del producto ("empanadas" ≠ "Empanada
 *  de carne"). Antes se agregaba a ciegas el primer match. */
function ambiguousItems(products, items) {
  if (!Array.isArray(items)) return [];
  return items.filter((p) => {
    const prod = products.find((x) => String(x.id) === String(p.offerId || p.id));
    if (!prod) return false;
    const said = normalizeForMatch(p.said || p.name || "");
    const fullName = normalizeForMatch(prod.name);
    return !!said && said !== fullName;
  });
}

// Attach del producto elegido: si ya está en el carrito → SET (corrigió la
// cantidad); si es re-declaración ("solo") → reemplaza todo; si no → agrega.
// La variante (color/talle) del mensaje se resuelve contra las variantes reales.
function attachChosen(state, chosen, qty, fromRedeclare, origItem) {
  const q = Math.max(1, Number(qty) || 1);
  const variant = origItem ? matchVariant(chosen, origItem) : null;
  const vid = variant?.id || null;
  if (fromRedeclare) {
    state.items = [{ offerId: chosen.id, variantId: vid, name: chosen.name, qty: q, modifiers: [] }];
    return;
  }
  const inCart = state.items.find((i) => i.offerId === chosen.id && (i.variantId || null) === vid);
  if (inCart) inCart.qty = q;
  else mergeItems(state, [{ offerId: chosen.id, variantId: vid, name: chosen.name, qty: q, modifiers: [] }]);
}

// Items EXACTOS de un mensaje mixto (exacto + genérico): se agregan igual,
// no se pierden por el attach inmediato del item ambiguo.
function applyExactItems(state, items, shouldMerge) {
  if (shouldMerge) mergeItems(state, items);
  else state.items = items.map((p) => ({
    offerId: p.offerId || p.id,
    variantId: p.variantId,
    name: p.name,
    qty: Math.max(1, Number(p.qty) || 1),
    modifiers: p.modifiers || [],
  }));
}

function pendingProductAsk(state) {
  const pp = state.pendingProduct;
  const label = pp.label || "esto";
  if (pp.options.length === 1) {
    return `🥟 ${pp.options[0].name} — ¿cuánt${pp.qty > 1 ? "as" : "a"} querés? (ej: *"3"*)`;
  }
  const lines = pp.options.map((p, i) => `${i + 1}️⃣ ${p.name}`).join("\n");
  const qtyPart = pp.qty > 1 ? `\n(Elegiste ${pp.qty} — decime de cuál)` : "";
  return `🥟 ${label} — ¿cuántas querés y de cuál?\n${lines}${qtyPart}\n\nRespondé todo junto (ej: *"2 carne"* o *"3 de jamón y queso"*).`;
}

/** Si algún item del carrito tiene producto con grupo requerido y el cliente
 *  no dijo opciones para ese grupo → pregunta (numeradas) y devuelve true.
 *  El state queda con pendingMods; la próxima respuesta se adjunta al item. */
function maybeAskRequiredMods(state, products, replies) {
  if (state.pendingMods) return true;
  for (const i of state.items) {
    const p = products.find((x) => String(x.id) === String(i.offerId));
    if (!p) continue;
    for (const g of p.modifiers || []) {
      if (!g.required) continue;
      const opts = (Array.isArray(g.options) ? g.options : [])
        .map((o) => (typeof o === "string" ? o : o?.label))
        .filter(Boolean);
      if (!opts.length) continue;
      const has = (i.modifiers || []).some((m) => {
        const label = normLabel(typeof m === "string" ? m : m?.label);
        return label && opts.some((o) => normLabel(o) === label || normLabel(o).includes(label));
      });
      if (has) continue;
      const max = Math.max(1, Number(g.max_selections) || 1);
      state.pendingMods = { offerId: i.offerId, name: p.name, group: String(g.group_name || "opciones"), options: opts, max };
      state.step = "flow";
      state.pendingFields = [];
      const lista = opts.slice(0, 8).join(", ");
      replies.push(`🧩 ¿Qué ${String(g.group_name || "opciones").toLowerCase()} querés en *${p.name}*? (elegí ${max === 1 ? "1" : `hasta ${max}`}: ${lista})`);
      return true;
    }
  }
  return false;
}

function summaryText(state, vendor) {
  const lines = state.items.map((i) => `• ${itemDisplay(i)}`);
  const method = state.method === "delivery" ? `🛵 Envío a ${state.customerAddress}` : "🏬 Retiro en el local";
  const payment =
    state.payment === "transferencia" ? "🏦 Transferencia" :
    state.payment === "efectivo" ? "💵 Efectivo" : "💳 Coordinamos por WhatsApp";
  const estimate = orderTotalEstimate(state, vendor);
  const totalLine = estimate.total != null
    ? `💰 Total: $${Math.round(estimate.total).toLocaleString("es-AR")}${estimate.aprox ? " (aprox)" : ""}`
    : "";
  return [
    "✅ Tu pedido:",
    lines.join("\n"),
    "",
    `${method} · ${payment}`,
    state.customerName ? `Nombre: ${state.customerName}` : "",
    totalLine,
    "",
    "¿Todo bien? Contestá *sí* para confirmar o *no* para cambiarlo.",
  ].filter(Boolean).join("\n");
}

/** Estimación del total con los precios del menú (promo-aware) + modificadores
 *  + envío + descuento en efectivo. El server recomputa el total EXACTO al
 *  crear el pedido (autoritativo) — acá es para que el cliente vea cuánto sale
 *  ANTES de confirmar. Con modificadores marca "(aprox)". */
function orderTotalEstimate(state, vendor) {
  try {
    const products = getMenuSync(vendor.id);
    let subtotal = 0;
    let hasMods = false;
    let incomplete = false;
    let modsUnknown = false;
    for (const i of state.items) {
      const p = products.find((x) => String(x.id) === String(i.offerId));
      if (!p || p.price == null) { incomplete = true; continue; }
      let unit = Number(p.price);
      const mods = Array.isArray(i.modifiers) ? i.modifiers : [];
      if (mods.length) {
        hasMods = true;
        const modPrice = new Map();
        for (const g of p.modifiers || []) {
          for (const o of Array.isArray(g.options) ? g.options : []) {
            const label = String(o?.label ?? "").trim();
            if (label) modPrice.set(label, Number(o?.price_mod ?? 0) || 0);
          }
        }
        for (const m of mods) {
          const label = typeof m === "string" ? m : m?.label;
          if (!label) continue;
          const mp = modPrice.get(String(label));
          if (mp == null) modsUnknown = true;
          else unit += mp;
        }
      }
      subtotal += unit * i.qty;
    }
    let total = subtotal;
    if (state.method === "delivery") {
      const fee = Number(vendor?.delivery_fee) || 0;
      const freeMin = Number(vendor?.free_delivery_min) || 0;
      if (fee > 0 && !(freeMin > 0 && subtotal >= freeMin)) total += fee;
    }
    if (state.payment === "efectivo") {
      const pct = Number(vendor?.cash_discount_pct) || 0;
      if (pct > 0) total = Math.round(total * (100 - pct)) / 100;
    }
    return { total: Math.round(total * 100) / 100, aprox: hasMods || modsUnknown || incomplete };
  } catch (e) {
    console.error("[bot] estimate err:", e?.message || e);
    return { total: null, aprox: false };
  }
}

function shortReGreet(state, vendor) {
  if (state.items.length) {
    return `¡Hola de nuevo! 👋 Tu pedido sigue acá:\n${state.items.map((i) => `• ${i.name} ×${i.qty}`).join("\n")}\n\n¿Seguimos?`;
  }
  return `¡Hola de nuevo! 👋 ¿Qué te puedo preparar?`;
}

// ———————————————————————————————————————————————————————————————————————————
// Parsing → estado
// ———————————————————————————————————————————————————————————————————————————

function applyParsed(state, parsed, waId) {
  state.items = (parsed.items || []).map((p) => {
    const existing = state.items.find((i) => String(i.offerId) === String(p.offerId || p.id));
    const mods = Array.isArray(p.modifiers) && p.modifiers.length > 0
      ? p.modifiers
      : (existing?.modifiers || []);
    return {
      offerId: p.offerId || p.id,
      variantId: p.variantId,
      name: p.name,
      qty: Math.max(1, Number(p.qty) || 1),
      modifiers: mods,
    };
  });
  applyContactFields(state, parsed);
}

/** Los campos de contacto/método/pago del parseo (sin items). */
function applyContactFields(state, parsed) {
  if (parsed.customerName) state.customerName = parsed.customerName;
  // El teléfono lo setea handleInbound (teléfono real del relay > lid:).
  if (parsed.note) state.note = parsed.note;
  if (parsed.method === "pickup" || parsed.method === "delivery") state.method = parsed.method;
  if (parsed.customerAddress) state.customerAddress = parsed.customerAddress;
  if (parsed.payment === "transferencia" || parsed.payment === "efectivo") state.payment = parsed.payment;
}

function mergeItems(state, newItems) {
  for (const p of newItems) {
    const offerId = p.offerId || p.id;
    const variantId = p.variantId || null;
    const mods = p.modifiers || [];
    // El key incluye variantId: dos items del mismo producto con variante
    // distinta (negro/S vs blanco/M) NO se combinan.
    const existing = state.items.find(
      (i) => i.offerId === offerId && (i.variantId || null) === variantId && (i.modifiers || []).length === mods.length
    );
    if (existing) existing.qty += Math.max(1, Number(p.qty) || 1);
    else state.items.push({ offerId, variantId, name: p.name, qty: Math.max(1, Number(p.qty) || 1), modifiers: mods });
  }
  // Dedupe de defensa: jamás dos entradas del mismo producto+variante+mods.
  const seen = new Map();
  state.items = state.items.filter((i) => {
    const k = `${i.offerId}|${i.variantId || ""}|${(i.modifiers || []).map((m) => (typeof m === "string" ? m : m.label || m.group)).join(",")}`;
    if (seen.has(k)) {
      seen.get(k).qty += i.qty;
      return false;
    }
    seen.set(k, i);
    return true;
  });
}

// ———————————————————————————————————————————————————————————————————————————
// API: crear pedido
// ———————————————————————————————————————————————————————————————————————————

async function createOrder(vendorId, state) {
  const res = await fetch(`${config.appUrl}/api/wa/order`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.waBotSecret}` },
    body: JSON.stringify({
      vendorId,
      customerName: state.customerName,
      customerPhone: state.customerPhone,
      customerAddress: state.customerAddress || null,
      method: state.method || "pickup",
      paymentMethod: state.payment || "whatsapp",
      items: state.items.map((i) => ({ offerId: i.offerId, variantId: i.variantId || null, qty: i.qty, modifiers: i.modifiers })),
      notes: state.note || null,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `order ${res.status}`);
  return data;
}

// ———————————————————————————————————————————————————————————————————————————
// Concierge v2 (BOT_TAKE_ORDERS apagado): el bot NO arma pedidos por chat.
// 1) Saluda, comparte el menú online y evalúa abierto/cerrado.
// 2) Cualquier texto que suene a pedido (productos del menú, o el cliente ya
//    tiene pedido reciente por teléfono) → tomarlo como ok, abrir el canal.
// 3) Cualquier otra cosa → ofrecer atención humana: "¿Querés que lo atienda
//    una persona de {store}? 1️⃣ Sí 2️⃣ No".
// 4) "ayuda" en cualquier momento → una persona del comercio se pone.
// El flujo de pedido viejo queda intacto (sin borrar), solo sin entrar.
// ———————————————————————————————————————————————————————————————————————————

const RE_AYUDA = /\bayuda\b/i;
const RE_PROBLEMA = /\b(problema|problemas|error|traba|trabar|falla|falló|fallo|fallas|no pude|no me funcion|no me funciona|no me deja|no sale|roto|rota)\b/i;
const RE_PERSON_SI = /^(1|sí|si|dale|ok|okey|bueno|perfecto|si quiero|sí quiero)(?=[\s.,!¡]|$)/i;
const RE_PERSON_NO = /^(2|no|nop|no quiero|no gracias|cero)(?=[\s.,!¡]|$)/i;

async function latestOrderFor(vendorId, phone) {
  try {
    const r = await fetch(`${config.appUrl}/api/wa/latest-orders?vendorId=${encodeURIComponent(vendorId)}&phone=${encodeURIComponent(String(phone || ""))}`, {
      headers: { Authorization: `Bearer ${config.waBotSecret}` },
      signal: AbortSignal.timeout(8_000),
    });
    if (!r.ok) return null;
    const data = await r.json().catch(() => null);
    if (!data?.pickupNumber && !data?.trackUrl) return null;
    return data;
  } catch {
    return null;
  }
}

// Mensajes PREDEFINIDOS del checkout (formato fijo del sitio — cero falsos
// positivos): el pedido armado que la app manda por WA ya está en el sistema.
const RE_APP_ORDER = /(quiero hacer un pedido)/i;
const RE_APP_PAID  = /(ya pagu[eé] mi pedido|ya pague mi pedido)/i;
const RE_APP_FAIL  = /(no se pudo cobrar)/i;
// CTAs pre-armados del micrositio: los botones "Pedir por WhatsApp" del sitio
// abren el chat con texto propio de la app ("… Vengo de Portal 659."), no son
// palabras del cliente → el bot calla (el comercio los ve en su WhatsApp) y la
// bienvenida queda reservada para el primer mensaje REAL del cliente.
const RE_APP_ORIGIN = /vengo de portal 659/i;
// El CTA "🚨 URGENTE - Necesito {store} lo antes posible.": el cliente que lo
// toca quiere hablar YA con una persona → handoff directo (sin bienvenida).
const RE_URGENTE = /urgente/i;

// Variantes de saludo (anti-ban: el mismo texto idéntico a muchos números es
// señal de spam). Se rota por hash del chat: un mismo cliente ve siempre el
// mismo tono, pero dos clientes no reciben el texto idéntico.
const CONCIERGE_GREETINGS = [
  (store, openLine, menuLine, link) =>
    `¡Hola! 👋 Soy el asistente de *${store}*.\n${openLine ? openLine + "\n\n" : ""}${menuLine} ${link}\n\n¿Necesitás ayuda? Escribí *ayuda* y una persona de *${store}* te toma el pedido o te responde lo que necesites enseguida 🙌`,
  (store, openLine, menuLine, link) =>
    `Hola 👋 Te escribe el asistente de *${store}*.\n${openLine ? openLine + "\n\n" : ""}${menuLine} ${link}\n\nSi necesitás ayuda, escribí *ayuda* y una persona de *${store}* te atiende enseguida 🙌`,
  (store, openLine, menuLine, link) =>
    `¡Hola! 👋 Bienvenido a *${store}*.\n${openLine ? openLine + "\n\n" : ""}${menuLine} ${link}\n\n¿Necesitás ayuda? Escribí *ayuda* y te responde una persona de *${store}* 🙌`,
];

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/** Bienvenida del concierge con abierto/cerrado real (y el próximo horario si
 *  está cerrado) + variante anti-ban por chat. Sale UNA vez por conversación. */
async function conciergeGreeting(vendor, waId) {
  let openLine = "";
  try {
    const r = await fetch(`${config.appUrl}/api/wa/menu?vendorId=${encodeURIComponent(vendor.id)}`, {
      headers: { Authorization: `Bearer ${config.waBotSecret}` },
      signal: AbortSignal.timeout(8_000),
    });
    const info = r.ok ? await r.json().catch(() => null) : null;
    const isOpen = info?.vendor?.store_open;
    if (isOpen === true) {
      openLine = "Estamos abiertos ahora ✓";
    } else if (isOpen === false) {
      const next = info?.vendor?.next_open_text;
      openLine = next ? `Estamos cerrados, volvemos a abrir a: ${next}` : "Estamos cerrados ahora";
    }
  } catch { /* el saludo va sin la línea de horario */ }
  const menuLine = openLine.startsWith("Estamos cerrados") ? "De todas maneras podés ver todos nuestros productos en:" : "Pedí fácil desde el menú:";
  const gi = hashStr(String(waId || vendor.id)) % CONCIERGE_GREETINGS.length;
  return CONCIERGE_GREETINGS[gi](vendor.store_name, openLine, menuLine, shopUrl(vendor));
}

async function handleConcierge({ vendor, text, state, replies, waId }) {
  const low = text.trim().toLowerCase();

  // 0) Mensajes PREDEFINIDOS del checkout → SILENCIO. El pedido armado que la
  //    app manda por WA ya está en el sistema (el checkout lo creó server-side
  //    ANTES de abrir WhatsApp): el bot no dice nada — ni bienvenida — y el
  //    canal queda abierto para los eventos (aceptado/en camino/listo/pago).
  //    El texto arranca con "Hola {store}" — sin este check el RE_GREETING lo
  //    matcheaba y respondía la bienvenida (el bug).
  if (RE_APP_ORDER.test(low) && /total\s*:/i.test(low)) return;
  if (RE_APP_PAID.test(low)) return;
  // MP falló → el dueño tiene que saberlo de una vez.
  if (RE_APP_FAIL.test(low)) {
    const r = await handoffHuman(vendor, waId, text, state);
    replies.push(...(r.replies || []));
    return;
  }

  // CTAs pre-armados del micrositio → SILENCIO (texto de la app, no del
  // cliente; no consume la bienvenida: el primer mensaje propio recién
  // entonces arranca el flujo de bienvenida → persona).
  if (RE_APP_ORIGIN.test(low)) return;

  // 1) Comprobante pendiente (de un pedido web por transferencia): el texto
  //    sigue esperando la foto — no cambia con el modo conserje.
  if (state.step === "awaiting_receipt") {
    replies.push("Estoy esperando tu comprobante (foto o PDF). Si cambiás de idea, escribime *cancelar*.");
    return;
  }

  // 2) "ayuda" / hablar con una persona / un problema directo / el CTA
  //    "🚨 URGENTE" → una persona toma el hilo de una vez. La ÚNICA escalada
  //    del bot (el urgente la salta: el cliente quiere hablar YA).
  if (RE_AYUDA.test(low) || RE_PROBLEMA.test(low) || RE_URGENTE.test(low)) {
    const r = await handoffHuman(vendor, waId, text, state);
    replies.push(...(r.replies || []));
    state.step = "idle";
    return;
  }

  // 3) AUTO-RESPONDER: la bienvenida sale UNA vez por conversación (estado
  //    abierto/cerrado + menú + pie de ayuda). Cualquier mensaje siguiente →
  //    "Enseguida te atiende una persona" (handoff: aviso al cliente +
  //    notificación al dueño + pausa de 30 min) y ahí sí, silencio: el loop
  //    queda cortado y el hilo pasa a manos humanas.
  if (!state.welcomed) {
    state.welcomed = true;
    state.step = "idle";
    replies.push(await conciergeGreeting(vendor, waId));
    return;
  }
  const r = await handoffHuman(vendor, waId, text, state);
  replies.push(...(r.replies || []));
  state.step = "idle";
  return;
}

async function handoffHuman(vendor, waId, text, state) {
  state.pausedUntil = Date.now() + HANDOFF_PAUSE_MIN * 60 * 1000;
  state.handoffCount = 0;
  await setState(vendor.id, waId, state);
  const { bumpHandoff } = await import("./metrics.mjs");
  bumpHandoff(vendor.id, vendor.store_name, waId, text);
  await notifyHandoff(vendor.id, waId, text);
  return { replies: [`Enseguida te atiende una persona de *${vendor.store_name}* 🙌`] };
}

// ———————————————————————————————————————————————————————————————————————————
// Sweep de inactividad (lo llama index.mjs cada 60s): cliente que no contesta
// lo que el bot le pide → "va a ser atendido por una persona" + push al dueño
// + pausa. Patrón Omnifox/Twilio (inactivity → remind → escalate).
//
// NO interrumpe los eventos del pedido: el /send (aceptado, en camino, listo,
// datos de pago) no mira pausedUntil — solo la conexión del relay y el kill
// switch. Así el canal queda abierto y las notificaciones siguen llegando.
// ———————————————————————————————————————————————————————————————————————————

const SWEEP_WAITING_STEPS = new Set([
  "awaiting_receipt",      // esperando el comprobante de la transferencia
]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (min, max) => Math.round(min + Math.random() * (max - min));
// Delay humano (igual que index.mjs): simula lectura antes del aviso.
const humanDelay = (len) => Math.min(config.replyDelayMaxMs, config.replyDelayMinMs + len * 4 + rand(200, 700));

// ————————————————————————————————————————————————————————————————
// Modo PORTAL: un solo número sirve a todos los comercios de la zona activa.
// ————————————————————————————————————————————————————————————————
async function fetchPortalMenu(q = "") {
  try {
    const url = `${config.appUrl}/api/wa/portal-menu${q ? `?q=${encodeURIComponent(q)}` : ""}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${config.waBotSecret}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { vendors: [] };
    return await res.json();
  } catch (e) {
    console.error(`[bot][portal] menu fetch fail: ${e?.message}`);
    return { vendors: [] };
  }
}

async function handlePortalInbound({ vendor, waId, body, waPhone }) {
  const text = String(body || "").trim();
  let state = (await getState(vendor.id, waId)) || { ...DEFAULT_STATE };
  if (!Array.isArray(state.history)) state.history = [];
  const ph = phoneFor(waId, waPhone);
  if (!state.customerPhone || (String(state.customerPhone).startsWith("lid:") && !ph.startsWith("lid:"))) {
    state.customerPhone = ph;
  }
  if (!state.items || !Array.isArray(state.items) || state.items === DEFAULT_STATE.items) state.items = [];
  if (!Array.isArray(state.history) || state.history === DEFAULT_STATE.history) state.history = [];
  if (!state.zone) state.zone = "sicardi-garibaldi";
  if (!state.portalVendorList) state.portalVendorList = [];

  // B5: Timeout de sesión (30 min sin actividad → resetear como conversación nueva).
  const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
  if (state.touchedAt && Date.now() - Number(state.touchedAt) > SESSION_TIMEOUT_MS && state.welcomed) {
    const savedPhone = state.customerPhone;
    state = { ...DEFAULT_STATE, customerPhone: savedPhone };
    await clearState(vendor.id, waId).catch(() => {});
  }

  // B4: Saludo personalizado — si el cliente tiene pedidos anteriores, saludar por nombre.
  if (!state.welcomed && !state._personalGreetingDone) {
    try {
      const rawPhone = state.customerPhone || waId;
      const phone = String(rawPhone).startsWith("lid:") ? waId : rawPhone;
      const res = await fetch(`${config.appUrl}/api/wa/portal-orders?phone=${encodeURIComponent(String(phone))}`, {
        headers: { Authorization: `Bearer ${config.waBotSecret}` },
        signal: AbortSignal.timeout(5_000),
      });
      const data = res.ok ? await res.json().catch(() => null) : null;
      const orders = data?.orders || [];
      if (orders.length > 0 && orders[0].customerName) {
        state.customerName = orders[0].customerName;
        state._lastOrder = orders[0];
        state._personalGreetingDone = true;
      }
    } catch { /* best-effort */ }
  }

  state.touchedAt = Date.now();
  const replies = [];

  try {
    if (!vendor.enabled) return { replies: [], handoff: true };

    if (RE_CANCEL.test(text)) {
      state._cleared = true;
      await clearState(vendor.id, waId);
      return { replies: ["Ok, cancelé todo. Cuando quieras retomamos. 👋"] };
    }

    if (state.pausedUntil && state.pausedUntil > Date.now()) {
      return { replies: [] };
    }

    state.history.push({ role: "user", text: text.slice(0, 200) });
    if (state.history.length > 16) state.history = state.history.slice(-16);

    if (RE_HUMAN.test(text) || RE_AYUDA.test(text)) {
      return await handoffHuman(vendor, waId, text, state);
    }

    // — Consulta de estado del pedido ("¿cómo va mi pedido?", "¿dónde está?",
    //   "estado", "seguimiento", "mi pedido"). El bot busca el último pedido
    //   del teléfono y responde estado + link de seguimiento. —
    const RE_STATUS = /(?:c[oó]mo (?:va|est[aá])|d[oó]nde (?:est[aá]|va)|estado|seguimiento|mi pedido|rastrear|track)/i;
    if (RE_STATUS.test(text) && !/^(hola|buenas|buenos|chau|adios|gracias|ok|si|no|cancelar|ayuda|menu|menú|comercios)$/i.test(text.trim())) {
      const rawPhone = state.customerPhone || waId;
      const phone = String(rawPhone).startsWith("lid:") ? waId : rawPhone;
      try {
        const res = await fetch(`${config.appUrl}/api/wa/portal-orders?phone=${encodeURIComponent(String(phone))}`, {
          headers: { Authorization: `Bearer ${config.waBotSecret}` },
          signal: AbortSignal.timeout(10_000),
        });
        const data = res.ok ? await res.json().catch(() => null) : null;
        const orders = data?.orders || [];
        if (orders.length === 0) {
          replies.push("No encontré pedidos recientes de tu número en las últimas 48h. Si hiciste un pedido, mandame el número o escribí *ayuda* para que te atienda una persona. 🙌");
          return await persist(state, vendor.id, waId, replies);
        }
        const STATUS_LABEL = {
          new: "Recibido (esperando que lo acepten)",
          preparing: "En preparación",
          ready: "Listo para retirar",
          sent: "En camino",
          completed: "Completado",
        };
        for (const o of orders.slice(0, 3)) {
          const nro = o.pickupNumber ? `Nro. ${o.pickupNumber}` : `#${String(o.id).slice(0, 8)}`;
          const status = STATUS_LABEL[o.status] || o.status;
          const lines = [`${o.storeName} — ${nro}: ${status}`];
          if (o.trackUrl) lines.push(`📦 Seguilo acá: ${o.trackUrl}`);
          replies.push(lines.join("\n"));
        }
        if (orders.length > 3) {
          replies.push(`(y ${orders.length - 3} pedido${orders.length - 3 !== 1 ? "s" : ""} más — escribí *ayuda* para ver el detalle)`);
        }
        return await persist(state, vendor.id, waId, replies);
      } catch (e) {
        replies.push("No pude consultar tus pedidos ahora. Probá de nuevo en un momento, o escribí *ayuda*. 🙏");
        return await persist(state, vendor.id, waId, replies);
      }
    }

    // — Favoritos: "guardá X como favorito", "mis favoritos", "sacá X de favoritos" —
    const RE_FAV_ADD = /(?:guard[aá]|agreg[aá]|marc[aá]|favorito)\s+(.+?)(?:\s+como\s+favorito)?$/i;
    const RE_FAV_LIST = /^(?:mis\s+)?favoritos$/i;
    const RE_FAV_REMOVE = /^(?:sac[aá]|quit[aá]|elimina|borr[aá])\s+(.+?)\s+de\s+favoritos$/i;
    const isFavAdd = RE_FAV_ADD.test(text) && !/^(hola|buenas|buenos|chau|adios|gracias|ok|si|no|cancelar|ayuda|menu|menú|comercios)$/i.test(text.trim());
    const isFavList = RE_FAV_LIST.test(text.trim());
    const isFavRemove = RE_FAV_REMOVE.test(text.trim());

    if (isFavAdd || isFavList || isFavRemove) {
      const rawPhone = state.customerPhone || waId;
      const phone = String(rawPhone).startsWith("lid:") ? waId : rawPhone;
      try {
        if (isFavRemove) {
          const m = text.trim().match(RE_FAV_REMOVE);
          const name = m ? m[1].trim() : "";
          // Resolver el vendor por nombre en el menú del portal.
          const portalData = await fetchPortalMenu("");
          const stores = portalData.vendors || portalData.stores || [];
          const store = stores.find((s) => {
            const sn = String(s.store_name || "").toLowerCase();
            return sn.includes(name.toLowerCase()) || name.toLowerCase().includes(sn);
          });
          if (store) {
            await fetch(`${config.appUrl}/api/wa/favorites`, {
              method: "DELETE",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.waBotSecret}` },
              body: JSON.stringify({ phone, vendorId: store.id }),
              signal: AbortSignal.timeout(10_000),
            });
            replies.push(`Listo, saqué *${store.store_name}* de tus favoritos. 🙌`);
          } else {
            replies.push(`No encontré "${name}" en las tiendas de la zona. Escribí *mis favoritos* para ver tu lista.`);
          }
          return await persist(state, vendor.id, waId, replies);
        }

        if (isFavList) {
          const res = await fetch(`${config.appUrl}/api/wa/favorites?phone=${encodeURIComponent(String(phone))}`, {
            headers: { Authorization: `Bearer ${config.waBotSecret}` },
            signal: AbortSignal.timeout(10_000),
          });
          const data = res.ok ? await res.json().catch(() => null) : null;
          const favs = data?.favorites || [];
          if (favs.length === 0) {
            replies.push("No tenés tiendas favoritas todavía. Escribí *guardá [nombre] como favorito* para agregar una. ⭐");
          } else {
            replies.push("⭐ Tus tiendas favoritas:");
            favs.forEach((f, i) => replies.push(`${i + 1}) *${f.store_name}*`));
            replies.push("Mandame el nombre de una tienda para ver su menú, o *comercios* para ver todas.");
          }
          return await persist(state, vendor.id, waId, replies);
        }

        // isFavAdd: "guardá X como favorito" / "favorito X"
        const m = text.trim().match(RE_FAV_ADD);
        const name = m ? m[1].replace(/\s+como\s+favorito$/i, "").trim() : "";
        const portalData = await fetchPortalMenu("");
        const stores = portalData.vendors || portalData.stores || [];
        const store = stores.find((s) => {
          const sn = String(s.store_name || "").toLowerCase();
          return sn.includes(name.toLowerCase()) || name.toLowerCase().includes(sn);
        });
        if (!store) {
          replies.push(`No encontré "${name}" en las tiendas de la zona. Escribí *comercios* para ver el listado.`);
          return await persist(state, vendor.id, waId, replies);
        }
        const res = await fetch(`${config.appUrl}/api/wa/favorites`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.waBotSecret}` },
          body: JSON.stringify({ phone, vendorId: store.id }),
          signal: AbortSignal.timeout(10_000),
        });
        if (res.ok) {
          replies.push(`⭐ *${store.store_name}* agregada a tus favoritas. Escribí *mis favoritos* para ver tu lista.`);
        } else {
          replies.push("No pude guardar el favorito. Probá de nuevo en un momento. 🙏");
        }
        return await persist(state, vendor.id, waId, replies);
      } catch (e) {
        replies.push("No pude gestionar tus favoritos ahora. Probá de nuevo en un momento. 🙏");
        return await persist(state, vendor.id, waId, replies);
      }
    }

    // — Re-pedido ("lo mismo que la última vez", "repetir pedido", "pedime lo
    //   de siempre"). Arma el carrito con los ítems del último pedido del
    //   teléfono y pide confirmación antes de crear el nuevo pedido. —
    const RE_REORDER = /(?:repetir|repetime|repetirme|lo mismo|de nuevo|otra vez|el mismo pedido|pedime lo de siempre|repetir pedido|repetir el pedido|repetirme el pedido)/i;
    if (RE_REORDER.test(text) && !/^(hola|buenas|buenos|chau|adios|gracias|ok|si|no|cancelar|ayuda|menu|menú|comercios)$/i.test(text.trim())) {
      const rawPhone = state.customerPhone || waId;
      const phone = String(rawPhone).startsWith("lid:") ? waId : rawPhone;
      try {
        const res = await fetch(`${config.appUrl}/api/wa/portal-orders?phone=${encodeURIComponent(String(phone))}`, {
          headers: { Authorization: `Bearer ${config.waBotSecret}` },
          signal: AbortSignal.timeout(10_000),
        });
        const data = res.ok ? await res.json().catch(() => null) : null;
        const orders = data?.orders || [];
        if (orders.length === 0) {
          replies.push("No encontré pedidos anteriores de tu número. Mandame tu pedido directo (ej: \"2 empanadas de carne y una coca\") y te lo armo. 🙌");
          return await persist(state, vendor.id, waId, replies);
        }
        const last = orders[0];
        const items = Array.isArray(last.items) ? last.items : [];
        // Mapear items del pedido a formato del carrito del bot (offerId, etc.)
        // Solo ítems con product_id válido (los manuales no se pueden re-pedir).
        const cartItems = items
          .filter((it) => it && (it.product_id || it.offerId))
          .map((it) => ({
            offerId: it.product_id || it.offerId,
            variantId: it.variant_id || it.variantId || null,
            name: it.name,
            qty: Math.max(0.001, Number(it.qty) || 1),
            modifiers: Array.isArray(it.modifiers) ? it.modifiers : [],
            price: Number(it.price) || 0,
          }));
        if (cartItems.length === 0) {
          replies.push(`Tu último pedido a *${last.storeName}* no tiene productos re-pedibles. Mandame tu pedido directo y te lo armo. 🙌`);
          return await persist(state, vendor.id, waId, replies);
        }
        // Armar el estado como si el cliente hubiera pedido esos ítems, en
        // confirmación. El comercio elegido es el de ese pedido (store_id
        // viene del endpoint portal-orders).
        state.currentVendorId = last.storeId;
        state.currentVendorName = last.storeName;
        state.currentVendorSlug = last.storeSlug || null;
        state.currentVendorTransfer = { alias: last.transferAlias || null, cbu: last.transferCbu || null, holder: last.transferHolder || null };
        state.currentVendorDelivery = last.deliveryOptions || "ambos";
        if (state.currentVendorDelivery === "retiro") state.method = "pickup";
        else if (state.currentVendorDelivery === "domicilio") state.method = "delivery";
        else state.method = last.method || "pickup";
        state.items = cartItems;
        state.method = last.method || "pickup";
        state.payment = last.paymentMethod || "whatsapp";
        state.customerName = last.customerName || state.customerName;
        state.portalVendorList = [];
        state.step = "confirm";
        // Resumen
        const summary = cartItems.map((i) => `• ${i.name} ×${i.qty}`).join("\n");
        replies.push(`Tu último pedido a *${last.storeName}*:`);
        replies.push(summary);
        replies.push(`Total estimado: $${last.total.toLocaleString("es-AR")}`);
        replies.push("¿Confirmás el mismo pedido? Respondé *sí* para confirmar o *no* para cancelar.");
        return await persist(state, vendor.id, waId, replies);
      } catch (e) {
        replies.push("No pude armar el re-pedido ahora. Probá de nuevo en un momento, o mandame tu pedido directo. 🙏");
        return await persist(state, vendor.id, waId, replies);
      }
    }

    // — Horarios por tienda ("¿a qué hora abre X?", "¿está abierto X?",
    //   "horarios de X", "cuándo abre X"). El bot busca la tienda por nombre
    //   en el menú del portal y responde abierto/cerrado + próximo horario. —
    const RE_HOURS = /(?:a qu[eé] hora|horario|cu[aá]ndo (?:abre|cierra)|est[aá] (?:abierto|cerrado)|abre|cierra)/i;
    if (RE_HOURS.test(text) && !/^(hola|buenas|buenos|chau|adios|gracias|ok|si|no|cancelar|ayuda|menu|menú|comercios)$/i.test(text.trim())) {
      const portalData = await fetchPortalMenu("");
      const stores = portalData.vendors || portalData.stores || [];
      // Resolver la tienda por nombre (si se menciona) o listar todas.
      const tn = String(text || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      const matched = stores.filter((s) => {
        const sn = String(s.store_name || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        return sn && (tn.includes(sn) || sn.split(" ").some((w) => w.length >= 3 && tn.includes(w)));
      });
      const targets = matched.length > 0 ? matched : stores;
      if (targets.length === 0) {
        replies.push("No encontré tiendas en la zona. Escribí *comercios* para ver el listado. 🙌");
        return await persist(state, vendor.id, waId, replies);
      }
      for (const s of targets.slice(0, 5)) {
        const status = s.store_open === true ? "Abierto ahora ✓" : s.store_open === false ? "Cerrado" : "Horario no disponible";
        const lines = [`${s.store_name}: ${status}`];
        if (s.store_open === false && s.next_open_text) lines.push(`  → ${s.next_open_text}`);
        if (s.hours) lines.push(`  Horario: ${s.hours}`);
        replies.push(lines.join("\n"));
      }
      if (targets.length > 5) replies.push(`(y ${targets.length - 5} tienda${targets.length - 5 !== 1 ? "s" : ""} más — escribí el nombre para ver su horario)`);
      return await persist(state, vendor.id, waId, replies);
    }

    // — Promociones ("¿qué promos hay?", "ofertas", "descuentos") —
    const RE_PROMO = /(?:promo|promoci[oó]n|promociones|oferta|ofertas|descuento|descuentos|novedad|novedades)/i;
    if (RE_PROMO.test(text) && !/^(hola|buenas|buenos|chau|adios|gracias|ok|si|no|cancelar|ayuda|menu|menú|comercios)$/i.test(text.trim())) {
      const portalData = await fetchPortalMenu("");
      const stores = portalData.vendors || portalData.stores || [];
      const promoStores = stores.map((s) => {
        const promos = (s.products || []).filter((p) => p.promo_price != null || p.featured_today === true);
        return { store: s, promos };
      }).filter((x) => x.promos.length > 0);
      if (promoStores.length === 0) {
        replies.push("No hay promos activas en la zona por ahora. Escribí *comercios* para ver todas las tiendas. 🙌");
        return await persist(state, vendor.id, waId, replies);
      }
      if (!state.welcomed) { replies.unshift("¡Hola! 👋 Soy el asistente de *Portal 659*."); state.welcomed = true; }
      replies.push("🔥 Promos y destacados de la zona:");
      for (const { store, promos } of promoStores.slice(0, 6)) {
        const lines = promos.slice(0, 4).map((p) => {
          const orig = p.original_price ? ` (antes $${Number(p.original_price).toLocaleString("es-AR")})` : "";
          return `  • ${p.name} — $${Number(p.price).toLocaleString("es-AR")}${orig}${p.featured_today ? " ⭐" : ""}`;
        });
        replies.push(`*${store.store_name}*:\n${lines.join("\\n")}`);
      }
      replies.push("¿Querés pedir de alguna? Escribí el nombre o el número.");
      return await persist(state, vendor.id, waId, replies);
    }

    // — Ubicación de tienda ("¿dónde queda X?", "dirección", "ubicación") —
    const RE_LOCATION = /(?:d[oó]nde (?:queda|est[aá]|es|fica)|direcci[oó]n|ubicaci[oó]n|c[oó]mo (?:llego|llegar)|mapa)/i;
    if (RE_LOCATION.test(text) && !/^(hola|buenas|buenos|chau|adios|gracias|ok|si|no|cancelar|ayuda|menu|menú|comercios)$/i.test(text.trim())) {
      const portalData = await fetchPortalMenu("");
      const stores = portalData.vendors || portalData.stores || [];
      const tn = String(text || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      const matched = stores.filter((s) => {
        const sn = String(s.store_name || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        return sn && (tn.includes(sn) || sn.split(" ").some((w) => w.length >= 3 && tn.includes(w)));
      });
      const targets = matched.length > 0 ? matched : stores;
      if (targets.length === 0) {
        replies.push("No encontré tiendas en la zona. Escribí *comercios* para ver el listado. 🙌");
        return await persist(state, vendor.id, waId, replies);
      }
      for (const s of targets.slice(0, 4)) {
        const lines = [`📍 *${s.store_name}*`];
        if (s.address) lines.push(`  ${s.address}`);
        if (s.neighborhood) lines.push(`  Barrio: ${s.neighborhood}`);
        lines.push(`  🗺️ https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s.store_name + " " + (s.address || s.neighborhood || ""))}`);
        replies.push(lines.join("\n"));
      }
      return await persist(state, vendor.id, waId, replies);
    }

    // — Métodos de pago ("¿aceptan tarjeta?", "¿cómo pago?") —
    const RE_PAYMENT = /(?:aceptan|acepta|pago|pagar|pagás|pagas|tarjeta|efectivo|transferencia|método|forma de pago|medio de pago)/i;
    if (RE_PAYMENT.test(text) && !/^(hola|buenas|buenos|chau|adios|gracias|ok|si|no|cancelar|ayuda|menu|menú|comercios)$/i.test(text.trim())) {
      const portalData = await fetchPortalMenu("");
      const stores = portalData.vendors || portalData.stores || [];
      const tn = String(text || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      const matched = stores.filter((s) => {
        const sn = String(s.store_name || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        return sn && (tn.includes(sn) || sn.split(" ").some((w) => w.length >= 3 && tn.includes(w)));
      });
      const targets = matched.length > 0 ? matched : stores;
      if (targets.length === 0) {
        replies.push("No encontré tiendas en la zona. Escribí *comercios* para ver el listado. 🙌");
        return await persist(state, vendor.id, waId, replies);
      }
      for (const s of targets.slice(0, 4)) {
        const methods = String(s.payment_methods || "").split(",").map((m) => m.trim()).filter(Boolean);
        const methodsText = methods.length > 0 ? methods.join(", ") : "Consultá directamente con el comercio";
        const cashDiscount = s.cash_discount_pct ? ` (descuento ${s.cash_discount_pct}% en efectivo)` : "";
        replies.push(`💳 *${s.store_name}*: ${methodsText}${cashDiscount}`);
      }
      return await persist(state, vendor.id, waId, replies);
    }

    // — Historial de pedidos ("mis pedidos", "qué pedí", "historial") —
    const RE_HISTORY = /(?:mis pedidos|qué ped[ií]|historial|últimos pedidos|pedidos anteriores|mis últimos)/i;
    if (RE_HISTORY.test(text) && !/^(hola|buenas|buenos|chau|adios|gracias|ok|si|no|cancelar|ayuda|menu|menú|comercios)$/i.test(text.trim())) {
      const rawPhone = state.customerPhone || waId;
      const phone = String(rawPhone).startsWith("lid:") ? waId : rawPhone;
      try {
        const res = await fetch(`${config.appUrl}/api/wa/portal-orders?phone=${encodeURIComponent(String(phone))}`, {
          headers: { Authorization: `Bearer ${config.waBotSecret}` },
          signal: AbortSignal.timeout(10_000),
        });
        const data = res.ok ? await res.json().catch(() => null) : null;
        const orders = data?.orders || [];
        if (orders.length === 0) {
          replies.push("No encontré pedidos de tu número en las últimas 48h. Si hiciste un pedido, mandame el número o escribí *ayuda*. 🙌");
          return await persist(state, vendor.id, waId, replies);
        }
        const STATUS_LABEL = { new: "Recibido", preparing: "En preparación", ready: "Listo", sent: "En camino", completed: "Completado" };
        replies.push("📋 Tus últimos pedidos:");
        for (const o of orders.slice(0, 5)) {
          const nro = o.pickupNumber ? `Nro. ${o.pickupNumber}` : `#${String(o.id).slice(0, 8)}`;
          const status = STATUS_LABEL[o.status] || o.status;
          replies.push(`  • ${o.storeName} — ${nro}: ${status}${o.trackUrl ? ` → ${o.trackUrl}` : ""}`);
        }
        return await persist(state, vendor.id, waId, replies);
      } catch (e) {
        replies.push("No pude consultar tus pedidos ahora. Probá de nuevo en un momento. 🙏");
        return await persist(state, vendor.id, waId, replies);
      }
    }

    // — Tiendas por categoría/vertical ("¿qué pizzerías hay?", "tiendas de ropa") —
    const VERTICAL_LABELS = { gastronomia: "Gastronomía", comercio: "Comercio", servicio: "Servicios", moda: "Moda", salud: "Salud", estetica: "Estética" };
    const RE_VERTICAL = /(?:tiendas? (?:de|del)|comercios? (?:de|del)|qué (?:pizzerías|rotiserías|verdulerías|carnicerías|kioscos|ferreterías|floristerías|librerías|pet shops|veterinarias|farmacias|peluquerías|barberías|estéticas|ropa|indumentaria|zapaterías|bijouterie)|pizzerías|rotiserías|verdulerías|carnicerías|kioscos|ferreterías|floristerías|librerías|pet shops|veterinarias|farmacias|peluquerías|barberías|estéticas|moda|ropa|indumentaria)/i;
    if (RE_VERTICAL.test(text) && !/^(hola|buenas|buenos|chau|adios|gracias|ok|si|no|cancelar|ayuda|menu|menú|comercios)$/i.test(text.trim())) {
      const portalData = await fetchPortalMenu("");
      const stores = portalData.vendors || portalData.stores || [];
      // Mapear keywords a verticales
      const keywordToVertical = {
        pizzería: "gastronomia", pizza: "gastronomia", rotisería: "gastronomia", comida: "gastronomia",
        verdulería: "comercio", carnicería: "comercio", kiosco: "comercio", ferretería: "comercio",
        floristería: "comercio", librería: "comercio", "pet shop": "comercio", veterinaria: "comercio",
        farmacia: "salud", peluquería: "estetica", barbería: "estetica", estética: "estetica",
        ropa: "moda", indumentaria: "moda", zapatería: "moda", bijouterie: "moda",
        servicio: "servicio", oficio: "servicio",
      };
      const tn = String(text || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      let targetVertical = null;
      for (const [kw, v] of Object.entries(keywordToVertical)) {
        if (tn.includes(kw)) { targetVertical = v; break; }
      }
      const filtered = targetVertical ? stores.filter((s) => s.vertical === targetVertical) : stores;
      if (filtered.length === 0) {
        replies.push(`No encontré tiendas de esa categoría en la zona. Escribí *comercios* para ver todas. 🙌`);
        return await persist(state, vendor.id, waId, replies);
      }
      if (!state.welcomed) { replies.unshift("¡Hola! 👋 Soy el asistente de *Portal 659*."); state.welcomed = true; }
      const label = targetVertical ? (VERTICAL_LABELS[targetVertical] || targetVertical) : "Todas";
      replies.push(`Tiendas de ${label} en la zona:`);
      for (const s of filtered.slice(0, 8)) {
        replies.push(`  ${s.store_open === true ? "🟢" : "🔴"} *${s.store_name}*${s.neighborhood ? ` — ${s.neighborhood}` : ""}${s.store_open === false && s.next_open_text ? ` (abre ${s.next_open_text})` : ""}`);
      }
      if (filtered.length > 8) replies.push(`(y ${filtered.length - 8} más — escribí el nombre para ver su menú)`);
      replies.push("Mandame el nombre de una tienda o un producto para buscar.");
      return await persist(state, vendor.id, waId, replies);
    }

    // — Ayuda sobre el portal ("¿cómo funciona?", "qué es portal 659") —
    const RE_HELP = /(?:c[oó]mo funciona|qu[eé] es portal|para qu[eé] sirve|c[oó]mo (?:me )?registro|c[oó]mo (?:me )?anoto|c[oó]mo (?:me )?sumo|ayuda sobre|informaci[oó]n sobre portal|qué es esto)/i;
    if (RE_HELP.test(text) && !/^(hola|buenas|buenos|chau|adios|gracias|ok|si|no|cancelar|ayuda|menu|menú|comercios)$/i.test(text.trim())) {
      replies.push("Portal 659 es el centro comercial de tu barrio 🏪");
      replies.push("Acá podés:");
      replies.push("• Ver tiendas y productos de tu zona");
      replies.push("• Pedir por WhatsApp o delivery");
      replies.push("• Consultar horarios, promos y ubicaciones");
      replies.push("• Seguir tus pedidos en tiempo real");
      replies.push("");
      replies.push("Mirá todas las tiendas: https://www.portal659.com.ar/buscar");
      replies.push("¿Tenés un comercio? Sumalo gratis: https://www.portal659.com.ar/comercios");
      replies.push("Escribí *comercios* para ver las tiendas o *ayuda* para hablar con una persona. 🙌");
      return await persist(state, vendor.id, waId, replies);
    }

    // — Queja/reclamo ("mi pedido llegó mal", "no recibí", "tengo un problema") —
    const RE_COMPLAINT = /(?:lleg[oó] mal|no (?:recib[ií]|lleg[oó])|problema con (?:mi|el) pedido|reclamo|queja|me (?:cobraron|cobr[oó]) mal|pedido (?:equivocado|incorrecto|incompleto)|falt[oó]|no (?:est[aá]|estaba) (?:bien|completo))/i;
    if (RE_COMPLAINT.test(text)) {
      const rawPhone = state.customerPhone || waId;
      const phone = String(rawPhone).startsWith("lid:") ? waId : rawPhone;
      // Buscar el último pedido para dar contexto al admin.
      let lastOrderInfo = "";
      try {
        const res = await fetch(`${config.appUrl}/api/wa/portal-orders?phone=${encodeURIComponent(String(phone))}`, {
          headers: { Authorization: `Bearer ${config.waBotSecret}` },
          signal: AbortSignal.timeout(10_000),
        });
        const data = res.ok ? await res.json().catch(() => null) : null;
        const orders = data?.orders || [];
        if (orders.length > 0) {
          const o = orders[0];
          lastOrderInfo = ` (último pedido: ${o.storeName} Nro. ${o.pickupNumber || o.id.slice(0, 8)}, ${o.status})`;
        }
      } catch { /* best-effort */ }
      replies.push("Lamento que tengas un problema con tu pedido. 🙏");
      replies.push(`Te comunico con una persona del equipo de Portal 659 para que te ayude.${lastOrderInfo}`);
      // Handoff a los admins del portal.
      await handoffHuman(vendor, waId, text, state);
      return await persist(state, vendor.id, waId, replies);
    }

    // — Tiempo de entrega ("¿cuándo llega?", "¿cuánto tarda?") —
    const RE_DELIVERY_TIME = /(?:cu[aá]ndo (?:llega|entrega|me llega)|cu[aá]nto (?:tarda|demora)|tiempo de (?:entrega|env[ií]o)|eta|demora)/i;
    if (RE_DELIVERY_TIME.test(text) && !/^(hola|buenas|buenos|chau|adios|gracias|ok|si|no|cancelar|ayuda|menu|menú|comercios)$/i.test(text.trim())) {
      const rawPhone = state.customerPhone || waId;
      const phone = String(rawPhone).startsWith("lid:") ? waId : rawPhone;
      try {
        const res = await fetch(`${config.appUrl}/api/wa/portal-orders?phone=${encodeURIComponent(String(phone))}`, {
          headers: { Authorization: `Bearer ${config.waBotSecret}` },
          signal: AbortSignal.timeout(10_000),
        });
        const data = res.ok ? await res.json().catch(() => null) : null;
        const orders = data?.orders || [];
        const activeOrder = orders.find((o) => o.status === "sent" || o.status === "preparing" || o.status === "ready");
        if (activeOrder) {
          const STATUS_ETA = { preparing: "Está en preparación", ready: "Listo para retirar", sent: "En camino" };
          replies.push(`${activeOrder.storeName} — ${STATUS_ETA[activeOrder.status] || activeOrder.status}.`);
          if (activeOrder.trackUrl) replies.push(`📦 Seguilo en tiempo real acá: ${activeOrder.trackUrl}`);
        } else if (orders.length > 0) {
          const o = orders[0];
          const STATUS_LABEL = { new: "Recibido", preparing: "En preparación", ready: "Listo", sent: "En camino", completed: "Completado" };
          replies.push(`Tu último pedido (${o.storeName}) está: ${STATUS_LABEL[o.status] || o.status}.`);
          if (o.trackUrl) replies.push(`📦 ${o.trackUrl}`);
        } else {
          replies.push("No encontré pedidos activos de tu número. Si hiciste un pedido, mandame el número o escribí *ayuda*. 🙌");
        }
        return await persist(state, vendor.id, waId, replies);
      } catch (e) {
        replies.push("No pude consultar el estado ahora. Probá de nuevo en un momento. 🙏");
        return await persist(state, vendor.id, waId, replies);
      }
    }

    // — Stock/disponibilidad ("¿tienen stock de X?", "¿hay X?") —
    const RE_STOCK = /(?:stock|disponible|disponibilidad|hay (?:stock|de)|tienen (?:stock|de))/i;
    if (RE_STOCK.test(text) && !/^(hola|buenas|buenos|chau|adios|gracias|ok|si|no|cancelar|ayuda|menu|menú|comercios)$/i.test(text.trim())) {
      const portalData = await fetchPortalMenu("");
      const stores = portalData.vendors || portalData.stores || [];
      const tn = String(text || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      // Extraer el nombre del producto buscado (quitar palabras de stock)
      const searchTerm = tn.replace(/(?:stock|disponible|disponibilidad|hay|tienen|de|del|la|el|los|las|un|una)\b/g, "").trim();
      const matches = [];
      for (const s of stores) {
        for (const p of s.products || []) {
          const pn = String(p.name || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
          if (searchTerm && pn.includes(searchTerm)) {
            const stockInfo = p.stock_control ? (p.stock > 0 ? `Stock: ${p.stock}` : "Sin stock") : "Disponible";
            matches.push({ store: s.store_name, product: p.name, stock: stockInfo, price: p.price });
          }
        }
      }
      if (matches.length === 0) {
        replies.push("No encontré ese producto en la zona. Escribí *comercios* para ver todas las tiendas. 🙌");
        return await persist(state, vendor.id, waId, replies);
      }
      if (!state.welcomed) { replies.unshift("¡Hola! 👋 Soy el asistente de *Portal 659*."); state.welcomed = true; }
      replies.push("Disponibilidad:");
      for (const m of matches.slice(0, 8)) {
        replies.push(`  • ${m.product} en *${m.store}* — $${Number(m.price).toLocaleString("es-AR")} (${m.stock})`);
      }
      replies.push("¿Querés pedir alguno? Mandame el nombre del producto o el número del comercio.");
      return await persist(state, vendor.id, waId, replies);
    }

    // — Cancelación de pedido ("quiero cancelar mi pedido") —
    const RE_CANCEL_ORDER = /(?:cancelar|cancel[aá]|anular)\s+(?:mi\s+)?pedido/i;
    if (RE_CANCEL_ORDER.test(text)) {
      const rawPhone = state.customerPhone || waId;
      const phone = String(rawPhone).startsWith("lid:") ? waId : rawPhone;
      try {
        const res = await fetch(`${config.appUrl}/api/wa/portal-orders?phone=${encodeURIComponent(String(phone))}`, {
          headers: { Authorization: `Bearer ${config.waBotSecret}` },
          signal: AbortSignal.timeout(10_000),
        });
        const data = res.ok ? await res.json().catch(() => null) : null;
        const orders = (data?.orders || []).filter((o) => o.status === "new" || o.status === "confirmed" || o.status === "preparing");
        if (orders.length === 0) {
          replies.push("No tenés pedidos pendientes para cancelar. Si tenés un problema con un pedido, escribí *ayuda*. 🙌");
          return await persist(state, vendor.id, waId, replies);
        }
        const o = orders[0];
        replies.push(`Tu pedido ${o.pickupNumber ? `Nro. ${o.pickupNumber}` : ""} de *${o.storeName}* está en estado "${o.status}".`);
        replies.push("Para cancelarlo, escribí *ayuda* y una persona del equipo te asiste (la cancelación requiere confirmación). 🙌");
        return await persist(state, vendor.id, waId, replies);
      } catch (e) {
        replies.push("No pude consultar tus pedidos ahora. Probá de nuevo en un momento. 🙏");
        return await persist(state, vendor.id, waId, replies);
      }
    }

    // El bot central SIEMPRE toma pedidos (es su propósito): no pasa por el
    // gate global BOT_TAKE_ORDERS — ese gate gobierna solo a los comercios.

    // En flujo de pedido con un comercio elegido: reusar el flow normal.
    if (state.currentVendorId && state.step !== "idle") {
      const chosenVendor = { id: state.currentVendorId, store_name: state.currentVendorName || "Comercio", slug: state.currentVendorSlug || null, enabled: true, transfer_alias: state.currentVendorTransfer?.alias || null, transfer_cbu: state.currentVendorTransfer?.cbu || null, transfer_holder: state.currentVendorTransfer?.holder || null, delivery_options: state.currentVendorDelivery || "ambos" };
      await handleStep({ vendor: chosenVendor, text, state, replies, waId });
      // Si el pedido se confirmó y se limpió, ofrecer otro comercio.
      if (state._cleared) {
        state.currentVendorId = null;
        state.currentVendorName = null;
        state.currentVendorSlug = null;
        state.items = [];
        state.step = "idle";
        state._cleared = false;
        replies.push("¿Querés pedir de otro comercio? Mandame el nombre del producto o escribí *comercios*.");
      }
      return await persist(state, vendor.id, waId, replies);
    }

    // Idle con comercio elegido: flujo normal de ese comercio.
    if (state.currentVendorId && state.step === "idle") {
      // Cambiar de comercio si lo pide.
      if (/^(otro|cambiar|volver|comercios|menu|menú)$/i.test(text.trim())) {
        state.currentVendorId = null;
        state.currentVendorName = null;
        state.currentVendorSlug = null;
        state.items = [];
        state.step = "idle";
        state.portalVendorList = [];
        // cae al bloque de portal idle abajo
      } else {
        const chosenVendor = { id: state.currentVendorId, store_name: state.currentVendorName || "Comercio", slug: state.currentVendorSlug || null, enabled: true, transfer_alias: state.currentVendorTransfer?.alias || null, transfer_cbu: state.currentVendorTransfer?.cbu || null, transfer_holder: state.currentVendorTransfer?.holder || null, delivery_options: state.currentVendorDelivery || "ambos" };
        await handleIdle({ vendor: chosenVendor, text, state, replies, waId });
        return await persist(state, vendor.id, waId, replies);
      }
    }

    // — Portal idle: sin comercio elegido —
    // 1) Si el cliente responde un número de la última lista mostrada → elegir comercio.
    const numMatch = text.trim().match(/^(\d+)$/);
    if (numMatch && state.portalVendorList && state.portalVendorList.length > 0) {
      const idx = Number(numMatch[1]) - 1;
      if (idx >= 0 && idx < state.portalVendorList.length) {
        const chosen = state.portalVendorList[idx];
        // Buscar los datos completos de la tienda (transfer, delivery, open) en el menú del portal.
        const portalData = await fetchPortalMenu("");
        const storeInfo = (portalData.vendors || portalData.stores || []).find((s) => s.id === chosen.id) || chosen;
        state.currentVendorId = chosen.id;
        state.currentVendorName = chosen.store_name;
        state.currentVendorSlug = chosen.slug || storeInfo.slug || null;
        state.currentVendorTransfer = { alias: storeInfo.transfer_alias || null, cbu: storeInfo.transfer_cbu || null, holder: storeInfo.transfer_holder || null };
        state.currentVendorDelivery = storeInfo.delivery_options || "ambos";
        // Aviso si está cerrado (pero permitimos pedir igual).
        if (storeInfo.store_open === false) {
          replies.push(`⚠️ *${chosen.store_name}* está cerrado ahora. ${storeInfo.next_open_text || ""} Podés ver el menú y hacer el pedido para cuando abra.`);
        }
        // Auto-setear método si la tienda solo acepta uno.
        if (state.currentVendorDelivery === "retiro") state.method = "pickup";
        else if (state.currentVendorDelivery === "domicilio") state.method = "delivery";
        else state.method = null;
        state.portalVendorList = [];
        state.items = [];
        state.step = "idle";
        const products = await getMenu(chosen.id);
        replies.push(`Perfecto, estás pidiendo de *${chosen.store_name}*. 📋 Menú:`);
        replies.push(products.slice(0, 20).map((p, i) => `${i + 1}) ${p.name} — $${p.price}`).join("\n") || "Sin productos disponibles.");
        const link = chosen.slug ? `\nMirá el menú con fotos: ${config.publicUrl}/tienda/${chosen.slug}` : "";
        replies.push(`Mandame tu pedido (ej: "2 empanadas de carne y una coca").${link}`);
        return await persist(state, vendor.id, waId, replies);
      }
    }

    // 2) Traer SIEMPRE el menú completo de la zona (sin filtro q) para poder
    //    mostrar todos los comercios si no hay coincidencia de producto.
    const portalData = await fetchPortalMenu("");
    const vendorsWithProducts = (portalData.vendors || []).filter((v) => (v.products || []).length > 0);

    // Normalizar para comparar: minúsculas, sin tildes, plural→singular aproximado.
    function norm(s) {
      return String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
    }
    function stem(w) {
      return w.replace(/(es|s)$/i, "");
    }

    // 1b) Selección por NOMBRE de comercio: si el texto menciona el nombre de
    //     un comercio de la lista mostrada (o de la zona), entrar directo sin
    //     pedir el número ("pedir de Azahar" → entra a Azahar).
    if (text.length >= 3 && !/^(hola|buenas|buenos|chau|adios|gracias|ok|si|no|cancelar|ayuda|menu|menú|comercios)$/i.test(text.trim())) {
      const tn = norm(text);
      const tTokens = tn.split(" ").filter(Boolean).map(stem);
      const candidates = (Array.isArray(state.portalVendorList) && state.portalVendorList.length > 0
        ? state.portalVendorList
        : vendorsWithProducts.map((v) => ({ id: v.id, store_name: v.store_name })));
      const nameHit = candidates.find((v) => {
        const vn = norm(v.store_name);
        const vTokens = vn.split(" ").filter(Boolean).map(stem);
        if (!vTokens.length) return false;
        // el nombre completo contenido en el mensaje, o todos los tokens del
        // nombre aparecen en el mensaje ("pedir de heladería 655")
        return vn === tn || tn.includes(vn) || vTokens.every((vt) => tTokens.some((tt) => tt === vt || tt.includes(vt) || vt.includes(tt)));
      });
      if (nameHit) {
        const portalData2 = await fetchPortalMenu("");
        const storeInfo2 = (portalData2.vendors || portalData2.stores || []).find((s) => s.id === nameHit.id) || nameHit;
        state.currentVendorId = nameHit.id;
        state.currentVendorName = nameHit.store_name;
        state.currentVendorSlug = nameHit.slug || storeInfo2.slug || null;
        state.currentVendorTransfer = { alias: storeInfo2.transfer_alias || null, cbu: storeInfo2.transfer_cbu || null, holder: storeInfo2.transfer_holder || null };
        state.currentVendorDelivery = storeInfo2.delivery_options || "ambos";
        if (storeInfo2.store_open === false) {
          replies.push(`⚠️ *${nameHit.store_name}* está cerrado ahora. ${storeInfo2.next_open_text || ""} Podés ver el menú y hacer el pedido para cuando abra.`);
        }
        if (state.currentVendorDelivery === "retiro") state.method = "pickup";
        else if (state.currentVendorDelivery === "domicilio") state.method = "delivery";
        else state.method = null;
        state.portalVendorList = [];
        state.items = [];
        state.step = "idle";
        const products = await getMenu(nameHit.id);
        replies.push(`Perfecto, estás pidiendo de *${nameHit.store_name}*. 📋 Menú:`);
        replies.push(products.slice(0, 20).map((p, i) => `${i + 1}) ${p.name} — $${p.price}`).join("\n") || "Sin productos disponibles.");
        const link = nameHit.slug ? `\nMirá el menú con fotos: ${config.publicUrl}/tienda/${nameHit.slug}` : "";
        replies.push(`Mandame tu pedido (ej: "2 empanadas de carne y una coca").${link}`);
        return await persist(state, vendor.id, waId, replies);
      }
    }

    // Filtrar por texto si hay búsqueda (sobre el menú completo, en cliente).
    let matches = [];
    if (text.length > 2 && !/^(hola|buenas|buenos|chau|adios|gracias|ok|si|no|cancelar|ayuda|menu|menú|comercios)$/i.test(text.trim())) {
      const t = norm(text);
      const qTokens = t.split(" ").filter(Boolean).map(stem);
      for (const v of vendorsWithProducts) {
        for (const p of v.products || []) {
          const pn = norm(p.name);
          const cn = norm(p.category);
          const pTokens = pn.split(" ").filter(Boolean).map(stem);
          // match si algún token de la búsqueda está en el nombre/categoría (o viceversa)
          const hit = qTokens.some((qt) => pTokens.some((pt) => pt === qt || pt.includes(qt) || qt.includes(pt)) || cn.includes(qt) || qt.includes(cn));
          if (hit) matches.push({ vendor: v, product: p });
        }
      }
    }

    if (matches.length > 0) {
      // Agrupar por comercio para comparar
      const byVendor = new Map();
      for (const m of matches) {
        if (!byVendor.has(m.vendor.id)) byVendor.set(m.vendor.id, { vendor: m.vendor, products: [] });
        byVendor.get(m.vendor.id).products.push(m.product);
      }
      const list = Array.from(byVendor.values());
      state.portalVendorList = list.map((x) => ({ id: x.vendor.id, store_name: x.vendor.store_name, slug: x.vendor.slug || null }));
      const lines = [];
      list.forEach((x, i) => {
        const prods = x.products.slice(0, 8).map((p) => `${p.name} $${p.price}`).join(", ");
        lines.push(`${i + 1}) *${x.vendor.store_name}* — ${prods}`);
      });
      // Detectar si la búsqueda fue por categoría (el texto coincide con una
      // categoría existente) para mostrar un encabezado más claro.
      const t = norm(text);
      const qTokens = t.split(" ").filter(Boolean).map(stem);
      const allCategories = new Set();
      for (const v of vendorsWithProducts) for (const p of v.products || []) if (p.category) allCategories.add(norm(p.category));
      const categoryMatch = [...allCategories].find((c) => qTokens.some((qt) => c === qt || c.includes(qt) || qt.includes(c)));
      if (!state.welcomed) {
        const _greetName = state.customerName ? ` ${state.customerName}` : "";
        const _lastOrderHint = state._lastOrder ? `\n¿El pedido de siempre? (${state._lastOrder.storeName}: ${state._lastOrder.pickupNumber ? "Nro. " + state._lastOrder.pickupNumber : ""}) o ¿algo diferente?` : "";
        replies.unshift(`¡Hola${_greetName}! 👋 Soy el asistente de *Portal 659*.${_lastOrderHint}`);
        state.welcomed = true;
      }
      if (categoryMatch) {
        replies.push(`Productos de la categoría *${categoryMatch}*:`);
      } else {
        replies.push("Encontré en estos comercios:");
      }
      replies.push(lines.join("\n"));
      replies.push("¿De cuál querés pedir? Respondé el número.");
      return await persist(state, vendor.id, waId, replies);
    }

    // 3) Sin coincidencia: mostrar comercios disponibles (solo la primera vez
    //    o si no habíamos mostrado la lista; si ya la vio, no repetir el listado).
    if (vendorsWithProducts.length > 0) {
      const alreadyListed = Array.isArray(state.portalVendorList) && state.portalVendorList.length > 0;
      if (!alreadyListed) {
        // Lista acotada (Fase 3): máximo 8 comercios; el resto se alcanza por
        // nombre o buscando un producto.
        const CAP = 8;
        const shown = vendorsWithProducts.slice(0, CAP);
        state.portalVendorList = shown.map((v) => ({ id: v.id, store_name: v.store_name, slug: v.slug || null }));
        const lines = shown.map((v, i) => `${i + 1}) *${v.store_name}* (${(v.products || []).length} productos)`);
        if (!state.welcomed) {
          replies.push("¡Hola! 👋 Soy el asistente de *Portal 659*. Estos son los comercios de tu zona:");
          state.welcomed = true;
        } else {
          replies.push("Comercios de tu zona:");
        }
        replies.push(lines.join("\n"));
        if (vendorsWithProducts.length > CAP) {
          replies.push(`(y ${vendorsWithProducts.length - CAP} más — escribí el nombre del comercio para verlo)`);
        }
        replies.push("Mandame el nombre de un producto para buscar, o el nombre o número del comercio para ver su menú.");
      } else {
        replies.push("No encontré ese producto. Mandame otro nombre, o el nombre o número del comercio de la lista anterior.");
      }
      return await persist(state, vendor.id, waId, replies);
    }

    if (!state.welcomed) {
      const _greetName2 = state.customerName ? ` ${state.customerName}` : "";
      replies.push(`¡Hola${_greetName2}! 👋 Soy el asistente de *Portal 659*.`);
      state.welcomed = true;
    }
    replies.push("No encontré comercios con productos en tu zona por ahora. Escribí *ayuda* si necesitás asistencia.");
    return await persist(state, vendor.id, waId, replies);

  } catch (e) {
    console.error("[bot][portal] error:", e?.message, "|", e?.stack?.split("\n")[1]);
    const msg = String(e?.message || "");
    if (msg && !/fetch|network|timeout|ENOTFOUND|ECONNREFUSED|EAI_AGAIN|etag/i.test(msg)) {
      return { replies: [`${msg}`] };
    }
    return { replies: ["Uy, hubo un error. Mandame el mensaje de nuevo en un segundo. 🙏"] };
  }
}

export async function sweepStaleConversations() {
  const now = Date.now();
  const TIMEOUT = config.handoffTimeoutMin * 60 * 1000;

  await forEachConversation(async (vendorId, waId, state) => {
    if (!state || !state.step) return;
    // Anti-loop: ya derivado (pausa activa) → el scan no repite.
    if (state.pausedUntil && state.pausedUntil > now) return;
    // Solo estados esperando respuesta del cliente.
    if (!SWEEP_WAITING_STEPS.has(state.step)) return;
    const touched = Number(state.touchedAt) || 0;
    if (!touched || now - touched < TIMEOUT) return;

    // El vendor viene de la conexión del relay (si no está conectado, no hay
    // nada que enviar y el push no tiene sentido sin el contexto del comercio).
    const client = getClientByVendor(vendorId);
    if (!client || !client.vendor || client.vendor.enabled === false) return;
    const vendor = client.vendor;
    // Rate limit de salida para el aviso al cliente (el push al dueño siempre va).
    const lastUserMsg = Array.isArray(state.history)
      ? [...state.history].reverse().find((h) => h.role === "user")?.text || ""
      : "";

    // Aviso al cliente (con pacing humano, como el resto del bot).
    try {
      await sleep(humanDelay(20));
      sendTyping(client, waId);
      sendText(client, waId, `Enseguida te atiende una persona de *${vendor.store_name}* 🙌`);
      sendPaused(client, waId);
    } catch { /* el push al dueño va igual */ }

    // Push al dueño con contexto (teléfono + último mensaje) — la "nota interna".
    await notifyHandoff(vendorId, waId, lastUserMsg || "(sin mensaje)");

    // Pausa: el scan no repite (anti-loop) y la persona atiende tranquila.
    state.pausedUntil = Date.now() + HANDOFF_PAUSE_MIN * 60 * 1000;
    await setState(vendorId, waId, state).catch(() => {});
    console.log(`[sweep] ${vendor.store_name} (${waId}) sin respuesta > ${config.handoffTimeoutMin} min — derivado a persona`);
  });
}

async function notifyHandoff(vendorId, waId, text) {
  try {
    await fetch(`${config.appUrl}/api/wa/handoff`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.waBotSecret}` },
      body: JSON.stringify({ vendorId, waId, lastMessage: text.slice(0, 200) }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    console.error("[bot] handoff notify:", e.message);
  }
}

// ———————————————————————————————————————————————————————————————————————————
// Persistencia
// ———————————————————————————————————————————————————————————————————————————

async function persist(state, vendorId, waId, replies) {
  // Si el handler ya limpió el estado (pedido confirmado / cancelado), NO
  // volverlo a guardar: re-seriarlo acá re-creaba el chat zombie (un segundo
  // "sí" re-confirmaba el mismo pedido).
  if (state._cleared) return { replies };
  // Historial de respuestas del bot (contexto para la próxima llamada IA).
  if (Array.isArray(replies) && replies.length) {
    state.history.push(...replies.map((r) => ({ role: "bot", text: r.slice(0, 200) })));
    if (state.history.length > 16) state.history = state.history.slice(-16);
  }
  await setState(vendorId, waId, state, state.step === "awaiting_receipt" ? AWAITING_RECEIPT_TTL : undefined);
  return { replies };
}

// ———————————————————————————————————————————————————————————————————————————
// Saludo (texto aprobado)
// ———————————————————————————————————————————————————————————————————————————

function greetingText(vendor) {
  const url = shopUrl(vendor);
  return `Hola 👋 Soy el asistente de *${vendor.store_name}*.

📲 Pedí desde nuestro menú online:
${url}

¿Ya sabés qué pedir?
Escribilo directamente y yo lo confirmo.`;
}

function transferText(vendor, total) {
  const lines = ["Para el pago:"];
  if (vendor.transfer_alias) lines.push(`Alias: ${vendor.transfer_alias}`);
  if (vendor.transfer_cbu) lines.push(`CBU: ${vendor.transfer_cbu}`);
  if (total != null) lines.push(`Monto: $${Number(total).toLocaleString("es-AR")}`);
  lines.push("Mandame la foto o el PDF del comprobante por acá y le aviso al comercio. ✅");
  return lines.join("\n");
}

// ———————————————————————————————————————————————————————————————————————————
// Media: comprobante de transferencia (foto/PDF)
// ———————————————————————————————————————————————————————————————————————————

/** State de "esperando comprobante" para pedidos creados por FUERA del flujo
 *  del asistente (pedidos web). Lo llama el cerebro (POST /send) cuando el
 *  comercio ACEPTA un pedido con transferencia: el comprobante que el cliente
 *  mande por el chat entra por handleInboundMedia → /api/wa/receipt →
 *  transfer_proof_url → visible en el panel. */
export async function startAwaitingReceipt(vendor, waId, orderId, phone) {
  const state = {
    ...DEFAULT_STATE,
    step: "awaiting_receipt",
    orderId: orderId || null,
    welcomed: true,
    customerPhone: phoneFor(waId, null) || phone || null,
    items: [],
  };
  await setState(vendor.id, waId, state, AWAITING_RECEIPT_TTL);
  return state;
}

/** Pedido de transferencia pendiente más reciente de un teléfono (sin
 *  comprobante, últimas 48h). Para el fallback del comprobante. */
async function findPendingReceiptOrder(vendorId, phone) {
  try {
    const res = await fetch(
      `${config.appUrl}/api/wa/pending-receipt?vendorId=${encodeURIComponent(vendorId)}&phone=${encodeURIComponent(String(phone))}`,
      { headers: { Authorization: `Bearer ${config.waBotSecret}` }, signal: AbortSignal.timeout(10_000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.orderId || null;
  } catch {
    return null;
  }
}

export async function handleInboundMedia({ vendor, waId, mime, name, buffer, waPhone }) {
  let state = await getState(vendor.id, waId);
  if (!state || state.step !== "awaiting_receipt" || !state.orderId) {
    // FALLBACK: el comprobante llegó cuando el chat ya no estaba en espera
    // (llegó tarde, el cliente escribió antes, o el estado se perdió).
    // Buscar el pedido de transferencia pendiente más reciente de este teléfono
    // y subirlo con ese orderId — el comprobante nunca se pierde.
    const phone = waPhone || state?.customerPhone || waId;
    const orderId = await findPendingReceiptOrder(vendor.id, phone);
    if (!orderId) return { handled: false };
    state = { step: "awaiting_receipt", orderId };
  }

  try {
    const fd = new FormData();
    fd.append("orderId", state.orderId);
    fd.append("vendorId", vendor.id);
    fd.append("file", new Blob([buffer], { type: mime }), name || `comprobante.${mime === "application/pdf" ? "pdf" : "jpg"}`);

    const res = await fetch(`${config.appUrl}/api/wa/receipt`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.waBotSecret}` },
      body: fd,
      signal: AbortSignal.timeout(30_000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error("[bot] receipt:", res.status, JSON.stringify(data).slice(0, 80));
      return { handled: true, replies: [data.error || "No lo pude guardar. Mandame la foto o el PDF de nuevo. 🙏"] };
    }
    await clearState(vendor.id, waId);
    return {
      handled: true,
      replies: [
        data.trackToken
          ? `✅ Comprobante recibido. El comercio lo verifica y comienza a preparar tu pedido.\n\n📦 Seguí tu pedido acá: ${trackUrl(data.trackToken)}`
          : "✅ Comprobante recibido. El comercio lo verifica y te avisa enseguida. 👍",
        "¿Querés pedir de otra tienda? Mandame el nombre del producto o escribí *comercios*. 🛒",
      ],
    };
  } catch (e) {
    console.error("[bot] receipt error:", e.message);
    return { handled: true, replies: ["Hubo un problema técnico. Probá reenviar en un segundo."] };
  }
}
