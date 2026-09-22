import { config } from "./config.mjs";
import { getState, setState, clearState } from "./state.mjs";
import { getMenu, matchProduct, menuSummary } from "./menu.mjs";
import { parseWithLlm, parseByRules } from "./nlu.mjs";

const DEFAULT_STATE = {
  step: "idle",
  items: [],
  method: null,
  payment: null,
  customerAddress: null,
  customerName: null,
  note: null,
  handoffCount: 0,
  pausedUntil: 0,
  orderId: null,
};

const AWAITING_RECEIPT_TTL = 15 * 60; // 15 min para acreditar el comprobante
const HANDOFF_PAUSE_MIN = 30;
const MAX_PARSE_MISSES = 2;

// Regexes cortos, ordenados por uso real:
const RE_CANCEL     = /^(cancelar|no gracias|basta|sair|no más)$/i;
const RE_CONFIRM    = /^(sí|si|dale|ok|okey|bueno|perfecto|confirmo|confirmar|si( quiero)?)\b/i;
const RE_NO         = /^(no|no lo|no quiero|no tengo)\b/i;
const RE_HUMAN      = /hablar con|humano|persona|quien|dueño/i;
const RE_MENU       = /\b(men[uú]|carta)\b/i;
const RE_PICKUP     = /(retiro|paso por)/i;
const RE_DELIVERY   = /(envío|envio|delivery|domicilio)/i;
const RE_EFECTIVO   = /(efectivo|cash|efvo)/i;
const RE_TRANSFER   = /(transfer|transferencia)/i;
const RE_GREETING   = /^(hola|buenas|buen|buenos dias|buenas tardes|buenas noches|hi|hey|ola)\b/i;

// ———————————————————————————————————————————————————————————————————————————
// Helpers cortos
// ———————————————————————————————————————————————————————————————————————————

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

function greetingText(vendor) {
  const url = shopUrl(vendor);
  return `Hola 👋 Soy el asistente de *${vendor.store_name}*.

📲 Pedí desde el menú online:
${url}

Escribime tu pedido directamente (ej: *2 empanadas de carne y una coca*).`;
}

function summaryText(state) {
  const lines = state.items.map((i) => `• ${i.name} ×${i.qty}`);
  const method =
    state.method === "delivery" ? `🛵 Envío a ${state.customerAddress}` : "🏬 Retiro en el local";
  const payment =
    state.payment === "transferencia" ? "🏦 Transferencia" :
    state.payment === "efectivo" ? "💵 Efectivo" : "💳 Por WhatsApp";
  const total = state.items.reduce((a, i) => a + (i.unitPrice || i.price || 0), 0);
  return `Mirá tu pedido:\n\n${lines.join("\n")}\n\n${method}\n${payment}\n${state.customerName ? `Nombre: ${state.customerName}\n` : ""}Total aproximado: $${total.toLocaleString("es-AR")}`;
}

function asks(method, address, name, payment) {
  return { method, address, name, payment };
}

// ———————————————————————————————————————————————————————————————————————————
// Funciones comunes
// ——————————————————————————————————————————

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
  return await res.json().catch(() => ({}));
}

async function persistNew(vendorId, waId, state) {
  await setState(vendorId, waId, state, state.step === "awaiting_receipt" ? AWAITING_RECEIPT_TTL : undefined);
}

// ———————————————————————————————————————————————————————————————————————————
// Mensaje entrante
// ———————————————————————————————————————————————————————————————————————————

export async function handleInbound({ vendor, waId, body }) {
  const text = String(body || "").trim();
  const state = (await getState(vendor.id, waId)) || { ...DEFAULT_STATE };
  const replies = [];

  try {
    if (!vendor.enabled) return { replies: [], handoff: true };
    if (state.pausedUntil && state.pausedUntil > Date.now()) return { replies: [] };

    // Cancelar el pedido/stage (siempre válido).
    if (RE_CANCEL.test(text)) {
      await clearState(vendor.id, waId);
      return { replies: ["Cancelado. Cuando quieras más info me escribís."] };
    }

    // Quiere hablar con alguien.
    if (RE_HUMAN.test(text)) {
      return await sendHandoff(vendor, waId, text, state);
    }

    // Si estamos en un flujo distinto: continuar.
    if (state.step !== "idle") {
      await handleStep({ vendor, text, state, replies, waId });
      await persistNew(vendor.id, waId, state);
      return { replies };
    }

    // El flujo del cliente: saludo → menú → pedido directo.
    await handleIdle({ vendor, text, state, replies, waId });
    await persistNew(vendor.id, waId, state);
    return { replies };

  } catch (e) {
    console.error("[bot] error:", e?.message);
    await clearState(vendor.id, waId);
    return { replies: ["Hubo un error. Intentá de nuevo en un momento."] };
  }
}

