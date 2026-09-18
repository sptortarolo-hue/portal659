import { WebSocket } from "ws";

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

export function clientCount() {
  return clients.size;
}

/** Envía un texto al celular de un cliente vía la conexión del relay. */
export function forEachClient(fn) {
  for (const [token, c] of clients) fn(token, c);
}

export function sendText(client, waId, text) {
  if (!client || client.ws.readyState !== WebSocket.OPEN) return false;
  client.ws.send(JSON.stringify({ type: "send", wa_id: waId, text }));
  return true;
}

/** Avisa al relay que "está tipeando" (ChatPresence composing) — el dueño se ve
 *  como si estuviera escribiendo. No bloquea: si el relay no está, se ignora. */
export function sendTyping(client, waId) {
  if (!client || client.ws.readyState !== WebSocket.OPEN) return false;
  client.ws.send(JSON.stringify({ type: "typing", wa_id: waId }));
  return true;
}

/** Detiene el indicador de tipeo (ChatPresence paused). */
export function sendPaused(client, waId) {
  if (!client || client.ws.readyState !== WebSocket.OPEN) return false;
  client.ws.send(JSON.stringify({ type: "paused", wa_id: waId }));
  return true;
}