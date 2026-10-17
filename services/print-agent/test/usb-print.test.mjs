/**
 * Pruebas del tercer modo USB (cola de Windows, spooler RAW).
 * Sin hardware: el runner de PowerShell se inyecta (mock) y en esta
 * máquina (no-Windows) las rutas reales responden error operativo.
 *
 * Uso: node test/usb-print.test.mjs   (desde services/print-agent)
 */
import assert from "node:assert/strict";
import http from "node:http";
import { sanitizeAgentConfig, validateConnectionConfig } from "../src/relay.js";
import {
  autoQueueName,
  listUsbPrinters,
  mapUsbError,
  parsePrinterListJson,
  parseQueueDetails,
  writeUsbRaw,
  writeUsbRawAuto,
} from "../src/usb-print.js";
import { createLocalServer } from "../src/local-server.js";

// --- config: backend usb ---
{
  const c = sanitizeAgentConfig({ token: "pp_x", printerBackend: "USB", printerUsbName: "  XP-80  " });
  assert.equal(c.printerBackend, "usb");
  assert.equal(c.printerUsbName, "XP-80");
  console.log("ok - sanitize normaliza backend usb y recorta la cola");
}
{
  const c = sanitizeAgentConfig({ token: "pp_x" });
  assert.equal(c.printerBackend, "tcp");
  assert.equal(c.printerUsbName, "");
  console.log("ok - config vieja sin backend sigue siendo tcp");
}
{
  const v = validateConnectionConfig({ token: "pp_x", serverUrl: "https://ejemplo.test", printerBackend: "usb" });
  assert.ok(v.warnings.some((w) => w.code === "missing-printer-usb"));
  assert.ok(!v.errors.some((e) => e.field === "printerIp"));
  console.log("ok - usb sin cola avisa missing-printer-usb (sin exigir IP)");
}
{
  const v = validateConnectionConfig({
    token: "pp_x",
    serverUrl: "https://ejemplo.test",
    printerBackend: "usb",
    printerUsbName: "x".repeat(261),
  });
  assert.ok(v.errors.some((e) => e.code === "invalid-printer-usb"));
  console.log("ok - cola usb larguísima es error de validación");
}

// --- parseo de Get-Printer ---
{
  const arr = parsePrinterListJson('[{"Name":"XP-80","PrinterStatus":3},{"Name":"EPSON TM-T20","PrinterStatus":null}]');
  assert.deepEqual(arr, [
    { name: "XP-80", status: "3" },
    { name: "EPSON TM-T20", status: null },
  ]);
  const single = parsePrinterListJson('{"Name":"XP-80","PrinterStatus":3}');
  assert.deepEqual(single, [{ name: "XP-80", status: "3" }]);
  assert.deepEqual(parsePrinterListJson(""), []);
  assert.deepEqual(parsePrinterListJson("no-json"), []);
  console.log("ok - parsePrinterListJson tolera array/objeto/vacío/inválido");
}

// --- mensajes operativos ---
{
  assert.match(mapUsbError("open", "XP-80"), /no existe o el spooler/);
  assert.match(mapUsbError("startdoc", "XP-80"), /Generic \/ Text Only/);
  assert.match(mapUsbError("write", "XP-80"), /cable USB/);
  console.log("ok - mapUsbError traduce pasos a lenguaje operativo");
}

// --- writeUsbRaw: validaciones (sin tocar PowerShell) ---
{
  const r = await writeUsbRaw("", Buffer.from([1, 2, 3]));
  assert.equal(r.ok, false);
  assert.match(r.error, /Sin cola USB/);
  const r2 = await writeUsbRaw("XP-80", Buffer.alloc(0));
  assert.equal(r2.ok, false);
  console.log("ok - writeUsbRaw valida cola y ticket vacío sin ejecutar nada");
}

