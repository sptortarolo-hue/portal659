import { config } from "./config.mjs";
import { getState, setState, clearState } from "./state.mjs";
import { getMenu, matchProduct, menuSummary } from "./menu.mjs";
import { parseWithLlm, parseByRules } from "./nlu.mjs";

const DEFAULT_STATE = {
  step: "idle",
  items: [], // { offerId, qty, modifiers }
  method: null,
  payment: null, // "efectivo" | "transferencia" | null (lo define el LLM o el paso "payment")
  customerName: null,
  note: null,
};

// El estado "esperando comprobante" vive poco: si en 15 min el cliente no manda
// la imagen/PDF, el pedido queda igual (pendiente) pero el bot deja de esperar.
const AWAITING_RECEIPT_TTL = 15 * 60; // segundos

function normalizePhone(waId) {
  const s = String(waId || "");
  // Si viene con server: para "@lid" no hay teléfono real (identificador
  // opaco de WhatsApp) — se guarda como "lid:<id>". order-service lo acepta
  // solo en pedidos del bot; el comercio ve la cadena y no un número inválido.
  if (s.includes("@lid")) return "lid:" + s.split("@")[0];
  const stripped = s.includes("@") ? s.split("@")[0] : s;
  const n = stripped.replace(/[^\d]/g, "");
  if (!n) return "";
  if (n.startsWith("549")) return n;
  if (n.startsWith("54")) return "549" + n.slice(2);
  return "549" + n;
}

/** El comercio acepta transferencia si tiene al menos el alias o el CBU cargados. */
function acceptsTransfer(vendor) {
  return !!(vendor.transfer_alias || vendor.transfer_cbu);
}

function transferDataText(vendor, total) {
  const lines = ["💳 *Datos para transferir:*"];
  if (vendor.transfer_alias) lines.push(`Alias: ${vendor.transfer_alias}`);
  if (vendor.transfer_cbu) lines.push(`CBU: ${vendor.transfer_cbu}`);
  if (vendor.transfer_holder) lines.push(`Titular: ${vendor.transfer_holder}`);
  if (total != null) lines.push(`Monto: $${Number(total).toLocaleString("es-AR")}`);
  lines.push("Cuando la hagas, mandame la foto o el PDF del comprobante por este chat y le aviso al comercio. ✅");
  lines.push("(Si no llega en 15 minutos, no pasa nada: el pedido queda pendiente y lo arreglás con el comercio).");
  return lines.join("\n");
}

export async function handleInbound({ vendor, waId, body }) {
  const vendorId = vendor.id;
  const text = String(body || "").trim();
  const phone = normalizePhone(waId);
  const state = (await getState(vendorId, waId)) || { ...DEFAULT_STATE };
  const replies = [];

  try {
    if (!vendor.enabled) {
      // Bot apagado (kill switch): no respondemos; el dueño atiende su WhatsApp.
      return { replies: [], handoff: true };
    }

    // Cancelar desde cualquier paso.
    if (/^(cancelar|no gracias|\/salir|basta|sali[rl]?)$/i.test(text)) {
      await clearState(vendorId, waId);
      return { replies: ["Listo, cancelé el pedido. Cualquier cosa me avisás. 😊"] };
    }

    console.log(`[bot] ${waId} step=${state.step} body="${text.slice(0, 80)}" llm=${config.llmApiKey ? "on" : "off"}`);

    if (state.step === "idle") {
      await handleIdle({ vendor, text, state, replies, phone, waId });
      console.log(`[bot] ${waId} idle -> step=${state.step} replies=${replies.length} items=${state.items?.length ?? 0}`);
      if (state._done) await clearState(vendorId, waId);
      else if (state.step !== "idle") await setState(vendorId, waId, state);
      return { replies };
    }

    // Flujo paso a paso (método → dirección → nombre → pago → confirmar).
    await handleStep({ vendor, text, state, replies, waId });
    console.log(`[bot] ${waId} step=${state.step} -> replies=${replies.length}${state._done ? " done" : ""}`);
    if (state._done) await clearState(vendorId, waId);
    else await setState(vendorId, waId, state, state.step === "awaiting_receipt" ? AWAITING_RECEIPT_TTL : undefined);
    return { replies };
  } catch (e) {
    console.error("[bot] error:", e.message);
    await clearState(vendorId, waId);
    return { replies: ["Perdón, hubo un problema. ¿Podés repetir el pedido?"] };
  }
}

