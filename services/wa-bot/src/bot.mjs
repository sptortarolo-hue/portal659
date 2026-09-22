import { config } from "./config.mjs";
import { getState, setState, clearState } from "./state.mjs";
import { getMenu, matchProduct, menuSummary } from "./menu.mjs";
import { parseWithLlm, parseByRules } from "./nlu.mjs";

const DEFAULT_STATE = {
  step: "idle",
  items: [],
  method: null,
  payment: null,
  customerName: null,
  note: null,
  handoffCount: 0,
  pausedUntil: 0,
  orderId: null,
};

const AWAITING_RECEIPT_TTL = 15 * 60; // 15 min para mandar comprobante
const HANDOFF_PAUSE_MIN = 30;
const MAX_PARSE_MISSES = 2;

// — Regexes de control de flujo
const RE_CANCEL    = /^(cancelar|no gracias|basta|me olvidé|olvide)\s*$/i;
const RE_CONFIRM   = /^(sí|si|dale|ok|okey|bueno|perfecto|confirmo|confirmar|listo)\s*[.!]?\s*$/i;
const RE_NO        = /^(no|nop|noa)\s*[.!]?$/i;
const RE_HUMAN     = /hablar con (una )?persona|hablar con alguien|manejáte|manejate|handoff|^humano\b|^dueño\b|^dueña\b|want to (speak|talk) to (a )?(human|person)|operator|reception/i;
const RE_TRANSFER  = /transfer|cbu|alias|cvu/i;
const RE_EFECTIVO  = /efectivo|cash|efvo/i;
const RE_MENU      = /menu|menú|carta|precio|precios|qué (tenés|tenés|tienen)|qué venden|cosas venden/i;
const RE_PICKUP    = /retiro|picker|paso por|voy yo|por el local/i;
const RE_DELIVERY  = /envío|envio|delivery|domicilio|a domicilio|llega to mi casa/;
const RE_GREETING  = /^(hola|buenas|buenos dias|buenas tardes|buenas noches|hi|hey|hello)\b/i;

