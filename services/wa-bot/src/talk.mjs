// Plantillas de tono del bot de WhatsApp.
// WA_TONE="clasico" (default): los textos actuales, palabra por palabra, sin riesgo.
// WA_TONE="humano": copys coloquiales tipo vendedor de mostrador, con variantes
// rotadas por hash del chat (anti-ban: no mandar siempre el mismo texto idéntico
// a muchos números).

const HUMAN_GREETINGS = [
  "¡Hola! 👋 Soy el asistente de *{store}*. ¿Qué te preparo?",
  "Hola 👋 Te escribe el asistente de *{store}*. ¿En qué te ayudo?",
  "¡Hola! Bienvenido a *{store}*. ¿Qué te llevo hoy?",
];

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function rot(arr, key) {
  return arr[hashStr(String(key)) % arr.length];
}

/** Texto de bienvenida según tono. */
export function greetingTextTone(vendor, tone) {
  const name = vendor.store_name || "el comercio";
  if (tone === "humano") return rot(HUMAN_GREETINGS, vendor.id).replace("{store}", name);
  // clasico: el texto actual vive en greetingText(); este helper solo para modo humano.
  return "";
}

/** Resumen del pedido en tono humano (vs summaryText en clasico). */
export function summaryTextTone(state, vendor, exactTotal = null) {
  const lines = state.items.map((i) => `• ${itemDisplayTone(i)}`).join("\n");
  const method = state.method === "delivery"
    ? `🛵 Te lo llevo a: ${state.customerAddress}`
    : "🏬 Lo retirás por el local";
  const payment =
    state.payment === "transferencia" ? "🏦 Transferencia" :
    state.payment === "efectivo" ? "💵 Efectivo" : "💳 Se coordina por WhatsApp";
  const estimate = orderTotalEstimateTone(state, vendor);
  const totalToShow = exactTotal != null ? exactTotal : estimate.total;
  const totalLine = totalToShow != null
    ? `💰 Total: $${Math.round(totalToShow).toLocaleString("es-AR")}${exactTotal != null ? "" : (estimate.aprox ? " (aprox.)" : "")}`
    : "";
  return [
    `Tu pedido de *${vendor.store_name || "el comercio"}:`,
    lines,
    "",
    `${method} · ${payment}`,
    state.customerName ? `A nombre de ${state.customerName}` : "",
    totalLine,
    "",
    "¿Está todo bien?",
    "1️⃣ Sí, confirmar",
    "2️⃣ No, cancelar",
    "3️⃣ Modificar pedido",
    portalNavFooter(),
  ].filter(Boolean).join("\n");
}

function itemDisplayTone(i) {
  const mods = (i.modifiers || []).map((m) => (typeof m === "string" ? m : m?.label)).filter(Boolean);
  const base = `${i.name} ×${i.qty}${mods.length ? ` (${mods.join(", ")})` : ""}`;
  if (i.unit === "kg") return `${base} (${i.weightKg || i.qty} kg)`;
  if (i.unit === "pack") return `${base} (paquete)`;
  return base;
}

/** Estimación ligera sin imports server. Mismo resultado que orderTotalEstimate
 *  pero sin acceso a precios (usa los del ítem si vienen). */
function orderTotalEstimateTone(state, vendor) {
  let subtotal = 0;
  let hasMods = false;
  for (const i of state.items) {
    const price = Number(i.price || 0);
    subtotal += price * Number(i.qty || 1);
    if ((i.modifiers || []).length) hasMods = true;
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
  return { total: Math.round(total * 100) / 100, aprox: hasMods };
}

/** Preguntas pendientes en tono humano. */
export function pendingQuestionsTone(state) {
  const lines = [];
  let n = 0;
  if (state.pendingFields.includes("method")) lines.push(`1️⃣ ¿Lo retirás por el local o te lo envío a domicilio?`), n++;
  if (state.pendingFields.includes("address")) lines.push(`${n + 1}️⃣ ¿A qué dirección te lo llevo?`), n++;
  if (state.pendingFields.includes("name")) lines.push(`${n + 1}️⃣ ¿A nombre de quién va el pedido?`), n++;
  if (state.pendingFields.includes("payment")) lines.push(`${n + 1}️⃣ ¿Pagás en efectivo o por transferencia?`), n++;
  const cart = state.items.length
    ? `Tu pedido:\n${state.items.map((i) => `• ${itemDisplayTone(i)}`).join("\n")}\n\n`
    : "";
  const questions = lines.length ? `${lines.join("\n")}\n\n` : "";
  return `${cart}${questions}Decime lo que falte, todo junto o de a una cosa. 👇${portalNavFooter()}`;
}

/** Confirmación de baja confianza en tono humano. */
export function lowConfidenceTone(items) {
  const resumen = items.map((p) => `${p.qty || 1}× ${p.name}`).join(", ");
  return `No estoy seguro de haber entendido bien: ¿es ${resumen}?
1️⃣ Sí, es eso
2️⃣ No, no es eso
${portalNavFooter()}`;
}

/** "¿Lo de siempre?" para re-pedido. */
export function reorderTone(lastOrder) {
  const items = (lastOrder.items || []).map((i) => `• ${i.name} ×${i.qty}`).join("\n");
  return `Tu último pedido de *${lastOrder.storeName}*:${items ? "\n" + items : ""}
¿Lo pedís de nuevo?
1️⃣ Sí, confirmar
2️⃣ No, cancelar
${portalNavFooter()}`;
}

/** Despedida tras confirmar. */
export function confirmTone(order) {
  const track = order.trackToken ? `\n📦 Seguí tu pedido: ${order.trackUrl}` : "";
  return `✅ ¡Pedido confirmado! Te avisamos cuando esté listo.${track}`;
}

/** No encontró producto: sugiere la lista en tono humano. */
export function noMatchTone(products) {
  const lines = products.slice(0, 8).map((p) => `• ${p.name} — $${Number(p.price).toLocaleString("es-AR")}`);
  return `De eso no tengo por ahora. Esto es lo que hay:\n${lines.join("\n")}\n\n¿Algo de acá?\n${portalNavFooter()}`;
}

/** Respuesta a pregunta ("tenés coca?"). */
export function answerTone(products) {
  const lines = products.slice(0, 8).map((p) => `• ${p.name} — $${Number(p.price).toLocaleString("es-AR")}`);
  return `Sí, tenemos:\n${lines.join("\n")}\n\n¿Querés pedir alguna? Decime cuál y cuántas.\n${portalNavFooter()}`;
}

/** Pie de navegación común para el bot del portal. */
export function portalNavFooter() {
  return "(Escribí *volver* para el paso anterior, *cancelar* para salir, *inicio* para el menú principal)";
}
