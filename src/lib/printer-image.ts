import { existsSync } from "fs";
import path from "path";
import { Readable, Writable } from "stream";

/**
 * Maquinaria de imagen compartida entre la impresora térmica y los
 * comprobantes PNG (WhatsApp / descargas).
 *
 * El texto se dibuja con `pureimage` + la TTF de Roboto-Bold del repo
 * (`assets/fonts/Roboto-Bold.ttf`): NO depende de fuentes instaladas en el
 * sistema, por eso funciona igual en el container Alpine de producción.
 * (Un SVG con <text> no sirve: librsvg —el motor de sharp— no tiene fuentes
 * en Alpine y los glifos salen como cuadrados o directamente no se dibujan.)
 */

export const FONT_PATH = path.join(process.cwd(), "assets", "fonts", "Roboto-Bold.ttf");
export const FONT_NAME = "RobotoBold";
/** Variante normal (misma familia/licencia) para jerarquía en los documentos. */
export const FONT_REGULAR_PATH = path.join(process.cwd(), "assets", "fonts", "Roboto-Regular.ttf");
export const FONT_REGULAR_NAME = "Roboto";
export const LOGO_D = 172;
export const HEADER_PAD = 16;

export type PrinterVendor = {
  id: string;
  store_name: string | null;
  logo_url?: string | null;
  address?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  instagram?: string | null;
  facebook?: string | null;
  printer_ip: string | null;
  printer_port: number | null;
  paper_size: string | null;
  print_mode?: string | null;
  print_token?: string | null;
  print_logo?: boolean | null;
  print_address?: boolean | null;
  print_phone?: boolean | null;
  print_social?: boolean | null;
};

let Sharp: any = null;
export async function loadSharp() {
  if (!Sharp) {
    const mod = await import("sharp");
    Sharp = mod.default || mod;
  }
  return Sharp;
}

let PureImage: any = null;
let regularReady = false;
/** Nombre de la fuente a usar para texto normal (cae a Bold si no hay Regular). */
export function regularFontName(): string {
  return regularReady ? FONT_REGULAR_NAME : FONT_NAME;
}
export async function loadPureImage() {
  if (!PureImage) {
    // Si la TTF no está (assets no copiado al container), fallamos fuerte:
    // mejor un error visible que un comprobante sin texto.
    if (!existsSync(FONT_PATH)) {
      throw new Error(`No se encuentra la fuente ${FONT_PATH} (¿se copió assets/ al container?)`);
    }
    const mod: any = await import("pureimage");
    if (mod.registerFont) {
      mod.registerFont(FONT_PATH, FONT_NAME).loadSync();
      if (existsSync(FONT_REGULAR_PATH)) {
        try {
          mod.registerFont(FONT_REGULAR_PATH, FONT_REGULAR_NAME).loadSync();
          regularReady = true;
        } catch {
          regularReady = false;
        }
      }
    }
    PureImage = mod;
  }
  return PureImage;
}

/** Resuelve la URL del logo (/uploads/...) al archivo en disco. */
export function logoDiskPath(logoUrl: string): string | null {
  const m = logoUrl.match(/\/uploads\/([^?#]+)/);
  if (!m) return null;
  const root = process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads");
  const p = path.join(root, m[1]);
  return existsSync(p) ? p : null;
}

export async function decodePng(PI: any, buf: Buffer) {
  const stream = new Readable({ read() { this.push(buf); this.push(null); } });
  return await PI.decodePNGFromStream(stream);
}

export async function encodePng(PI: any, bitmap: any): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const ws = new Writable({
      write: (c: unknown, _e: unknown, cb: () => void) => {
        chunks.push(Buffer.from(c as Buffer));
        cb();
      },
    });
    PI.encodePNGToStream(bitmap, ws).then(() => resolve(Buffer.concat(chunks))).catch(reject);
  });
}

/** Logo cuadrado recortado en círculo (transparente alrededor). */
export async function makeCircularLogo(logoUrl: string): Promise<Buffer | null> {
  const diskPath = logoDiskPath(logoUrl);
  if (!diskPath) return null;
  try {
    const sharp = await loadSharp();
    const resized = await sharp(diskPath).resize(LOGO_D, LOGO_D, { fit: "cover" }).png().toBuffer();
    const circleSvg =
      `<svg width="${LOGO_D}" height="${LOGO_D}"><circle cx="${LOGO_D / 2}" cy="${LOGO_D / 2}" r="${LOGO_D / 2}" fill="#fff"/></svg>`;
    return await sharp(resized).composite([{ input: Buffer.from(circleSvg), blend: "dest-in" }]).png().toBuffer();
  } catch {
    return null;
  }
}

