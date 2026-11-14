import {
  FONT_NAME,
  decodePng,
  encodePng,
  loadPureImage,
  loadSharp,
  makeCircularLogo,
  regularFontName,
  renderQrImage,
} from "@/lib/printer-image";

/**
 * Comprobante del servicio en PNG, "realzado" y apto para compartir por
 * WhatsApp: documento vertical a color, con el detalle del turno, las
 * partidas, los totales y (si hay) la Factura C con su QR.
 *
 * Se dibuja con `pureimage` + las Roboto del repo (igual que el encabezado
 * del ticket térmico). NO se usa SVG: librsvg —el motor de sharp— no tiene
 * fuentes en el container Alpine de producción y los <text> no se dibujaban.
 *
 * Sin emojis (no hay fuente de emoji) y sin branding del portal: el
 * comprobante es del comercio.
 */

export interface ReceiptCardInput {
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

  /** Color de acento (por rubro) y datos para el encabezado. */
  categoryLabel?: string | null;
  neighborhood?: string | null;

  customerName?: string | null;
  serviceName?: string | null;
  staffName?: string | null;
  date?: string | null;
  time?: string | null;
  durationMin?: number | null;
  locationName?: string | null;
  notes?: string | null;
  productsUsed?: string | null;
  equipmentLabel?: string | null;
  diagnosis?: string | null;
  orderNo?: string | null;
  bookingRef?: string | null;

  items: { name: string; qty?: number; price?: number; modifiers?: string[] }[];
  total: number;
  subtotal?: number | null;
  depositPaid?: number;
  amountPaid?: number;
  cashAmount?: number | null;
  paymentMethod?: string | null;
  paymentLabel?: string | null;
  vuelto?: number;
  cashDiscount?: number;

  invoiceNumber?: string | null;
  cae?: string | null;
  caeVto?: string | null;
  isFiscal?: boolean;
  qrData?: string | null;

  /** URL del micrositio (se escribe en el pie; NO es clickeable dentro de la imagen). */
  storeUrl?: string | null;
  footer?: string;
}

const W = 1080;
const PAD = 48;
const HEADER_H = 300;
const MAX_W = W - PAD * 2;

const C_TEXT = "#0f172a";
const C_MUTED = "#64748b";
const C_FAINT = "#94a3b8";
const AR_TZ = "America/Argentina/Buenos_Aires";

/**
 * Identidad del Portal 659: azul base + lima en los detalles.
 * (La lima `#a3e635` no se lee sobre blanco → para el texto se usa la
 * variante fuerte `#4d7c0f`, la misma que usa el panel del portal en claro.)
 */
const PORTAL_BLUE = "#4f46e5";
const PORTAL_LIME = "#a3e635";
const PORTAL_LIME_STRONG = "#4d7c0f";
const PORTAL_LIME_SOFT = "#f7fee7";

type Align = "left" | "right" | "center";
type Seg = { text: string; size: number; font: "b" | "r"; color: string; align: Align };
type Line = { segs: Seg[]; h: number };
type Block =
  | { kind: "lines"; lines: Line[]; gapBefore?: number; bg?: string; accent?: string; padX?: number; padY?: number }
  | { kind: "rule"; gapBefore?: number }
  | { kind: "header" }
  | { kind: "gap"; h: number };

const PAYMENT_LABELS: Record<string, string> = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  whatsapp: "Coordinado",
  tarjeta: "Tarjeta",
  credito: "Tarjeta/Online",
  fiado: "Fiado",
};

