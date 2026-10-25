/**
 * Lector universal de balanza por Web Serial (Chrome/Edge en PC).
 *
 * Cubre cualquier marca y cualquier conexión que se vea como puerto serie:
 * - Cable USB directo (CDC)
 * - Adaptador USB→serial RS232 DB9 (FTDI / CH340 / PL2303)
 * - Bluetooth serial emparejado (aparece como COM en Windows)
 *
 * Estrategia: barrido automático de baudios (el que funcionó queda recordado
 * por comercio en localStorage) + parser tolerante a los formatos ASCII más
 * comunes. Si llega data que no se entiende, se devuelve cruda para diagnóstico.
 *
 * Client-safe: no importar desde server (usa navigator/localStorage).
 */

const BAUDS = [9600, 19200, 4800, 2400];

const READ_MS_FIRST = 5000; // primer intento (baud recordado o 9600): más margen
const READ_MS_SCAN = 3200; // resto del barrido

/** Peso máximo plausible de una balanza de mostrador (kg). */
const MAX_KG = 1000;

// ── Errores tipados ──────────────────────────────────────────────────────────

export class ScaleNotSupportedError extends Error {
  constructor() {
    super("Este navegador no soporta balanza directa (usá Chrome o Edge en PC)");
    this.name = "ScaleNotSupportedError";
  }
}

export class ScalePortError extends Error {
  constructor() {
    super("No se pudo abrir la balanza (revisá el cable y el puerto)");
    this.name = "ScalePortError";
  }
}

/** No llegó ningún byte en ningún baudrate. */
export class ScaleNoDataError extends Error {
  constructor() {
    super("No llegó ningún dato de la balanza (revisá el cable y probá de nuevo)");
    this.name = "ScaleNoDataError";
  }
}

/** Llegaron bytes pero ninguno se pudo interpretar como peso. */
export class ScaleUnparsedError extends Error {
  raw: string;
  baud: number;
  constructor(raw: string, baud: number) {
    super(
      `No se pudo leer el peso. La balanza envió: «${truncRaw(raw)}» (a ${baud} baudios)`
    );
    this.name = "ScaleUnparsedError";
    this.raw = raw;
    this.baud = baud;
  }
}

export type ScaleReadResult = { kg: number; baud: number; raw: string };

function truncRaw(raw: string): string {
  const clean = raw.replace(/[^\x20-\x7E]/g, "·").trim();
  return clean.length > 120 ? "…" + clean.slice(-120) : clean;
}

// ── Puerto recordado (compartido mostrador + Config) ─────────────────────────

let cachedPort: any = null;

export function getCachedScalePort(): any {
  return cachedPort;
}

export function setCachedScalePort(port: any): void {
  cachedPort = port;
}

export function clearCachedScalePort(): void {
  cachedPort = null;
}

export function isWebSerialSupported(): boolean {
  const nav = typeof navigator !== "undefined" ? (navigator as any) : null;
  return Boolean(nav?.serial);
}

/** Pide al usuario elegir el puerto (picker del navegador). Lo cachea. */
export async function requestScalePort(): Promise<any> {
  const nav = navigator as any;
  if (!nav?.serial) throw new ScaleNotSupportedError();
  const port = await nav.serial.requestPort();
  cachedPort = port;
  return port;
}

// ── Baudios recordados por comercio ──────────────────────────────────────────

function baudKey(vendorId?: string | null): string {
  return `portal659-scale-baud:${vendorId || "default"}`;
}

export function loadRememberedBaud(vendorId?: string | null): number | null {
  try {
    const v = Number(localStorage.getItem(baudKey(vendorId)));
    return BAUDS.includes(v) ? v : null;
  } catch {
    return null;
  }
}

function saveRememberedBaud(vendorId: string | null | undefined, baud: number): void {
  try {
    localStorage.setItem(baudKey(vendorId), String(baud));
  } catch {
    /* noop */
  }
}

// ── Parser de peso ───────────────────────────────────────────────────────────

/** Convierte un número con separadores mixtos ("1.235,5" / "1,235.5") a number. */
function toNumber(token: string): number | null {
  let t = token.replace(/\s/g, "");
  const lastDot = t.lastIndexOf(".");
  const lastComma = t.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) {
    // Hay ambos: el último es el separador decimal, el otro es de miles.
    const dec = lastDot > lastComma ? "." : ",";
    t = t.split(dec === "." ? "," : ".").join("").replace(dec, ".");
  } else {
    t = t.replace(",", ".");
  }
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