function normalizePhone(waId) {
  const s = String(waId || "");
  if (s.includes("@lid")) return "lid:" + s.split("@")[0];
  const stripped = s.includes("@") ? s.split("@")[0] : s;
  const n = stripped.replace(/[^\d]/g, "");
  if (!n) return "";
  if (n.startsWith("549")) return n;
  if (n.startsWith("54")) return "549" + n.slice(2);
  return "549" + n;
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

export async function handleInbound({ vendor, waId, body }) {
  const text = String(body || "").trim();
  const vendorId = vendor.id;
  const state = (await getState(vendorId, waId)) || { ...DEFAULT_STATE };
  const replies = [];
  const phone = normalizePhone(waId);

  try {
    // Kill-switch
    if (!vendor.enabled) return { replies: [], handoff: true };

    // Pausa derivación (handoff reciente → nada de IA, atiende el dueño)
    if (state.pausedUntil && state.pausedUntil > Date.now()) return { replies: [] };
    if (state.pausedUntil) { state.pausedUntil = 0; state.handoffCount = 0; }

    // Cancelar
    if (RE_CANCEL.test(text)) {
      await clearState(vendorId, waId);
      return { replies: ["Dale — cancelé todo. Si querés otra cosa, acá estoy. 🙂"] };
    }

    // Handoff explícito (cualquier mensaje con estas palabras clave)
    if (RE_HUMAN.test(text)) {
      return await performHandoff(vendor, waId, text, state, replies);
    }

    // Paso específico (estamos en un flujo)
    if (state.step !== "idle") {
      await handleStepFlow({ vendor, text, state, replies, waId, phone });
      return await persist(state, replies, vendorId, waId);
    }

    // Idle: intento de pedido o saludo
    await handleIdle({ vendor, text, state, replies, phone, waId });
    return await persist(state, replies, vendorId, waId);

  } catch (e) {
    console.error("[bot] error:", e?.stack || e);
    return { replies: ["Hubo un error técnico, perdón. Escribime de nuevo en un segundo. 🙏"] };
  }
}

// ———————————————————————————————————————————————————————————————————————————
// idle: primer mensaje → greeting o pedido directo
// ———————————————————————————————————————————————————————————————————————————

async function handleIdle({ vendor, text, state, replies, phone, waId }) {
  if (RE_MENU.test(text)) {
    // Solo menú
    const url = shopUrl(vendor);
    replies.push(`📋 Nuestro menú con fotos y precios:\n${url}\n\nEscribime tu pedido cuando quieras (ej: *2 empanadas de carne y una gaseosa*).`);
    return;
  }

  // Saludo puro (sin pedido)
  if (RE_GREETING.test(text) && !/[a-z]\s+\d|\d/.test(text)) {
    replies.push(greetingText(vendor));
    return;
  }

  // Pedido: intentar con IA primero.
  const parsed = await parseWithLlm(text, await getMenu(vendor.id)).catch(() => null);
  const items = Array.isArray(parsed?.items) ? parsed.items : [];
  const hasParsedItems = items.length > 0;

  if (hasParsedItems) {
    // Si la IA armó items, guardar en el estado
    applyParsed(items, parsed, state, phone);
    if (parsed.method) state.method = parsed.method;
    if (parsed.customerAddress) state.customerAddress = parsed.customerAddress;
    if (parsed.customerName) state.customerName = parsed.customerName;
    if (parsed.payment) state.payment = parsed.payment;
    // Avanzar al primer paso faltante — nunca saltao de una vez a confirm si falta algo.
    advanceToNextStep(state, vendor, replies);
    return;
  }

  // IA no entendió: tratamos por reglas (números + producto en el menú)
  const ruleBased = parseByRules(text, state.menuSnapshot ?? []);
  if (ruleBased?.items?.length) {
    applyParsed(ruleBased.items, ruleBased, state, phone);
    if (ruleBased.method) state.method = ruleBased.method;
    advanceToNextStep(state, vendor, replies);
    return;
  }

  // Nada entendido: miss
  state.handoffCount = (state.handoffCount || 0) + 1;
  if (state.handoffCount >= MAX_PARSE_MISSES) {
    return await performHandoff(vendor, waId, text, state, replies, "No entendí lo siguiente — puede pedirlo acá:");
  }
  replies.push(`No te entendí bien. Probá escribirlo distinto, por ejemplo: *2 empanadas y una gaseosa* ✏️`);
}

// ———————————————————————————————————————————————————————————————————————————
// Steps secuenciales (solo avanzan: cada mensaje los va completando)
// ———————————————————————————————————————————————————————————————————————————

async function handleStepFlow({ vendor, text, state, replies, waId, phone }) {
  const t = text;

  switch (state.step) {
    case "method": {
      if (RE_PICKUP.test(t)) state.method = "pickup";
      else if (RE_DELIVERY.test(t)) state.method = "delivery";
      else { replies.push("Contestame *retiro* o *envío*, así te lo preparo ya."); return; }
      break;
    }
    case "address": {
      if (t.length < 5) { replies.push("Pasame una dirección un poco más detallada, por favor."); return; }
      state.customerAddress = t;
      break;
    }
    case "name": {
      state.customerName = t;
      break;
    }
    case "payment": {
      if (RE_TRANSFER.test(t)) state.payment = "transferencia";
      else if (RE_EFECTIVO.test(t)) state.payment = "efectivo";
      else { replies.push("Pagás *efectivo* o *transferencia*?"); return; }
      break;
    }
    case "confirm": {
      if (RE_CONFIRM.test(t)) {
        await createAndConfirm(state, vendor, replies, waId);
        return;
      }
      if (RE_NO.test(t)) {
        await clearState(vendor.id, waId);
        replies.push("Dale, lo dejamos sin pedir. Si querés otra cosa me escribís.");
        return;
      }
      return;
    }
    case "awaiting_receipt": {
      replies.push("Estoy esperando el comprobante todavía — mandame la foto o PDF cuando quieras. Si cambiás de pago escribíme cancelar.");
      return;
    }
    default:
      state.step = "idle";
      await handleIdle({ vendor, text, state, replies, phone, waId });
      return;
  }

  // Avanzamos al siguiente paso según el estado al final de cada caso.
  if (state.step === "method" && state.method) {
    state.step = state.method === "delivery" ? "address" : (acceptsTransfer(vendor) ? "payment" : "confirm");
    if (state.step === "address") replies.push("¿A qué dirección te lo llevamos?");
    else if (state.step === "payment") replies.push("¿Efectivo o transferencia?");
    else replies.push(summaryText(state, vendor));
  }
  else if (state.step === "address" && state.method === "delivery") {
    state.step = acceptsTransfer(vendor) ? "payment" : "confirm";
    if (state.step === "payment") replies.push("¿Efectivo o transferencia?");
    else replies.push(summaryText(state, vendor));
  }
  else if (state.step === "payment" && state.payment) {
    state.step = "confirm";
    replies.push(summaryText(state, vendor));
  }
  else if (state.step === "confirm" && state.step === "confirm") {
    // el "confirm" ya lo manejé arriba; acá solo llego si siguio sin iros
    replies.push("Para confirmar decime *sí*; para cancelar *no*.");
  }
}

// ———————————————————————————————————————————————————————————————————————————
// Parsing output → state.items + metadata
// ———————————————————————————————————————————————————————————————————————————

function applyParsed(items, parsed, state, phone) {
  state.items = items.map((it) => ({
    offerId: it.offerId ?? it.id,
    name: it.name,
    qty: Math.max(1, it.qty || 1),
    modifiers: it.modifiers || [],
  }));
  if (parsed.customerName) state.customerName = parsed.customerName;
  if (parsed.customerPhone) state.customerPhone = parsed.customerPhone;
  else state.customerPhone = phone;
  if (parsed.note) state.note = parsed.note;
}

function summaryText(state, vendor) {
  const lines = state.items.map((i) => `• ${i.name} ×${i.qty}`);
  const method = state.method === "delivery" ? `🛵 Envío a ${state.customerAddress}` : "🏬 Retiro en el local";
  const payment =
    state.payment === "transferencia" ? "🏦 Transferencia" :
    state.payment === "efectivo" ? "💵 Efectivo" : "💳 Coordinamos por WhatsApp";
  return `Te armo el pedido:\n\n${lines.join("\n")}\n\n${method}\n${payment}\n${state.customerName ? `Nombre: ${state.customerName}\n` : ""}\n¿Te parece? Escribime *sí* para confirmar o *no* para corregir.`;
}

async function createAndConfirm(state, vendor, replies, waId) {
  const order = await createOrder(vendor.id, state);
  if (state.payment === "transferencia") {
    state.step = "awaiting_receipt";
    state.orderId = order.orderId || order.id;
    replies.push("✅ Pedido guardado como pendiente de pago.");
    replies.push(transferDataText(vendor, order.total ?? extractOrderTotal(order)));
    return;
  }
  replies.push("✅ Pedido recibido. Enseguida te lo confirmamos por acá. 💬");
  state.step = "idle";
  await clearState(vendor.id, waId);
}

// ———————————————————————————————————————————————————————————————————————————
// Handoffs
// ———————————————————————————————————————————————————————————————————————————

async function performHandoff(vendor, waId, text, state, replies, customPrefix) {
  if (state.pausedUntil > Date.now()) return { replies: [] };

  const prefixLine = customPrefix ?? "Te paso con el comercio — te contestan enseguida. 🙌";
  replies.push(prefixLine);

  state.pausedUntil = Date.now() + HANDOFF_PAUSE_MIN * 60 * 1000;
  state.handoffCount = 0;
  await setState(vendor.id, waId, state);
  await notifyHandoff(vendor.id, waId, text);
  return { replies };
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
    console.error("[bot] notifyHandoff:", e.message);
  }
}