function money(n: number): string {
  return `$${Number(n || 0).toLocaleString("es-AR")}`;
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

function fontSpec(font: "b" | "r", size: number): string {
  return `${size}px ${font === "b" ? FONT_NAME : regularFontName()}`;
}

function lineH(size: number): number {
  return Math.round(size * 1.42);
}

export async function renderReceiptCard(input: ReceiptCardInput): Promise<Buffer | null> {
  try {
    const PI = await loadPureImage();
    const sharp = await loadSharp();


    // Canvas auxiliar: sólo para medir y envolver texto.
    const probe = PI.make(8, 8);
    const pctx = probe.getContext("2d");
    pctx.textBaseline = "alphabetic";

    const wrap = (text: string, maxWidth: number, size: number, font: "b" | "r"): string[] => {
      const words = String(text || "").split(/\s+/).filter(Boolean);
      if (!words.length) return [];
      pctx.font = fontSpec(font, size);
      const lines: string[] = [];
      let cur = "";
      for (const w of words) {
        const candidate = cur ? cur + " " + w : w;
        if (pctx.measureText(candidate).width <= maxWidth || !cur) cur = candidate;
        else {
          lines.push(cur);
          cur = w;
        }
      }
      if (cur) lines.push(cur);
      return lines;
    };

    const blocks: Block[] = [];

    // ---------------- Encabezado ----------------
    blocks.push({ kind: "header" });

    // ---------------- Título ----------------
    blocks.push({
      kind: "lines",
      gapBefore: 34,
      lines: [
        {
          h: lineH(40),
          segs: [
            {
              text: input.isFiscal ? "FACTURA C" : "Comprobante de servicio",
              size: 40,
              font: "b",
              color: PORTAL_BLUE,
              align: "left",
            },
          ],
        },
        ...(input.bookingRef
          ? [
              {
                h: lineH(24),
                segs: [
                  {
                    text: `Turno #${input.bookingRef}`,
                    size: 24,
                    font: "r" as const,
                    color: C_MUTED,
                    align: "left" as const,
                  },
                ],
              },
            ]
          : []),
      ],
    });

    // ---------------- Saludo ----------------
    if (input.customerName) {
      blocks.push({
        kind: "lines",
        gapBefore: 18,
        lines: [
          {
            h: lineH(34),
            segs: [
              {
                text: `Gracias, ${input.customerName}`,
                size: 34,
                font: "b",
                color: C_TEXT,
                align: "left",
              },
            ],
          },
        ],
      });
    }

    // ---------------- Detalle del servicio ----------------
    type Detail = { label: string; value: string | null | undefined; long?: boolean };
    const details: Detail[] = [
      { label: "Servicio", value: input.serviceName },
      { label: "Profesional", value: input.staffName },
      { label: "Fecha y hora", value: [input.date, input.time].filter(Boolean).join(" ") },
      { label: "Duración", value: input.durationMin ? `${input.durationMin} min` : null },
      { label: "Sede", value: input.locationName },
      { label: "Equipo", value: input.equipmentLabel },
      { label: "Diagnóstico", value: input.diagnosis, long: true },
      { label: "Orden", value: input.orderNo },
      { label: "Notas", value: input.notes, long: true },
      { label: "Productos usados", value: input.productsUsed, long: true },
    ].filter((d) => !!d.value && String(d.value).trim());

    if (details.length) {
      const detailLines: Line[] = [];
      for (const d of details) {
        const value = String(d.value).trim();
        pctx.font = fontSpec("r", 28);
        const fits = pctx.measureText(value).width <= MAX_W - 260;
        if (fits && !d.long) {
          detailLines.push({
            h: lineH(28),
            segs: [
              { text: d.label, size: 26, font: "r", color: C_MUTED, align: "left" },
              { text: value, size: 28, font: "r", color: C_TEXT, align: "right" },
            ],
          });
        } else {
          detailLines.push({
            h: lineH(24),
            segs: [{ text: d.label, size: 24, font: "r", color: C_MUTED, align: "left" }],
          });
          for (const ln of wrap(value, MAX_W, 26, "r")) {
            detailLines.push({
              h: lineH(26),
              segs: [{ text: ln, size: 26, font: "r", color: C_TEXT, align: "left" }],
            });
          }
        }
      }
      blocks.push({ kind: "lines", gapBefore: 26, lines: detailLines });
    }

    blocks.push({ kind: "rule", gapBefore: 30 });

    // ---------------- Partidas ----------------
    const itemLines: Line[] = [];
    for (const item of input.items || []) {
      const qty = Number(item.qty || 1);
      const name = String(item.name || "").trim();
      const lineTotal = Number(item.price || 0) * qty;
      const qtyStr = `${qty % 1 === 0 ? qty : qty.toLocaleString("es-AR")}x`;
      const left = `${qtyStr} ${name}`;
      const right = money(lineTotal);

      pctx.font = fontSpec("r", 28);
      const leftW = pctx.measureText(left).width;
      pctx.font = fontSpec("b", 28);
      const rightW = pctx.measureText(right).width;

      if (leftW + rightW + 40 <= MAX_W) {
        itemLines.push({
          h: lineH(28),
          segs: [
            { text: left, size: 28, font: "r", color: C_TEXT, align: "left" },
            { text: right, size: 28, font: "b", color: C_TEXT, align: "right" },
          ],
        });
      } else {
        for (const ln of wrap(left, MAX_W, 28, "r")) {
          itemLines.push({
            h: lineH(28),
            segs: [{ text: ln, size: 28, font: "r", color: C_TEXT, align: "left" }],
          });
        }
        itemLines.push({
          h: lineH(28),
          segs: [{ text: right, size: 28, font: "b", color: C_TEXT, align: "right" }],
        });
      }
      if (item.modifiers && item.modifiers.length) {
        for (const ln of wrap(`(${item.modifiers.join(", ")})`, MAX_W - 24, 24, "r")) {
          itemLines.push({
            h: lineH(24),
            segs: [{ text: `  ${ln}`, size: 24, font: "r", color: C_MUTED, align: "left" }],
          });
        }
      }
    }
    if (itemLines.length) {
      blocks.push({ kind: "lines", gapBefore: 22, lines: itemLines });
    }

    // ---------------- Caja de totales ----------------
    const payLabel =
      input.paymentLabel ||
      PAYMENT_LABELS[String(input.paymentMethod || "").toLowerCase()] ||
      (input.paymentMethod ? String(input.paymentMethod) : "");
    const totalLines: Line[] = [];
    const subtotal =
      input.subtotal != null ? Number(input.subtotal) : Number(input.total || 0);
    if (input.cashDiscount && input.cashDiscount > 0) {
      totalLines.push({
        h: lineH(26),
        segs: [
          { text: "Descuento efectivo", size: 26, font: "r", color: C_MUTED, align: "left" },
          { text: `-${money(input.cashDiscount)}`, size: 26, font: "r", color: C_TEXT, align: "right" },
        ],
      });
    }
    totalLines.push({
      h: lineH(26),
      segs: [
        { text: "Subtotal", size: 26, font: "r", color: C_MUTED, align: "left" },
        { text: money(subtotal), size: 26, font: "r", color: C_TEXT, align: "right" },
      ],
    });
    if (input.depositPaid && input.depositPaid > 0) {
      // La seña NO va en la caja de totales: es un pago ya hecho, no un
      // descuento (si se resta ahí se entiende que el total bajó).
      totalLines.push({
        h: lineH(26),
        segs: [
          { text: "Cobrado", size: 26, font: "r", color: C_MUTED, align: "left" },
          { text: money(input.amountPaid ?? input.total), size: 26, font: "r", color: C_TEXT, align: "right" },
        ],
      });
    } else if (input.amountPaid != null && input.amountPaid > 0 && Number(input.amountPaid) !== Number(input.total)) {
      totalLines.push({
        h: lineH(26),
        segs: [
          { text: "Cobrado", size: 26, font: "r", color: C_MUTED, align: "left" },
          { text: money(input.amountPaid), size: 26, font: "r", color: C_TEXT, align: "right" },
        ],
      });
    }
    totalLines.push({
      h: lineH(40),
      segs: [
        { text: "Total", size: 38, font: "b", color: PORTAL_LIME_STRONG, align: "left" },
        { text: money(input.total), size: 38, font: "b", color: PORTAL_LIME_STRONG, align: "right" },
      ],
    });
    if (input.amountPaid != null && input.amountPaid > 0 && Number(input.amountPaid) !== Number(input.total) && !(input.depositPaid && input.depositPaid > 0)) {
      totalLines.push({
        h: lineH(26),
        segs: [
          { text: "Cobrado", size: 26, font: "r", color: C_MUTED, align: "left" },
          { text: money(input.amountPaid), size: 26, font: "r", color: C_TEXT, align: "right" },
        ],
      });
    }
    if (input.cashAmount != null && Number(input.cashAmount) > 0) {
      totalLines.push({
        h: lineH(26),
        segs: [
          { text: "Abona con", size: 26, font: "r", color: C_MUTED, align: "left" },
          { text: money(input.cashAmount), size: 26, font: "r", color: C_TEXT, align: "right" },
        ],
      });
    }
    if (input.vuelto != null && input.vuelto > 0) {
      totalLines.push({
        h: lineH(26),
        segs: [
          { text: "Vuelto", size: 26, font: "r", color: C_MUTED, align: "left" },
          { text: money(input.vuelto), size: 26, font: "r", color: C_TEXT, align: "right" },
        ],
      });
    }
    if (payLabel) {
      totalLines.push({
        h: lineH(26),
        segs: [
          { text: "Pago", size: 26, font: "r", color: C_MUTED, align: "left" },
          { text: payLabel, size: 26, font: "r", color: C_TEXT, align: "right" },
        ],
      });
    }
    blocks.push({
      kind: "lines",
      gapBefore: 26,
      bg: PORTAL_LIME_SOFT,
      accent: PORTAL_LIME,
      padX: 36,
      padY: 26,
      lines: totalLines,
    });

    // La seña se aclara debajo de la caja (es un pago ya hecho).
    if (input.depositPaid && input.depositPaid > 0) {
      blocks.push({
        kind: "lines",
        gapBefore: 12,
        lines: [
          {
            h: lineH(24),
            segs: [
              {
                text: `Seña pagada: ${money(input.depositPaid)}`,
                size: 24,
                font: "r",
                color: C_MUTED,
                align: "left",
              },
            ],
          },
        ],
      });
    }

    // ---------------- Fiscal ----------------
    let qrPng: Buffer | null = null;
    if (input.isFiscal) {
      const fiscalLines: Line[] = [];
      if (input.invoiceNumber) {
        fiscalLines.push({
          h: lineH(28),
          segs: [
            {
              text: `Factura C N° ${input.invoiceNumber}`,
              size: 28,
              font: "b",
              color: C_TEXT,
              align: "left",
            },
          ],
        });
      }
      if (input.cae) {
        fiscalLines.push({
          h: lineH(24),
          segs: [
            { text: `CAE: ${input.cae}`, size: 24, font: "r", color: C_MUTED, align: "left" },
          ],
        });
      }
      if (input.caeVto) {
        fiscalLines.push({
          h: lineH(24),
          segs: [
            { text: `Vto CAE: ${input.caeVto}`, size: 24, font: "r", color: C_MUTED, align: "left" },
          ],
        });
      }
      blocks.push({ kind: "lines", gapBefore: 30, lines: fiscalLines });
      if (input.qrData) {
        qrPng = await renderQrImage(input.qrData, 300);
      }
    }

    // ---------------- Pie ----------------
    const footLines: Line[] = [];
    footLines.push({
      h: lineH(30),
      segs: [
        { text: "Gracias por tu visita", size: 30, font: "b", color: C_TEXT, align: "left" },
      ],
    });
    const phone = input.printPhone !== false ? (input.phone || "").trim() : "";
    const whatsapp = input.printPhone !== false ? (input.whatsapp || "").trim() : "";
    const contactBits: string[] = [];
    if (whatsapp || phone) contactBits.push(`WhatsApp: ${whatsapp || phone}`);
    const ig = input.printSocial !== false && input.instagram
      ? `Instagram: @${shortSocialHandle(input.instagram, "instagram")}`
      : "";
    if (ig) contactBits.push(ig);
    const fb = input.printSocial !== false && input.facebook
      ? `Facebook: ${shortSocialHandle(input.facebook, "facebook")}`
      : "";
    if (fb) contactBits.push(fb);
    for (const bit of contactBits) {
      footLines.push({
        h: lineH(24),
        segs: [{ text: bit, size: 24, font: "r", color: C_MUTED, align: "left" }],
      });
    }
    if (input.storeUrl) {
      footLines.push({
        h: lineH(28),
        segs: [
          {
            text: "Reservá tu próximo turno",
            size: 26,
            font: "b",
            color: PORTAL_LIME_STRONG,
            align: "left",
          },
        ],
      });
      footLines.push({
        h: lineH(24),
        segs: [{ text: input.storeUrl, size: 24, font: "r", color: C_TEXT, align: "left" }],
      });
    }
    if (input.footer) {
      footLines.push({
        h: lineH(24),
        segs: [{ text: input.footer, size: 24, font: "r", color: C_FAINT, align: "left" }],
      });
    }
    // Fecha/hora de emisión (el cliente necesita saber cuándo se emitió).
    const now = new Date();
    const emitted = `${now.toLocaleDateString("es-AR", { timeZone: AR_TZ })} ${now.toLocaleTimeString("es-AR", {
      timeZone: AR_TZ,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      hourCycle: "h23",
    })}`;
    footLines.push({
      h: lineH(24),
      segs: [{ text: `Emitido: ${emitted}`, size: 24, font: "r", color: C_FAINT, align: "left" }],
    });
    blocks.push({ kind: "rule", gapBefore: 30 });
    blocks.push({ kind: "lines", gapBefore: 22, lines: footLines });

    // ---------------- Medidas ----------------
    let totalH = PAD;
    for (const b of blocks) {
      if (b.kind === "header") {
        totalH += HEADER_H;
      } else if (b.kind === "rule") {
        totalH += (b.gapBefore || 0) + 2;
      } else if (b.kind === "gap") {
        totalH += b.h;
      } else {
        const padY = b.padY || 0;
        const linesH = b.lines.reduce((acc, l) => acc + l.h, 0);
        totalH += (b.gapBefore || 0) + padY * 2 + linesH;
      }
    }
    if (qrPng) totalH += 300 + 18 + lineH(22);
    totalH += PAD;

    // ---------------- Canvas ----------------
    const canvas = PI.make(W, totalH);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, totalH);
    ctx.textBaseline = "alphabetic";

    // Logo del local (circular, a color) para el encabezado.
    let logoBitmap: any = null;
    if (input.printLogo !== false && input.logoUrl) {
      const circular = await makeCircularLogo(input.logoUrl);
      if (circular) {
        try {
          logoBitmap = await decodePng(PI, circular);
        } catch {
          logoBitmap = null;
        }
      }
    }

    const drawLine = (line: Line, yTop: number) => {
      for (const seg of line.segs) {
        ctx.font = fontSpec(seg.font, seg.size);
        ctx.fillStyle = seg.color;
        const w = ctx.measureText(seg.text).width;
        let x = PAD;
        if (seg.align === "right") x = W - PAD - w;
        else if (seg.align === "center") x = Math.round((W - w) / 2);
        ctx.fillText(seg.text, x, yTop + seg.size);
      }
    };

    let y = 0;
    for (const b of blocks) {
      if (b.kind === "header") {
        ctx.fillStyle = PORTAL_BLUE;
        ctx.fillRect(0, 0, W, HEADER_H);
        const logoSize = 172;
        const logoY = Math.round((HEADER_H - logoSize) / 2);
        let textX = PAD;
        let textW = W - PAD * 2;
        if (logoBitmap) {
          ctx.drawImage(logoBitmap, PAD, logoY, logoSize, logoSize);
          textX = PAD + logoSize + 40;
          textW = W - textX - PAD;
        }
        // Nombre (ajusta el tamaño para que quepa en 2 líneas).
        let size = 46;
        let nameLines: string[] = [];
        while (size >= 26) {
          nameLines = wrap(input.storeName || "Comercio", textW, size, "b");
          if (nameLines.length <= 2) break;
          size -= 3;
        }
        if (nameLines.length > 2) nameLines = nameLines.slice(0, 2);
        const nameH = nameLines.length * lineH(size);
        const sub = [input.categoryLabel, input.neighborhood].filter(Boolean).join(" · ");
        const subH = sub ? lineH(24) : 0;
        const blockH = nameH + subH + 10;
        let ty = Math.round((HEADER_H - blockH) / 2);
        ctx.font = fontSpec("b", size);
        ctx.fillStyle = "#ffffff";
        for (const ln of nameLines) {
          ctx.fillText(ln, textX, ty + size);
          ty += lineH(size);
        }
        if (sub) {
          ty += 10;
          ctx.font = fontSpec("r", 24);
          ctx.fillStyle = "#f1f5f9";
          const subLines = wrap(sub, textW, 24, "r").slice(0, 2);
          for (const ln of subLines) {
            ctx.fillText(ln, textX, ty + 24);
            ty += lineH(24);
          }
        }
        y += HEADER_H;
        continue;
      }

      if (b.kind === "rule") {
        y += b.gapBefore || 0;
        ctx.fillStyle = PORTAL_LIME;
        ctx.fillRect(PAD, y, MAX_W, 3);
        y += 3;
        continue;
      }

      if (b.kind === "gap") {
        y += b.h;
        continue;
      }

      y += b.gapBefore || 0;
      const padY = b.padY || 0;
      const padX = b.padX || 0;
      const linesH = b.lines.reduce((acc, l) => acc + l.h, 0);
      if (b.bg) {
        ctx.fillStyle = b.bg;
        ctx.fillRect(0, y, W, linesH + padY * 2);
      }
      if (b.accent) {
        ctx.fillStyle = b.accent;
        ctx.fillRect(0, y, 8, linesH + padY * 2);
      }
      let ly = y + padY;
      for (const line of b.lines) {
        if (padX) {
          // Re-calcula las x con el padding interno de la caja.
          for (const seg of line.segs) {
            ctx.font = fontSpec(seg.font, seg.size);
            ctx.fillStyle = seg.color;
            const w = ctx.measureText(seg.text).width;
            let x = PAD + padX;
            if (seg.align === "right") x = W - PAD - padX - w;
            else if (seg.align === "center") x = Math.round((W - w) / 2);
            ctx.fillText(seg.text, x, ly + seg.size);
          }
        } else {
          drawLine(line, ly);
        }
        ly += line.h;
      }
      y += linesH + padY * 2;
    }

    if (qrPng) {
      const qrBitmap = await decodePng(PI, qrPng);
      const qrX = Math.round((W - 300) / 2);
      ctx.drawImage(qrBitmap, qrX, y + 10, 300, 300);
      y += 300 + 18;
      ctx.font = fontSpec("r", 22);
      ctx.fillStyle = C_FAINT;
      const cap = "Verificá el comprobante fiscal";
      const capW = ctx.measureText(cap).width;
      ctx.fillText(cap, Math.round((W - capW) / 2), y + 22);
    }

    const raw = await encodePng(PI, canvas);
    return await sharp(raw).png().toBuffer();
  } catch (e) {
    console.error("[receipt-image] render failed", e);
    return null;
  }
}
