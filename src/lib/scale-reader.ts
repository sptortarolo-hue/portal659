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

export const BAUDS = [9600, 115200, 4800, 19200, 2400, 1200, 38400];

const READ_MS_FIRST = 3000; // primer intento (baud recordado o 9600): más margen
const READ_MS_SCAN = 1500; // resto del barrido
const READ_MS_DIAG = 1000; // diagnóstico: más corto para barrer rápido

/** Combinación de parámetros serie a probar. Muchas balanzas (Systel incluida)
 *  con adaptadores CH340/PL2303 usan 7E1 o 7O1 en vez de 8N1. */
export type PortParams = {
  baudRate: number;
  parity: "none" | "even" | "odd";
  dataBits: 7 | 8;
  stopBits: 1 | 2;
};

// (PORT_COMBOS se arma dinámicamente por baud en readScaleFromPort / diagnoseScale)

/** Matriz de paridad/bits a barrer (independiente del baud). */
export const PARITY_COMBOS: { parity: PortParams["parity"]; dataBits: PortParams["dataBits"]; stopBits: PortParams["stopBits"] }[] = [
  { parity: "none", dataBits: 8, stopBits: 1 },
  { parity: "even", dataBits: 7, stopBits: 1 },
  { parity: "odd", dataBits: 7, stopBits: 1 },
  { parity: "even", dataBits: 8, stopBits: 1 },
  { parity: "none", dataBits: 7, stopBits: 1 },
  { parity: "none", dataBits: 8, stopBits: 2 },
];

export function paramsKey(p: PortParams): string {
  return `${p.baudRate}-${p.parity[0]}${p.dataBits}${p.stopBits}`;
}

export function paramsLabel(p: PortParams): string {
  const par = p.parity === "none" ? "N" : p.parity === "even" ? "E" : "O";
  return `${p.baudRate} ${p.dataBits}${par}${p.stopBits}`;
}

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

// ── Parámetros serie recordados (baud + paridad/bits) ────────────────────────
function paramsStorageKey(vendorId?: string | null): string {
  return `portal659-scale-params:${vendorId || "default"}`;
}

export function loadRememberedParams(vendorId?: string | null): PortParams | null {
  try {
    const raw = localStorage.getItem(paramsStorageKey(vendorId));
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (!p || typeof p.baudRate !== "number") return null;
    return p as PortParams;
  } catch {
    return null;
  }
}

