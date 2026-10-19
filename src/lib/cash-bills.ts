/**
 * Sugerencias de "¿Con cuánto abonás?" para pedidos en efectivo.
 * Solo billetes argentinos en circulación (sin $50.000). Sugiere los montos más
 * cercanos >= total que se pueden formar con 1 o 2 billetes, limitados a
 * montos "redondos" (múltiplos de $5.000) para no sugerir rarezas como
 * $11.000 (10.000 + 1.000). El monto exacto se muestra aparte como "Exacto".
 */
export const CASH_BILLS = [1000, 2000, 5000, 10000, 20000];

/**
 * Devuelve hasta `max` montos pagables (>= total) formados con 1-2 billetes.
 * Para totales mayores al máximo de 2 billetes ($40.000) hace fallback con
 * hasta 3 billetes. El monto igual al total se omite (lo cubre "Exacto").
 */
export function cashBillSuggestions(total: number, max = 3): number[] {
  const t = Math.max(0, Math.ceil(Number(total) || 0));
  if (t <= 0) return [];
  const sums = new Set<number>();
  const addRound = (s: number) => {
    if (s >= t && s % 5000 === 0) sums.add(s);
  };
  // 1-2 billetes: sueltos (cualquiera) y combinaciones "redondas".
  for (const a of CASH_BILLS) {
    if (a >= t) sums.add(a);
    for (const b of CASH_BILLS) addRound(a + b);
  }
  // Fallback para totales grandes: hasta 3 billetes.
  if (![...sums].some((s) => s > t)) {
    for (const a of CASH_BILLS)
      for (const b of CASH_BILLS)
        for (const c of CASH_BILLS) addRound(a + b + c);
  }
  return [...sums].filter((s) => s !== t).sort((x, y) => x - y).slice(0, max);
}
