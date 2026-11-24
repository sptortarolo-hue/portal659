import { isSandbox } from "./sandbox.mjs";

// WebSocket.OPEN === 1 (RFC 6455). Usamos el valor directo para que este
// módulo pueda importarse desde la app Next sin la dependencia `ws` del
// servicio wa-bot (el Playground corre en sandbox y nunca envía nada).
const WS_OPEN = 1;

const clients = new Map(); // token -> { ws, vendor }

export function addClient(token, ws, vendor) {
  clients.set(token, { ws, vendor });
}

export function removeClient(token, ws) {
  const c = clients.get(token);
  if (c && c.ws === ws) clients.delete(token);
}

export function getClient(token) {
  return clients.get(token) || null;
}

/** Busca el cliente conectado por vendorId (la app no conoce los tokens). */
export function getClientByVendor(vendorId) {
  for (const c of clients.values()) {
    if (String(c.vendor?.id) === String(vendorId)) return c;
  }
  return null;
}

export function clientCount() {
  return clients.size;
}

/** Envía un texto al celular de un cliente vía la conexión del relay. */
export function forEachClient(fn) {
  for (const [token, c] of clients) fn(token, c);
}

/** Lista de clientes vivos para el tablero (token + vendor). */
export function clientsList() {
  return [...clients.entries()];
}

export function sendText(client, waId, text) {
  if (isSandbox()) return true;
  if (!client || client.ws.readyState !== WS_OPEN) return false;
  client.ws.send(JSON.stringify({ type: "send", wa_id: waId, text }));
  return true;
}

/** Envía una imagen por WhatsApp (base64). Caption opcional. */
export function sendImage(client, waId, data, caption) {
  if (isSandbox()) return true;
  if (!client || client.ws.readyState !== WS_OPEN) return false;
  client.ws.send(JSON.stringify({ type: "image", wa_id: waId, data, body: caption || "" }));
  return true;
}

/** Envía un documento (PDF) por WhatsApp (base64). */
export function sendDocument(client, waId, data, fileName, mime) {
  if (isSandbox()) return true;
  if (!client || client.ws.readyState !== WS_OPEN) return false;
  client.ws.send(JSON.stringify({ type: "document", wa_id: waId, data, name: fileName || "documento.pdf", mime: mime || "application/pdf" }));
  return true;
}

/** Avisa al relay que "está tipeando" (ChatPresence composing) — el dueño se ve
 *  como si estuviera escribiendo. No bloquea: si el relay no está, se ignora. */
export function sendTyping(client, waId) {
  if (isSandbox()) return true;
  if (!client || client.ws.readyState !== WS_OPEN) return false;
  client.ws.send(JSON.stringify({ type: "typing", wa_id: waId }));
  return true;
}

/** Detiene el indicador de tipeo (ChatPresence paused). */
export function sendPaused(client, waId) {
  if (isSandbox()) return true;
  if (!client || client.ws.readyState !== WS_OPEN) return false;
  client.ws.send(JSON.stringify({ type: "paused", wa_id: waId }));
  return true;
}