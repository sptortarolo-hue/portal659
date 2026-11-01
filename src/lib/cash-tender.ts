/**
 * "¿Con cuánto paga?" — mostrador y cierre de mesa (efectivo).
 *
 * El cajero escribe (o toca un chip) el monto con el que el cliente abona y el
 * panel muestra el vuelto EN VIVO, antes de cobrar: es la pantalla "Change due"
 * de los POS de referencia (Square / Toast), acoplada al flujo de cobro.
 *
 * Es OPCIONAL: si el campo queda vacío la venta sale igual que siempre (no se
 * manda nada y no se guarda nada). Si el monto tipeado NO alcanza el total,
 * tampoco se manda — el widget lo avisa en rojo, pero nunca bloquea el cobro.
 *
 * Client-safe: lo consumen los componentes del panel y el cálculo del ticket
 * offline; nunca habla con la base.
 */

/** Redondeo a 2 decimales (evita 0.30000000000000004). */
export function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * Parse tolerante del monto tipeado: acepta coma o punto decimal ("12,5"),
 * espacios y basura (el input ya filtra, pero el portapapeles puede no).
 * Devuelve 0 si no hay número.
 *
 * La coma y el punto se leen como decimal (paridad con el resto del panel,
 * que usa `Number()`): para montos "redondos" el cajero casi siempre toca el
 * chip Exacto/billete en vez de tipear, así que la ambigüedad AR del punto
 * miles ("1.200") no aparece en la práctica.
 */
export function parseMonto(raw: string | number | null | undefined): number {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : 0;
  const cleaned = String(raw ?? "")
    .trim()
    .replace(/\s/g, "")
    .replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

/** Vuelto a dar (nunca negativo). */
export function cashChange(tender: number, total: number): number {
  const t = Number(tender) || 0;
  const tot = Math.max(0, Number(total) || 0);
  return round2(Math.max(0, t - tot));
}

/** Cuánto falta para llegar al total (0 si alcanza o no hay nada tipeado). */
export function cashShort(tender: number, total: number): number {
  const t = Number(tender) || 0;
  const tot = Math.max(0, Number(total) || 0);
  return round2(Math.max(0, tot - t));
}

export type TenderState = {
  /** Hay algo tipeado en el campo. */
  touched: boolean;
  /** El monto tipeado alcanza el total (listo para guardar/mostrar vuelto). */
  ok: boolean;
  /** Monto parseado (0 si está vacío o no es número). */
  amount: number;
  /** Vuelto a dar (0 si no aplica). */
  change: number;
  /** Lo que falta para cubrir el total (0 si aplica). */
  short: number;
};

/**
 * Estado derivado del campo. Solo con `ok` en true el monto se manda al
 * servidor y se muestra el vuelto (una fracción menor al total no es un pago).
 */
export function tenderState(raw: string | number | null | undefined, total: number): TenderState {
  const amount = parseMonto(raw);
  const touched = typeof raw === "number" ? amount > 0 : String(raw ?? "").trim() !== "";
  const tot = Math.max(0, Number(total) || 0);
  const ok = touched && amount > 0 && amount >= tot - 0.001;
  return {
    touched,
    ok,
    amount: ok ? round2(amount) : amount,
    change: ok ? cashChange(amount, tot) : 0,
    short: !ok && touched ? cashShort(amount, tot) : 0,
  };
}
