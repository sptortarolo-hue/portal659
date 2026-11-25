/**
 * Lógica pura de dedupe de compras (sin DB, sin Next, sin imports).
 *
 * Se testea directo con Node 24 (strip-types) en scripts/check-purchase-dedupe.mjs.
 * La capa de DB (purchase-dedupe.ts) hace las consultas y delega acá la
 * decisión, para que un falso positivo (compra recurrente del mismo proveedor
 * con los mismos productos y monto) NO bloquee una factura nueva.
 *
 * Reglas:
 *  - exact_file: mismo archivo → señal dura (la decide la capa de DB por hash).
 *  - strong: proveedor + n° de comprobante + monto exacto → ADVERTENCIA.
 *  - possible: proveedor + monto parecido + fecha cercana → ADVERTENCIA, y
 *    se descarta si los números de comprobante difieren o las líneas no cuadran.
 */

export type DuplicateType = "exact_file" | "strong" | "possible";

export type DuplicateInfo = {
  type: DuplicateType;
  /** Texto corto que explica por qué se marcó (para el panel). */
  reason: string;
  purchase_id: string;
  purchased_at: string | null;
  receipt_number: string | null;
  total: number;
};

export type DedupeLine = {
  /** id de catálogo (insumo/producto/variante) o descripción normalizada. */
  key: string;
  qty: number;
  unit: string;
  total?: number;
};

export type DedupeCandidate = {
  id: string;
  purchased_at: string | null;
  receipt_number: string | null;
  total: number;
  lines: DedupeLine[];
};

/** Normalización USADA TAMBIÉN EN SQL: minúsculas, sin punctuación, sin 0s a la izq. */
export function normalizeReceiptNumber(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .replace(/^0+(?=\d)/, "");
}

/** Normalización de claves de línea (ids UUID incluidos: no sacar ceros). */
export function normalizeLineKey(value: unknown): string {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function normalizeUnit(value: unknown): string {
  const s = String(value ?? "").trim().toLowerCase();
  if (!s) return "u";
  if (s === "unidad" || s === "unidades" || s === "u." || s === "un" || s === "u") return "u";
  if (s === "kilogramo" || s === "kilogramos" || s === "kilo" || s === "kilos" || s === "kg") return "kg";
  if (s === "gramo" || s === "gramos" || s === "g") return "g";
  if (s === "litro" || s === "litros" || s === "l") return "l";
  if (s === "mililitro" || s === "mililitros" || s === "ml") return "ml";
  return s;
}

function round(n: number, decimals = 3): number {
  const f = 10 ** decimals;
  return Math.round((Number(n) || 0) * f) / f;
}

/** Identidad estable de una línea: qué se compró, cuánto y en qué unidad. */
export function lineIdentity(line: DedupeLine): string {
  return `${normalizeLineKey(line.key)}|${round(line.qty)}|${normalizeUnit(line.unit)}`;
}

/**
 * ¿Las líneas son compatibles con ser la misma compra?
 * Sin señal (algún lado vacío) ⇒ true: no descarta, pero tampoco afirma.
 */
export function linesCompatible(a: DedupeLine[], b: DedupeLine[]): boolean {
  if (!a.length || !b.length) return true;
  if (a.length !== b.length) return false;
  const sa = a.map(lineIdentity).sort();
  const sb = b.map(lineIdentity).sort();
  return sa.every((v, i) => v === sb[i]);
}

/** Dos comprobantes con número y números distintos son documentos distintos. */
export function receiptNumbersDiffer(a: unknown, b: unknown): boolean {
  const na = normalizeReceiptNumber(a);
  const nb = normalizeReceiptNumber(b);
  return na.length > 0 && nb.length > 0 && na !== nb;
}

export const POSSIBLE_DAYS = 3;
export const POSSIBLE_AMOUNT_PCT = 0.03;

export function amountClose(a: number, b: number, pct = POSSIBLE_AMOUNT_PCT): boolean {
  return Math.abs(a - b) <= Math.max(Math.abs(a), Math.abs(b)) * pct;
}

/** Comparece fechas en TZ UTC; sin alguna fecha no descarta (solo advierte). */
export function withinDays(a: string | null, b: string | null, days = POSSIBLE_DAYS): boolean {
  if (!a || !b) return true;
  const ta = Date.parse(`${String(a).slice(0, 10)}T00:00:00Z`);
  const tb = Date.parse(`${String(b).slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return true;
  return Math.abs(ta - tb) <= days * 86400000;
}

/**
 * Decisión pura del nivel "possible". Devuelve true si el candidato sigue
 * siendo sospechoso y merece una ADVERTENCIA (nunca un bloqueo).
 */
export function isPossibleDuplicate(
  input: { receiptNumber?: string | null; total: number; purchasedAt?: string | null; lines?: DedupeLine[] },
  candidate: DedupeCandidate
): boolean {
  // Un número distinto es la prueba más fuerte de que son facturas distintas.
  if (receiptNumbersDiffer(input.receiptNumber, candidate.receipt_number)) return false;
  if (!amountClose(input.total, candidate.total)) return false;
  if (!withinDays(input.purchasedAt ?? null, candidate.purchased_at)) return false;
  if (input.lines?.length && candidate.lines.length && !linesCompatible(input.lines, candidate.lines)) return false;
  return true;
}

export function possibleReason(inputNumber: unknown, candidate: DedupeCandidate): string {
  const hasNro = normalizeReceiptNumber(inputNumber) && normalizeReceiptNumber(candidate.receipt_number);
  return hasNro
    ? "Mismo proveedor, comprobante y monto similar"
    : "Mismo proveedor, monto y fecha cercanos (sin n° de comprobante)";
}

export const STRONG_REASON = "Mismo proveedor, n° de comprobante y monto";
export const EXACT_FILE_REASON = "Es el mismo archivo que ya se registró";
