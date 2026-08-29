import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";

const PORT = Number(process.env.PORT || 8791);
const SECRET = process.env.PRINT_BRIDGE_SECRET || "";
const JOB_TIMEOUT_MS = 20000;

const clients = new Map();

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
    if (!client || client.ws.readyState !== WebSocket.OPEN) {
      return writeJson(res, 200, { ok: false, offline: true, error: "La app Portal Print no está conectada" });
    }

    const jobId = randomUUID();
    const result = await sendJob(client, jobId, job);
    writeJson(res, 200, { ok: result.ok, jobId, offline: false, error: result.error });
    return;
  }

  writeJson(res, 404, { error: "not found" });
});

const wss = new WebSocketServer({ noServer: true });

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
  });
});

function sendJob(client, jobId, job) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      client.ws.off("message", onMessage);
      resolve(result);
    };
    const onMessage = (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg.jobId !== jobId) return;
      finish({ ok: msg.ok === true, error: msg.ok ? undefined : msg.error });
    };
    const timer = setTimeout(() => {
      finish({ ok: false, error: "La app no respondió a tiempo (timeout)" });
    }, JOB_TIMEOUT_MS);

    client.ws.on("message", onMessage);
    try {
      client.ws.send(JSON.stringify({ type: "job", jobId, job }));
    } catch (e) {
      finish({ ok: false, error: `Conexión rota: ${e.message}` });
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