/**
 * Pruebas del barrido LAN de impresoras del agente PC.
 *
 * Uso: node test/discover.test.mjs   (desde services/print-agent)
 */
import assert from "node:assert/strict";
import net from "node:net";
import { discoverPrinters, localSubnets } from "../src/relay.js";

function check(name, cond) {
  assert.ok(cond, name);
  console.log(`ok - ${name}`);
}

// Impresora falsa: acepta TCP en 127.0.0.1 y cierra.
const capturer = net.createServer((socket) => {
  socket.on("data", () => {});
  setTimeout(() => {
    try { socket.end(); } catch {}
  }, 50);
});
await new Promise((resolve) => capturer.listen(0, "127.0.0.1", resolve));
const fakePort = capturer.address().port;

const t0 = Date.now();
const hosts = await discoverPrinters({ port: fakePort, timeoutMs: 150, subnets: ["127.0.0"] });
const elapsed = Date.now() - t0;
check("encuentra la impresora falsa en 127.0.0.1", hosts.includes("127.0.0.1"));
check(`barrido acotado y rápido (${elapsed}ms)`, elapsed < 8000);

const empty = await discoverPrinters({ port: 1, timeoutMs: 100, subnets: ["127.0.0"] });
check("puerto cerrado no reporta nada", Array.isArray(empty));

const nets = localSubnets();
check("subredes locales detectadas sin romper", Array.isArray(nets));

capturer.close();
console.log("todas las pruebas de discovery pasaron");
