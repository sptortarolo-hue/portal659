"use client";

/**
 * Ticket de contingencia offline (Track Impresión F1).
 *
 * Builder ESC/POS en JS puro, cero dependencias, para imprimir sin servidor
 * (vía listener local en agente PC / app Android). Layout SOLO-TEXTO:
 * - Sin logo (el raster necesita sharp, solo disponible en el servidor).
 * - Sin QR fiscal (ARCA exige internet).
 * - Encabezado PROVISORIO + número provisorio P-N (nunca definitivo).
 *
 * Cuando vuelve la conexión, el documento real (con Nro. definitivo) sale
 * por el camino servidor normal; lo impreso offline NO se reimprime.
 */

export type ContingencyKind = "COMANDA" | "TICKET" | "RETIRO" | "PRECUENTA" | "DESPACHO";

export type ContingencyItem = {
  qty: number;
  name: string;
  /** Modificadores ya como labels (ej. ["sin cebolla"]) o string unido. */
  modifiers?: string[] | string | null;
};

export type ContingencyDoc = {
  storeName: string;
  kind: ContingencyKind;
  /** Número provisorio del día (P-N). Null = sin número. */
  provisional?: number | null;
  tableName?: string | null;
  customerName?: string | null;
  items: ContingencyItem[];
  total: number;
  paymentLabel?: string | null;
  /** Info de efectivo para precuenta/ticket: % y total a abonar. */
  cashPct?: number | null;
  cashTotal?: number | null;
  createdAt?: number;
  /** 48 = 80mm, 32 = 58mm. */
  width?: 48 | 32;
};

const ESC = 0x1b;
const GS = 0x1d;

/** latin1: ñ/tildes van directo (códigos < 256); lo demás se degrada. */
const REPLACEMENTS: Record<string, string> = {
  "—": "-", "–": "-", "“": '"', "”": '"', "‘": "'", "’": "'",
  "…": "...", "•": "-", "°": "o", "·": "-", "✓": "v", "⚠": "!",
  "📡": "", "🖨": "", "🧾": "", "💵": "", "🏦": "", "💳": "",
};

function sanitizeLine(s: string): string {
  let out = "";
  for (const ch of String(s ?? "")) {
    if (ch === "\n" || ch === "\r" || ch === "\t") {
      out += " ";
      continue;
    }
    const code = ch.codePointAt(0) ?? 63;
    if (code < 32) continue;
    if (code < 256) {
      out += ch;
      continue;
    }
    out += REPLACEMENTS[ch] ?? "?";
  }
  return out;
}

function money(n: number): string {
  const v = Number(n) || 0;
  return `$${v.toLocaleString("es-AR", { maximumFractionDigits: 2 })}`;
}

function wrap(text: string, width: number): string[] {
  const words = sanitizeLine(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > width) {
      if (cur) lines.push(cur);
      cur = w.length > width ? w.slice(0, width) : w;
    } else {
      cur = (cur + " " + w).trim();
    }
  }
  if (cur) lines.push(cur);
  return lines.length > 0 ? lines : [""];
}

class EscPos {
  private bytes: number[] = [];

  raw(...b: number[]): this {
    this.bytes.push(...b);
    return this;
  }
  init(): this {
    return this.raw(ESC, 0x40);
  }
  align(n: 0 | 1 | 2): this {
    return this.raw(ESC, 0x61, n);
  }
  bold(on: boolean): this {
    return this.raw(ESC, 0x45, on ? 1 : 0);
  }
  doubleSize(on: boolean): this {
    return this.raw(GS, 0x21, on ? 0x11 : 0x00);
  }
  text(s: string): this {
    const clean = sanitizeLine(s);
    for (let i = 0; i < clean.length; i++) {
      this.bytes.push(clean.charCodeAt(i) & 0xff);
    }
    return this.raw(0x0a);
  }
  rule(width: number): this {
    return this.text("-".repeat(width));
  }
  feedAndCut(): this {
    // feed 3 líneas + corte parcial (igual que el agente PC).
    return this.raw(ESC, 0x64, 0x03, GS, 0x56, 0x42, 0x00);
  }
  build(): Uint8Array {
    return new Uint8Array(this.bytes);
  }
}

function fmtTime(ts: number): string {
  try {
    return new Date(ts).toLocaleString("es-AR", {
      timeZone: "America/Argentina/Buenos_Aires",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return new Date(ts).toLocaleString();
  }
}

/** Renderiza el documento de contingencia a bytes ESC/POS listos para TCP. */
export function buildContingencyBytes(doc: ContingencyDoc): Uint8Array {
  const width = doc.width === 32 ? 32 : 48;
  const p = new EscPos().init();

  p.align(1).bold(true);
  for (const line of wrap(doc.storeName || "Mi comercio", width)) p.text(line);
  p.text(doc.kind);
  p.bold(false);
  p.text("PROVISORIO - SIN VALIDEZ FISCAL");
  p.align(0).rule(width);

  const meta: string[] = [];
  if (doc.provisional != null) meta.push(`P-${doc.provisional}`);
  meta.push(fmtTime(doc.createdAt ?? Date.now()));
  p.text(meta.join(" - "));
  if (doc.tableName) p.text(`Mesa: ${doc.tableName}`);
  if (doc.customerName) p.text(`Cliente: ${doc.customerName}`);
  p.rule(width);

  for (const item of doc.items || []) {
    const qty = Number(item.qty) || 1;
    for (const line of wrap(`${qty}x ${item.name}`, width)) p.text(line);
    const mods = Array.isArray(item.modifiers)
      ? item.modifiers.filter(Boolean).join(", ")
      : item.modifiers || "";
    if (mods) {
      for (const line of wrap(`(${mods})`, width - 3)) p.text(`   ${line}`);
    }
  }
  p.rule(width);

  p.bold(true).doubleSize(width > 32);
  p.text(`TOTAL: ${money(doc.total)}`);
  p.doubleSize(false).bold(false);
  if (doc.paymentLabel) p.text(`Pago: ${doc.paymentLabel}`);
  if ((doc.cashPct ?? 0) > 0 && (doc.cashTotal ?? 0) > 0) {
    p.text(`Efectivo (-${doc.cashPct}%): ${money(doc.cashTotal as number)}`);
  }
  p.rule(width);
  p.align(1).text("Portal 659 - ticket offline");
  p.align(0).feedAndCut();

  return p.build();
}

/** Uint8Array → base64 (para el contrato /local-print). */
export function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  try {
    return btoa(s);
  } catch {
    return "";
  }
}
