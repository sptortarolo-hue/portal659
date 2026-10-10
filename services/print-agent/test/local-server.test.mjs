/**
 * Pruebas del servidor local de impresión offline (127.0.0.1).
 *
 * Uso: node test/local-server.test.mjs   (desde services/print-agent)
 */
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import { createLocalServer } from "../src/local-server.js";

const PORT = 18792;
const TOKEN = "pp_local_test";

function request(port, path, body) {
  return new Promise((resolve, reject) => {
    const text = body === undefined ? null : JSON.stringify(body);
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path,
        method: text === null ? "GET" : "POST",
        headers: text === null ? {} : { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          let json = null;
          try {
            json = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          } catch {}
          resolve({ status: res.statusCode, json });
        });
      }
    );
    req.on("error", reject);
    if (text !== null) req.write(text);
    req.end();
  });
}

function waitFor(fn, timeoutMs = 3000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (fn()) return resolve(true);
      if (Date.now() - start > timeoutMs) return reject(new Error("timeout esperando condición"));
      setTimeout(tick, 25);
    };
    tick();
  });
}

const events = [];
const server = createLocalServer({
  getConfig: () => ({ serverUrl: "https://ejemplo.test", token: TOKEN, printerIp: "", printerPort: 9100 }),
  onEvent: (e) => events.push(e),
  port: PORT,
});
server.start();
await waitFor(() => server.isListening());

let r = await request(PORT, "/local-status");
assert.equal(r.status, 200);
assert.equal(r.json.ok, true);
console.log("ok - /local-status responde sin auth");

r = await request(PORT, "/local-print", { payload: Buffer.from("hola").toString("base64") });
assert.equal(r.status, 401);
console.log("ok - sin token → 401");

r = await request(PORT, "/local-print", { token: "otro", payload: Buffer.from("hola").toString("base64") });
assert.equal(r.status, 401);
console.log("ok - token incorrecto → 401");

r = await request(PORT, "/local-print", { token: TOKEN, payload: "" });
assert.equal(r.status, 400);
console.log("ok - payload vacío → 400");

r = await request(PORT, "/local-print", { token: TOKEN, payload: Buffer.from("hola").toString("base64") });
assert.equal(r.status, 200);
assert.equal(r.json.ok, false);
assert.match(r.json.error, /IP/i);
console.log("ok - sin IP de impresora → ok:false sin intentar TCP");

// Capturador TCP: prueba el camino feliz completo.
const received = [];
const capturer = net.createServer((socket) => {
  socket.on("data", (c) => received.push(c));
});
await new Promise((resolve) => capturer.listen(0, "127.0.0.1", resolve));
const printerPort = capturer.address().port;
const server2Events = [];
const server2 = createLocalServer({
  getConfig: () => ({
    serverUrl: "https://ejemplo.test",
    token: TOKEN,
    printerIp: "127.0.0.1",
    printerPort,
  }),
  onEvent: (e) => server2Events.push(e),
  port: PORT + 1,
});
server2.start();
await waitFor(() => server2.isListening());

const payload = Buffer.from([0x1b, 0x40, ...Buffer.from("TICKET PROVISORIO", "latin1")]).toString("base64");
r = await request(PORT + 1, "/local-print", { token: TOKEN, payload });
assert.equal(r.status, 200);
assert.equal(r.json.ok, true);
await waitFor(() => Buffer.concat(received).length > 0);
assert.deepEqual(
  Buffer.concat(received),
  Buffer.from([0x1b, 0x40, ...Buffer.from("TICKET PROVISORIO", "latin1")])
);
const printEvent = server2Events.find((e) => e.type === "print");
assert.ok(printEvent && printEvent.ok === true && printEvent.local === true);
console.log("ok - imprime bytes exactos por TCP y emite evento local");

server.stop();
server2.stop();
capturer.close();

// --- /local-scan + /local-config (Buscar desde la web) ---
const server3Events = [];
const server3 = createLocalServer({
  getConfig: () => ({ serverUrl: "https://ejemplo.test", token: TOKEN, printerIp: "", printerPort: 9100 }),
  onEvent: (e) => server3Events.push(e),
  port: PORT + 2,
});
server3.start();
await waitFor(() => server3.isListening());

// Sin token → 401.
r = await request(PORT + 2, "/local-scan?port=9100");
assert.equal(r.status, 401);
console.log("ok - scan sin token → 401");

// Con token + impresora falsa en la IP LAN real → la encuentra (scan real).
function lanIp() {
  for (const list of Object.values(os.networkInterfaces() || {})) {
    for (const nic of list || []) {
      if (nic && nic.family === "IPv4" && !nic.internal) return nic.address;
    }
  }
  return null;
}
const lan = lanIp();
let capturer2 = null;
if (!lan) {
  console.log("skip - sin LAN para scan real");
} else {
  capturer2 = net.createServer((socket) => {
    socket.on("data", () => {});
    setTimeout(() => { try { socket.end(); } catch {} }, 50);
  });
  await new Promise((resolve, reject) => {
    capturer2.on("error", reject);
    capturer2.listen(0, lan, resolve);
  });
  const scanPort = capturer2.address().port;
  r = await request(PORT + 2, `/local-scan?token=${TOKEN}&port=${scanPort}`);
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.ok((r.json.hosts || []).includes(lan), `debe listar ${lan}`);
  console.log("ok - scan encuentra la impresora falsa en la LAN");
}

// /local-config persiste vía evento (lo guarda main.js).
r = await request(PORT + 2, "/local-config", { token: "mal" });
assert.equal(r.status, 401);
r = await request(PORT + 2, "/local-config", { token: TOKEN, printerIp: "192.168.100.20" });
assert.equal(r.status, 200);
assert.equal(r.json.ok, true);
const fixEvent = server3Events.find((e) => e.type === "printer-ip-fixed");
assert.ok(fixEvent && fixEvent.ip === "192.168.100.20", "debe emitir persistencia");
r = await request(PORT + 2, "/local-config", { token: TOKEN, printerIp: "" });
assert.equal(r.status, 400);
console.log("ok - config valida, emite persistencia y rechaza IP vacía");

server3.stop();
if (capturer2) capturer2.close();
console.log("todas las pruebas del servidor local pasaron");
