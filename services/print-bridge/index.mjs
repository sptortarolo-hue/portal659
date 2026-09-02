import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";

const PORT = Number(process.env.PORT || 8791);
const SECRET = process.env.PRINT_BRIDGE_SECRET || "";
const JOB_TIMEOUT_MS = 20000;
const MAX_QUEUE_PER_TOKEN = 100;
const MAX_JOB_ATTEMPTS = 8;

const clients = new Map(); // token -> { ws, token, lastSeen }
const pending = new Map(); // token -> [{ id, job, attempts, enqueuedAt }]
const deliverLocks = new Map(); // token -> Promise (serializa entregas directas a la misma impresora)

function hasAuth(req) {
  if (!SECRET) return true;
  return req.headers["x-bridge-secret"] === SECRET;
}

function writeJson(res, status, data) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(data));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === "/health" && req.method === "GET") {
    writeJson(res, 200, { ok: true });
    return;
  }

  if (url.pathname === "/status" && req.method === "GET") {
    if (!hasAuth(req)) return writeJson(res, 403, { error: "forbidden" });
    const token = url.searchParams.get("token") ?? "";
    const client = clients.get(token);
    const online = !!client && client.ws.readyState === WebSocket.OPEN;
    writeJson(res, 200, {
      online,
      connectedClients: clients.size,
      lastSeen: client?.lastSeen ?? null,
      queued: pending.get(token)?.length ?? 0,
    });
    return;
  }

  if (url.pathname === "/push" && req.method === "POST") {
    if (!hasAuth(req)) return writeJson(res, 403, { error: "forbidden" });

    let raw = "";
    for await (const chunk of req) raw += chunk;

    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return writeJson(res, 400, { error: "json inválido" });
    }

    const { token, job } = data;
    if (!token || !job) return writeJson(res, 400, { error: "token y job requeridos" });

    const client = clients.get(token);
    const online = !!client && client.ws.readyState === WebSocket.OPEN;
    const hasQueued = (pending.get(token) || []).length > 0;

    // Sin app conectada O con cola pendiente: encolar para entregar en orden cuando pueda.
    if (!online || hasQueued) {
      const item = enqueueJob(token, job);
      if (!item) {
        return writeJson(res, 200, { ok: false, offline: true, error: "Cola de impresión llena (máx 100 pedidos)" });
      }
      if (online) flushQueue(client).catch(() => {});
      return writeJson(res, 200, {
        ok: true,
        queued: true,
        jobId: item.id,
        pending: pending.get(token).length,
      });
    }

    const result = await withTokenLock(token, () => sendJob(client, item2job(job)));
    writeJson(res, 200, { ok: result.ok, jobId: result.jobId, offline: false, error: result.error });
    return;
  }

  writeJson(res, 404, { error: "not found" });
});

const wss = new WebSocketServer({ noServer: true });

function enqueueJob(token, job) {
  const arr = pending.get(token) || [];
  if (arr.length >= MAX_QUEUE_PER_TOKEN) return null;
  const item = { id: randomUUID(), job, attempts: 0, enqueuedAt: Date.now() };
  arr.push(item);
  pending.set(token, arr);
  console.log(`[relay] job ${item.id} encolado para ${token} (pendientes: ${arr.length})`);
  return item;
}

function item2job(job) {
  return { id: randomUUID(), job, attempts: 0 };
}

// Serializa las entregas directas por token: dos /push concurrentes a la misma
// impresora se imprimen de a una, sin abrir conexiones simultáneas.
async function withTokenLock(token, fn) {
  const prev = deliverLocks.get(token) || Promise.resolve();
  const run = prev.then(() => fn());
  const settled = run.then(() => {}, () => {});
  deliverLocks.set(token, settled);
  settled.then(() => {
    if (deliverLocks.get(token) === settled) deliverLocks.delete(token);
  });
  return run;
}

const flushing = new Set(); // tokens con un flush en curso (evita entregas paralelas)

// Entrega los jobs pendientes de un token, en orden, apenas el cliente se conecta.
async function flushQueue(client) {
  if (flushing.has(client.token)) return;
  flushing.add(client.token);
  try {
    while (client.ws.readyState === WebSocket.OPEN) {
    const arr = pending.get(client.token);
    if (!arr || arr.length === 0) return;
    const item = arr[0];
    const result = await sendJob(client, item);
    if (result.ok) {
      arr.shift();
      if (arr.length === 0) pending.delete(client.token);
      console.log(`[relay] job ${item.id} entregado desde cola (${client.token})`);
      continue;
    }
    if (result.disconnected) return; // se reintenta en la próxima conexión
    item.attempts++;
    if (item.attempts >= MAX_JOB_ATTEMPTS) {
      arr.shift(); // se descarta: la impresora parece muerta, no atascar la cola
      console.error(`[relay] job ${item.id} descartado tras ${item.attempts} intentos (${result.error})`);
      continue;
    }
    console.warn(`[relay] job ${item.id} falló (${result.error}); reintento en 5s`);
    await new Promise((r) => setTimeout(r, 5000));
    }
  } finally {
    flushing.delete(client.token);
  }
}

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const token = url.searchParams.get("token") ?? "";
  if (url.pathname !== "/printbridge" || !token) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    const client = { ws, token, lastSeen: Date.now() };
    clients.set(token, client);

    ws.on("message", () => {
      client.lastSeen = Date.now();
    });
    ws.on("close", () => {
      if (clients.get(token) === client) clients.delete(token);
    });
    ws.on("error", () => {
      if (clients.get(token) === client) clients.delete(token);
    });

    ws.send(JSON.stringify({ type: "hello", status: "ok" }));

    // Entregar la cola pendiente de este token (si hubo cortes de conexión).
    if ((pending.get(token) || []).length > 0) {
      flushQueue(client).catch(() => {});
    }
  });
});

function sendJob(client, item) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      client.ws.off("message", onMessage);
      client.ws.off("close", onClose);
      resolve(result);
    };
    const onMessage = (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg.jobId !== item.id) return;
      finish({ ok: msg.ok === true, error: msg.ok ? undefined : msg.error, jobId: item.id });
    };
    // Si el cliente se cae a mitad del job, no lo marcamos como fallo de impresión:
    // queda en cola y se reintenta al reconectar.
    const onClose = () => finish({ ok: false, disconnected: true, jobId: item.id });
    const timer = setTimeout(() => {
      finish({ ok: false, error: "La app no respondió a tiempo (timeout)", jobId: item.id });
    }, JOB_TIMEOUT_MS);

    client.ws.on("message", onMessage);
    client.ws.on("close", onClose);
    try {
      client.ws.send(JSON.stringify({ type: "job", jobId: item.id, job: item.job }));
    } catch (e) {
      finish({ ok: false, error: `Conexión rota: ${e.message}`, jobId: item.id });
    }
  });
}

setInterval(() => {
  for (const client of clients.values()) {
    if (client.ws.readyState === WebSocket.OPEN) {
      try {
        client.ws.ping();
      } catch {
        /* se limpia en 'close' */
      }
    }
  }
}, 30000);

server.listen(PORT, () => {
  console.log(`[print-bridge] escuchando en :${PORT} (relay WebSocket para Portal Print)`);
});