import sharp from "sharp";

/**
 * Envuelve el PNG de la etiqueta en el lenguaje de la impresora de etiquetas.
 *
 * Una sola imagen (`renderLabelPng`: blanco/negro, umbral) alimenta los tres
 * lenguajes, así la elección de "TSPL / ZPL / ESC-POS" es un tema de transporte
 * y no de diseño. El transporte NO se toca: el relay acepta el `backend` y la
 * cola USB por trabajo (`services/print-agent/src/relay.js`).
 *
 * Ancho de impresión: 203 dpi = 8 puntos/mm.
 *   TSPL/ZPL trabajan con "dots" (puntos) → widthDots = px.
 *   ESC/POS usa bytes por fila en el raster GS v 0 → bytesPerRow = ceil(px/8).
 */

const PX_PER_MM = 8;
/** dpi de las impresoras de etiquetas chicas (Elitronic PL-500). */
export const STICKER_DPI = 203;

export type StickerLanguage = "tspl" | "zpl" | "escpos";
export const STICKER_LANGUAGE_CHOICES: StickerLanguage[] = ["tspl", "zpl", "escpos"];

export function stickerLanguageLabel(lang: string | null | undefined): string {
  if (lang === "tspl") return "TSPL";
  if (lang === "zpl") return "ZPL";
  if (lang === "escpos") return "ESC/POS";
  return "Automático";
}

/** PNG b/n → bits MSB-first (1 = punto negro). Devuelve también el ancho en bytes. */
export async function pngToMono(png: Buffer): Promise<{ data: Buffer; widthBytes: number; widthPx: number; heightPx: number }> {
  const { data, info } = await sharp(png)
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const widthPx = info.width;
  const heightPx = info.height;
  const widthBytes = Math.ceil(widthPx / 8);
  const out = Buffer.alloc(widthBytes * heightPx);
  for (let y = 0; y < heightPx; y++) {
    for (let x = 0; x < widthPx; x++) {
      const v = data[y * widthPx + x];
      if (v < 160) {
        out[y * widthBytes + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
  }
  return { data: out, widthBytes, widthPx, heightPx };
}

function mm(v: number): string {
  const n = Math.round(v * 100) / 100;
  return `${n}`;
}

/** TSPL/TSPL2 (Elitronic, Xprinter, Zebra GC/GK, TSC). */
export function buildTsplJob(png: Buffer, opts: { widthMm: number; heightMm: number; copies: number; gapMm?: number }): Promise<Buffer> {
  return pngToMono(png).then(({ data, widthBytes, heightPx }) => {
    const gap = Math.max(1, Math.min(10, Number(opts.gapMm) || 2));
    const header =
      `SIZE ${mm(opts.widthMm)} mm,${mm(opts.heightMm)} mm\r\n` +
      `GAP ${mm(gap)} mm,0 mm\r\n` +
      `DIRECTION 0\r\n` +
      `REFERENCE 0,0\r\n` +
      `CLS\r\n` +
      `BITMAP 0,0,${widthBytes},${heightPx},0,`;
    const footer = `\r\nPRINT 1,${Math.max(1, Math.floor(opts.copies))}\r\n`;
    return Buffer.concat([Buffer.from(header, "ascii"), data, Buffer.from(footer, "ascii")]);
  });
}

/** ZPL II (Zebra y compatibles). */
export function buildZplJob(png: Buffer, opts: { widthMm: number; heightMm: number; copies: number }): Promise<Buffer> {
  return pngToMono(png).then(({ data, widthBytes, widthPx, heightPx }) => {
    const widthDots = Math.round(opts.widthMm * PX_PER_MM);
    const heightDots = Math.round(opts.heightMm * PX_PER_MM);
    const totalBytes = data.length;
    const hex = data.toString("hex").toUpperCase();
    const text =
      `^XA\r\n` +
      `^PW${widthDots}\r\n` +
      `^LL${heightDots}\r\n` +
      `^FO0,0^GFA,${totalBytes},${totalBytes},${widthBytes},${hex}^FS\r\n` +
      `^PQ${Math.max(1, Math.floor(opts.copies))},0,1,Y\r\n` +
      `^XZ\r\n`;
    void widthPx;
    return Buffer.from(text, "ascii");
  });
}

/** ESC/POS (GS v 0 raster). Sin corte: la etiqueta la avanza el sensor. */
export function buildEscPosJob(png: Buffer, opts: { copies: number }): Promise<Buffer> {
  return pngToMono(png).then(({ data, widthBytes, heightPx }) => {
    const copies = Math.max(1, Math.floor(opts.copies));
    const chunks: Buffer[] = [];
    for (let i = 0; i < copies; i++) {
      chunks.push(Buffer.from([0x1b, 0x40])); // ESC @ (reset)
      chunks.push(Buffer.from([0x1d, 0x76, 0x30, 0x00])); // GS v 0, modo normal
      const size = Buffer.alloc(4);
      size.writeUInt16LE(widthBytes, 0);
      size.writeUInt16LE(heightPx, 2);
      chunks.push(size);
      chunks.push(data);
      chunks.push(Buffer.from([0x0a])); // avance de línea
    }
    return Buffer.concat(chunks);
  });
}

export async function buildStickerBuffer(params: {
  png: Buffer;
  widthMm: number;
  heightMm: number;
  copies: number;
  language: StickerLanguage;
  gapMm?: number;
}): Promise<{ ok: true; buffer: Buffer; languageUsed: StickerLanguage } | { ok: false; error: string }> {
  try {
    const { png } = params;
    const copies = Math.min(50, Math.max(1, Math.floor(params.copies) || 1));
    const gapMm = params.gapMm;
    if (params.language === "zpl") {
      return { ok: true, buffer: await buildZplJob(png, { ...params, copies }), languageUsed: "zpl" };
    }
    if (params.language === "escpos") {
      return { ok: true, buffer: await buildEscPosJob(png, { copies }), languageUsed: "escpos" };
    }
    return { ok: true, buffer: await buildTsplJob(png, { widthMm: params.widthMm, heightMm: params.heightMm, copies, gapMm }), languageUsed: "tspl" };
  } catch (e: any) {
    return { ok: false, error: e?.message || "No se pudo armar la etiqueta" };
  }
}

/** Logo pequeño para encabezados futuros: no se usa todavía. */
export async function stickerPngBase64(png: Buffer): Promise<string> {
  return png.toString("base64");
}
