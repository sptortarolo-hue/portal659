import { existsSync } from "fs";
import path from "path";
import { Readable, Writable } from "stream";
import type { Order, OrderItem } from "@/types/database";

let ThermalPrinter: any = null;
let PrinterTypes: any = null;

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

export type PrintJobType = "ticket" | "comanda" | "retiro" | "test" | "precuenta";

export type DispatchResult = {
  ok: boolean;
  mode: "server" | "app";
  skipped?: boolean;
  offline?: boolean;
  error?: string;
};

async function loadModule() {
  if (!ThermalPrinter) {
    const mod = await import("node-thermal-printer");
    ThermalPrinter = mod.ThermalPrinter || mod.default?.ThermalPrinter;
    PrinterTypes = mod.PrinterTypes || mod.default?.PrinterTypes;
  }
}

function errorMsg(e: unknown): string {
  return e instanceof Error ? e.message : "Error desconocido";
}

// ---------------------------------------------------------------------------
// Encabezado del ticket: logo circular + nombre del comercio (bitmap) + datos.
// ---------------------------------------------------------------------------

const FONT_PATH = path.join(process.cwd(), "assets", "fonts", "Roboto-Bold.ttf");
const FONT_NAME = "RobotoBold";
const LOGO_D = 172;
const HEADER_PAD = 16;

let Sharp: any = null;
async function loadSharp() {
  if (!Sharp) {
    const mod = await import("sharp");
    Sharp = mod.default || mod;
  }
  return Sharp;
}

let PureImage: any = null;
async function loadPureImage() {
  if (!PureImage) {
    const mod: any = await import("pureimage");
    if (mod.registerFont) {
      mod.registerFont(FONT_PATH, FONT_NAME).loadSync();
    }
    PureImage = mod;
  }
  return PureImage;
}

/** Resuelve la URL del logo (/uploads/...) al archivo en disco. */
function logoDiskPath(logoUrl: string): string | null {
  const m = logoUrl.match(/\/uploads\/([^?#]+)/);
  if (!m) return null;
  const root = process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads");
  const p = path.join(root, m[1]);
  return existsSync(p) ? p : null;
}

async function decodePng(PI: any, buf: Buffer) {
  const stream = new Readable({ read() { this.push(buf); this.push(null); } });
  return await PI.decodePNGFromStream(stream);
}

async function encodePng(PI: any, bitmap: any): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const ws = new Writable({
      write(c: unknown, _e: unknown, cb: () => void) {
        chunks.push(Buffer.from(c as Buffer));
        cb();
      },
    });
    PI.encodePNGToStream(bitmap, ws).then(() => resolve(Buffer.concat(chunks))).catch(reject);
  });
}

