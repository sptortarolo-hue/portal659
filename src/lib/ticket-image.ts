import {
  FONT_NAME,
  decodePng,
  encodePng,
  loadPureImage,
  loadSharp,
  makeCircularLogo,
  renderQrImage,
  renderStoreHeader,
  type PrinterVendor,
} from "@/lib/printer-image";

/**
 * Comprobante PNG (WhatsApp / descarga) con el MISMO contenido y orden que el
 * ticket térmico: encabezado (logo redondo + nombre + datos), ítems, total,
 * seña, vuelto y bloque fiscal con QR.
 *
 * Se dibuja con `pureimage` + la Roboto-Bold del repo (igual que el
 * encabezado de la impresora). NO se usa SVG: librsvg —el motor de sharp—
 * no tiene fuentes en el container Alpine de producción y los <text>
 * salían como cuadrados o directamente no se dibujaban.
 */

export interface TicketImageInput {
  storeName: string;
  logoUrl?: string | null;
  address?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  instagram?: string | null;
  facebook?: string | null;
  printLogo?: boolean | null;
  printAddress?: boolean | null;
  printPhone?: boolean | null;
  printSocial?: boolean | null;
  customerName?: string | null;
  date?: string | null;
  time?: string | null;
  items: { name: string; qty?: number; price?: number; modifiers?: string[] }[];
  total: number;
  depositPaid?: number;
  amountPaid?: number;
  cashAmount?: number | null;
  paymentMethod?: string | null;
  paymentLabel?: string | null;
  vuelto?: number;
  cashDiscount?: number;
  // Fiscal
  invoiceNumber?: string | null;
  cae?: string | null;
  caeVto?: string | null;
  isFiscal?: boolean;
  qrData?: string | null; // data para QR fiscal
  docTitle?: string | null;
  footer?: string;
  bookingRef?: string | null;
  staffName?: string | null;
}

// Ancho del ticket 80mm a 203dpi (576 dots) × 2 para que se lea nítido en el
// celular. Las proporciones son las del ticket impreso.
const LOGICAL_WIDTH = 576;
const SCALE = 2;
const WIDTH = LOGICAL_WIDTH * SCALE;
const PAD = 14 * SCALE;
const MAX_W = WIDTH - PAD * 2;

const FONT_BODY = 26;
const FONT_TITLE = 34;
const FONT_TOTAL = 36;
const FONT_SMALL = 22;

type Align = "left" | "right" | "center";
type Seg = { text: string; size: number; align: Align; color?: string };
type Row = { h: number; segs: Seg[]; image?: Buffer; imageW?: number; imageH?: number };

const AR_TZ = "America/Argentina/Buenos_Aires";