// --- writeUsbRaw: runner mockeado ---
{
  const seen = {};
  const fakeRun = async (args, opts) => {
    seen.args = args;
    seen.env = opts?.env;
    assert.ok(String(args[args.length - 1]).includes("PortalRawPrint"), "el script usa P/Invoke winspool");
    assert.equal(opts?.env?.PORTAL_PRINTER, "XP-80");
    return { code: 0, stdout: "OK:42\n", stderr: "", timedOut: false };
  };
  const r = await writeUsbRaw("XP-80", Buffer.from([0x1b, 0x40]), { run: fakeRun, platform: "win32" });
  assert.equal(r.ok, true);
  assert.equal(r.bytes, 42);
  console.log("ok - writeUsbRaw OK parsea bytes y pasa la cola por env (sin quoting)");
}
{
  const fakeRun = async () => ({ code: 0, stdout: "ERR:startdoc:1\n", stderr: "", timedOut: false });
  const r = await writeUsbRaw("XP-80", Buffer.from([0x1b, 0x40]), { run: fakeRun, platform: "win32" });
  assert.equal(r.ok, false);
  assert.match(r.error, /Generic \/ Text Only/);
  console.log("ok - writeUsbRaw ERR:startdoc sugiere Generic/Text Only");
}
{
  const fakeRun = async () => ({ code: 1, stdout: "", stderr: "", timedOut: true });
  const r = await writeUsbRaw("XP-80", Buffer.from([0x1b, 0x40]), { run: fakeRun, platform: "win32" });
  assert.equal(r.ok, false);
  assert.match(r.error, /tardó demasiado/);
  console.log("ok - writeUsbRaw timeout mapea a spooler colgado");
}
{
  // Ruta real (sin mock): en Windows ejecuta PowerShell de verdad contra el
  // spooler; fuera de Windows responde error operativo.
  const r = await writeUsbRaw("XP-80-NO-EXISTE-12345", Buffer.from([0x1b, 0x40]));
  assert.equal(r.ok, false);
  if (process.platform === "win32") {
    assert.match(r.error, /no existe o el spooler/, "el script PowerShell debe correr y fallar en open");
    const l = await listUsbPrinters();
    assert.equal(l.ok, true, `listar debe funcionar en Windows: ${l.error || ""}`);
    assert.ok(Array.isArray(l.printers));
    console.log(`ok - PowerShell real: open falla operativo + lista ${l.printers.length} colas`);
  } else {
    assert.match(r.error, /solo disponible en Windows/);
    const l = await listUsbPrinters();
    assert.equal(l.ok, false);
    console.log("ok - fuera de Windows responde error operativo (sin romper)");
  }
}

// --- writeUsbRawAuto: auto-fallback ante driver que rechaza RAW ---
function makeRun(behavior) {
  let calls = 0;
  const run = async (args, opts) => {
    calls++;
    const script = String(args[args.length - 1] || "");
    if (script.includes("Add-Printer")) {
      behavior.created = { port: opts?.env?.PORTAL_PORT, name: opts?.env?.PORTAL_NEWNAME };
      return behavior.createOk
        ? { code: 0, stdout: "OK\n", stderr: "", timedOut: false }
        : { code: 0, stdout: "ERR:acceso denegado\n", stderr: "", timedOut: false };
    }
    if (script.includes("Get-Printer |")) {
      // PowerShell devuelve propiedades capitalizadas: Name/DriverName/PortName.
      const ps = (behavior.queues || []).map((q) => ({
        Name: q.name,
        DriverName: q.driver,
        PortName: q.port,
      }));
      return { code: 0, stdout: JSON.stringify(ps), stderr: "", timedOut: false };
    }
    if (script.includes("PortalRawPrint")) {
      const q = opts?.env?.PORTAL_PRINTER;
      if (q === behavior.failQueue) {
        return { code: 0, stdout: `ERR:${behavior.failStep || "startdoc"}:1\n`, stderr: "", timedOut: false };
      }
      return { code: 0, stdout: `OK:${behavior.bytes ?? 10}\n`, stderr: "", timedOut: false };
    }
    return { code: 0, stdout: "", stderr: "", timedOut: false };
  };
  run.calls = () => calls;
  return run;
}