// ———————————————————————————————————————————————————————————————————————————
// Idle: saludo, menú o primer pedido
// ———————————————————————————————————————————————————————————————————————————

async function handleIdle({ vendor, text, state, replies, waId }) {
  if (RE_GREETING.test(text) && text.length < 20) {
    replies.push(greetingText(vendor));
    return;
  }

  if (RE_MENU.test(text)) {
    const url = shopUrl(vendor);
    replies.push(`Conocé el menú: ${url}\n\nContame qué vas a querer (ej: *2 empanadas de carne y una coca*).`);
    return;
  }

  // Intentar procesar un pedido completo.
  const products = await getMenu(vendor.id);
  let parsed = await parseWithLlm(text, products);

  // Si el LLM falla o no hay respuesta, usar regla simple del lado derecho.
  if (!parsed?.items?.length) {
    parsed = parseByRules(text, products);
  }

  if (parsed?.items?.length) {
    // LLM detectó algo. Guardarlo y preguntar método/dirección/nombre/pago.
    applyParsed(state, parsed, waId);

    if (parsed.method) state.method = parsed.method;
    if (parsed.payment) state.payment = parsed.payment;
    advanceStep(state, replies, vendor);
    return;
  }

  // Sin nada que interpretar: sumar miss O preguntar más.
  state.handoffCount = (state.handoffCount || 0) + 1;
  if (state.handoffCount >= MAX_PARSE_MISSES) {
    return sendHandoff(vendor, waId, text, state);
  }

  replies.push(
    `No entendí bien. ¿Qué querés pedir? Decímelo así: *2 empanadas de carne* y después te pregunto lo demás.`
  );
}

// ———————————————————————————————————————————————————————————————————————————
// Steps: si falta algo, pregunto lo que sea que falte (tipo switch).
// ———————————————————————————————————————————————————————————————————————————

async function handleStep({ vendor, text, state, replies, waId }) {
  const t = text;

  switch (state.step) {
    case "method": {
      if (RE_PICKUP.test(t)) state.method = "pickup";
      else if (RE_DELIVERY.test(t)) state.method = "delivery";
      else return replies.push("Contestame: ¿retiro en el negocio o envío a domicilio?");

      return advanceStep(state, replies, vendor);
    }
    case "address": {
      if (t.length < 4) return replies.push("Necesito una dirección completa: calle y número (y si hay piso).");
      state.customerAddress = t;
      return advanceStep(state, replies, vendor);
    }
    case "name": {
      state.customerName = t;
      return advanceStep(state, replies, vendor);
    }
    case "payment": {
      if (RE_TRANSFER.test(t)) state.payment = "transferencia";
      else if (RE_EFECTIVO.test(t)) state.payment = "efectivo";
      else return replies.push("¿Pagás *efectivo* o por *transferencia*?");
      return advanceStep(state, replies, vendor);
    }
    case "confirm": {
      if (RE_CONFIRM.test(t)) {
        const order = await createOrder(vendor.id, state);
        if (state.payment === "transferencia") {
          state.orderId = order.id || order.orderId;
          state.step = "awaiting_receipt";
          replies.push("✅ Pedido tomado. Queda pendiente por pago.");
          replies.push(transferText(vendor, order.total));
          return advanceStep(state, replies, vendor);
        }
        await clearState(vendor.id, waId);
        replies.push("✅ ¡Pedido confirmado! El comercio te lo manda por acá.");
        return;
      }
      if (RE_NO.test(t)) {
        await clearState(vendor.id, waId);
        replies.push("Dale, no quedó pendiente nada.");
        return;
      }
      return replies.push("Contesta *sí* para confirmar o *no* para cambiarlo.");
    }
    case "awaiting_receipt": {
      // esperando info de pago
      if (text) {
        //  Podría ser mejor tipado en forma de carga: mantenemos el pedido vivo.
      }
      replies.push("Mandame la foto o el PDF del comprobante por acá.✅");
      return;
    }
    default:
      state.step = "idle";
      return handleIdle({ vendor, text, state, replies, waId });
  }
}

