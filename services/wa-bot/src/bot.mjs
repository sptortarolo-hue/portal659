import { config } from "./config.mjs";
import { getState, setState, clearState } from "./state.mjs";
import { getMenu, matchProduct, menuSummary } from "./menu.mjs";
import { parseWithLlm, parseByRules } from "./nlu.mjs";

const DEFAULT_STATE = {
  step: "idle",
  items: [],          // { offerId, qty, modifiers, name }
  method: null,
  payment: null,      // "efectivo" | "transferencia" | "whatsapp" | null
  customerName: null,
  note: null,
  handoffCount: 0,    // cuántas veces seguidas el parser no entendió
  pausedUntil: 0,     // timestamp: bot en pausa (handoff humano)
  // Para esperar el comprobante:
  orderId: null,
  total: null,
};

const AWAITING_RECEIPT_TTL = 15 * 60;     // 15 min para mandar el comprobante
const HANDOFF_PAUSE_MIN = 30;             // 30 min: quien llama al humano calla
const MAX_PARSE_MISSES = 2;               // 2 fallos seguidos del lenguaje → humano

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
// entrada principal
// ———————————————————————————————————————————————————————————————————————————

export async function handleInbound({ vendor, waId, body }) {
  const vendorId = vendor.id;
  const text = String(body || "").trim();
  const phone = normalizePhone(waId);
  const state = (await getState(vendorId, waId)) || { ...DEFAULT_STATE };
  const replies = [];

  try {
    if (!vendor.enabled) {
      return { replies: [], handoff: true };
    }

    // Bot en pausa porque ya derivamos a un humano hace poco: el dueño atiende.
    if (state.pausedUntil && state.pausedUntil > Date.now()) {
      console.log(
        `[bot] ${waId} en pausa por handoff (${Math.round((state.pausedUntil - Date.now()) / 1000)}s restantes)`
      );
      return { replies: [] };
    }
    if (state.pausedUntil) {
      state.pausedUntil = 0;
      state.handoffCount = 0;
    }

    if (/^(cancelar|no gracias|\/salir|basta|sali[rl]?)$/i.test(text)) {
      await clearState(vendorId, waId);
      return { replies: ["Listo, cancelé el pedido. Cualquier cosa me avisás. 😊"] };
    }

    // Handoff explícito: el cliente pide hablar con una persona.
    if (/humano|persona|hablar con/i.test(text)) {
      console.log(`[bot] ${waId} pidió hablar con una persona`);
      replies.push("Te derivo con el dueño — te responde enseguida por acá. 🙌");
      await notifyHandoff(vendorId, waId, text);
      state.pausedUntil = Date.now() + HANDOFF_PAUSE_MIN * 60 * 1000;
      await setState(vendorId, waId, state);
      return { replies };
    }

    console.log(`[bot] ${waId} step=${state.step} body="${text.slice(0, 80)}" llm=${config.llmApiKey ? "on" : "off"}`);

    if (state.step === "idle") {
      await handleIdle({ vendor, text, state, replies, phone, waId });
    } else {
      await handleStep({ vendor, text, state, replies, waId });
    }

    console.log(`[bot] ${waId} → step=${state.step} replies=${replies.length}`);

    if (state._done) {
      await clearState(vendorId, waId);
      return { replies };
    }
    // Guardamos SIEMPRE el estado de la conversación con TTL corto: así el
    // handoffCount persiste entre mensajes y los pasos no se pierden.
    await setState(vendorId, waId, state, state.step === "awaiting_receipt" ? AWAITING_RECEIPT_TTL : undefined);
    return { replies };
  } catch (e) {
    console.error("[bot] error:", e.message);
    console.error(e.stack?.split("\n").slice(0, 3).join(" | "));
    // NO limpiamos el state: un error transitorio no debe resetear el flujo.
    return { replies: ["Uy, hubo un error. Probá de nuevo en un segundo. 🙏"] };
  }
}