function segH(size: number): number {
  return Math.round(size * 1.35);
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

function wrapWords(ctx: any, text: string, maxWidth: number, size: number): string[] {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  ctx.font = `${size}px ${FONT_NAME}`;
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

function money(n: number): string {
  return `$${Number(n || 0).toLocaleString("es-AR")}`;
}

const PAYMENT_LABELS: Record<string, string> = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  whatsapp: "Coordinado",
  tarjeta: "Tarjeta",
  credito: "Tarjeta/Online",
  fiado: "Fiado",
};

export async function renderReceiptImage(input: TicketImageInput): Promise<Buffer | null> {
  try {
    const PI = await loadPureImage();
    const sharp = await loadSharp();

    // Canvas auxiliar: sólo para medir el texto antes de crear el final.
    const probe = PI.make(8, 8);
    const pctx = probe.getContext("2d");
    pctx.textBaseline = "alphabetic";

    const rows: Row[] = [];
    const pushText = (
      text: string,
      opts: { size?: number; align?: Align; color?: string } = {}
    ) => {
      const size = opts.size || FONT_BODY;
      rows.push({
        h: segH(size),
        segs: [{ text, size, align: opts.align || "left", color: opts.color }],
      });
    };
    const pushSeparator = () => {
      pctx.font = `${FONT_SMALL}px ${FONT_NAME}`;
      const dashW = pctx.measureText("-").width || 8;
      const n = Math.max(10, Math.floor(MAX_W / dashW));
      rows.push({
        h: segH(FONT_SMALL),
        segs: [{ text: "-".repeat(n), size: FONT_SMALL, align: "center" }],
      });
    };

    // --- Encabezado: mismo bitmap que se imprime (logo redondo + nombre) ---
    const vendor: PrinterVendor = {
      id: "receipt",
      store_name: input.storeName || "Comercio",
      logo_url: input.logoUrl || null,
      address: input.address || null,
      phone: input.phone || null,
      whatsapp: input.whatsapp || null,
      instagram: input.instagram || null,
      facebook: input.facebook || null,
      printer_ip: null,
      printer_port: null,
      paper_size: "80mm",
    };

    let headerPng: Buffer | null = null;
    if (input.printLogo !== false && input.logoUrl) {
      const circular = await makeCircularLogo(input.logoUrl);
      if (circular) {
        const raw = await renderStoreHeader(vendor, LOGICAL_WIDTH, circular);
        if (raw) {
          // Se escala ×2 con "nearest": al ser 1-bit mantiene los bordes duros.
          const scaled = await sharp(raw)
            .resize(WIDTH, undefined, { kernel: "nearest" })
            .png()
            .toBuffer();
          const meta = await sharp(scaled).metadata();
          headerPng = scaled;
          rows.push({ h: meta.height || 0, segs: [], image: scaled, imageW: WIDTH, imageH: meta.height || 0 });
          rows.push({ h: 6, segs: [] });
        }
      }
    }
    if (!headerPng) {
      // Sin logo (o falló): nombre + datos, como composeStoreHeader.
      pushText(input.storeName || "Comercio", { size: FONT_TITLE, align: "center" });
    }

    // Datos del local (respetando los toggles de impresión).
    const address = input.printAddress !== false ? (input.address || "").trim() : "";
    if (address) {
      for (const ln of wrapWords(pctx, address, MAX_W, FONT_SMALL)) {
        pushText(ln, { size: FONT_SMALL, align: "center" });
      }
    }
    const phone = input.printPhone !== false ? (input.phone || "").trim() : "";
    const whatsapp = input.printPhone !== false ? (input.whatsapp || "").trim() : "";
    if (phone || whatsapp) {
      const tel = phone ? `Tel: ${phone}` : "";
      const wa = whatsapp ? `WA: ${whatsapp}` : "";
      const combined = [tel, wa].filter(Boolean).join(" · ");
      if (combined.length <= 48) {
        pushText(combined, { size: FONT_SMALL, align: "center" });
      } else {
        if (tel) pushText(tel, { size: FONT_SMALL, align: "center" });
        if (wa) pushText(wa, { size: FONT_SMALL, align: "center" });
      }
    }
    const ig =
      input.printSocial !== false && input.instagram
        ? `IG: @${shortSocialHandle(input.instagram, "instagram")}`
        : "";
    const fb =
      input.printSocial !== false && input.facebook
        ? `FB: ${shortSocialHandle(input.facebook, "facebook")}`
        : "";
    if (ig || fb) {
      const combined = [ig, fb].filter(Boolean).join(" · ");
      if (combined.length <= 48) {
        pushText(combined, { size: FONT_SMALL, align: "center" });
      } else {
        if (ig) pushText(ig, { size: FONT_SMALL, align: "center" });
        if (fb) pushText(fb, { size: FONT_SMALL, align: "center" });
      }
    }

    pushSeparator();

    // --- Título + identificación (espejo de composeReceipt) ---
    pushText(input.docTitle || (input.isFiscal ? "FACTURA C" : "TICKET"), {
      size: FONT_TITLE,
      align: "center",
    });
    if (input.bookingRef) {
      pushText(`Turno #${input.bookingRef}`, { size: FONT_BODY, align: "left" });
    }
    if (input.customerName) {
      pushText(`Cliente: ${input.customerName}`, { size: FONT_BODY, align: "left" });
    }
    if (input.staffName) {
      pushText(`Profesional: ${input.staffName}`, { size: FONT_BODY, align: "left" });
    }
    if (input.date) {
      pushText(`${input.date}${input.time ? " " + input.time : ""}`, {
        size: FONT_BODY,
        align: "left",
      });
    }

    pushSeparator();

    // --- Partidas (precio SIEMPRE visible; el nombre se envuelve) ---
    for (const item of input.items || []) {
      const qty = Number(item.qty || 1);
      const name = String(item.name || "").trim();
      const unitPrice = Number(item.price || 0);
      const total = unitPrice * qty;
      const qtyStr = `${qty % 1 === 0 ? qty : qty.toLocaleString("es-AR")}x`;
      const left = `${qtyStr} ${name}`;
      const right = money(total);

      pctx.font = `${FONT_BODY}px ${FONT_NAME}`;
      const leftW = pctx.measureText(left).width;
      const rightW = pctx.measureText(right).width;

      if (leftW + rightW + 24 <= MAX_W) {
        rows.push({
          h: segH(FONT_BODY),
          segs: [
            { text: left, size: FONT_BODY, align: "left" },
            { text: right, size: FONT_BODY, align: "right" },
          ],
        });
      } else {
        for (const ln of wrapWords(pctx, left, MAX_W, FONT_BODY)) {
          rows.push({ h: segH(FONT_BODY), segs: [{ text: ln, size: FONT_BODY, align: "left" }] });
        }
        rows.push({
          h: segH(FONT_BODY),
          segs: [{ text: right, size: FONT_BODY, align: "right" }],
        });
      }

      if (item.modifiers && item.modifiers.length) {
        const mods = `(${item.modifiers.join(", ")})`;
        for (const ln of wrapWords(pctx, mods, MAX_W - 12, FONT_SMALL)) {
          rows.push({
            h: segH(FONT_SMALL),
            segs: [{ text: `  ${ln}`, size: FONT_SMALL, align: "left" }],
          });
        }
      }
    }

    pushSeparator();

    // --- Totales ---
    if (input.cashDiscount && input.cashDiscount > 0) {
      pushText(`Desc. efectivo: -${money(input.cashDiscount)}`, { size: FONT_BODY, align: "right" });
    }
    rows.push({
      h: segH(FONT_TOTAL),
      segs: [{ text: `TOTAL: ${money(input.total)}`, size: FONT_TOTAL, align: "right" }],
    });

    // --- Pago / seña / vuelto ---
    const payLabel =
      input.paymentLabel ||
      PAYMENT_LABELS[String(input.paymentMethod || "").toLowerCase()] ||
      (input.paymentMethod ? String(input.paymentMethod) : "");
    if (payLabel) {
      pushText(`Pago: ${payLabel} — PAGADO`, { size: FONT_BODY, align: "left" });
    }
    if (input.depositPaid && input.depositPaid > 0) {
      pushText(`Seña pagada: ${money(input.depositPaid)}`, { size: FONT_BODY, align: "left" });
    }
    if (input.amountPaid != null && input.amountPaid > 0 && Number(input.amountPaid) !== Number(input.total)) {
      pushText(`Cobrado: ${money(input.amountPaid)}`, { size: FONT_BODY, align: "left" });
    }
    if (input.cashAmount != null && Number(input.cashAmount) > 0) {
      pushText(`Abona con: ${money(input.cashAmount)}`, { size: FONT_BODY, align: "left" });
    }
    if (input.vuelto != null && input.vuelto > 0) {
      pushText(`Vuelto: ${money(input.vuelto)}`, { size: FONT_BODY, align: "left" });
    }

    // --- Fiscal (Factura C) ---
    let qrPng: Buffer | null = null;
    if (input.isFiscal) {
      pushSeparator();
      if (input.invoiceNumber) {
        pushText(`FACTURA C N° ${input.invoiceNumber}`, { size: FONT_BODY, align: "left" });
      }
      if (input.cae) {
        pushText(`CAE: ${input.cae}`, { size: FONT_SMALL, align: "left" });
      }
      if (input.caeVto) {
        pushText(`Vto CAE: ${input.caeVto}`, { size: FONT_SMALL, align: "left" });
      }
      if (input.qrData) {
        qrPng = await renderQrImage(input.qrData, 300);
        if (qrPng) {
          // El QR va dentro del bloque fiscal (igual que en el ticket impreso).
          rows.push({ h: 312, segs: [], image: qrPng, imageW: 300, imageH: 300 });
        }
      }
    }

    // --- Pie ---
    pushSeparator();
    if (input.footer) {
      pushText(input.footer, { size: FONT_SMALL, align: "center" });
    }
    const now = new Date();
    const emitted = `${now.toLocaleDateString("es-AR", { timeZone: AR_TZ })} ${now.toLocaleTimeString("es-AR", {
      timeZone: AR_TZ,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      hourCycle: "h23",
    })}`;
    pushText(`Emitido: ${emitted}`, { size: FONT_SMALL, align: "center", color: "#555555" });

    // --- Canvas final ---
    const headerH = rows.reduce((acc, r) => acc + r.h, 0);
    const totalH = Math.max(200, headerH + 24);
    const canvas = PI.make(WIDTH, totalH);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, WIDTH, totalH);
    ctx.textBaseline = "alphabetic";

    let y = 8;
    for (const row of rows) {
      if (row.image) {
        const bitmap = await decodePng(PI, row.image);
        const iw = row.imageW || WIDTH;
        const ih = row.imageH || row.h;
        ctx.drawImage(bitmap, Math.round((WIDTH - iw) / 2), y, iw, ih);
        y += row.h;
        continue;
      }
      for (const seg of row.segs) {
        ctx.font = `${seg.size}px ${FONT_NAME}`;
        ctx.fillStyle = seg.color || "black";
        const w = ctx.measureText(seg.text).width;
        let x = PAD;
        if (seg.align === "right") x = WIDTH - PAD - w;
        else if (seg.align === "center") x = Math.round((WIDTH - w) / 2);
        ctx.fillText(seg.text, x, y + seg.size);
      }
      y += row.h;
    }

    if (qrPng) {
      const qrBitmap = await decodePng(PI, qrPng);
      const qrX = Math.round((WIDTH - 300) / 2);
      ctx.drawImage(qrBitmap, qrX, y + 6, 300, 300);
    }

    const raw = await encodePng(PI, canvas);
    return await sharp(raw).png().toBuffer();
  } catch (e) {
    console.error("[ticket-image] render failed", e);
    return null;
  }
}
