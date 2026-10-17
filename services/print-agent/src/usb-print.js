/**
 * Impresión USB por cable en Windows (tercer modo "usb").
 *
 * Las térmicas USB aparecen en Windows como una COLA de impresión
 * (ej. "XP-80", "EPSON TM-T20"), no como una IP. Para mandarles los mismos
 * bytes ESC/POS crudos que por TCP se usa el spooler en modo RAW vía
 * PowerShell stock (Add-Type + P/Invoke a winspool.drv): sin dependencias
 * nativas nuevas, sin Zadig, sin drivers extra (plug-and-play total).
 *
 * El nombre de la cola y los bytes viajan por variables de entorno
 * (PORTAL_PRINTER / PORTAL_BIN): evita todo problema de quoting con
 * espacios, tildes o comillas en los nombres de impresora.
 */

const { execFile } = require("node:child_process");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { randomUUID } = require("node:crypto");
const { writeFile, unlink } = require("node:fs/promises");

const POWERSHELL =
  `${process.env.SystemRoot || "C:\\Windows"}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
const LIST_TIMEOUT_MS = 15000;
const WRITE_TIMEOUT_MS = 15000;
const MAX_NAME_LEN = 260;

function defaultRun(args, { timeoutMs, env } = {}) {
  return new Promise((resolve) => {
    execFile(
      POWERSHELL,
      args,
      { timeout: timeoutMs, windowsHide: true, env: { ...process.env, ...env } },
      (err, stdout, stderr) => {
        resolve({
          code: err && typeof err.code === "number" ? err.code : err ? 1 : 0,
          stdout: String(stdout || ""),
          stderr: String(stderr || ""),
          timedOut: !!(err && err.killed),
        });
      }
    );
  });
}

function isWindows(platform = process.platform) {
  return platform === "win32";
}

/**
 * Parsea la salida de `Get-Printer | ... | ConvertTo-Json -Compress`.
 * PowerShell devuelve objeto suelto (una sola) o array (varias) o "" (ninguna).
 */
function parsePrinterListJson(text) {
  const raw = String(text || "").trim();
  if (!raw) return [];
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  const arr = Array.isArray(data) ? data : [data];
  const out = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const name = String(item.Name ?? "").trim();
    if (!name) continue;
    out.push({ name, status: item.PrinterStatus != null ? String(item.PrinterStatus) : null });
  }
  return out;
}

const LIST_PS =
  "Get-Printer | Select-Object Name,PrinterStatus | ConvertTo-Json -Compress";
const LIST_PS_FALLBACK =
  "Get-CimInstance Win32_Printer | Select-Object @{n='Name';e={$_.Name}},@{n='PrinterStatus';e={$_.PrinterStatus}} | ConvertTo-Json -Compress";

/** Lista las colas de impresión de ESTE equipo. Solo Windows. */
async function listUsbPrinters({ run = defaultRun, platform = process.platform } = {}) {
  if (!isWindows(platform)) {
    return { ok: false, error: "USB solo disponible en Windows (en este equipo no aplica)" };
  }
  const base = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command"];
  let res = await run([...base, LIST_PS], { timeoutMs: LIST_TIMEOUT_MS });
  let printers = res.code === 0 ? parsePrinterListJson(res.stdout) : [];
  if (res.code !== 0 || (printers.length === 0 && res.stdout.trim() === "")) {
    // Reintento con CIM (algunos Windows recortan Get-Printer en PS 5.1).
    const retry = await run([...base, LIST_PS_FALLBACK], { timeoutMs: LIST_TIMEOUT_MS });
    if (retry.code === 0) printers = parsePrinterListJson(retry.stdout);
    else if (res.code !== 0) res = retry;
  }
  if (res.code !== 0 && printers.length === 0) {
    return { ok: false, error: mapListError(res) };
  }
  return { ok: true, printers };
}

function mapListError(res) {
  if (res.timedOut) return "PowerShell tardó demasiado (spooler colgado: reiniciá la cola de impresión de Windows)";
  const tail = String(res.stderr || "").trim().split("\n").pop() || "";
  if (/no se reconoce|not recognized/i.test(tail)) {
    return "PowerShell no disponible en este equipo";
  }
  return tail ? `No se pudo listar impresoras: ${tail.slice(0, 200)}` : "No se pudo listar impresoras";
}

const RAW_CS = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class PortalRawPrint {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct DOC_INFO_1 {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDatatype;
  }
  [DllImport("winspool.Drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern bool OpenPrinter(string pPrinterName, out IntPtr phPrinter, IntPtr pDefault);
  [DllImport("winspool.Drv", SetLastError = true)]
  public static extern bool ClosePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", SetLastError = true)]
  public static extern int StartDocPrinter(IntPtr hPrinter, int level, [In] ref DOC_INFO_1 pDocInfo);
  [DllImport("winspool.Drv", SetLastError = true)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", SetLastError = true)]
  public static extern bool StartPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", SetLastError = true)]
  public static extern bool EndPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", SetLastError = true)]
  public static extern bool WritePrinter(IntPtr hPrinter, byte[] pBytes, int dwCount, out int dwWritten);
}
"@;
$printer = $env:PORTAL_PRINTER;
$bin = $env:PORTAL_BIN;
if ([string]::IsNullOrWhiteSpace($printer)) { Write-Output "ERR:open:0"; exit 0 }
if (-not (Test-Path -LiteralPath $bin)) { Write-Output "ERR:read:0"; exit 0 }
$h = [IntPtr]::Zero;
if (-not [PortalRawPrint]::OpenPrinter($printer, [ref]$h, [IntPtr]::Zero)) { Write-Output "ERR:open:1"; exit 0 }
try {
  $doc = New-Object PortalRawPrint+DOC_INFO_1;
  $doc.pDocName = "Portal 659";
  $doc.pOutputFile = $null;
  $doc.pDatatype = "RAW";
  $job = [PortalRawPrint]::StartDocPrinter($h, 1, [ref]$doc);
  if ($job -le 0) { Write-Output "ERR:startdoc:1"; exit 0 }
  try {
    if (-not [PortalRawPrint]::StartPagePrinter($h)) { Write-Output "ERR:startpage:1"; exit 0 }
    try {
      $bytes = [IO.File]::ReadAllBytes($bin);
      $written = 0;
      $ok = [PortalRawPrint]::WritePrinter($h, $bytes, $bytes.Length, [ref]$written);
      if (-not $ok -or $written -ne $bytes.Length) { Write-Output "ERR:write:1"; exit 0 }
    } finally {
      [void][PortalRawPrint]::EndPagePrinter($h);
    }
  } finally {
    [void][PortalRawPrint]::EndDocPrinter($h);
  }
  Write-Output ("OK:" + $bytes.Length);
} finally {
  [void][PortalRawPrint]::ClosePrinter($h);
}
`.trim();