// ———————————————————————————————————————————————————————————————————————————
// idle: primer contacto o mensaje fuera de flujo
// ———————————————————————————————————————————————————————————————————————————

async function handleIdle({ vendor, text, state, replies, phone, waId }) {
  const products = await getMenu(vendor.id);
  const parsed = await parseWithLlm(text, products).catch(() => null) || parseByRules(text, products);

  const url = shopUrl(vendor);
  const hasItems = Array.isArray(parsed?.items) && parsed.items.length > 0;

  // Orden de detección (no mezclar):
  // 1) Pedido explícito (LLM o reglas con ítems) → flujo de pedido.
  // 2) Menú pedido ("menu", "carta", "precios") → link.
  // 3) Saludo ("hola", "buenas") → responder el saludo, una vez por chat.
  // 4) Nada matcheó → miss. A los 2 seguidos → handoff.
  if (hasItems) {
    await fillOrderFromParsed({ vendor, state, parsed, replies, phone, waId });
    return;
  }
  if (parsed?.askMenu) {
    replies.push(`📋 Mirá el menú con fotos acá: ${url}\n\nO escribime directo lo que querés (ej: *"2 empanadas de carne y una coca"*).`);
    state.handoffCount = 0;
    return;
  }
  if (parsed?.greeting) {
    // Saludo corto: responder con el texto del bot, sin contar como miss.
    // Si el cliente repite "hola" varias veces seguidas, igual le contestamos
    // (no es ambiguo: es un saludo).
    replies.push(greetingText(vendor, url));
    state.handoffCount = 0;
    return;
  }

  // LLM/reglas no entendieron nada útil: contar miss y, tras 2 seguidos, handoff.
  const misses = (state.handoffCount || 0) + 1;
  state.handoffCount = misses;
  console.log(`[bot] ${waId} no entendí "${text.slice(0, 50)}" — miss ${misses}/${MAX_PARSE_MISSES}`);
  if (misses >= MAX_PARSE_MISSES) {
    replies.push("Perdón que no te estoy siguiendo 😅 Te paso con el comercio, te contesta enseguida por acá.");
    await notifyHandoff(vendor.id, waId, text);
    state.pausedUntil = Date.now() + HANDOFF_PAUSE_MIN * 60 * 1000;
    state.handoffCount = 0;
    return;
  }
  replies.push(`No te entendí bien. ¿Qué querés pedir? escribilo simple, por ejemplo: *"2 empanadas de carne"* o mirá el menú: ${url}`);
}

function greetingText(vendor, url) {
  const parts = [`Hola 👋 Soy el asistente de *${vendor.store_name}*.`];
  if (url) {
    parts.push(`📲 Pedí online con fotos y precios: ${url}`);
  }
  parts.push("¿Ya sabés qué querés? escribimelo de una (ej: *2 empanadas de carne y una coca*) y te lo confirmo por acá.");
  return parts.join("\n\n");
}

async function fillOrderFromParsed({ vendor, state, parsed, replies, phone, waId }) {
  const items = [];
  const notFound = [];
  const products = await getMenu(vendor.id);
  for (const it of parsed.items || []) {
    const p = matchProduct(products, it.name);
    if (!p) { notFound.push(it.name); continue; }
    items.push({ offerId: p.id, name: p.name, qty: Math.max(1, Number(it.qty) || 1), modifiers: it.modifiers || [] });
  }

  if (notFound.length) {
    // No encontramos lo que pediste: listar el menú para que mire.
    replies.push(`No encontré: ${notFound.join(", ")}.\n\n${menuSummary(vendor.store_name, products)}`);
    return;
  }

  state.items = items;
  state.customerName = parsed.customerName || state.customerName || null;
  state.note = parsed.note || state.note || null;
  state.customerPhone = parsed.customerPhone || phone;
  if (parsed.payment === "transferencia" || parsed.payment === "efectivo") {
    state.payment = parsed.payment;
  }

  if (parsed.method === "pickup" || parsed.method === "delivery") {
    state.method = parsed.method;
  } else {
    state.step = "method";
    replies.push("Perfecto. ¿Lo retirás por el local o te lo enviamos? (retiro / envío)");
    return;
  }

  if (state.method === "delivery" && !parsed.customerAddress) {
    state.step = "address";
    replies.push("¿A qué dirección lo enviamos?");
    return;
  }
  if (!state.customerName) {
    state.step = "name";
    replies.push("¿A nombre de quién lo hacemos?");
    return;
  }
  nextAfterCustomer(state, vendor, replies);
}

