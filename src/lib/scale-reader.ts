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

const BAUDS = [9600, 19200, 38400, 115200, 4800, 2400];

const READ_MS_FIRST = 7000; // primer intento (baud recordado o 9600): más margen
const READ_MS_SCAN = 4000; // resto del barrido

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
    super(
      "No se pudo abrir la balanza (revisá el cable/puerto, cerrá otras pestañas que usen el mismo puerto y volvé a elegir el dispositivo)"
    );
    this.name = "ScalePortError";
  }
}

/** No llegó ningún byte en ningún baudrate. */
export class ScaleNoDataError extends Error {
  constructor() {
    super(
      "No llegó ningún dato de la balanza. Revisá: (1) que el cable/adaptador esté bien conectado y con driver instalado, (2) que la balanza esté encendida y con peso estable, (3) que el puerto elegido sea el de la balanza, (4) probá apretar la tecla Imprimir/Enviar de la balanza mientras lee."
    );
    this.name = "ScaleNoDataError";
  }
}

/** Llegaron bytes pero ninguno se pudo interpretar como peso. */
export class ScaleUnparsedError extends Error {
  raw: string;
  baud: number;
  constructor(raw: string, baud: number) {
    const hasWack = raw.includes("\x11");
    const msg = hasWack
      ? `La balanza respondió "peso inestable" (WACK). Estabilizá el peso en el plato y volvé a probar (a ${baud} baudios).`
      : `No se pudo leer el peso. La balanza envió: «${truncRaw(raw)}» (a ${baud} baudios)`;
    super(msg);
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
  // 1) Frames delimitados (protocolo polled): Systel STX...ETX, CAS STX...CR.
  //    El peso viaja ASCII entre los delimitadores; la verificación (CRC) va
  //    después y NO debe confundirse con el peso (antes un CRC dígito podía
  //    sobrescribir el peso real).
  let lastKg: number | null = null;
  const frameRes = [/\x02([^\x03]*)\x03/g, /\x02([^\x0D]*)\x0D/g];
  for (const re of frameRes) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const token = (m[1] || "").replace(/\s+/g, "");
      if (!token) continue;
      const v = toNumber(token);
      if (v == null || !Number.isFinite(v)) continue;
      // En frames polled el visor envía kg con decimales: si tiene separador
      // decimal es kg; si es entero se asume gramos (CAS/Torrey típicos).
      const kg = token.includes(".") || token.includes(",")
        ? Math.abs(v)
        : Math.abs(v) / 1000;
      if (kg > 0 && kg <= MAX_KG) lastKg = kg;
    }
  }
  if (lastKg != null) return lastKg;

  // 2) Parser genérico (modo continuo / texto libre).
  const clean = text.replace(/[^\x20-\x7E]/g, " ");
  // Número (con separadores decimales/miles opcionales) + unidad opcional
  // pegada (kg|g). Sin \s en la clase interna: los saltos de línea separan
  // lecturas consecutivas y no deben pegarse en un solo número.
  const re2 = /([+-]?\d[\d.,]{0,11}\d|[+-]?\d)\s*(kg|g)?/gi;
  let m2: RegExpExecArray | null;
  while ((m2 = re2.exec(clean)) !== null) {
    const unit = m2[2]?.toLowerCase();
    const v = toNumber(m2[1]);
    if (v == null || !Number.isFinite(v)) continue;
    let kg: number | null = null;
    if (unit === "kg") kg = Math.abs(v);
    else if (unit === "g") kg = Math.abs(v) / 1000;
    else if (m2[1].includes(".") || m2[1].includes(","))
      kg = Math.abs(v); // decimal sin unidad: kg (x.yyy kg ≡ xyyy g: mismo valor)
    else kg = Math.abs(v) / 1000; // entero sin unidad: gramos (frames típicos)
    if (kg != null && kg > 0 && kg <= MAX_KG) lastKg = kg;
    // Avanzar más allá del match para no loopear sobre cadenas vacías.
    if (m2.index === re2.lastIndex) re2.lastIndex++;
  }
  return lastKg;
}

// ── Lectura del puerto ───────────────────────────────────────────────────────

const SLEEP = Symbol("timeout");

async function readForMs(
  port: any,
  ms: number,
  onChunk: (s: string) => void,
  writer?: any
): Promise<void> {
  const reader = port.readable.getReader();
  const decoder = new TextDecoder();
  try {
    const deadline = Date.now() + ms;
    let pending: Promise<any> | null = null;
    let lastEnq = 0;
    // Envía el byte de pedido ENQ (0x05): imprescindible para balanzas en
    // modo polled (Systel Clipse/Croma/Cuora) y harmless en modo continuo.
    const sendEnq = async () => {
      if (!writer) return;
      try {
        await writer.write(new Uint8Array([0x05]));
      } catch {
        /* noop */
      }
    };
    await sendEnq();
    lastEnq = Date.now();
    while (Date.now() < deadline) {
      // Re-pedir cada ~900ms: cubre peso inestable (WACK) y cambios de peso.
      if (Date.now() - lastEnq > 900) {
        await sendEnq();
        lastEnq = Date.now();
      }
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
    const openOpts = { baudRate: baud };
    try {
      await port.open(openOpts);
    } catch {
      // Puerto ya abierto de un intento anterior: cerrar y reintentar una vez.
      try {
        await port.close();
        await port.open(openOpts);
      } catch {
        throw new ScalePortError();
      }
    }
    // Activar DTR/RTS: muchas balanzas (Systel incluida) y adaptadores
    // USB-serie requieren DTR=1 para habilitar la transmisión. Sin esto la
    // balanza no responde aunque el puerto se abra bien.
    try {
      await port.setSignals?.({ dataTerminalReady: true, requestToSend: true });
    } catch {
      /* noop: no todos los navegadores/adaptadores lo soportan */
    }
    // Dar tiempo a que la balanza detecte DTR antes de enviar ENQ.
    await new Promise((r) => setTimeout(r, 150));
    let raw = "";
    let writer: any = null;
    try {
      try {
        writer = port.writable?.getWriter?.();
      } catch {
        writer = null;
      }
      // Systel (Clipse/Croma/Cuora) polled: requiere ENQ (0x05) para responder.
      // Modo B (estabilidad): requiere 0x07 0x07. Ambos son inofensivos en
      // modo continuo y en otras marcas.
      const send = async (bytes: number[]) => {
        if (!writer) return;
        try {
          await writer.write(new Uint8Array(bytes));
        } catch {
          /* noop */
        }
      };
      await send([0x05]);
      await new Promise((r) => setTimeout(r, 250));
      await send([0x07, 0x07]);
      await readForMs(
        port,
        baud === bauds[0] ? READ_MS_FIRST : READ_MS_SCAN,
        (s) => {
          raw += s;
        },
        writer
      );
    } finally {
      try {
        writer?.releaseLock();
      } catch {
        /* noop */
      }
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