async function handleIdle({ vendor, text, state, replies, phone, waId }) {
  const products = await getMenu(vendor.id);

  let parsed = await parseWithLlm(text, products).catch(() => null);
  if (!parsed) parsed = parseByRules(text);

  const shopUrl = vendor.slug ? `${config.appUrl}/tienda/${vendor.slug}` : "";

  if (parsed?.askMenu) {
    replies.push(menuSummary(vendor.store_name, products) + (shopUrl ? `\n\n📸 Con fotos y precios acá: ${shopUrl}` : ""));
    return;
  }
  if (!parsed?.items?.length) {
    replies.push(`Hola 👋 Soy el asistente de *${vendor.store_name}*.\n\n${menuSummary(vendor.store_name, products)}${shopUrl ? `\n\n📸 Con fotos y precios acá: ${shopUrl}` : ""}\n\nTambién podés decirme tu pedido directo, ej: "dos hamburguesas y una coca, envío a calle 5 123".`);
    return;
  }

  // Mapear nombres de productos → ids del menú.
  const items = [];
  const notFound = [];
  for (const it of parsed.items) {
    const p = matchProduct(products, it.name);
    if (!p) { notFound.push(it.name); continue; }
    items.push({ offerId: p.id, name: p.name, qty: Math.max(1, Number(it.qty) || 1), modifiers: it.modifiers || [] });
  }

  if (notFound.length) {
    replies.push(`No encontré: ${notFound.join(", ")}.\n${menuSummary(vendor.store_name, products)}`);
    return;
  }
  if (!items.length) {
    replies.push("Disculpá, no pude interpretar qué querés. ¿Podés decírmelo distinto?");
    return;
  }

  state.items = items;
  state.customerName = parsed.customerName || null;
  state.note = parsed.note || null;
  state.customerPhone = phone;
  if (parsed.payment === "transferencia" || parsed.payment === "efectivo") {
    state.payment = parsed.payment;
  }

  if (parsed.method === "pickup" || parsed.method === "delivery") {
    state.method = parsed.method;
  } else {
    state.step = "method";
    replies.push("¿Lo retirás por el local o te lo enviamos? (retiro / envío)");
    return;
  }

  // Info completa en el primer mensaje: saltamos directo a confirmar/cambiar.
  if (state.method === "delivery" && !parsed.customerAddress) {
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
      replies.push("¿Cómo pagás? 💵 Efectivo o 🏦 transferencia");
      return;
    }
    state.payment = "whatsapp"; // comercio sin transfer configurada: coordinar como siempre
  }
  state.step = "confirm";
  replies.push(confirmText(state));
}