export function wrapNameLines(ctx: any, text: string, maxWidth: number): string[] {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const candidate = cur ? cur + " " + w : w;
    if (ctx.measureText(candidate).width <= maxWidth || !cur) {
      cur = candidate;
    } else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

/**
 * Compone el bitmap del encabezado:
 *  - 80mm (576px): logo redondo a la izquierda (~30%) + nombre a la derecha.
 *  - 58mm (384px): logo centrado arriba (mismo tamaño) + nombre debajo.
 * Devuelve un PNG blanco/negro listo para printImageBuffer, o null si falla.
 */
export async function renderStoreHeader(
  vendor: PrinterVendor,
  widthPx: number,
  circularPng: Buffer
): Promise<Buffer | null> {
  try {
    const PI = await loadPureImage();
    const sharp = await loadSharp();
    const is58 = widthPx === 384;
    const name = (vendor.store_name || "").trim() || "Mi comercio";
    const logo = await decodePng(PI, circularPng);

    const maxHeight = is58 ? 420 : LOGO_D + HEADER_PAD * 2;
    const canvas = PI.make(widthPx, maxHeight);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, widthPx, maxHeight);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";

    const textArea = is58
      ? widthPx - HEADER_PAD * 2
      : widthPx - (HEADER_PAD + LOGO_D + 20) - HEADER_PAD;

    let size = 48;
    let lines: string[] = [];
    while (size >= 24) {
      ctx.font = `${size}px ${FONT_NAME}`;
      lines = wrapNameLines(ctx, name, textArea);
      if (lines.length >= 1 && lines.length <= 2) break;
      size -= 4;
    }
    if (lines.length > 2) {
      lines = lines.slice(0, 2);
      ctx.font = `${size}px ${FONT_NAME}`;
      let last = lines[1];
      while (last.length > 1 && ctx.measureText(last + "...").width > textArea) {
        last = last.slice(0, -1);
      }
      lines[1] = last + "...";
    }

    const lineHeight = Math.round(size * 1.2);
    const blockH = lines.length * lineHeight;

    let logoX = HEADER_PAD;
    let logoY = Math.round((LOGO_D + HEADER_PAD * 2 - LOGO_D) / 2);
    let textX = HEADER_PAD;
    let baselines: number[];
    let realH = LOGO_D + HEADER_PAD * 2;

    if (is58) {
      logoX = Math.round((widthPx - LOGO_D) / 2);
      logoY = 8;
      const textTop = logoY + LOGO_D + 22;
      baselines = lines.map((_, i) => textTop + (i + 1) * lineHeight);
      realH = textTop + blockH + HEADER_PAD;
    } else {
      logoY = Math.round((realH - LOGO_D) / 2);
      const textTop = Math.round((realH - blockH) / 2);
      baselines = lines.map((_, i) => textTop + (i + 1) * lineHeight);
      textX = HEADER_PAD + LOGO_D + 20;
    }

    ctx.drawImage(logo, logoX, logoY, LOGO_D, LOGO_D);
    ctx.fillStyle = "black";
    ctx.font = `${size}px ${FONT_NAME}`;
    lines.forEach((ln, i) => ctx.fillText(ln, textX, baselines[i]));

    const raw = await encodePng(PI, canvas);
    const thresholded = await sharp(raw)
      .grayscale()
      .normalise()
      .threshold(150)
      .png()
      .toBuffer();

    const meta = await sharp(thresholded).metadata();
    const height = Math.min(maxHeight, meta.height || maxHeight);
    const cropH = Math.min(realH, height);
    return await sharp(thresholded)
      .extract({ left: 0, top: 0, width: widthPx, height: cropH })
      .png()
      .toBuffer();
  } catch {
    return null;
  }
}

/**
 * QR como bitmap (qrcode lib + binarizado): independiente del firmware.
 */
export async function renderQrImage(url: string, sizePx: number): Promise<Buffer | null> {
  try {
    const QRCode = (await import("qrcode")).default;
    const qrBuf: Buffer = await QRCode.toBuffer(url, { width: sizePx, margin: 2 });
    const sharp = await loadSharp();
    return await sharp(qrBuf).grayscale().threshold(150).png().toBuffer();
  } catch {
    return null;
  }
}