function saveRememberedParams(vendorId: string | null | undefined, p: PortParams): void {
  try {
    localStorage.setItem(paramsStorageKey(vendorId), JSON.stringify(p));
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
    let buf = "";
    let firstByteAt = 0;
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
      // Corte temprano: con peso válido y 100 ms desde el primer byte,
      // terminamos. Se evalúa en CADA vuelta (no solo al recibir chunks):
      // en modo polled la trama llega y después viene silencio, y ese caso
      // era justamente el que antes esperaba el timeout completo.
      if (buf && firstByteAt && Date.now() - firstByteAt >= 100 && parseScaleKg(buf) != null) {
        break;
      }
      // Re-pedir cada ~900ms: cubre peso inestable (WACK) y cambios de peso.
      if (Date.now() - lastEnq > 900) {
        await sendEnq();
        lastEnq = Date.now();
      }
      if (!pending) pending = reader.read();
      const res = await Promise.race([
        pending,
        new Promise<typeof SLEEP>((res) => setTimeout(() => res(SLEEP), 100)),
      ]);
      if (res === SLEEP) continue;
      pending = null;
      const { value, done } = res as any;
      if (done || !value) break;
      const chunk = decoder.decode(value, { stream: true });
      buf += chunk;
      if (!firstByteAt) firstByteAt = Date.now();
      onChunk(chunk);
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

// ── Lectura continua (para disparar con la tecla Imprimir de la balanza) ─────
export async function continuousRead(
  port: any,
  params: PortParams,
  opts: { ms?: number; onChunk?: (s: string) => void; onProgress?: (msg: string) => void } = {}
): Promise<{ raw: string; bytes: number }> {
  const ms = opts.ms ?? 15000;
  let raw = "";
  opts.onProgress?.("Abriendo puerto…");
  try {
    await port.open({ baudRate: params.baudRate, parity: params.parity, dataBits: params.dataBits, stopBits: params.stopBits });
  } catch {
    try {
      await port.close();
      await port.open({ baudRate: params.baudRate, parity: params.parity, dataBits: params.dataBits, stopBits: params.stopBits });
    } catch {
      throw new ScalePortError();
    }
  }
  try {
    await port.setSignals?.({ dataTerminalReady: true, requestToSend: true });
  } catch {
    /* noop */
  }
  await new Promise((r) => setTimeout(r, 30));
  let writer: any = null;
  try {
    writer = port.writable?.getWriter?.() ?? null;
  } catch {
    writer = null;
  }
  const send = async (bytes: number[]) => {
    if (!writer) return;
    try {
      await writer.write(new Uint8Array(bytes));
    } catch {
      /* noop */
    }
  };
  opts.onProgress?.("Leyendo… apretá la tecla Imprimir/Enviar de la balanza");
  const start = Date.now();
  let lastEnq = 0;
  await send([0x05]);
  await send([0x07, 0x07]);
  lastEnq = Date.now();
  const reader = port.readable.getReader();
  const decoder = new TextDecoder();
  let pending: any = null;
  try {
    while (Date.now() - start < ms) {
      if (Date.now() - lastEnq > 1000) {
        await send([0x05]);
        await send([0x07, 0x07]);
        lastEnq = Date.now();
      }
      if (!pending) pending = reader.read();
      const res = await Promise.race([
        pending,
        new Promise((r) => setTimeout(() => r("timeout"), 100)),
      ]);
      if (res === "timeout") continue;
      pending = null;
      const { value, done } = res as any;
      if (done || !value) break;
      const chunk = decoder.decode(value, { stream: true });
      raw += chunk;
      opts.onChunk?.(chunk);
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
    try {
      writer?.releaseLock?.();
    } catch {
      /* noop */
    }
    try {
      await port.close();
    } catch {
      /* noop */
    }
  }
  return { raw, bytes: raw.length };
}

// ── Diagnóstico crudo (para identificar protocolo de balanzas nuevas) ────────
export type DiagComboResult = {
  params: PortParams;
  raw: string;
  bytes: number;
  hex: string;
};

export type ScaleDiagResult = {
  combos: DiagComboResult[];
  totalBytes: number;
};

/** Lee el puerto con cada combinación (baud × paridad/bits), enviando todos
 *  los comandos candidatos, y devuelve el volcado crudo (hex + ascii) de lo
 *  que llegó. No intenta parsear: sirve para identificar el protocolo exacto
 *  de una balanza que no se reconoce. */
export async function diagnoseScale(
  port: any,
  opts: { onProgress?: (label: string) => void; bauds?: number[] } = {}
): Promise<ScaleDiagResult> {
  const POLL_COMMANDS = [
    [0x05],
    [0x07, 0x07],
    [0x1b],
    [0x0d],
    [0x0a],
    [0x02, 0x05, 0x03],
  ];
  const baudList = opts.bauds && opts.bauds.length ? opts.bauds : BAUDS;
  const combos: DiagComboResult[] = [];
  let totalBytes = 0;
  for (const pc of PARITY_COMBOS) {
    for (const b of baudList) {
      const params: PortParams = { baudRate: b, parity: pc.parity, dataBits: pc.dataBits, stopBits: pc.stopBits };
      opts.onProgress?.(paramsLabel(params));
      let raw = "";
      try {
        await port.open({ baudRate: b, parity: pc.parity, dataBits: pc.dataBits, stopBits: pc.stopBits });
      } catch {
        try {
          await port.close();
          await port.open({ baudRate: b, parity: pc.parity, dataBits: pc.dataBits, stopBits: pc.stopBits });
        } catch {
          continue;
        }
      }
      try {
        await port.setSignals?.({ dataTerminalReady: true, requestToSend: true });
      } catch {
        /* noop */
      }
      await new Promise((r) => setTimeout(r, 30));
      let writer: any = null;
      try {
        try {
          writer = port.writable?.getWriter?.();
        } catch {
          writer = null;
        }
        const send = async (bytes: number[]) => {
          if (!writer) return;
          try {
            await writer.write(new Uint8Array(bytes));
          } catch {
            /* noop */
          }
        };
        for (const cmd of POLL_COMMANDS) {
          await send(cmd);
          await new Promise((r) => setTimeout(r, 80));
        }
        await readForMs(port, READ_MS_DIAG, (s) => {
          raw += s;
        }, writer);
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
      const hex = Array.from(raw).map((c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join(" ");
      combos.push({ params, raw, bytes: raw.length, hex });
      totalBytes += raw.length;
    }
  }
  return { combos, totalBytes };
}

export type WatchHandle = {
  stop: () => void;
  /** Baudios con los que quedó la balanza leyendo. */
  baud: number | null;
};

/**
 * Lectura CONTINUA de la balanza (para mostrar el peso en vivo y para
 * auto-imprimir al estabilizar): abre el puerto una vez y queda escuchando.
 * `onKg` recibe el último peso interpretable (kg, 3 decimales) o `null` si
 * el plato quedó vacío. `stop()` libera el puerto.
 *
 * El bucle es intencionalmente tolerante: si un frame viene corrupto o la
 * balanza manda "peso inestable", simplemente no actualiza.
 */
export async function watchScale(
  port: any,
  opts: {
    vendorId?: string | null;
    onKg: (kg: number | null) => void;
    onError?: (message: string) => void;
    /** Milisegundos entre re-pedidos ENQ (default 800). */
    pollMs?: number;
  }
): Promise<WatchHandle> {
  const pollMs = Math.max(300, opts.pollMs ?? 800);
  const remembered = loadRememberedParams(opts.vendorId);
  const baud = remembered?.baudRate ?? loadRememberedBaud(opts.vendorId) ?? 9600;
  const parity = remembered?.parity ?? "none";
  const dataBits = remembered?.dataBits ?? 8;
  const stopBits = remembered?.stopBits ?? 1;
  let stopped = false;

  try {
    await port.open({ baudRate: baud, parity, dataBits, stopBits });
  } catch {
    try {
      await port.close();
      await port.open({ baudRate: baud, parity, dataBits, stopBits });
    } catch {
      throw new ScalePortError();
    }
  }
  try {
    await port.setSignals?.({ dataTerminalReady: true, requestToSend: true });
  } catch {
    /* noop */
  }

  let writer: any = null;
  try {
    writer = port.writable?.getWriter?.() ?? null;
  } catch {
    writer = null;
  }
  const sendEnq = async () => {
    if (!writer) return;
    try {
      await writer.write(new Uint8Array([0x05]));
    } catch {
      /* noop */
    }
  };
  await sendEnq();

  const decoder = new TextDecoder();
  const reader = port.readable.getReader();
  const handle: WatchHandle = { stop: () => { stopped = true; }, baud };

  void (async () => {
    let buf = "";
    let lastEnq = Date.now();
    const MIN_PENDING = 150;
    try {
      for (;;) {
        if (stopped) break;
        if (Date.now() - lastEnq > pollMs) {
          await sendEnq();
          lastEnq = Date.now();
        }
        const res = (await Promise.race([
          reader.read(),
          new Promise<typeof SLEEP>((res) => setTimeout(() => res(SLEEP), MIN_PENDING)),
        ])) as any;
        if (res === SLEEP) continue;
        const { value, done } = res as { value?: Uint8Array; done?: boolean };
        if (done) break;
        if (!value) continue;
        buf += decoder.decode(value, { stream: true });
        // Conservar solo los últimos ~400 bytes para no crecer sin límite.
        if (buf.length > 400) buf = buf.slice(-400);
        const kg = parseScaleKg(buf);
        opts.onKg(kg);
      }
    } catch (e: any) {
      opts.onError?.(e?.message || "No se pudo leer la balanza");
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
      try {
        writer?.releaseLock?.();
      } catch {
        /* noop */
      }
      try {
        await port.close();
      } catch {
        /* noop */
      }
    }
  })();

  return handle;
}

export async function readScaleFromPort(
  port: any,
  opts: {
    vendorId?: string | null;
    onBaud?: (baud: number) => void;
    /** Parámetros fijos (si se pasan, no se barre la matriz). */
    params?: PortParams;
  } = {}
): Promise<ScaleReadResult> {
  // Lista de combos (baud × paridad/bits) a probar. Si hay params fijos o
  // params recordados, se priorizan; si no, se barre toda la matriz.
  const remembered = loadRememberedParams(opts.vendorId) || (loadRememberedBaud(opts.vendorId) ? { baudRate: loadRememberedBaud(opts.vendorId)!, parity: "none" as const, dataBits: 8 as const, stopBits: 1 as const } : null);
  const fixed = opts.params || remembered;
  // Armar la lista de combos a probar.
  const combos: PortParams[] = [];
  if (fixed) combos.push(fixed);
  for (const pc of PARITY_COMBOS) {
    for (const b of BAUDS) {
      const c: PortParams = { baudRate: b, parity: pc.parity, dataBits: pc.dataBits, stopBits: pc.stopBits };
      if (!combos.some((x) => x.baudRate === c.baudRate && x.parity === c.parity && x.dataBits === c.dataBits && x.stopBits === c.stopBits)) {
        combos.push(c);
      }
    }
  }
  // Dedup por paramsKey manteniendo orden.
  const seen = new Set<string>();
  const ordered = combos.filter((c) => {
    const k = paramsKey(c);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  let sawBytes = false;
  let bestRaw = "";
  let bestParams: PortParams | null = null;

  const POLL_COMMANDS = [[0x05], [0x07, 0x07], [0x1b]];

  for (const params of ordered) {
    const baud = params.baudRate;
    try {
      await port.open({ baudRate: baud, parity: params.parity, dataBits: params.dataBits, stopBits: params.stopBits });
    } catch {
      try {
        await port.close();
        await port.open({ baudRate: baud, parity: params.parity, dataBits: params.dataBits, stopBits: params.stopBits });
      } catch {
        continue;
      }
    }
    try {
      await port.setSignals?.({ dataTerminalReady: true, requestToSend: true });
    } catch {
      /* noop */
    }
    await new Promise((r) => setTimeout(r, 30));
    let raw = "";
    let writer: any = null;
    try {
      try {
        writer = port.writable?.getWriter?.();
      } catch {
        writer = null;
      }
      const send = async (bytes: number[]) => {
        if (!writer) return;
        try {
          await writer.write(new Uint8Array(bytes));
        } catch {
          /* noop */
        }
      };
      for (const cmd of POLL_COMMANDS) {
        await send(cmd);
        await new Promise((r) => setTimeout(r, 60));
      }
      await readForMs(
        port,
        ordered[0] === params ? READ_MS_FIRST : READ_MS_SCAN,
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
        bestParams = params;
      }
    }
    const kg = parseScaleKg(raw);
    if (kg != null) {
      saveRememberedBaud(opts.vendorId, baud);
      saveRememberedParams(opts.vendorId, params);
      return { kg, baud, raw: raw.slice(-200) };
    }
    opts.onBaud?.(baud);
  }
  if (sawBytes) throw new ScaleUnparsedError(bestRaw, bestParams?.baudRate ?? 0);
  throw new ScaleNoDataError();
}
