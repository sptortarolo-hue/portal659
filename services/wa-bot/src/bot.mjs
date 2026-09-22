import { config } from "./config.mjs";
import { getState, setState, clearState } from "./state.mjs";
import { getMenu, matchProduct, menuSummary } from "./menu.mjs";
import { parseWithLlm, parseByRules } from "./nlu.mjs";

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
};

const AWAITING_RECEIPT_TTL = 15 * 60; // 15 min para acreditar el comprobante
const HANDOFF_PAUSE_MIN = 30;
const MAX_PARSE_MISSES = 2;

// Regexes
const RE_CANCEL   = /^(cancelar|no gracias|basta)\b/i;
const RE_CONFIRM  = /^(sí|si|dale|ok|okey|bueno|perfecto|confirmo|confirmar|listo)(?=[\s.,!¡]|$)/i;
const RE_NO       = /^(no|nop|cancelar todo)\b/i;
const RE_HUMAN    = /hablar con (una )?persona|hablar con alguien|humano|dueño|dueña|atención humana/i;
const RE_MENU     = /\b(menú|menu|carta)\b/i;
const RE_PICKUP   = /\b(retiro|retirar|paso por|voy por|busco)\b/i;
const RE_DELIVERY = /\b(envío|envio|delivery|domicilio|despachen)\b/i;
const RE_TRANSFER = /\b(transferencia|transferir|cbu|alias)\b/i;
const RE_CASH     = /\b(efectivo|cash)\b/i;
const RE_GREETING = /^(hola|buenas|buen día|buenos días|buenas tardes|buenas noches|hi|hey|hello)\b/i;

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
      return {
        offerId: prod?.id || p.offerId || p.id,
        name: p.name,
        qty: Math.max(1, Number(p.qty) || 1),
        modifiers: Array.isArray(p.modifiers) ? p.modifiers : [],
      };
    })
    .filter((p) => p.offerId);
}

function enrichParsed(products, parsed) {
  if (!parsed) return parsed;
  parsed.items = resolveOfferIds(products, parsed.items);
  return parsed;
}

