import { config } from "./config.mjs";
import { getState, setState, clearState } from "./state.mjs";
import { getMenu, matchProduct, menuSummary } from "./menu.mjs";
import { parseWithLlm, parseByRules } from "./nlu.mjs";

const DEFAULT_STATE = {
  step: "idle",
  items: [], // { offerId, qty, modifiers }
  method: null,
  customerName: null,
  note: null,
};

function normalizePhone(waId) {
  const n = String(waId || "").replace(/[^\d]/g, "");
  if (!n) return "";
  if (n.startsWith("549")) return n;
  if (n.startsWith("54")) return "549" + n.slice(2);
  return "549" + n;
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
    if (/^(cancelar|no gracias|\/salir|basta)$/i.test(text)) {
      await clearState(vendorId, waId);
      return { replies: ["Listo, cancelé el pedido. Cualquier cosa me avisás. 😊"] };
    }

    if (state.step === "idle") {
      await handleIdle({ vendor, text, state, replies, phone, waId });
      if (state._done) await clearState(vendorId, waId);
      else if (state.step !== "idle") await setState(vendorId, waId, state);
      return { replies };
    }

    // Flujo paso a paso (método → nombre → dirección → confirmar).
    await handleStep({ vendor, text, state, replies });
    if (state._done) await clearState(vendorId, waId);
    else await setState(vendorId, waId, state);
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

  if (parsed?.askMenu) {
    replies.push(menuSummary(vendor.store_name, products));
    return;
  }
  if (!parsed?.items?.length) {
    replies.push(`Hola 👋 Soy el asistente de *${vendor.store_name}*.\n\n${menuSummary(vendor.store_name, products)}\n\nTambién podés decirme tu pedido directo, ej: "dos hamburguesas y una coca, envío a calle 5 123".`);
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
  state.step = "confirm";
  replies.push(confirmText(state));
}

async function handleStep({ vendor, text, state, replies }) {
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
      state.step = "confirm";
      replies.push(confirmText(state));
      return;
    }
    case "confirm": {
      if (/^(sí|si|dale|ok|confirmo|confirmar|bueno|perfecto)$/i.test(t)) {
        await createOrder(vendor.id, state);
        state._done = true;
        replies.push("✅ ¡Pedido recibido! Te lo confirmamos por acá. 💬");
        return;
      }
      replies.push(confirmText(state));
      return;
    }
    default:
      replies.push("No entendí. ¿Retiro o envío?");
  }
}

function confirmText(state) {
  const lines = state.items.map((i) => `• ${i.name || ""} x${i.qty}`);
  const method = state.method === "delivery" ? `🚚 Envío a ${state.customerAddress}` : "🏬 Retiro";
  return `Te resumo:\n\n${lines.join("\n")}\n${method}\nNombre: ${state.customerName}\n\n¿Confirmás? (sí / no)`;
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
      items: state.items.map((i) => ({ offerId: i.offerId, qty: i.qty, modifiers: i.modifiers })),
      notes: state.note || null,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `order ${res.status}`);
  return data;
}