import { config } from "./config.mjs";
import { getState, setState, clearState } from "./state.mjs";
import { getMenu, matchProduct, menuSummary, groupByCategory, categoriesLine, categoryProductsLine } from "./menu.mjs";
import { parseWithLlm, parseByRules } from "./nlu.mjs";

const DEFAULT_STATE = {
  step: "idle",
  items: [],          // { offerId, qty, modifiers, name }
  method: null,
  payment: null,      // "efectivo" | "transferencia" | "whatsapp" | null
  customerName: null,
  note: null,
  categories: null,   // cache para el browse (viene del menú ya parseado)
  browseCat: null,    // índice de la categoría abierta en browse_products
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
  // La URL va a un cliente en WhatsApp: siempre la pública, nunca la interna de Docker.
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
    if (state.pausedUntil) { // expiró: empezar fresco.
      state.pausedUntil = 0;
      state.handoffCount = 0;
    }

    if (/^(cancelar|no gracias|\/salir|basta|sali[rl]?)$/i.test(text)) {
      await clearState(vendorId, waId);
      return { replies: ["Listo, cancelé el pedido. Cualquier cosa me avisás. 😊"] };
    }

    // Handoff explícito: el cliente pide hablar con una persona. Aunque el flujo
    // esté a mitad, lo derivamos y el bot queda en pausa 30 min en este chat.
    if (/\b(habl[ae]r?|hablen)?\s*(con|al|a la)?\s*(dueño|dueña|persona|humano|humana|alguien|encargad[ao]|administración|voz)\b/i.test(text)
      && !/pedido|menú|menu|carta|empanada|pizza|hamburguesa/i.test(text)) {
      console.log(`[bot] ${waId} pidió hablar con una persona (explícito)`);
      replies.push(`Claro! Te paso con el comercio directo — te contestan por este chat en un ratito. 🙌`);
      await notifyHandoff(vendor.id, waId, text);
      state.pausedUntil = Date.now() + HANDOFF_PAUSE_MIN * 60 * 1000;
      state.handoffCount = 0;
      await setState(vendorId, waId, state);
      return { replies };
    }

    console.log(`[bot] ${waId} step=${state.step} body="${text.slice(0, 80)}" llm=${config.llmApiKey ? "on" : "off"}`);

    const stateBefore = state.step;
    if (state.step === "idle") {
      await handleIdle({ vendor, text, state, replies, phone, waId });
    } else {
      await handleStep({ vendor, text, state, replies, waId });
    }

    console.log(`[bot] ${waId} ${stateBefore} -> ${state.step} replies=${replies.length}`);

    if (state._done) {
      await clearState(vendorId, waId);
      return { replies };
    }

    // Persistir solo si hay flujo abierto o quedó pausado.
    if (state.step !== "idle" || state.pausedUntil) {
      await setState(vendorId, waId, state, state.step === "awaiting_receipt" ? AWAITING_RECEIPT_TTL : undefined);
    }
    return { replies };
  } catch (e) {
    console.error("[bot] error:", e.message);
    await clearState(vendorId, waId);
    return { replies: ["Perdón, hubo un problema. ¿Podés repetir el pedido?"] };
  }
}

// ———————————————————————————————————————————————————————————————————————————
// idle → arranca el diálogo (saludo con categorías numeradas o pedido directo)
// ———————————————————————————————————————————————————————————————————————————

async function handleIdle({ vendor, text, state, replies, phone, waId }) {
  const products = await getMenu(vendor.id);
  const parsed = await parseWithLlm(text, products).catch(() => null) || parseByRules(text);

  const url = shopUrl(vendor);
  const cats = groupByCategory(products);

  const hasParsedItems = Array.isArray(parsed?.items) && parsed.items.length > 0;
  if (!hasParsedItems) {
    // No es un pedido claro: saludo + categorías, o pedir el menú.
    const showCats = cats.length > 0;
    state.categories = showCats ? cats : null;
    state.step = showCats ? "browse" : "idle";
    replies.push(greetingText(vendor, cats, url));
    return;
  }

  // Sí es un pedido de una: flujo clásico.
  await fillOrderFromParsed({ vendor, state, parsed, replies, phone, waId });
}

function greetingText(vendor, cats, url) {
  const parts = [`Hola 👋 Soy el asistente de *${vendor.store_name}*.`];
  if (url) parts.push(`📸 Menú con fotos: ${url}`);
  if (cats.length > 0) {
    parts.push("");
    parts.push("¿Qué vas a querer hoy? Respondé con el número:");
    parts.push("");
    parts.push(categoriesLine(cats));
    parts.push("");
    parts.push("O escribime directo lo que querés (ej: *dos empanadas de carne y una coca*).");
  }
  return parts.join("\n");
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
    replies.push(`No encontré: ${notFound.join(", ")}.\n${menuSummary(vendor.store_name, products)}`);
    return;
  }
  if (!items.length) {
    replies.push("No te entendí bien. ¿Qué te gustaría pedir? Por ejemplo: *2 pizzas grandes* o *unas empanadas de jamón y queso*.");
    return;
  }

  state.items = items;
  state.customerName = parsed.customerName || state.customerName || null;
  state.note = parsed.note || state.note || null;
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
  nextAfterCustomer(state, vendor, replies);
}

