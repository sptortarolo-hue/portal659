/**
 * Pruebas del auto-fix de DHCP (printWithAutoFix/shouldAutoScan).
 *
 * Uso: node test/autofix.test.mjs   (desde services/print-agent)
 * Nota: el camino "escanear y reintentar en otra IP" requiere una IP
 * inalcanzable real (no determinista en loopback) y se valida en campo;
 * acá se cubren las decisiones y los caminos sin scan.
 */
import assert from "node:assert/strict";
import net from "node:net";
import { printWithAutoFix, shouldAutoScan } from "../src/relay.js";

function check(name, cond) {
  assert.ok(cond, name);
  console.log(`ok - ${name}`);
}

check("escanea ante EHOSTUNREACH", shouldAutoScan({ code: "EHOSTUNREACH", message: "connect EHOSTUNREACH" }) === true);
check("escanea ante No route to host", shouldAutoScan("No route to host") === true);
check("escanea ante timeout", shouldAutoScan("timeout TCP") === true);
check("escanea ante timed out", shouldAutoScan("connect timed out") === true);
check("NO escanea ante refused (hay algo vivo)", shouldAutoScan("connect ECONNREFUSED 127.0.0.1:9100") === false);
check("NO escanea sin error", shouldAutoScan(null) === false && shouldAutoScan("") === false);
check("NO escanea error de validación", shouldAutoScan("Sin IP de impresora configurada") === false);

// Impresora falsa en loopback.
const received = [];
const capturer = net.createServer((socket) => {
  socket.on("data", (c) => received.push(c));
});
await new Promise((resolve) => capturer.listen(0, "127.0.0.1", resolve));
const printerPort = capturer.address().port;

const payload = Buffer.from([0x1b, 0x40, ...Buffer.from("AUTO", "latin1")]);
let r = await printWithAutoFix("127.0.0.1", printerPort, payload, {});
check("primer intento OK no escanea ni marca fix", r.ok === true && r.autoFixed === false && r.usedIp === "127.0.0.1");

const closedPort = printerPort === 1 ? 2 : 1;
r = await printWithAutoFix("127.0.0.1", closedPort, payload, {});
check("puerto cerrado falla sin auto-fix", r.ok === false && r.autoFixed !== true && /refus/i.test(r.error || ""));

capturer.close();
console.log("todas las pruebas del auto-fix pasaron");