/**
 * Extrae el último peso válido (kg) de un stream ASCII de balanza.
 * Formatos soportados:
 *   - "ST,GS,+  1.235kg" / "US,GT, 0.542 kg" (MT y variantes)
 *   - "1.235 kg" / "1,235 kg" / "+  1.235KG"
 *   - "0.542" (decimal sin unidad → kg)
 *   - "1240 g" / "1240g" (entero en gramos)
 *   - "12340" (entero sin unidad → se interpreta en gramos: frames típicos
 *     de balanzas comerciales; con filtro de plausibilidad ≤ MAX_KG*1000)
 * Gana siempre el ÚLTIMO match del buffer (la lectura más reciente).
 * Devuelve null si no hay ningún peso interpretable > 0.
 */
export function parseScaleKg(text: string): number | null {
  const clean = text.replace(/[^\x20-\x7E]/g, " ");
  // Número (con separadores decimales/miles opcionales) + unidad opcional
  // pegada (kg|g). Sin \s en la clase interna: los saltos de línea separan
  // lecturas consecutivas y no deben pegarse en un solo número.
  const re = /([+-]?\d[\d.,]{0,11}\d|[+-]?\d)\s*(kg|g)?/gi;
  let lastKg: number | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean)) !== null) {
    const unit = m[2]?.toLowerCase();
    const v = toNumber(m[1]);
    if (v == null || !Number.isFinite(v)) continue;
    let kg: number | null = null;
    if (unit === "kg") kg = Math.abs(v);
    else if (unit === "g") kg = Math.abs(v) / 1000;
    else if (m[1].includes(".") || m[1].includes(","))
      kg = Math.abs(v); // decimal sin unidad: kg (x.yyy kg ≡ xyyy g: mismo valor)
    else kg = Math.abs(v) / 1000; // entero sin unidad: gramos (frames típicos)
    if (kg != null && kg > 0 && kg <= MAX_KG) lastKg = kg;
    // Avanzar más allá del match para no loopear sobre cadenas vacías.
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  return lastKg;
}

// ── Lectura del puerto ───────────────────────────────────────────────────────

const SLEEP = Symbol("timeout");

async function readForMs(
  port: any,
  ms: number,
  onChunk: (s: string) => void
): Promise<void> {
  const reader = port.readable.getReader();
  const decoder = new TextDecoder();
  try {
    const deadline = Date.now() + ms;
    let pending: Promise<any> | null = null;
    while (Date.now() < deadline) {
      if (!pending) pending = reader.read();
      // No se corta en el primer silencio: se reusa la misma lectura
      // pendiente hasta agotar la ventana (balanzas que mandan a ráfagas).
      const res = await Promise.race([
        pending,
        new Promise<typeof SLEEP>((res) => setTimeout(() => res(SLEEP), 400)),
      ]);
      if (res === SLEEP) continue;
      pending = null;
      const { value, done } = res as any;
      if (done || !value) break;
      onChunk(decoder.decode(value, { stream: true }));
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      /* noop */
    }
    try {
      reader.releaseLock();
    } catch {
      /* noop */
    }
  }
}

export async function readScaleFromPort(
  port: any,
  opts: { vendorId?: string | null; onBaud?: (baud: number) => void } = {}
): Promise<ScaleReadResult> {
  const remembered = loadRememberedBaud(opts.vendorId);
  const bauds = remembered
    ? [remembered, ...BAUDS.filter((b) => b !== remembered)]
    : [...BAUDS];
  let sawBytes = false;
  let bestRaw = "";
  let bestBaud = 0;
  for (const baud of bauds) {
    try {
      await port.open({ baudRate: baud });
    } catch {
      // Puerto ya abierto de un intento anterior: cerrar y reintentar una vez.
      try {
        await port.close();
        await port.open({ baudRate: baud });
      } catch {
        throw new ScalePortError();
      }
    }
    let raw = "";
    try {
      await readForMs(
        port,
        baud === bauds[0] ? READ_MS_FIRST : READ_MS_SCAN,
        (s) => {
          raw += s;
        }
      );
    } finally {
      try {
        await port.close();
      } catch {
        /* noop */
      }
    }
    if (raw) {
      sawBytes = true;
      if (raw.length > bestRaw.length) {
        bestRaw = raw;
        bestBaud = baud;
      }
    }
    const kg = parseScaleKg(raw);
    if (kg != null) {
      saveRememberedBaud(opts.vendorId, baud);
      return { kg, baud, raw: raw.slice(-200) };
    }
    opts.onBaud?.(baud);
  }
  if (sawBytes) throw new ScaleUnparsedError(bestRaw, bestBaud);
  throw new ScaleNoDataError();
}
