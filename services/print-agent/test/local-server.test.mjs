/**
 * Pruebas del servidor local de impresión offline (127.0.0.1).
 *
 * Uso: node test/local-server.test.mjs   (desde services/print-agent)
 */
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
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
console.log("todas las pruebas del servidor local pasaron");