/** Traduce el `ERR:<paso>` del script a lenguaje operativo. */
function mapUsbError(step, printerName) {
  const name = printerName ? ` "${printerName}"` : "";
  switch (step) {
    case "open":
      return `La cola${name} no existe o el spooler no responde: elegila de la lista de este equipo (no escribas el nombre a mano).`;
    case "read":
      return "No se pudo leer el ticket a imprimir (archivo temporal). Probá de nuevo.";
    case "startdoc":
    case "startpage":
      return (
        `La impresora${name} rechazó el trabajo RAW: el driver filtra los bytes. ` +
        `Creá una 2ª cola con el driver "Generic / Text Only" al mismo puerto USB y elegila en el agente.`
      );
    case "write":
      return `No se pudo enviar a${name}: verificá cable USB, papel y que esté prendida.`;
    default:
      return `No se pudo imprimir en${name || " la impresora USB"}.`;
  }
}

/**
 * Escribe bytes ESC/POS crudos a una cola USB local (spooler RAW).
 * Devuelve { ok, bytes?, error? }.
 */
async function writeUsbRaw(
  printerName,
  buffer,
  { run = defaultRun, platform = process.platform, timeoutMs = WRITE_TIMEOUT_MS } = {}
) {
  const name = String(printerName ?? "").trim();
  if (!name) return { ok: false, error: "Sin cola USB configurada: elegila de la lista de este equipo." };
  if (name.length > MAX_NAME_LEN) return { ok: false, error: "El nombre de la cola USB es inválido." };
  const data = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  if (data.length === 0) return { ok: false, error: "Ticket vacío, nada para imprimir." };
  if (!isWindows(platform)) {
    return { ok: false, error: "USB solo disponible en Windows (en este equipo no aplica)" };
  }
  const binPath = join(tmpdir(), `portal-print-${randomUUID()}.bin`);
  try {
    await writeFile(binPath, data);
  } catch (e) {
    return { ok: false, error: `No se pudo preparar el ticket: ${e?.message || e}` };
  }
  try {
    const res = await run(
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", RAW_CS],
      { timeoutMs, env: { PORTAL_PRINTER: name, PORTAL_BIN: binPath } }
    );
    const out = `${res.stdout || ""}\n${res.stderr || ""}`;
    const okMatch = out.match(/OK:(\d+)/);
    if (res.code === 0 && okMatch) return { ok: true, bytes: Number(okMatch[1]) || data.length };
    if (res.timedOut) {
      return { ok: false, error: "El spooler tardó demasiado (cola colgada: cancelá los trabajos en Windows y probá de nuevo)", code: "timeout" };
    }
    const errMatch = out.match(/ERR:([a-z]+)/);
    const step = errMatch ? errMatch[1] : "";
    return { ok: false, error: mapUsbError(step, name), code: step || null };
  } finally {
    try {
      await unlink(binPath);
    } catch {}
  }
}