{
  const r = await writeUsbRawAuto("Q1", Buffer.from([1]), {
    run: makeRun({ queues: [] }),
    platform: "win32",
  });
  assert.equal(r.ok, true);
  assert.equal(r.usbUsed, "Q1");
  assert.equal(r.autoFixed, false);
  console.log("ok - auto: cola que funciona sale directo sin fallback");
}
{
  const run = makeRun({
    failQueue: "POS-58",
    queues: [
      { name: "POS-58", driver: "POS-58 Series", port: "USB001" },
      { name: "GT", driver: "Generic / Text Only", port: "USB001" },
    ],
  });
  const r = await writeUsbRawAuto("POS-58", Buffer.from([1]), { run, platform: "win32" });
  assert.equal(r.ok, true);
  assert.equal(r.usbUsed, "GT", "debe preferir la cola genérica del mismo puerto");
  assert.equal(r.autoFixed, true);
  assert.equal(run.calls(), 3, "fallo + listar + reintento en GT");
  console.log("ok - auto: hermana genérica en el mismo puerto se usa sola");
}
{
  const behavior = {
    failQueue: "POS-58",
    createOk: true,
    queues: [{ name: "POS-58", driver: "POS-58 Series", port: "USB001" }],
  };
  const r = await writeUsbRawAuto("POS-58", Buffer.from([1]), {
    run: makeRun(behavior),
    platform: "win32",
  });
  assert.equal(r.ok, true);
  assert.equal(r.usbUsed, autoQueueName("USB001"));
  assert.equal(r.autoFixed, true);
  assert.equal(behavior.created.port, "USB001");
  console.log("ok - auto: crea Portal659 (USBxxx) y usa la recién creada");
}
{
  const r = await writeUsbRawAuto("POS-58", Buffer.from([1]), {
    run: makeRun({ failQueue: "POS-58", createOk: false, queues: [{ name: "POS-58", driver: "POS", port: "USB001" }] }),
    platform: "win32",
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /No se pudo arreglar automático/);
  assert.match(r.error, /acceso denegado/);
  console.log("ok - auto: si la creación falla, explica con el motivo y la guía manual");
}
{
  const run = makeRun({ failQueue: "POS-58", failStep: "write" });
  const r = await writeUsbRawAuto("POS-58", Buffer.from([1]), { run, platform: "win32" });
  assert.equal(r.ok, false);
  assert.match(r.error, /cable USB/);
  assert.equal(run.calls(), 1, "papel/cable no dispara fallback");
  console.log("ok - auto: error de papel/cable no intenta fallback");
}
{
  const qs = parseQueueDetails('[{"Name":"POS-58","DriverName":"POS-58 Series","PortName":"USB001"},{"Name":"PDF","DriverName":"Microsoft Print To PDF","PortName":"PORTPROMPT:"}]');
  assert.equal(qs.length, 2);
  assert.deepEqual(qs[0], { name: "POS-58", driver: "POS-58 Series", port: "USB001" });
  console.log("ok - parseQueueDetails lee name/driver/port");
}

// --- local-server: endpoints USB ---
function request(port, path, body, method) {
  return new Promise((resolve, reject) => {
    const text = body === undefined ? null : JSON.stringify(body);
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path,
        method: method || (text === null ? "GET" : "POST"),
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
const PORT = 18793;
const TOKEN = "pp_usb_test";
const events = [];
const server = createLocalServer({
  getConfig: () => ({ serverUrl: "https://ejemplo.test", token: TOKEN, printerIp: "", printerPort: 9100 }),
  onEvent: (e) => events.push(e),
  port: PORT,
});
server.start();
await new Promise((resolve, reject) => {
  const start = Date.now();
  const tick = () => (server.isListening() ? resolve(true) : Date.now() - start > 3000 ? reject(new Error("timeout")) : setTimeout(tick, 25));
  tick();
});

{
  const r = await request(PORT, "/local-status");
  assert.equal(r.json.ok, true);
  assert.equal(r.json.backend, "tcp");
  console.log("ok - /local-status anuncia backend (tolerante para clientes viejos)");
}
{
  const r = await request(PORT, "/local-printers");
  assert.equal(r.status, 401);
  const r2 = await request(PORT, `/local-printers?token=${TOKEN}`);
  assert.equal(r2.status, 200);
  assert.ok(Array.isArray(r2.json.printers));
  console.log("ok - /local-printers exige token y responde lista");
}
{
  const bad = await request(PORT, "/local-config", { token: TOKEN, backend: "usb", printerUsbName: "" });
  assert.equal(bad.status, 400);
  const good = await request(PORT, "/local-config", { token: TOKEN, backend: "usb", printerUsbName: "XP-80" });
  assert.equal(good.status, 200);
  assert.equal(good.json.ok, true);
  const fix = events.find((e) => e.type === "printer-usb-fixed");
  assert.ok(fix && fix.usbName === "XP-80", "debe emitir persistencia usb");
  console.log("ok - /local-config usb valida y emite persistencia");
}
{
  // Sin cola en el agente → ok:false operativo (no intenta nada).
  const r = await request(PORT, "/local-print", {
    token: TOKEN,
    backend: "usb",
    payload: Buffer.from("hola").toString("base64"),
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, false);
  console.log("ok - /local-print usb sin cola responde error operativo");
}
server.stop();
console.log("todas las pruebas USB pasaron");