// ———————————————————————————————————————————————————————————————————————————
// Persistencia + crear pedido + ayudas post-order
// ———————————————————————————————————————————————————————————————————————————

async function persist(state, replies, vendorId, waId) {
  if (state._done) {
    await clearState(vendorId, waId);
    return { replies };
  }
  await setState(vendorId, waId, state, state.step === "awaiting_receipt" ? AWAITING_RECEIPT_TTL : undefined);
  return { replies };
}

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

function extractOrderTotal(order) {
  if (order?.total) return Number(order.total);
  return null;
}

function transferDataText(vendor, total) {
  const lines = ["Para confirmar el pago, pasame el comprobante acá (foto o PDF):"];
  if (vendor.transfer_alias) lines.push(`Alias: ${vendor.transfer_alias}`);
  if (vendor.transfer_cbu) lines.push(`CBU: ${vendor.transfer_cbu}`);
  if (vendor.transfer_holder) lines.push(`Titular: ${vendor.transfer_holder}`);
  if (total != null) lines.push(`Monto: $${Number(total).toLocaleString("es-AR")}`);
  return lines.join("\n");
}

// ———————————————————————————————————————————————————————————————————————————
// Media: comprobante (foto/PDF) que llega mientras esperamos
// ———————————————————————————————————————————————————————————————————————————

export async function handleInboundMedia({ vendor, waId, mime, name, buffer }) {
  const state = await getState(vendor.id, waId);
  if (!state || state.step !== "awaiting_receipt" || !state.orderId) return { handled: false };

  try {
    const fd = new FormData();
    fd.append("orderId", state.orderId);
    fd.append("vendorId", vendor.id);
    fd.append("file", new Blob([buffer], { type: mime }),
      name || `comprobante.${mime === "application/pdf" ? "pdf" : "jpg"}`);

    const res = await fetch(`${config.appUrl}/api/wa/receipt`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.waBotSecret}` },
      body: fd,
      signal: AbortSignal.timeout(30_000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error(`[bot] receipt ${res.status}: ${JSON.stringify(data).slice(0, 80)}`);
      return { handled: true, replies: ["No pude guardarlo. Probá mandarlo de nuevo en un ratito. 🙏"] };
    }
    await clearState(vendor.id, waId);
    return { handled: true, replies: ["✅ Comprobante recibido. El comercio lo verifica y te avisa enseguida. 👍"] };
  } catch (e) {
    console.error("[bot] receipt upload:", e.message);
    return { handled: true, replies: ["Hubo un problema técnico al guardar. Probá reenviar en un segundo."] };
  }
}

function greetingText(vendor) {
  const url = shopUrl(vendor);
  return `Hola 👋 Soy el asistente de *${vendor.store_name}*.

📲 Pedí desde nuestro menú online:
${url}

¿Ya sabés qué pedir?
Escribilo directamente y yo lo confirmo.`;
}