// ———————————————————————————————————————————————————————————————————————————
// steps: browse (categorías), browse_products (productos de la categoría), method/address/payment/confirm/awaiting_receipt
// ———————————————————————————————————————————————————————————————————————————

async function handleStep({ vendor, text, state, replies, waId }) {
  const t = text.trim();
  const phone = normalizePhone(waId);

  // Si dice "listo" en cualquier paso y hay artículos: saltar a confirmar (rellenando los huecos).
  const wannaClose = /^(listo|nada m(?:a|á)s|eso es todo|cierro[^a-z]|termine)$/i.test(t);

  switch (state.step) {
    case "browse": {
      const products = await getMenu(vendor.id);
      const cats = state.categories && state.categories.length > 0 ? state.categories : groupByCategory(products);
      const idx = pickCategory(t, cats);
      if (idx != null) {
        if (cats[idx].items.length === 0) {
          replies.push(`La categoría *${cats[idx].name}* no tiene productos cargados aún. Probá otra o el link del menú.`);
          return;
        }
        state.step = "browse_products";
        state.browseCat = idx;
        state.categories = cats;
        replies.push(categoryProductsLine(cats[idx], vendor.slug, config.appUrl));
        replies.push("¿Cuál y cuántos? (ej: *1 x2* o *1 x2 y 3*) — u otra categoría con su número.");
        return;
      }
      if (wannaClose) {
        if (state.items.length > 0) {
          nextAfterOrderCloses(state, vendor, replies);
          return;
        }
        replies.push("Veo que querés cerrar pero aún no agregaste nada 😊. Elegí un número de categoría o escribime algo tipo *dos pizzas*.");
        return;
      }
      // Gemini/reglas sobre texto libre acá: pedido sin haber elegido categoría.
      await fillOrderFromTextFallback({ vendor, text, state, replies, phone, waId });
      return;
    }

    case "browse_products": {
      const catIdx = state.browseCat;
      const cats = state.categories;
      const cat = cats && catIdx != null ? cats[catIdx] : null;

      if (wannaClose) {
        nextAfterOrderCloses(state, vendor, replies);
        return;
      }

      // picks del tipo "1", "1 x2 y 3" (siempre indexados contra LA ÚLTIMA LISTA MOSTRADA)
      if (cat) {
        const picks = parsePicks(t, cat.items);
        if (picks) {
          applyPicks(state, picks);
          const back = `\nOtra categoría, otra cosa, o *listo* para confirmar. ${cartLine(state)}`;
          replies.push("✅ Agregado." + back);
          state.step = "browse";
          state.handoffCount = 0;
          return;
        }
      }
      // no era picks: pasar a texto libre.
      await fillOrderFromTextFallback({ vendor, text, state, replies, phone, waId });
      return;
    }

    case "method": {
      if (/retiro|pickup|paso|busco/i.test(t)) state.method = "pickup";
      else if (/envio|envío|delivery|domicilio/i.test(t)) state.method = "delivery";
      else if (wannaClose && state.method) { /* sigue con el dato que ya tenía */ }
      else { replies.push("Respondé: ¿retiro o envío?"); return; }
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
      replies.push("Sigo esperando tu comprobante 📎. Si ya no lo querés pagar con transferencia, avisá al comercio directo o escribime *cancelar*.");
      return;
    }
    default:
      // Step raro: volver al principio sin perder el chat.
      state.step = "idle";
      await handleIdle({ vendor, text, state, replies, phone, waId });
  }
}

// ———————————————————————————————————————————————————————————————————————————
// utilidades
// ———————————————————————————————————————————————————————————————————————————

/** pickCategory: número o nombre (insensible a mayúsculas), null si no matchea. */
function pickCategory(t, cats) {
  const trimmed = t.trim();
  const asNum = /^\d+$/.test(trimmed) ? Number(trimmed) : null;
  if (asNum != null && asNum >= 1 && asNum <= cats.length) return asNum - 1;
  const norm = trimmed.toLowerCase();
  // matcheo aproximado por inclusión (ej: "empanadas" matchea "🥟 Empanadas")
  const idx = cats.findIndex((c) => c.name.toLowerCase().includes(norm) || norm.includes(c.name.toLowerCase()));
  return idx >= 0 ? idx : null;
}