// ———————————————————————————————————————————————————————————————————————————
// steps: method → address → name → payment → confirm → awaiting_receipt
// ———————————————————————————————————————————————————————————————————————————

async function handleStep({ vendor, text, state, replies, waId }) {
  const t = text.trim();

  switch (state.step) {
    case "method": {
      if (/retiro|pickup|paso|busco/i.test(t)) state.method = "pickup";
      else if (/envio|envío|delivery|domicilio/i.test(t)) state.method = "delivery";
      else { replies.push("Respondé: ¿*retiro* en el local o *envío* a domicilio?"); return; }
      nextAfterCustomer(state, vendor, replies);
      return;
    }
    case "address": {
      state.customerAddress = t;
      nextAfterCustomer(state, vendor, replies);
      return;
    }
    case "name": {
      state.customerName = t;
      nextAfterCustomer(state, vendor, replies);
      return;
    }
    case "payment": {
      if (/efectivo|cash/i.test(t)) state.payment = "efectivo";
      else if (/transfer/i.test(t)) state.payment = "transferencia";
      else { replies.push("Respondé: 💵 efectivo o 🏦 transferencia"); return; }
      nextAfterCustomer(state, vendor, replies);
      return;
    }
    case "confirm": {
      if (/^(sí|si|dale|ok|confirmo|confirmar|bueno|perfecto)$/i.test(t)) {
        const order = await createOrder(vendor.id, state);
        if (state.payment === "transferencia") {
          state.step = "awaiting_receipt";
          state.orderId = order.orderId || order.id;
          state.total = order.total;
          replies.push("✅ ¡Pedido recibido! Quedó como *pendiente de pago*.");
          replies.push(transferDataText(vendor, order.total));
          return;
        }
        state._done = true;
        replies.push("✅ ¡Pedido recibido! Te lo confirmamos por acá. 💬");
        return;
      }
      if (/^(no|nop|no,)/i.test(t)) {
        state._done = true;
        replies.push("Dale, lo dejamos sin pedir. Si te arrepentís, escribime de nuevo 👍");
        return;
      }
      replies.push(confirmText(state));
      return;
    }
    case "awaiting_receipt": {
      if (/listo|ya pag|te mand|ahí va|comprobante|recibo|pagado/i.test(t)) {
        replies.push("👍 Genial. Mandame la foto o el PDF del comprobante por acá y le aviso al comercio.");
        return;
      }
      replies.push("Sigo esperando tu comprobante. Si no lo tenés, contame *cancelar* y no quedas pendiente.");
      return;
    }
    default:
      state.step = "idle";
      await handleIdle({ vendor, text, state, replies, phone: normalizePhone(waId), waId });
  }
}

// ———————————————————————————————————————————————————————————————————————————
// utilidades
// ———————————————————————————————————————————————————————————————————————————

function nextAfterCustomer(state, vendor, replies) {
  if (state.method === "delivery" && !state.customerAddress) {
    state.step = "address";
    replies.push("¿A qué dirección lo enviamos?");
    return;
  }
  if (!state.customerName) {
    state.step = "name";
    replies.push("¿A nombre de quién?");
    return;
  }
  if (!state.payment) {
    if (acceptsTransfer(vendor)) {
      state.step = "payment";
      replies.push("¿Cómo pagás? 💵 Efectivo o 🏦 Transferencia");
      return;
    }
    state.payment = "whatsapp";
  }
  state.step = "confirm";
  replies.push(confirmText(state));
}