export async function handleInbound({ vendor, waId, body }) {
  const text = String(body || "").trim();
  const state = (await getState(vendor.id, waId)) || { ...DEFAULT_STATE };
  const replies = [];

  try {
    if (!vendor.enabled) return { replies: [], handoff: true };

    // Pausa por handoff reciente: el dueño atiende, el bot calla.
    if (state.pausedUntil && state.pausedUntil > Date.now()) return { replies: [] };

    // Cancelación global (siempre disponible).
    if (RE_CANCEL.test(text)) {
      await clearState(vendor.id, waId);
      return { replies: ["Ok, cancelé todo. Cuando quieras retomamos. 👍"] };
    }

    // Handoff explícito.
    if (RE_HUMAN.test(text)) {
      return await handoffHuman(vendor, waId, text, state);
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
    // No limpiar el state: un error transitorio no debe resetear el pedido.
    return { replies: ["Uy, hubo un error. Mandame el mensaje de nuevo en un segundo. 🙏"] };
  }
}

// ———————————————————————————————————————————————————————————————————————————
// Idle: primer contacto / pedido de una
// ———————————————————————————————————————————————————————————————————————————

async function handleIdle({ vendor, text, state, replies, waId }) {
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
  let parsed = enrichParsed(
    products,
    (await parseWithLlm(text, products).catch(() => null)) || parseByRules(text, products)
  );

  if (parsed?.items?.length) {
    state.welcomed = true;
    applyParsed(state, parsed, waId);
    advanceAndAsk(state, vendor, replies);
    return;
  }

  // Nada entendido: contar miss; a los 2 → handoff.
  state.handoffCount = (state.handoffCount || 0) + 1;
  if (state.handoffCount >= MAX_PARSE_MISSES) {
    return handoffHuman(vendor, waId, text, state);
  }
  replies.push(`No te entendí bien. Escribime el pedido directo, ej: *"2 empanadas de carne y una coca"*. O mirá el menú: ${shopUrl(vendor)}`);
}

// ———————————————————————————————————————————————————————————————————————————
// En flujo: respuesta del cliente completa o corrige el pedido
// ———————————————————————————————————————————————————————————————————————————

async function handleStep({ vendor, text, state, replies, waId }) {
  const t = text.trim();

  // En confirm: "sí" crea; "no" cancela; cualquier otra cosa = corrección.
  if (state.step === "confirm") {
    if (RE_CONFIRM.test(t)) {
      const order = await createOrder(vendor.id, state);
      if (state.payment === "transferencia") {
        state.step = "awaiting_receipt";
        state.orderId = order.orderId || order.id;
        replies.push("✅ Pedido confirmado. Quedó pendiente de pago.");
        replies.push(transferText(vendor, order.total));
      } else {
        replies.push("✅ ¡Pedido confirmado! Te avisamos por acá cuando esté listo.");
        state._cleared = true;
        await clearState(vendor.id, waId);
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
    const products = await getMenu(vendor.id);
    const parsed = enrichParsed(
      products,
      (await parseWithLlm(t, products).catch(() => null)) || parseByRules(t, products)
    );
    if (parsed?.items?.length) {
      applyParsed(state, parsed, waId);
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
  const parsed = enrichParsed(
    products,
    (await parseWithLlm(t, products).catch(() => null)) || parseByRules(t, products)
  );

  let got = false;
  // Se actualizan SIEMPRE (no solo si falta): el cliente puede cambiar de idea
  // en medio del flujo ("mejor retiro" tras decir "envío", "mejor efectivo"…).
  if (parsed?.method && parsed.method !== state.method) { state.method = parsed.method; got = true; }
  if (parsed?.customerAddress && parsed.customerAddress !== state.customerAddress) { state.customerAddress = parsed.customerAddress; got = true; }
  if (parsed?.customerName && parsed.customerName !== state.customerName) { state.customerName = parsed.customerName; got = true; }
  if (parsed?.payment && parsed.payment !== state.payment) { state.payment = parsed.payment; got = true; }

  // Productos en la respuesta: distinguir AGREGAR de RE-DECLARAR.
  // Con verbos de suma ("agregá/también/sumá/más") se suman al carrito; en
  // cualquier otro caso el mensaje ES el pedido actualizado → reemplaza.
  // Antes siempre sumaba: repetir el pedido lo duplicaba (×4 en vez de ×2).
  if (parsed?.items?.length) {
    const isAddition = /\b(agrega|agregá|agregar|también|tambien|sumá|suma|sumar|más|mas)\b/i.test(t);
    if (isAddition) {
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
      replies.push(summaryText(state));
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
  if (!got && fieldsNow.includes("address") && t.length >= 4 &&
      (/\d/.test(t) || /^(calle|av|avenida|pasaje|bulevar|diagonal|ruta|juan b|gral|barrio|localidad)/i.test(t))) {
    state.customerAddress = t;
    got = true;
  }

  if (got) {
    state.handoffCount = 0;
    advanceAndAsk(state, vendor, replies);
    return;
  }

  // No entendió la respuesta: repetir las preguntas pendientes (combinadas).
  state.handoffCount = (state.handoffCount || 0) + 1;
  if (state.handoffCount >= MAX_PARSE_MISSES) {
    return handoffHuman(vendor, waId, text, state);
  }
  replies.push(pendingQuestions(state) + "\n\nNo entendí eso — respondé lo que te pregunto arriba. 🙏");
}

// ———————————————————————————————————————————————————————————————————————————
// Preguntas combinadas: UN solo mensaje con TODO lo que falta
// ———————————————————————————————————————————————————————————————————————————

function advanceAndAsk(state, vendor, replies) {
  const missing = missingFields(state, vendor);

  if (missing.length === 0) {
    // Todo completo: resumen + confirmación.
    state.step = "confirm";
    replies.push(summaryText(state));
    return;
  }

  state.step = "flow";
  state.pendingFields = missing;
  replies.push(pendingQuestions(state));
}

function missingFields(state, vendor) {
  const out = [];
  if (!state.method) out.push("method");
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
    ? `Tu pedido:\n${state.items.map((i) => `• ${i.name} ×${i.qty}`).join("\n")}\n\n`
    : "";
  const questions = lines.length ? `${lines.join("\n")}\n\n` : "";
  return `${cart}${questions}Respondé todo junto en un mensaje (ej: *"envío a calle 5 123, Juan, transferencia"*), o de a una cosa. 👇`;
}

function summaryText(state) {
  const lines = state.items.map((i) => `• ${i.name} ×${i.qty}`);
  const method = state.method === "delivery" ? `🛵 Envío a ${state.customerAddress}` : "🏬 Retiro en el local";
  const payment =
    state.payment === "transferencia" ? "🏦 Transferencia" :
    state.payment === "efectivo" ? "💵 Efectivo" : "💳 Coordinamos por WhatsApp";
  return [
    "✅ Tu pedido:",
    lines.join("\n"),
    "",
    `${method} · ${payment}`,
    state.customerName ? `Nombre: ${state.customerName}` : "",
    "",
    "¿Todo bien? Contestá *sí* para confirmar o *no* para cambiarlo.",
  ].filter(Boolean).join("\n");
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
  state.items = (parsed.items || []).map((p) => ({
    offerId: p.offerId || p.id,
    name: p.name,
    qty: Math.max(1, Number(p.qty) || 1),
    modifiers: p.modifiers || [],
  }));
  if (parsed.customerName) state.customerName = parsed.customerName;
  if (!state.customerPhone) state.customerPhone = normalizePhone(waId);
  if (parsed.note) state.note = parsed.note;
  if (parsed.method === "pickup" || parsed.method === "delivery") state.method = parsed.method;
  if (parsed.customerAddress) state.customerAddress = parsed.customerAddress;
  if (parsed.payment === "transferencia" || parsed.payment === "efectivo") state.payment = parsed.payment;
}

function mergeItems(state, newItems) {
  for (const p of newItems) {
    const offerId = p.offerId || p.id;
    const mods = p.modifiers || [];
    const existing = state.items.find((i) => i.offerId === offerId && (i.modifiers || []).length === mods.length);
    if (existing) existing.qty += Math.max(1, Number(p.qty) || 1);
    else state.items.push({ offerId, name: p.name, qty: Math.max(1, Number(p.qty) || 1), modifiers: mods });
  }
  // Dedupe de defensa: jamás dos entradas del mismo producto (offerId+mods).
  const seen = new Map();
  state.items = state.items.filter((i) => {
    const k = `${i.offerId}|${(i.modifiers || []).map((m) => (typeof m === "string" ? m : m.label || m.group)).join(",")}`;
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
      items: state.items.map((i) => ({ offerId: i.offerId, qty: i.qty, modifiers: i.modifiers })),
      notes: state.note || null,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `order ${res.status}`);
  return data;
}

// ———————————————————————————————————————————————————————————————————————————
// Handoff a humano
// ———————————————————————————————————————————————————————————————————————————

async function handoffHuman(vendor, waId, text, state) {
  state.pausedUntil = Date.now() + HANDOFF_PAUSE_MIN * 60 * 1000;
  state.handoffCount = 0;
  await setState(vendor.id, waId, state);
  await notifyHandoff(vendor.id, waId, text);
  return { replies: ["Te paso con el comercio — te contestan enseguida por este chat. 🙌"] };
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

export async function handleInboundMedia({ vendor, waId, mime, name, buffer }) {
  const state = await getState(vendor.id, waId);
  if (!state || state.step !== "awaiting_receipt" || !state.orderId) return { handled: false };

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
      return { handled: true, replies: ["No lo pude guardar. Mandame la foto o el PDF de nuevo. 🙏"] };
    }
    await clearState(vendor.id, waId);
    return { handled: true, replies: ["✅ Comprobante recibido. El comercio lo verifica y te avisa enseguida. 👍"] };
  } catch (e) {
    console.error("[bot] receipt error:", e.message);
    return { handled: true, replies: ["Hubo un problema técnico. Probá reenviar en un segundo."] };
  }
}