/** Logo cuadrado recortado en círculo (transparente alrededor). */
async function makeCircularLogo(logoUrl: string): Promise<Buffer | null> {
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

function wrapNameLines(ctx: any, text: string, maxWidth: number): string[] {
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
 *  - 58mm (384px): logo centrado arriba (mismo tamaÃ±o) + nombre debajo.
 * Devuelve un PNG blanco/negro listo para printImageBuffer, o null si falla.
 */
async function renderStoreHeader(
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
      while (last.length > 1 && ctx.measureText(last + "â€¦").width > textArea) {
        last = last.slice(0, -1);
      }
      lines[1] = last + "â€¦";
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

const headerImageCache = new Map<string, Buffer>();

async function buildHeaderImage(vendor: PrinterVendor, widthPx: number): Promise<Buffer | null> {
  if (!vendor.logo_url) return null;
  const key = `${vendor.id}|${vendor.logo_url}|${vendor.store_name || ""}|${widthPx}`;
  const cached = headerImageCache.get(key);
  if (cached) return cached;
  const circular = await makeCircularLogo(vendor.logo_url);
  if (!circular) return null;
  const png = await renderStoreHeader(vendor, widthPx, circular);
  if (!png) return null;
  if (headerImageCache.size >= 200) headerImageCache.clear();
  headerImageCache.set(key, png);
  return png;
}

function shortSocialHandle(value: string, host: string): string {
  let v = String(value || "").trim();
  v = v.replace(/^https?:\/\//i, "");
  v = v.replace(/^www\./i, "");
  v = v.replace(new RegExp(`^${host}\\.com/`, "i"), "");
  v = v.replace(/^@/, "");
  v = v.replace(/[?#].*$/, "").replace(/\/+$/, "").trim();
  return v;
}

/**
 * Encabezado de todos los documentos: logo+nombre (bitmap si hay logo y estÃ¡
 * activado; si no, nombre en texto) + lÃ­neas de datos on/off por lÃ­nea.
 * El nombre del negocio y el pie de pÃ¡gina siempre se imprimen.
 */
async function composeStoreHeader(printer: any, vendor: PrinterVendor, width: number): Promise<void> {
  const wantLogo = vendor.print_logo !== false && !!vendor.logo_url;
  const widthPx = width >= 48 ? 576 : 384;
  let printedImage = false;
  if (wantLogo) {
    const img = await buildHeaderImage(vendor, widthPx);
    if (img) {
      printer.alignCenter();
      await printer.printImageBuffer(img);
      printer.newLine();
      printedImage = true;
    }
  }
  if (!printedImage) {
    printer.bold(true);
    printer.setTextSize(1, 1);
    printer.println(vendor.store_name || "");
    printer.setTextSize(0, 0);
    printer.bold(false);
  }

  const address = (vendor.address || "").trim();
  if (vendor.print_address !== false && address) {
    printer.println(address.slice(0, width));
  }

  const phone = (vendor.phone || "").trim();
  const whatsapp = (vendor.whatsapp || "").trim();
  if (vendor.print_phone !== false && (phone || whatsapp)) {
    const tel = phone ? `Tel: ${phone}` : null;
    const wa = whatsapp ? `WA: ${whatsapp}` : null;
    const combined = [tel, wa].filter(Boolean).join(" Â· ");
    if (combined.length <= width) {
      printer.println(combined);
    } else {
      if (tel) printer.println(tel.slice(0, width));
      if (wa) printer.println(wa.slice(0, width));
    }
  }

  const ig = vendor.instagram ? `IG: @${shortSocialHandle(vendor.instagram, "instagram")}` : null;
  const fb = vendor.facebook ? `FB: ${shortSocialHandle(vendor.facebook, "facebook")}` : null;
  if (vendor.print_social !== false && (ig || fb)) {
    const combined = [ig, fb].filter(Boolean).join(" Â· ");
    if (combined.length <= width) {
      printer.println(combined);
    } else {
      if (ig) printer.println(ig.slice(0, width));
      if (fb) printer.println(fb.slice(0, width));
    }
  }
}

const AR_TZ = "America/Argentina/Buenos_Aires";

function formatArgDate(d: Date): string {
  return d.toLocaleDateString("es-AR", {
    timeZone: AR_TZ,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatArgTime(d: Date): string {
  return d.toLocaleTimeString("es-AR", {
    timeZone: AR_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    hourCycle: "h23",
  });
}

function padRight(str: string, len: number): string {
  if (str.length >= len) return str.slice(0, len);
  return str + " ".repeat(len - str.length);
}

function padLeft(str: string, len: number): string {
  if (str.length >= len) return str.slice(0, len);
  return " ".repeat(len - str.length) + str;
}

function formatItemLine(item: OrderItem, width: number): string[] {
  const lines: string[] = [];
  const qtyStr = `${item.qty}x`;
  const nameStr = item.name;
  const priceStr = `$${(item.price * item.qty).toLocaleString("es-AR")}`;

  const availableForName = width - qtyStr.length - 1 - priceStr.length;
  if (nameStr.length <= availableForName) {
    lines.push(`${qtyStr} ${padRight(nameStr, availableForName)}${priceStr}`);
  } else {
    lines.push(`${qtyStr} ${nameStr.slice(0, availableForName)}`);
    if (nameStr.length > availableForName) {
      lines.push(`  ${nameStr.slice(availableForName)}`);
    }
  }

  if (item.modifiers && item.modifiers.length > 0) {
    lines.push(`   (${item.modifiers.join(", ")})`);
  }

  return lines;
}

async function createPrinter(vendor: PrinterVendor): Promise<{ ok: true; printer: any } | { ok: false; error: string }> {
  await loadModule();
  if (!ThermalPrinter || !PrinterTypes) {
    return { ok: false, error: "MÃ³dulo de impresiÃ³n no disponible" };
  }
  const width = vendor.paper_size === "58mm" ? 32 : 48;
  const interfaceStr = vendor.printer_ip
    ? `tcp://${vendor.printer_ip}:${vendor.printer_port || 9100}`
    : "tcp://0.0.0.0:9100";
  try {
    const printer = new ThermalPrinter({
      type: PrinterTypes.EPSON,
      interface: interfaceStr,
      width,
      options: { timeout: 5000 },
    });
    try {
      // CP850: tildes y ñ para el texto de los tickets.
      printer.setCharacterSet("PC850_MULTILINGUAL");
    } catch {
      // ignorar: sin character set el texto ASCII sigue funcionando
    }
    return { ok: true, printer };
  } catch (e) {
    return { ok: false, error: errorMsg(e) };
  }
}

function separatorFor(width: number): string {
  return width >= 48 ? "========================================" : "================================";
}

function composeFooter(printer: any, width: number): void {
  const separator = separatorFor(width);
  printer.alignCenter();
  printer.println(separator);
  printer.println("www.portal659.com.ar");
  printer.println("El centro comercial de tu barrio");
  printer.println("");
  printer.println(separator);
}

async function composeComanda(printer: any, vendor: PrinterVendor, order: Order): Promise<void> {
  const width = vendor.paper_size === "58mm" ? 32 : 48;

  const now = new Date();
  const dateStr = formatArgDate(now);
  const timeStr = formatArgTime(now);

  printer.alignCenter();
  await composeStoreHeader(printer, vendor, width);
  printer.println("COMANDA");
  printer.println(separatorFor(width));

  printer.alignLeft();
  printer.bold(true);
  printer.println(`${dateStr} ${timeStr}`);
  printer.bold(false);
  // NÃºmero universal del pedido del dÃ­a (grande, para cantar a cocina/caja).
  if (order.pickup_number != null) {
    printer.alignCenter();
    printer.setTextSize(2, 2);
    printer.bold(true);
    const m = order.method === "delivery" ? "ENVIO" : "RETIRO";
    printer.println(`${m} Nro. ${order.pickup_number}`);
    printer.bold(false);
    printer.setTextSize(0, 0);
    printer.alignLeft();
  }
  printer.println("----------------------------------------");

  const methodStr = order.method === "delivery" ? "Delivery" : "Retiro en local";
  const paymentStr =
    order.payment_method === "efectivo" ? "Efectivo" :
    order.payment_method === "transferencia" ? "Transferencia" :
    "Coordinar";
  printer.println(`${methodStr}  |  ${paymentStr}`);
  printer.println("----------------------------------------");

  const separator = separatorFor(width);
  printer.println(separator);

  for (const item of order.items) {
    const itemLines = formatItemLine(item, width);
    for (const line of itemLines) {
      printer.println(line);
    }
  }

  printer.println(separator);

  printer.alignRight();
  printer.bold(true);
  printer.setTextSize(1, 1);
  printer.println(`TOTAL: $${Number(order.total).toLocaleString("es-AR")}`);
  printer.setTextSize(0, 0);
  printer.bold(false);

  printer.alignLeft();
  printer.println("");
  printer.println(`Cliente: ${order.customer_name}`);
  printer.println(`Tel: ${order.customer_phone}`);
  if (order.method === "delivery" && order.customer_address) {
    printer.println(`Dir: ${order.customer_address}`);
  }

  if (order.notes) {
    printer.println("");
    printer.bold(true);
    printer.println("NOTAS:");
    printer.bold(false);
    printer.println(order.notes);
  }

  printer.println("");
  composeFooter(printer, width);
  printer.cut();
}

async function composeReceipt(
  printer: any,
  vendor: PrinterVendor,
  order: Order,
  extra?: { tableName?: string; subLabel?: string }
): Promise<void> {
  const width = vendor.paper_size === "58mm" ? 32 : 48;
  const separator = separatorFor(width);

  const now = new Date();
  const dateStr = formatArgDate(now);
  const timeStr = formatArgTime(now);

  printer.alignCenter();
  await composeStoreHeader(printer, vendor, width);
  printer.println("TICKET");
  if (extra?.tableName) printer.println(`Mesa: ${extra.tableName}`);
  if (extra?.subLabel) printer.println(extra.subLabel);
  printer.println(separator);

  printer.alignLeft();
  printer.bold(true);
  printer.println(`Pedido #${order.id.slice(0, 8)}`);
  printer.bold(false);
  printer.println(`${dateStr} ${timeStr}`);
  printer.println(separator);

  for (const item of order.items) {
    const itemLines = formatItemLine(item, width);
    for (const line of itemLines) {
      printer.println(line);
    }
  }

  printer.println(separator);

  printer.alignRight();
  printer.bold(true);
  printer.setTextSize(1, 1);
  printer.println(`TOTAL: $${Number(order.total).toLocaleString("es-AR")}`);
  printer.setTextSize(0, 0);
  printer.bold(false);

  printer.alignLeft();
  const paymentStr =
    order.payment_method === "efectivo" ? "Efectivo" :
    order.payment_method === "transferencia" ? "Transferencia" :
    order.payment_method === "whatsapp" ? "Coordinado" :
    "Tarjeta/Online";
  const paidStr = order.paid_at ? "PAGADO" : "PENDIENTE";
  printer.println("");
  printer.bold(!!order.paid_at);
  printer.println(`Pago: ${paymentStr} â€” ${paidStr}`);
  printer.bold(false);

  if (order.customer_name && order.channel !== "app") {
    printer.println(`Cliente: ${order.customer_name}`);
  }

  printer.println("");
  composeFooter(printer, width);
  printer.cut();
}

async function composeRetiroReceipt(printer: any, vendor: PrinterVendor, order: Order): Promise<void> {
  const width = vendor.paper_size === "58mm" ? 32 : 48;
  const separator = separatorFor(width);

  printer.alignCenter();
  await composeStoreHeader(printer, vendor, width);
  printer.println("RETIRO");
  printer.bold(true);
  printer.setTextSize(2, 2);
  printer.println(`Nro. ${order.pickup_number ?? "--"}`);
  printer.setTextSize(0, 0);
  printer.bold(false);
  printer.println(separator);

  printer.println("Retira tu pedido en el mostrador");
  printer.println("con tu numero.");
  printer.println(separator);
  printer.println("www.portal659.com.ar");
  printer.println("El centro comercial de tu barrio");
  printer.println(separator);

  printer.cut();
}

async function composePrecuenta(
  printer: any,
  vendor: PrinterVendor,
  tableName: string,
  items: { name: string; price: number; qty: number; modifiers?: string[] }[],
  total: number
): Promise<void> {
  const width = vendor.paper_size === "58mm" ? 32 : 48;
  const separator = separatorFor(width);

  const now = new Date();
  const dateStr = formatArgDate(now);
  const timeStr = formatArgTime(now);

  printer.alignCenter();
  await composeStoreHeader(printer, vendor, width);
  printer.println("PRECUENTA");
  printer.println("(no es comprobante de pago)");
  printer.println(separator);

  printer.alignLeft();
  printer.bold(true);
  printer.println(`Mesa: ${tableName}`);
  printer.bold(false);
  printer.println(`${dateStr} ${timeStr}`);
  printer.println(separator);

  for (const item of items) {
    const itemLines = formatItemLine(item, width);
    for (const line of itemLines) {
      printer.println(line);
    }
  }

  printer.println(separator);

  printer.alignRight();
  printer.bold(true);
  printer.setTextSize(1, 1);
  printer.println(`TOTAL: $${Number(total).toLocaleString("es-AR")}`);
  printer.setTextSize(0, 0);
  printer.bold(false);

  printer.alignLeft();
  printer.println("");
  printer.println("Gracias! Confirma el pago");
  printer.println("en caja para cerrar la cuenta.");
  printer.println("");
  composeFooter(printer, width);
  printer.cut();
}

async function composeTest(printer: any, vendor: PrinterVendor): Promise<void> {
  const width = vendor.paper_size === "58mm" ? 32 : 48;

  printer.alignCenter();
  await composeStoreHeader(printer, vendor, width);
  printer.println("");
  printer.println("PRUEBA DE IMPRESION");
  printer.println(separatorFor(width));
  printer.alignLeft();
  printer.println("");
  printer.println("Si puedes leer esto,");
  printer.println("la impresora esta funcionando correctamente.");
  printer.println("");
  printer.println(`Ancho: ${vendor.paper_size || "80mm"}`);
  printer.println("Relay: Portal Print disponible");
  printer.println("");
  composeFooter(printer, width);
  printer.cut();
}

export async function printComanda(
  order: Order,
  vendor: PrinterVendor
): Promise<{ success: boolean; error?: string }> {
  const res = await createPrinter(vendor);
  if (!res.ok) return { success: false, error: res.error };
  if (!vendor.printer_ip) return { success: false, error: "IP de impresora no configurada" };
  try {
    await composeComanda(res.printer, vendor, order);
    await res.printer.execute();
    return { success: true };
  } catch (e) {
    return { success: false, error: errorMsg(e) };
  }
}

export async function printReceipt(
  order: Order,
  vendor: PrinterVendor,
  extra?: { tableName?: string; subLabel?: string }
): Promise<{ success: boolean; error?: string }> {
  const res = await createPrinter(vendor);
  if (!res.ok) return { success: false, error: res.error };
  if (!vendor.printer_ip) return { success: false, error: "IP de impresora no configurada" };
  try {
    await composeReceipt(res.printer, vendor, order, extra);
    await res.printer.execute();
    return { success: true };
  } catch (e) {
    return { success: false, error: errorMsg(e) };
  }
}

export async function printTest(
  vendor: PrinterVendor
): Promise<{ success: boolean; error?: string }> {
  const res = await createPrinter(vendor);
  if (!res.ok) return { success: false, error: res.error };
  if (!vendor.printer_ip) return { success: false, error: "IP de impresora no configurada" };
  try {
    await composeTest(res.printer, vendor);
    await res.printer.execute();
    return { success: true };
  } catch (e) {
    return { success: false, error: errorMsg(e) };
  }
}

type BufferResult = { success: true; buffer: Buffer } | { success: false; error: string };

export async function buildComandaBuffer(
  vendor: PrinterVendor,
  order: Order
): Promise<BufferResult> {
  const res = await createPrinter(vendor);
  if (!res.ok) return { success: false, error: res.error };
  try {
    await composeComanda(res.printer, vendor, order);
    const buffer = (await res.printer.getBuffer()) as Buffer;
    return { success: true, buffer };
  } catch (e) {
    return { success: false, error: errorMsg(e) };
  }
}

export async function buildReceiptBuffer(
  vendor: PrinterVendor,
  order: Order,
  extra?: { tableName?: string; subLabel?: string }
): Promise<BufferResult> {
  const res = await createPrinter(vendor);
  if (!res.ok) return { success: false, error: res.error };
  try {
    await composeReceipt(res.printer, vendor, order, extra);
    const buffer = (await res.printer.getBuffer()) as Buffer;
    return { success: true, buffer };
  } catch (e) {
    return { success: false, error: errorMsg(e) };
  }
}

export async function buildTestBuffer(vendor: PrinterVendor): Promise<BufferResult> {
  const res = await createPrinter(vendor);
  if (!res.ok) return { success: false, error: res.error };
  try {
    await composeTest(res.printer, vendor);
    const buffer = (await res.printer.getBuffer()) as Buffer;
    return { success: true, buffer };
  } catch (e) {
    return { success: false, error: errorMsg(e) };
  }
}

export async function printRetiroReceipt(
  order: Order,
  vendor: PrinterVendor
): Promise<{ success: boolean; error?: string }> {
  const res = await createPrinter(vendor);
  if (!res.ok) return { success: false, error: res.error };
  if (!vendor.printer_ip) return { success: false, error: "IP de impresora no configurada" };
  try {
    await composeRetiroReceipt(res.printer, vendor, order);
    await res.printer.execute();
    return { success: true };
  } catch (e) {
    return { success: false, error: errorMsg(e) };
  }
}

export async function buildRetiroReceiptBuffer(
  vendor: PrinterVendor,
  order: Order
): Promise<BufferResult> {
  const res = await createPrinter(vendor);
  if (!res.ok) return { success: false, error: res.error };
  try {
    await composeRetiroReceipt(res.printer, vendor, order);
    const buffer = (await res.printer.getBuffer()) as Buffer;
    return { success: true, buffer };
  } catch (e) {
    return { success: false, error: errorMsg(e) };
  }
}

export async function printPrecuenta(
  vendor: PrinterVendor,
  tableName: string,
  items: { name: string; price: number; qty: number; modifiers?: string[] }[],
  total: number
): Promise<{ success: boolean; error?: string }> {
  const res = await createPrinter(vendor);
  if (!res.ok) return { success: false, error: res.error };
  if (!vendor.printer_ip) return { success: false, error: "IP de impresora no configurada" };
  try {
    await composePrecuenta(res.printer, vendor, tableName, items, total);
    await res.printer.execute();
    return { success: true };
  } catch (e) {
    return { success: false, error: errorMsg(e) };
  }
}

export async function buildPrecuentaBuffer(
  vendor: PrinterVendor,
  tableName: string,
  items: { name: string; price: number; qty: number; modifiers?: string[] }[],
  total: number
): Promise<BufferResult> {
  const res = await createPrinter(vendor);
  if (!res.ok) return { success: false, error: res.error };
  try {
    await composePrecuenta(res.printer, vendor, tableName, items, total);
    const buffer = (await res.printer.getBuffer()) as Buffer;
    return { success: true, buffer };
  } catch (e) {
    return { success: false, error: errorMsg(e) };
  }
}

type BridgeJob = {
  type: string;
  payload: string;
  printerIp: string | null;
  printerPort: number;
  width: number;
};

function bridgeJob(type: string, buffer: Buffer, vendor: PrinterVendor): BridgeJob {
  return {
    type,
    payload: buffer.toString("base64"),
    printerIp: vendor.printer_ip,
    printerPort: vendor.printer_port || 9100,
    width: vendor.paper_size === "58mm" ? 32 : 48,
  };
}

async function pushToBridge(
  token: string | null | undefined,
  job: BridgeJob
): Promise<{ ok: boolean; offline?: boolean; error?: string }> {
  if (!token) {
    return { ok: false, error: "Falta el token del puente (regeneralo en la secciÃ³n Impresora)" };
  }
  const base = (process.env.PRINT_BRIDGE_URL || "").replace(/\/$/, "");
  const secret = process.env.PRINT_BRIDGE_SECRET || "";
  if (!base) {
    return { ok: false, error: "Puente no configurado (PRINT_BRIDGE_URL)" };
  }
  let res: Response;
  try {
    res = await fetch(`${base}/push`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-bridge-secret": secret },
      body: JSON.stringify({ token, job }),
      signal: AbortSignal.timeout(20000),
    });
  } catch (e) {
    return { ok: false, error: `No se pudo contactar el relay: ${errorMsg(e)}` };
  }
  const data = (await res.json().catch(() => null)) as
    | { ok?: boolean; offline?: boolean; error?: string }
    | null;
  if (!data) {
    return { ok: false, error: `El relay respondiÃ³ ${res.status}` };
  }
  return { ok: data.ok === true, offline: data.offline === true, error: data.error };
}

export async function dispatchPrint(params: {
  vendor: PrinterVendor;
  order?: Order;
  type: PrintJobType;
  extra?: {
    tableName?: string;
    subLabel?: string;
    items?: { name: string; price: number; qty: number; modifiers?: string[] }[];
    total?: number;
  };
}): Promise<DispatchResult> {
  const { vendor } = params;
  const mode: "server" | "app" = vendor.print_mode === "app" ? "app" : "server";

  if (params.type === "test") {
    if (mode === "app") {
      const built = await buildTestBuffer(vendor);
      if (!built.success) return { ok: false, mode, error: built.error };
      const pushed = await pushToBridge(vendor.print_token, bridgeJob("test", built.buffer, vendor));
      return { ok: pushed.ok, mode, offline: pushed.offline, error: pushed.error };
    }
    if (!vendor.printer_ip) return { ok: true, mode, skipped: true };
    const r = await printTest(vendor);
    return { ok: r.success, mode, error: r.error };
  }

  // Precuenta de mesa: detalle de la cuenta antes de cerrar (no es un pedido).
  if (params.type === "precuenta") {
    const tableName = params.extra?.tableName || "Mesa";
    const items = params.extra?.items || [];
    const total = params.extra?.total ?? 0;
    if (mode === "app") {
      const built = await buildPrecuentaBuffer(vendor, tableName, items, total);
      if (!built.success) return { ok: false, mode, error: built.error };
      const pushed = await pushToBridge(vendor.print_token, bridgeJob("precuenta", built.buffer, vendor));
      return { ok: pushed.ok, mode, offline: pushed.offline, error: pushed.error };
    }
    if (!vendor.printer_ip) return { ok: true, mode, skipped: true };
    const r = await printPrecuenta(vendor, tableName, items, total);
    return { ok: r.success, mode, error: r.error };
  }

  if (!params.order) return { ok: false, mode, error: "orderId requerido" };
  const order = params.order;

  if (mode === "app") {
    let built: BufferResult;
    if (params.type === "ticket") built = await buildReceiptBuffer(vendor, order, params.extra);
    else if (params.type === "retiro") built = await buildRetiroReceiptBuffer(vendor, order);
    else built = await buildComandaBuffer(vendor, order);
    if (!built.success) return { ok: false, mode, error: built.error };
    const pushed = await pushToBridge(
      vendor.print_token,
      bridgeJob(params.type, built.buffer, vendor)
    );
    return { ok: pushed.ok, mode, offline: pushed.offline, error: pushed.error };
  }

  if (!vendor.printer_ip) return { ok: true, mode, skipped: true };
  let r: { success: boolean; error?: string };
  if (params.type === "ticket") r = await printReceipt(order, vendor, params.extra);
  else if (params.type === "retiro") r = await printRetiroReceipt(order, vendor);
  else r = await printComanda(order, vendor);
  return { ok: r.success, mode, error: r.error };
}