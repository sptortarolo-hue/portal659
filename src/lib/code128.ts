/**
 * Encoder CODE128 (sets B/C) puro, sin dependencias.
 *
 * Existe para imprimir el código de barras como BITMAP: el comando de
 * hardware (GS k vía printer.code128) delega el dibujo al firmware de la
 * impresora y las térmicas baratas (POS-58) suelen no implementar CODE128
 * — salen solo los números. Dibujando los módulos como imagen (GS v 0,
 * el mismo raster de los logos) el código sale en cualquier térmica.
 *
 * Tabla de patrones según ISO/IEC 15417: cada símbolo son 3 barras + 3
 * espacios que suman 11 módulos (el stop, 13). Regla de elección de set:
 * solo dígitos, largo ≥4 y par → C (dos dígitos por símbolo); si no, B
 * (todo el ASCII imprimible). Sin cambios de set a mitad de cadena:
 * a cambio de algunos px, el dato escaneado es siempre exacto.
 */

const PATTERNS: string[] = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213",
  "122312", "132212", "221213", "221312", "231212", "112232", "122132",
  "122231", "113222", "123122", "123221", "223211", "221132", "221231",
  "213212", "223112", "312131", "311222", "321122", "321221", "312212",
  "322112", "322211", "212123", "212321", "232121", "111323", "131123",
  "131321", "112313", "132113", "132311", "211313", "231113", "231311",
  "112133", "112331", "132131", "113123", "113321", "133121", "313121",
  "211331", "231131", "213113", "213311", "213131", "311123", "311321",
  "331121", "312113", "312311", "332111", "314111", "221411", "431111",
  "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114",
  "413111", "241112", "134111", "111242", "121142", "121241", "114212",
  "124112", "124211", "411212", "421112", "421211", "212141", "214121",
  "412121", "111143", "111341", "131141", "114113", "114311", "411113",
  "411311", "113141", "114131", "311141", "411131", "211412", "211214",
  "211232", "233111",
];

const START_B = 104;
const START_C = 105;
const STOP = 106;
/** Stop pattern: símbolo stop + barra final de 2 módulos (13 en total). */
const STOP_WIDTHS = [2, 3, 3, 1, 1, 1, 2];

export type Code128Encoding = {
  set: "B" | "C" | "BC";
  /** Valores de símbolos: start + datos (+ switches) + checksum (sin stop). */
  values: number[];
  /** Anchos bar/espacio alternados (arranca en barra) en módulos,
   * incluyendo start, checksum y stop. */
  widths: number[];
};

/** Reemplaza lo no imprimible (CODE128-B cubre ASCII 32..126). */
function sanitize(text: string): string {
  let out = "";
  for (const ch of String(text ?? "")) {
    const c = ch.charCodeAt(0);
    out += c >= 32 && c <= 126 ? ch : "?";
  }
  return out;
}

/**
 * Codifica `text` a valores CODE128. Null si queda vacío.
 * Checksum = (start + Σ i·valor) mod 103 con i arrancando en 1.
 * Dígitos impares largos (ej. EAN13): primer dígito en B + switch a C
 * (valor 99) — el dato escaneado es idéntico y la barra queda al doble
 * de grosor que codificar todo en B.
 */
export function code128Values(text: string): { set: "B" | "C" | "BC"; values: number[] } | null {
  const clean = sanitize(text).trim();
  if (!clean) return null;
  const digitsOnly = /^\d+$/.test(clean);
  let set: "B" | "C" | "BC" = "B";
  const values: number[] = [];
  if (digitsOnly && clean.length >= 4 && clean.length % 2 === 0) {
    set = "C";
    values.push(START_C);
    for (let i = 0; i < clean.length; i += 2) {
      values.push(Number(clean.slice(i, i + 2)));
    }
  } else if (digitsOnly && clean.length >= 5) {
    set = "BC";
    values.push(START_B, clean.charCodeAt(0) - 32, 99);
    for (let i = 1; i < clean.length; i += 2) {
      values.push(Number(clean.slice(i, i + 2)));
    }
  } else {
    values.push(START_B);
    for (const ch of clean) {
      values.push(ch.charCodeAt(0) - 32);
    }
  }
  let sum = values[0];
  for (let i = 1; i < values.length; i++) {
    sum += i * values[i];
  }
  values.push(sum % 103);
  return { set, values };
}

/** Anchos bar/espacio completos (start + datos + checksum + stop). Null si vacío. */
export function code128BarWidths(text: string): number[] | null {
  const enc = code128Values(text);
  if (!enc) return null;
  const widths: number[] = [];
  for (const v of enc.values) {
    for (const ch of PATTERNS[v]) widths.push(Number(ch));
  }
  widths.push(...STOP_WIDTHS);
  return widths;
}