async function handleStep({ vendor, text, state, replies, waId }) {
  const t = text.trim();
  switch (state.step) {
    case "method": {
      if (/retiro|pickup|paso|busco/i.test(t)) state.method = "pickup";
      else if (/envio|envío|delivery|domicilio/i.test(t)) state.method = "delivery";
      else { replies.push("Respondé: ¿retiro o envío?"); return; }
      if (state.method === "delivery") { state.step = "address"; replies.push("¿A qué dirección lo enviamos?"); }
      else state.step = "name";
      if (state.step === "name") replies.push("¿A nombre de quién?");
      return;
    }
    case "address": {
      state.customerAddress = t;
      state.step = "name";
      replies.push("¿A nombre de quién?");
      return;
    }
    case "name": {
      state.customerName = t;
      if (!state.payment) {
        if (acceptsTransfer(vendor)) {
          state.step = "payment";
          replies.push("¿Cómo pagás? 💵 Efectivo o 🏦 transferencia");
          return;
        }
        state.payment = "whatsapp";
      }
      state.step = "confirm";
      replies.push(confirmText(state));
      return;
    }
    case "payment": {
      if (/efectivo|cash/i.test(t)) state.payment = "efectivo";
      else if (/transfer/i.test(t)) state.payment = "transferencia";
      else { replies.push("Respondé: 💵 efectivo o 🏦 transferencia"); return; }
      state.step = "confirm";
      replies.push(confirmText(state));
      return;
    }
    case "confirm": {
      if (/^(sí|si|dale|ok|confirmo|confirmar|bueno|perfecto)$/i.test(t)) {
        const order = await createOrder(vendor.id, state);
        if (state.payment === "transferencia") {
          // Pedido creado como pendiente: ahora esperamos el comprobante de
          // transferencia. TTL corto (15 min) para no quedar enganchado.
          state.step = "awaiting_receipt";
          state.orderId = order.orderId || order.id;
          state.total = order.total;
          replies.push("✅ ¡Pedido recibido! Quedó como pendiente de pago.");
          replies.push(transferDataText(vendor, order.total));
          // NO borramos el estado: lo maneja awaiting_receipt.
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
      // Esperando la foto/PDF del comprobante. Texto tipo "ya pagué" sirve
      // pero pide la prueba igual.
      if (/listo|ya pag|te mand|ahí va|mira|recibo|comprobante|te paso|pagado/i.test(t)) {
        replies.push("👍 Genial. Pasame la foto o el PDF del comprobante por acá y le aviso al comercio.");
        return;
      }
      // Devolvió otra cosa: no asumir el contexto del pedido, mantener el chat limpio.
      replies.push("Todavía estoy esperando tu comprobante (foto o PDF). Si no pagaste, avisame y lo dejamos como pendiente.");
      return;
    }
    default:
      replies.push("No entendí. ¿Retiro o envío?");
  }
}

function confirmText(state) {
  const lines = state.items.map((i) => `• ${i.name || ""} x${i.qty}`);
  const method = state.method === "delivery" ? `🚚 Envío a ${state.customerAddress}` : "🏬 Retiro";
  const payment =
    state.payment === "transferencia" ? "🏦 Transferencia" :
    state.payment === "efectivo" ? "💵 Efectivo" : "📱 A coordinar";
  return `Te resumo:\n\n${lines.join("\n")}\n${method}\nPago: ${payment}\nNombre: ${state.customerName}\n\n¿Confirmás? (sí / no)`;
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
      method: state.method,
      paymentMethod: state.payment === "transferencia" ? "transferencia" : "whatsapp",
      items: state.items.map((i) => ({ offerId: i.offerId, qty: i.qty, modifiers: i.modifiers })),
      notes: state.note || null,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `order ${res.status}`);
  console.log(`[bot] pedido creado (id ${data?.orderId ?? data?.id ?? "?"}) para vendor ${vendorId} · ${state.method} · ${state.items.length} ítems · pago=${state.payment}`);
  return data;
}

/**
 * Imagen/PDF entrante (el cerebro WS la decodificó de base64). Solo la usamos si
 * este chat está esperando el comprobante de una transferencia; si no, se ignora
 * y devuelve {handled:false} (el texto normal sigue por otro camino).
 */
export async function handleInboundMedia({ vendor, waId, mime, name, buffer }) {
  const state = await getState(vendor.id, waId);
  if (!state || state.step !== "awaiting_receipt" || !state.orderId) {
    return { handled: false };
  }

  // Subir al endpoint interno que guarda el archivo y marca el pedido.
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
        "Apenas ellos lo verifiquen te escriben/avanza el pedido por acá. Gracias 🙌",
      ],
    };
  } catch (e) {
    console.error("[bot] receipt upload exception:", e?.message || e);
    return { handled: true, replies: ["Hubo un problema técnico al guardar la imagen. Intentá mandarla de nuevo."] };
  }
}