// Avance del flujo: pregunto EXACTAMENTE lo que falta.
function advanceStep(state, replies, vendor) {
  if (!state.method) {
    state.step = "method";
    replies.push("¿Lo retirás en el local o te lo enviamos? (retiro / envío)");
    return;
  }
  if (state.method === "delivery" && !state.customerAddress) {
    state.step = "address";
    replies.push("¿A qué dirección te lo enviamos?");
    return;
  }
  if (!state.customerName) {
    state.step = "name";
    replies.push("¿A nombre de quién va el pedido?");
    return;
  }
  if (!state.payment) {
    state.step = "payment";
    replies.push("Elegí el método de pago: *efectivo* o *transferencia*.");
    return;
  }

  // Listo. Solo sí/no sobre el resumen.
  replies.push(
    summaryText(state) +
    "\n\n" + (state.payment === "transferencia"
      ? "Después de confirmar vas a poder pagar por transferencia. Decime *sí* o *no*."
      : "Confirmo el pedido ahora. Contestame *sí* o *no*.")
  );
}

// ———————————————————————————————————————————————————————————————————————————
// Parceadores de pedidos: IA + reglas
// ———————————————————————————————————————————————————————————————————————————

function applyParsed(state, parsed, waId) {
  const items = (parsed.items || []).map((p) => ({
    offerId: p.offerId || p.id,
    name: p.name,
    qty: p.qty || 1,
    modifiers: p.modifiers || [],
    price: p.price,
  }));
  state.items = items;
  const phone = normalizePhone(waId);
  if (parsed.customerPhone) state.customerPhone = parsed.customerPhone;
  else if (phone) state.customerPhone = phone;
  if (parsed.note) state.note = parsed.note;
  if (parsed.method === "pickup" || parsed.method === "delivery") state.method = parsed.method;
  if (parsed.customerAddress) state.customerAddress = parsed.customerAddress;
  if (parsed.customerName) state.customerName = parsed.customerName;
  if (parsed.payment) state.payment = parsed.payment;
}

// ———————————————————————————————————————————————————————————————————————————
// Handoff to human
// ———————————————————————————————————————————————————————————————————————————

async function sendHandoff(vendor, waId, text, state) {
  // Notificar al comercio y pausar el bot por el chat.
  const newState = { ...state, pausedUntil: Date.now() + HANDOFF_PAUSE_MIN * 60 * 1000, handoffCount: 0 };
  await setState(vendor.id, waId, newState);
  await notifyVendor(vendor, waId, text);
  return { replies: ["Te paso al comercio — cualquier cosa te contestamos por aquí. 👍"] };
}

async function notifyVendor(vendorId, waId, text) {
  try {
    await fetch(`${config.appUrl}/api/wa/handoff`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.waBotSecret}` },
      body: JSON.stringify({ vendorId, waId, lastMessage: text.slice(0, 200) }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    console.error("[bot] handoff error:", e.message);
  }
}

// ———————————————————————————————————————————————————————————————————————————
// Media: comprobante de pago (foto / PDF)
// ———————————————————————————————————————————————————————————————————————————

export async function handleInboundMedia({ vendor, waId, mime, name, buffer }) {
  const state = await getState(vendor.id, waId);
  if (!state || state.step !== "awaiting_receipt" || !state.orderId) return { handled: false };

  try {
    const fd = new FormData();
    fd.append("orderId", state.orderId);
    fd.append("vendorId", vendor.id);
    fd.append("file", new Blob([buffer], { type: mime }), name || (mime === "application/pdf" ? "comprobante.pdf" : "comprobante.jpg"));

    const res = await fetch(`${config.appUrl}/api/wa/receipt`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.waBotSecret}` },
      body: fd,
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      console.error("[bot] receipt upload failed:", res.status);
      return { handled: false };
    }
    await clearState(vendor.id, waId);
    return { handled: true, replies: ["✅ Perfecto, lo recibí. El comercio lo verifica este momento."] };
  } catch (e) {
    console.error("[bot] receipt err:", e.message);
    return { handled: true, replies: ["Hubo un error subiendo el archivo. Probá enviarlo de nuevo en un ratito."] };
  }
}

function transferText(vendor, total) {
  const lines = [];
  if (vendor.transfer_alias) lines.push(`Alias: ${vendor.transfer_alias}`);
  if (vendor.transfer_cbu) lines.push(`CBU: ${vendor.transfer_cbu}`);
  if (total != null) lines.push(`Monto: $${Number(total).toLocaleString("es-AR")}`);
  lines.push("Mandame la foto cuando lo hagas y le aviso al comercio.");
  return lines.join("\n");
}