// ---------------------------------------------------------------------------
// Auto-fallback (tercer modo): algunos drivers POS rechazan el tipo RAW.
// En vez de pedirle al comercio que cree a mano una 2ª cola "Generic / Text
// Only", el agente busca otra cola en el MISMO puerto USB que acepte RAW y,
// si no existe, la crea solo (driver inbox de Windows + puerto ya existente).
// Si sale, queda fijada en la config (printer-usb-fixed) y no se repite el
// trabajo en los próximos tickets. Mismo patrón que el auto-fix de IP.
// ---------------------------------------------------------------------------

const LIST_DETAILS_PS =
  "Get-Printer | Select-Object Name,DriverName,PortName | ConvertTo-Json -Compress";

/** Cola genérica que crea el agente, determinística por puerto USB. */
function autoQueueName(port) {
  return `Portal659 (${String(port || "").trim()})`;
}

const QUEUE_CREATE_PS = `
$ErrorActionPreference = "Stop"
$port = $env:PORTAL_PORT
$newName = $env:PORTAL_NEWNAME
try {
  if ([string]::IsNullOrWhiteSpace($port)) { throw "sin puerto" }
  $existing = Get-Printer -Name $newName -ErrorAction SilentlyContinue
  if ($existing) { Write-Output "OK"; exit 0 }
  $drv = "Generic / Text Only"
  $staged = Get-PrinterDriver -Name $drv -ErrorAction SilentlyContinue
  if (-not $staged) { Add-PrinterDriver -Name $drv | Out-Null }
  Add-Printer -Name $newName -DriverName $drv -PortName $port | Out-Null
  Write-Output "OK"
} catch {
  $msg = $_.Exception.Message -replace "[\r\n]+", " "
  if ($msg.Length -gt 160) { $msg = $msg.Substring(0, 160) }
  Write-Output ("ERR:" + $msg)
}
`.trim();

function parseQueueDetails(text) {
  const raw = String(text || "").trim();
  if (!raw) return [];
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  const arr = Array.isArray(data) ? data : [data];
  const out = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const name = String(item.Name ?? "").trim();
    if (!name) continue;
    out.push({
      name,
      driver: String(item.DriverName ?? "").trim(),
      port: String(item.PortName ?? "").trim(),
    });
  }
  return out;
}

/** Lista las colas con driver y puerto (para armar candidatos de fallback). */
async function listQueueDetails({ run = defaultRun, platform = process.platform } = {}) {
  if (!isWindows(platform)) return { ok: false, error: "USB solo disponible en Windows" };
  const res = await run(
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", LIST_DETAILS_PS],
    { timeoutMs: LIST_TIMEOUT_MS }
  );
  const queues = res.code === 0 ? parseQueueDetails(res.stdout) : [];
  if (res.code !== 0 && queues.length === 0) {
    return { ok: false, error: mapListError(res) };
  }
  return { ok: true, queues };
}

