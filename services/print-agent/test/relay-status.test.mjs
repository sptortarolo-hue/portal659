/**
 * Pruebas unitarias del estado y la validación del relay del agente PC.
 *
 * Uso: npm run test:relay   (desde services/print-agent)
 */
import assert from "node:assert/strict";
import {
  buildWsUrl,
  createRelay,
  sanitizeAgentConfig,
  validateConnectionConfig,
} from "../src/relay.js";

function check(name, fn) {
  fn();
  console.log(`ok - ${name}`);
}

check("normaliza y recorta la configuración", () => {
  const normalized = sanitizeAgentConfig({
    serverUrl: "  https://ejemplo.test/  ",
    token: "  pp_prueba  ",
    printerIp: "  192.168.1.50  ",
    printerPort: "9100",
  });
  assert.equal(normalized.serverUrl, "https://ejemplo.test/");
  assert.equal(normalized.token, "pp_prueba");
  assert.equal(normalized.printerIp, "192.168.1.50");
  assert.equal(normalized.printerPort, 9100);
});

check("detecta token faltante y servidor con ruta", () => {
  const validation = validateConnectionConfig({
    serverUrl: "https://ejemplo.test/portal/",
    token: "   ",
    printerIp: "192.168.1.50",
    printerPort: 9100,
  });
  assert.ok(validation.errors.some((error) => error.code === "missing-token"));
  assert.ok(validation.errors.some((error) => error.code === "invalid-server-path"));
});

check("construye la URL del relay preservando puerto y host", () => {
  const url = buildWsUrl({
    serverUrl: "http://127.0.0.1:8852/",
    token: "pp_prueba",
    printerIp: "127.0.0.1",
    printerPort: 9998,
  });
  assert.equal(url, "ws://127.0.0.1:8852/printbridge?token=pp_prueba");
});

check("el relay informa configuración inválida sin intentar conectar", () => {
  const events = [];
  const relay = createRelay({ getConfig: () => ({}), onEvent: (event) => events.push(event) });
  relay.start();

  const startedStatus = events.find((event) => event.type === "status");
  assert.ok(startedStatus, "se esperaba un evento de estado");
  assert.equal(startedStatus.online, false);
  assert.equal(startedStatus.connection.status, "invalid");
  assert.equal(startedStatus.connection.code, "missing-token");

  relay.stop();
  assert.equal(relay.getStatus().connection.status, "idle");
});

console.log("relay-status: todas las pruebas pasaron");