function confirmText(state) {
  const lines = state.items.map((i) => `• ${i.name || ""} x${i.qty}`);
  const method = state.method === "delivery" ? `🚚 Envío a ${state.customerAddress}` : "🏬 Retiro";
  const payment =
    state.payment === "transferencia" ? "🏦 Transferencia" :
    state.payment === "efectivo" ? "💵 Efectivo" : "📱 A coordinar";
  return `Te resumo:\n\n${lines.join("\n")}\n\n${method}\nPago: ${payment}\nNombre: ${state.customerName}\n\n¿Confirmás? (sí / no)`;
}

async function createOrder(vendorId, state) {
  const res = await fetch(`${config.appUrl}/api/wa/order`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.waBotSecret}`,
    },
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
  console.log(`[bot] pedido creado (id ${data?.orderId ?? data?.id ?? "?"}) para vendor ${vendorId} · ${state.method} · ${state.items.length} ítems · pago=${state.payment}`);
  return data;
}

function transferDataText(vendor, total) {
  const lines = ["💳 *Datos para transferir:*"];
  if (vendor.transfer_alias) lines.push(`Alias: ${vendor.transfer_alias}`);
  if (vendor.transfer_cbu) lines.push(`CBU: ${vendor.transfer_cbu}`);
  if (vendor.transfer_holder) lines.push(`Titular: ${vendor.transfer_holder}`);
  if (total != null) lines.push(`Monto: $${Number(total).toLocaleString("es-AR")}`);
  lines.push("\nCuando la hagas, mandame la foto o el PDF del comprobante por este chat y le aviso al comercio. ✅");
  lines.push("Si no lo mandás en 15 minutos, no pasa nada — queda pendiente de pago y lo coordinás directo con el comercio.");
  return lines.join("\n");
}

async function notifyHandoff(vendorId, waId, text) {
  try {
    await fetch(`${config.appUrl}/api/wa/handoff`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.waBotSecret}`,
      },
      body: JSON.stringify({ vendorId, waId, lastMessage: text.slice(0, 200) }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    console.error(`[bot] handoff notify falló: ${e.message}`);
  }
}

// ———————————————————————————————————————————————————————————————————————————
// media: comprobante de transferencia (foto/PDF)
// ———————————————————————————————————————————————————————————————————————————

export async function handleInboundMedia({ vendor, waId, mime, name, buffer }) {
  const state = await getState(vendor.id, waId);
  if (!state || state.step !== "awaiting_receipt" || !state.orderId) {
    return { handled: false };
  }

  try {
    const fd = new FormData();
    const blob = new Blob([buffer], { type: mime });
    fd.append("orderId", state.orderId);
    fd.append("vendorId", vendor.id);
    fd.append("file", blob, name || (mime === "application/pdf" ? "comprobante.pdf" : "comprobante.jpg"));

    const res = await fetch(`${config.appUrl}/api/wa/receipt`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.waBotSecret}` },
      body: fd,
      signal: AbortSignal.timeout(30_000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.url) {
      console.error(`[bot] receipt upload error ${res.status}: ${JSON.stringify(data).slice(0, 200)}`);
      return { handled: true, replies: ["Hmm, no pude guardar la imagen. Probá mandarla de nuevo en un segundo 🙏"] };
    }

    console.log(`[bot] comprobante guardado en pedido ${state.orderId} → ${data.url}`);
    await clearState(vendor.id, waId);
    return {
      handled: true,
      replies: [
        "✅ ¡Perfecto! Recibí tu comprobante y ya se lo mostré al comercio.",
        "Apenas ellos lo verifiquen te escriben por acá. Gracias 🙌",
      ],
    };
  } catch (e) {
    console.error("[bot] receipt upload exception:", e?.message || e);
    return { handled: true, replies: ["Hubo un problema técnico al guardar la imagen. Intentá mandarla de nuevo."] };
  }
}