/**
 * Crea (o reutiliza) la cola genérica "Portal659 (USBxxx)" sobre un puerto
 * USB existente. Driver "Generic / Text Only" (inbox de Windows). Puede
 * requerir permisos: si falla devuelve el motivo para guiar a mano.
 */
async function ensureGenericQueue(port, { run = defaultRun, platform = process.platform } = {}) {
  if (!isWindows(platform)) return { ok: false, error: "USB solo disponible en Windows" };
  const cleanPort = String(port || "").trim();
  if (!cleanPort || cleanPort.length > 32) {
    return { ok: false, error: "puerto USB inválido" };
  }
  const newName = autoQueueName(cleanPort);
  const res = await run(
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", QUEUE_CREATE_PS],
    { timeoutMs: 30000, env: { PORTAL_PORT: cleanPort, PORTAL_NEWNAME: newName } }
  );
  const out = String(res.stdout || "");
  if (/^\s*OK\s*$/m.test(out)) return { ok: true, name: newName };
  const m = out.match(/ERR:(.*)/s);
  return {
    ok: false,
    name: newName,
    error: m ? m[1].trim() : "no se pudo crear la cola genérica automática",
  };
}

/**
 * Escribe bytes ESC/POS con auto-fallback: si la cola configurada rechaza el
 * RAW (driver filtra), prueba otras colas del mismo puerto USB y, si ninguna
 * sirve, crea la genérica. Devuelve { ok, bytes?, usbUsed?, autoFixed?, error?, code? }.
 */
async function writeUsbRawAuto(
  printerName,
  buffer,
  { run = defaultRun, platform = process.platform, timeoutMs = WRITE_TIMEOUT_MS, createQueue = true } = {}
) {
  const first = await writeUsbRaw(printerName, buffer, { run, platform, timeoutMs });
  if (first.ok) return { ...first, usbUsed: printerName, autoFixed: false };
  // Solo el rechazo del driver vale la pena auto-arreglar; papel/cable/cola
  // inexistente no se resuelven cambiando de cola.
  if (first.code !== "startdoc" && first.code !== "startpage") return first;

  const details = await listQueueDetails({ run, platform });
  if (!details.ok) {
    return { ok: false, error: `${first.error} (no se pudieron listar colas para el fallback)`, code: first.code };
  }
  const orig = details.queues.find((q) => q.name === printerName);
  if (!orig || !orig.port) {
    return first;
  }
  const siblings = details.queues.filter((q) => q.name !== printerName && q.port === orig.port);
  const generic = siblings.filter((q) => /generic|text only/i.test(q.driver || ""));
  const candidates = [...generic, ...siblings.filter((q) => !generic.includes(q))].slice(0, 2);
  for (const c of candidates) {
    const r = await writeUsbRaw(c.name, buffer, { run, platform, timeoutMs });
    if (r.ok) return { ok: true, bytes: r.bytes, usbUsed: c.name, autoFixed: true };
  }
  if (createQueue) {
    const created = await ensureGenericQueue(orig.port, { run, platform });
    if (created.ok) {
      const r = await writeUsbRaw(created.name, buffer, { run, platform, timeoutMs });
      if (r.ok) return { ok: true, bytes: r.bytes, usbUsed: created.name, autoFixed: true };
      return { ok: false, error: r.error, code: r.code || first.code };
    }
    return {
      ok: false,
      error: `${first.error} No se pudo arreglar automático (${created.error}): creá una 2ª cola con el driver "Generic / Text Only" al mismo puerto USB y elegila en el agente.`,
      code: first.code,
    };
  }
  return first;
}

module.exports = {
  listUsbPrinters,
  writeUsbRaw,
  writeUsbRawAuto,
  parsePrinterListJson,
  parseQueueDetails,
  listQueueDetails,
  ensureGenericQueue,
  autoQueueName,
  mapUsbError,
  RAW_CS,
  LIST_DETAILS_PS,
  QUEUE_CREATE_PS,
  POWERSHELL,
  MAX_NAME_LEN,
};