/**
 * Picks numéricos: "1" | "1 x2" | "1 x2 y 3" | "1, 3".
 * Devuelve null si el texto no es puramente una lista de picks (para no robarle
 * al LLM una frase que solo casualmente contiene números).
 */
function parsePicks(t, items) {
  const parts = t.split(/\s*(?:y|,|\+|\|)\s*/i);
  if (parts.some((p) => !/^\s*\d+(?:\s*[x×]\s*\d+)?\s*$/.test(p))) return null;
  const picks = [];
  for (const part of parts) {
    const m = /^\s*(\d+)(?:\s*[x×]\s*(\d+))?\s*$/.exec(part);
    if (!m) return null;
    const idx = Number(m[1]);
    const qty = Number(m[2] || 1);
    if (idx < 1 || idx > items.length || qty < 1 || qty > 50) return null;
    const p = items[idx - 1];
    picks.push({
      offerId: p.id, name: p.name, qty,
      modifiers: [],
    });
  }
  return picks.length ? picks : null;
}

function applyPicks(state, picks) {
  for (const p of picks) {
    const existing = state.items.find((i) => i.offerId === p.offerId && (i.modifiers || []).length === 0);
    if (existing) existing.qty += p.qty;
    else state.items.push(p);
  }
  state.handoffCount = 0;
}

function cartLine(state) {
  const n = state.items.reduce((a, i) => a + i.qty, 0);
  return n > 0 ? `Llevás ${n} producto${n === 1 ? "" : "s"} en total.` : "Todavía no agregaste nada.";
}

/** Texto libre que no entró como picks/categoría: probar LLM y luego reglas. */
async function fillOrderFromTextFallback({ vendor, text, state, replies, phone, waId }) {
  const products = await getMenu(vendor.id);
  const parsed = await parseWithLlm(text, products).catch(() => null) || parseByRules(text);

  if (parsed?.askMenu) {
    const url = shopUrl(vendor);
    replies.push(menuSummary(vendor.store_name, products) + (url ? `\n\n📸 Con fotos: ${url}` : ""));
    return;
  }

  if (Array.isArray(parsed?.items) && parsed.items.length > 0) {
    await fillOrderFromParsed({ vendor, state, parsed, replies, phone, waId });
    return;
  }

  // No entendió nada. Contador de misses: a las 2 seguidas handoff automático.
  const misses = (state.handoffCount || 0) + 1;
  state.handoffCount = misses;
  if (misses >= MAX_PARSE_MISSES) {
    await maybeHandoff(vendor, waId, text, state, replies);
    return;
  }
  replies.push(`No te entendí bien (${misses}/${MAX_PARSE_MISSES}).\n¿Qué querés pedir? Podés:`.trim() +
    (state.categories?.length ? "\n• Escribir el número de la categoría" : "") +
    "\n• Describirlo con palabras (ej: *2 pizzas y una coca*)");
}

async function maybeHandoff(vendor, waId, text, state, replies) {
  console.log(`[bot] ${waId} → handoff al dueño (no lo entiendo)`);
  replies.push(`Perdoname, no te estoy entendiendo 😅 Te paso con el comercio directo, en un ratito te responde una persona.`);
  await notifyHandoff(vendor.id, waId, text);
  state.pausedUntil = Date.now() + HANDOFF_PAUSE_MIN * 60 * 1000;
  state.handoffCount = 0;
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

function nextAfterOrderCloses(state, vendor, replies) {
  if (state.items.length === 0) {
    replies.push("Todavía no agregaste nada al pedido 😊. Elegí algo del menú primero.");
    return;
  }
  if (!state.method) {
    state.step = "method";
    replies.push("¿Lo retirás por el local o te lo enviamos? (retiro / envío)");
    return;
  }
  if (!state.customerName) {
    state.step = "name";
    replies.push("¿A nombre de quién?");
    return;
  }
  nextAfterCustomer(state, vendor, replies);
}

function nextAfterCustomer(state, vendor, replies) {
  if (state.method === "delivery" && !state.customerAddress) {
    state.step = "address";
    replies.push("¿A qué dirección lo enviamos?");
    return;
  }
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
      method: state.method === "delivery" ? "delivery" : "pickup",
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
  lines.push("Cuando la hagas, mandame la foto o el PDF por este chat y le aviso al comercio. ✅");
  lines.push("(Si no llega en 15 minutos, no pasa nada: el pedido queda pendiente y lo arreglan entre ustedes.)");
  return lines.join("\n");
}

// ———————————————————————————————————————————————————————————————————————————
// media (comprobante transferencia)
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
        "Apenas lo verifiquen te avisan/acelera el pedido por acá. Gracias 🙌",
      ],
    };
  } catch (e) {
    console.error("[bot] receipt upload exception:", e?.message || e);
    return { handled: true, replies: ["Hubo un problema técnico al guardar la imagen. Intentá mandarla de nuevo."] };
  }
}
