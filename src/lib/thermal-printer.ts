import type { Order, OrderItem } from "@/types/database";
import { orderLineTotal } from "@/lib/order-line";
import { CASH_METHOD_LABELS } from "@/lib/cash-methods";
import { formatDeliveryWindow } from "@/lib/delivery-schedule";
import { code128BarWidths } from "@/lib/code128";
import { buildStickerBuffer } from "@/lib/label-printer";
import {
  FONT_NAME,
  LOGO_D,
  decodePng,
  encodePng,
  loadPureImage,
  loadSharp,
  makeCircularLogo,
  renderQrImage,
  renderStoreHeader,
  wrapNameLines,
  type PrinterVendor,
} from "@/lib/printer-image";

export type { PrinterVendor } from "@/lib/printer-image";

let ThermalPrinter: any = null;
let PrinterTypes: any = null;

export type PrintJobType =
  | "ticket"
  | "comanda"
  | "retiro"
  | "despacho"
  | "test"
  | "precuenta"
  | "cash_close"
  | "cash_snapshot"
  | "presupuesto"
  | "label"
  | "shipment_label"
  | "orden"
  | "orden_tag"
  | "turno";

/** Oblea de envío extendido (Portal 659 Envíos) para impresión térmica. */
export type ShipmentLabelData = {
  code: string;
  /** URL de tracking (se imprime como QR). */
  trackUrl: string;
  customer_name: string | null;
  customer_phone: string | null;
  customer_address: string | null;
  zone_name: string | null;
  store_name: string | null;
  /** Copias: 1 = solo paquete, 2 = paquete + copia logística. */
  copies?: number;
}

/** Datos del presupuesto de oficio para impresión térmica. */
/** Comprobante de orden de servicio (recepción de taller) para impresión térmica. */
export type WorkOrderPrintData = {
  order_no: number | null;
  customer_name: string;
  customer_phone: string | null;
  /** "🛠️ Moto Zanella 150 · N° ABC123" (etiqueta del equipo, emoji por tipo). */
  equipment_label: string | null;
  /** Falla declarada por el cliente. */
  declared_issue: string | null;
  /** Diagnóstico del taller (opcional). */
  diagnosis: string | null;
  /** Fecha de ingreso (hoy). */
  intake_date: string;
  /** Fecha de entrega estimada (sin hora). */
  delivery_date: string | null;
  /** Seña cargada (se cobra por MP o al retirar). */
  deposit_amount: number | null;
  deposit_paid: boolean;
  /** Precio acordado (si ya está definido). */
  price: number | null;
  /** Orden cobrada (al imprimir el comprobante tras el cobro). */
  paid?: boolean;
  amount_paid?: number | null;
  payment_method?: string | null;
  /** Momento en que se retiró el equipo (orden entregada): imprime "Equipo retirado". */
  completed_date?: string | null;
  /** Partidas de la cuenta (del presupuesto vinculado): detalle impreso al cobrar. */
  items?: { kind?: string | null; description: string; qty: number; unit_price: number }[];
};

/** Datos del presupuesto de oficio para impresión térmica. */
export type QuotePrintData = {
  customer_name: string;
  customer_phone: string | null;
  service_name: string | null;
  description: string;
  items: { kind: string; description: string; qty: number; unit_price: number }[];
  total: number;
  deposit_pct: number | null;
  deposit_amount: number | null;
  validity?: string | null;
  created_at: string;
  /** Título del documento ("PRESUPUESTO" por defecto, "CONSULTA" en estética). */
  docTitle?: string;
};

export type CashClosingPrintData = {
  closed_at: string;
  since: string;
  orders_count: number;
  gross_total: number;
  discounts_total: number;
  net_total: number;
  by_method: Record<string, { count: number; total: number }> | null;
  by_account?: unknown;
  cash_declared: number | null;
  cash_difference: number | null;
  notes: string | null;
  /** Turno de caja (nulo en cierres legacy sin apertura). */
  opened_at?: string | null;
  opening_amount?: number | null;
  opened_by_name?: string | null;
  /** Quien confirmó el cierre (created_by). */
  closed_by_name?: string | null;
  /** Receptor del pase de turno (NULL = cierre común). */
  handed_to?: string | null;
  movements?: { ingresos: number; retiros: number } | null;
  expected_cash?: number | null;
  /** Ajustes post-cierre: correcciones cargadas después del Z (venta sin
   *  registrar, duplicada o medio equivocado). Se imprimen como bloque aparte
   *  sin tocar los números congelados. */
  adjustments?: {
    amount: number;
    method: string;
    reason: string;
    kind?: string;
    order_number?: number | null;
    created_at?: string;
    created_by_name?: string | null;
  }[];
  adjustment_total?: number;
  adjustment_cash?: number;
  /** Neto y diferencia con los ajustes ya sumados (null = sin arqueo). */
  adjusted_net_total?: number;
  adjusted_expected_cash?: number;
  adjusted_cash_difference?: number | null;
};

export type DispatchResult = {
  ok: boolean;
  mode: "server" | "app" | "usb";
  skipped?: boolean;
  offline?: boolean;
  error?: string;
  /** Auto-fix de DHCP: la IP que realmente imprimió (puede diferir de la configurada). */
  printerIpUsed?: string | null;
  autoFixed?: boolean;
  /** Modo usb: la cola de Windows que realmente imprimió. */
  usbUsed?: string | null;
};

/** Datos de envío para los documentos impresos (zona autodeclarada). */
function deliveryPrintInfo(order: Order): {
  zoneName: string;
  outOfArea: boolean;
  fee: number;
} {
  const o = order as any;
  return {
    zoneName: o?.delivery_zone_name != null ? String(o.delivery_zone_name) : "",
    outOfArea: o?.delivery_out_of_area === true,
    fee: Number(o?.delivery_fee) || 0,
  };
}

/** Línea de desglose del envío (comanda/ticket) o null si no corresponde. */
function deliveryFeeLine(order: Order): string | null {
  if (order.method !== "delivery") return null;
  const d = deliveryPrintInfo(order);
  if (d.outOfArea) return "Envío: A CONVENIR";
  if (d.fee <= 0) return null;
  return d.zoneName
    ? `Envío (${d.zoneName}): $${d.fee.toLocaleString("es-AR")}`
    : `Envío: $${d.fee.toLocaleString("es-AR")}`;
}

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
 * Encabezado de todos los documentos: logo+nombre (bitmap si hay logo y está
 * activado; si no, nombre en texto) + líneas de datos on/off por línea.
 * El nombre del negocio y el pie de página siempre se imprimen.
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
    const combined = [tel, wa].filter(Boolean).join(" · ");
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
    const combined = [ig, fb].filter(Boolean).join(" · ");
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
  // Por peso: "0,500kg Queso ..." (qty decimal, precio por kilo).
  const qtyStr =
    (item as any).unit === "kg"
      ? `${Number(item.qty).toLocaleString("es-AR", { maximumFractionDigits: 3 })}kg`
      : `${item.qty}x`;
  const nameStr = item.name;
  const priceStr = `$${orderLineTotal(item).toLocaleString("es-AR")}`;

  // El precio SIEMPRE se imprime, aunque el nombre sea largo: si no entra en
  // la primera línea, se envuelve el nombre y el precio va al final de la
  // última línea (si entra) o en una línea aparte alineada a la derecha.
  const firstCap = width - qtyStr.length - 1; // capacidad del nombre en la 1ra línea
  const availWithPrice = firstCap - priceStr.length;
  if (nameStr.length <= availWithPrice) {
    lines.push(`${qtyStr} ${padRight(nameStr, availWithPrice)}${priceStr}`);
  } else if (nameStr.length <= firstCap) {
    lines.push(`${qtyStr} ${nameStr}`);
    lines.push(padLeft(priceStr, width));
  } else {
    // Envolver el nombre.
    let remaining = nameStr.slice(firstCap);
    const firstLine = `${qtyStr} ${nameStr.slice(0, firstCap)}`;
    const contCap = width - 2;
    const wrapped: string[] = [];
    while (remaining.length > 0) {
      wrapped.push(remaining.slice(0, contCap));
      remaining = remaining.slice(contCap);
    }
    const lastWrapped = wrapped.pop() ?? "";
    // Intentar poner el precio en la última línea envuelta.
    if (lastWrapped.length + 1 + priceStr.length <= contCap) {
      const base = padRight(lastWrapped, contCap - priceStr.length);
      lines.push(firstLine);
      // líneas intermedias
      for (const w of wrapped) lines.push(`  ${w}`);
      lines.push(`  ${base}${priceStr}`);
    } else {
      lines.push(firstLine);
      for (const w of wrapped) lines.push(`  ${w}`);
      lines.push(`  ${lastWrapped}`);
      lines.push(padLeft(priceStr, width));
    }
  }

  if (item.modifiers && item.modifiers.length > 0) {
    // Los gustos (ej: 4-5 en 1 kg) no entran en una línea de 32/48 columnas:
    // se envuelven por palabras en vez de dejar que la impresora corte.
    const full = `(${item.modifiers.join(", ")})`;
    const maxw = Math.max(10, width - 3);
    if (full.length <= maxw) {
      lines.push(`   ${full}`);
    } else {
      let cur = "";
      for (const word of full.split(" ")) {
        const next = cur ? `${cur} ${word}` : word;
        if (next.length > maxw && cur) {
          lines.push(`   ${cur}`);
          cur = word;
        } else {
          cur = next;
        }
      }
      if (cur) lines.push(`   ${cur}`);
    }
  }

  // Snapshot de combo: sub-líneas "└ 2× Coca 3L" (vuelven envueltas igual
  // que los gustos; si no hay snapshot la línea sale como siempre).
  const comboMembers = (item as any).combo_members as
    | { name?: string; qty?: number }[]
    | undefined;
  if (Array.isArray(comboMembers) && comboMembers.length > 0) {
    const maxw = Math.max(10, width - 5);
    let cur = "";
    const flush = () => {
      if (cur) {
        lines.push(`   └ ${cur}`);
        cur = "";
      }
    };
    for (const m of comboMembers) {
      const piece = `${Number(m?.qty) || 1}× ${String(m?.name || "?")}`;
      const part = cur ? ` + ${piece}` : piece;
      if (part.length > maxw && cur) {
        lines.push(`   └ ${cur}`);
        cur = piece;
      } else {
        cur += part;
      }
      if (cur.length > maxw) {
        flush();
      }
    }
    flush();
  }

  return lines;
}

async function createPrinter(vendor: PrinterVendor): Promise<{ ok: true; printer: any } | { ok: false; error: string }> {
  await loadModule();
  if (!ThermalPrinter || !PrinterTypes) {
    return { ok: false, error: "Módulo de impresión no disponible" };
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
  return width >= 48 ? "========================================" : "==============================";
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
  // Número universal del pedido del día (grande, para cantar a cocina/caja).
  if (order.pickup_number != null) {
    printer.alignCenter();
    printer.setTextSize(2, 2);
    printer.bold(true);
    const m = order.method === "delivery" ? "ENVÍO" : "RETIRO";
    printer.println(`${m} Nro. ${order.pickup_number}`);
    printer.bold(false);
    printer.setTextSize(0, 0);
    printer.alignLeft();
  }
  printer.println(separatorFor(width));

  const comandaZone = order.method === "delivery" ? deliveryPrintInfo(order).zoneName : "";
  const methodStr = order.method === "delivery"
    ? (comandaZone ? `Delivery (${comandaZone})` : "Delivery")
    : "Retiro en local";
  const paymentStr =
    order.payment_method === "efectivo" ? "Efectivo" :
    order.payment_method === "transferencia" ? "Transferencia" :
    order.payment_method === "mercadopago" ? "Mercado Pago (pago)" :
    "Coordinar";
  // "¿Con cuánto abonás?": cocina/caja ven de cuánto es el vuelto.
  const abonaStr =
    order.payment_method === "efectivo" && Number((order as any)?.cash_amount) > 0
      ? ` (abona $${Number((order as any).cash_amount).toLocaleString("es-AR")})`
      : "";
  printer.println(`${methodStr}  |  ${paymentStr}${abonaStr}`);
  printer.println(separatorFor(width));

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
  const ticketCash = Number((order as any)?.cash_discount) || 0;
  const ticketCashPct = Number((order as any)?.cash_pct) || 0;
  if (ticketCash > 0) {
    printer.println(`Desc. efectivo (${ticketCashPct}%): -$${ticketCash.toLocaleString("es-AR")}`);
  }
  const ticketGift = Number((order as any)?.giftcard_discount) || 0;
  if (ticketGift > 0) {
    printer.println(`Giftcard ${((order as any)?.giftcard_code || "")}: -$${ticketGift.toLocaleString("es-AR")}`);
  }
  const ticketVol = Number((order as any)?.volume_discount) || 0;
  if (ticketVol > 0) {
    printer.println(`Desc. volumen: -$${ticketVol.toLocaleString("es-AR")}`);
  }
  const ticketManual = Number((order as any)?.manual_discount) || 0;
  if (ticketManual > 0) {
    const ticketManualReason = String((order as any)?.manual_discount_reason || "").trim();
    printer.println(`Desc. manual${ticketManualReason ? ` (${ticketManualReason})` : ""}: -$${ticketManual.toLocaleString("es-AR")}`);
  }
  const ticketShip = deliveryFeeLine(order);
  if (ticketShip) {
    printer.println(ticketShip);
  }
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
  const ticketWindow = order.method === "delivery" ? formatDeliveryWindow((order as any)?.delivery_window) : null;
  if (ticketWindow) {
    printer.println(`Entrega: ${ticketWindow}`);
  } else if (order.method === "delivery" && (vendor as any)?.delivery_coordinar === true) {
    printer.println("Horario: se coordina por WhatsApp");
  }
  if (order.method === "delivery" && deliveryPrintInfo(order).outOfArea) {
    printer.bold(true);
    printer.println("** ENVIO A CONVENIR **");
    printer.bold(false);
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

export type ReceiptExtra = {
  tableName?: string;
  subLabel?: string;
  /** Título del documento (default "TICKET"). Retail imprime "COMPROBANTE". */
  docTitle?: string;
  /** Comprobante de venta retail: Nro. diario grande + datos del cliente. */
  retail?: boolean;
  /** Venta directa: ticket completo con "Mostrador · Nro. X" en tamaño normal. */
  direct?: boolean;
  /** Saldo de cuenta corriente (fiado) para imprimir en el ticket. */
  fiadoBalance?: number;
  /** Factura electrónica ARCA (se imprime bloque fiscal con CAE + QR). */
  fiscal?: FiscalPrintInfo | null;
  /**
   * "¿Con cuánto paga?" (efectivo): monto con el que abona el cliente, para
   * imprimir "Abona con / Vuelto". Pisa `order.cash_amount` cuando el total
   * impreso no es el del pedido (cierre de mesa: el total es de la cuenta).
   */
  cashAmount?: number | null;
  /**
   * Pago combinado (split): una línea por medio con su monto. Presente →
   * imprime el desglose y el TOTAL PAGADO en lugar del medio único (y el
   * vuelto sale de la fila de efectivo, no de `cashAmount`).
   */
  payments?: { method: string; amount: number; tendered?: number | null }[];
  /**
   * Cierre de mesa fiscal: los ítems y el total vienen de la CUENTA (varias
   * consumiciones sumadas por close), no del pedido individual que se usa
   * solo como portador de la factura. Presentes → pisan los del pedido y se
   * omiten los descuentos derivados del pedido (ya netos en el total).
   */
  items?: {
    name: string;
    price: number;
    qty: number;
    modifiers?: string[];
    unit?: string;
    /** Componentes de combo (sub-líneas en el ticket). */
    combo_members?: { product_id?: string; name?: string; qty?: number }[];
  }[];
  total?: number;
};

/** Datos fiscales para el ticket impreso (Factura C). */
export type FiscalPrintInfo = {
  cuit: string;
  puntoVenta: number;
  cbteNro: number;
  cae: string;
  /** Vencimiento CAE en YYYYMMDD. */
  caeVto: string;
  /** Fecha de emisión del comprobante (ISO). */
  fechaEmision?: string | null;
  /** Condición IVA del emisor (vendors.fiscal_cond_iva). */
  condIva?: string | null;
  /** Título del documento (default "FACTURA C"). */
  docLabel?: string | null;
  /** Nro. de factura asociada (NC), ya formateado "0001-00000001". */
  asocLabel?: string | null;
  /** URL de verificación ARCA (QR). Se genera al imprimir si no viene. */
  qrUrl?: string;
  /** Receptor identificado (DNI/CUIT). Sin esto = consumidor final. */
  receptorDocTipo?: number | null;
  receptorDocNro?: string | null;
  receptorNombre?: string | null;
};

/** Etiqueta visible de la condición IVA del emisor. */
function condIvaLabel(cond: string | null | undefined): string | null {
  const c = (cond || "").trim().toLowerCase();
  if (!c) return null;
  if (c === "monotributo") return "Monotributo";
  if (c === "responsable_inscripto") return "IVA Responsable Inscripto";
  return cond!.trim();
}

/** Formato DD/MM/AAAA para fechas fiscales (acepta YYYYMMDD o ISO). */
function formatFiscalDate(input: string): string {
  const clean = (input || "").replace(/\D/g, "");
  if (clean.length === 8) {
    return `${clean.slice(6, 8)}/${clean.slice(4, 6)}/${clean.slice(0, 4)}`;
  }
  const d = new Date(input);
  if (!Number.isNaN(d.getTime())) {
    const p = (n: number) => String(n).padStart(2, "0");
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
  }
  return input;
}

async function composeFiscalHeader(
  printer: any,
  width: number,
  fiscal: FiscalPrintInfo
): Promise<void> {
  const nro = `${String(fiscal.puntoVenta).padStart(4, "0")}-${String(fiscal.cbteNro).padStart(8, "0")}`;
  const title = fiscal.docLabel || "FACTURA C";
  const fecha = fiscal.fechaEmision ? formatFiscalDate(fiscal.fechaEmision) : null;
  const cond = condIvaLabel(fiscal.condIva);
  const receptor =
    fiscal.receptorDocTipo && fiscal.receptorDocTipo !== 99 && fiscal.receptorDocNro && fiscal.receptorDocNro !== "0"
      ? `${fiscal.receptorDocTipo === 80 ? "CUIT" : fiscal.receptorDocTipo === 86 ? "CUIL" : fiscal.receptorDocTipo === 96 ? "DNI" : `Doc ${fiscal.receptorDocTipo}`}: ${fiscal.receptorDocNro}${fiscal.receptorNombre ? ` · ${fiscal.receptorNombre}` : ""}`
      : "Consumidor final";

  printer.alignCenter();
  printer.println(separatorFor(width));
  printer.bold(true);
  printer.println(`${title} — ORIGINAL`);
  printer.println(`Nº ${nro}`);
  printer.bold(false);
  if (fiscal.asocLabel) {
    printer.println(`Anula a: ${fiscal.asocLabel}`);
  }
  const fechaCuit = [fecha, fiscal.cuit ? `CUIT: ${fiscal.cuit}` : null].filter(Boolean).join(" · ");
  if (fechaCuit) printer.println(fechaCuit);
  const condReceptor = [cond, receptor].filter(Boolean).join(" · ");
  if (condReceptor) printer.println(condReceptor.slice(0, width));
}

const fiscalQrCache = new Map<string, Buffer>();

/**
 * Bloque fiscal lado a lado (solo 80mm/576px): QR a la izquierda (~30mm,
 * margen 2 para escaneo fácil) + columna de texto a la derecha (CAE, vto,
 * verificación). Mismo patrón que el encabezado con logo (bitmap único,
 * cache en memoria). Devuelve null si falla (el llamador usa el apilado).
 */
async function renderFiscalSideQr(
  fiscal: FiscalPrintInfo,
  cae: string,
  vto: string
): Promise<Buffer | null> {
  if (!fiscal.qrUrl) return null;
  const key = `fiscal:${fiscal.cae}:${fiscal.cbteNro}`;
  const cached = fiscalQrCache.get(key);
  if (cached) return cached;
  try {
    const QRCode = (await import("qrcode")).default;
    const qrBuf: Buffer = await QRCode.toBuffer(fiscal.qrUrl, {
      width: 240,
      margin: 2,
    });
    const PI = await loadPureImage();
    const sharp = await loadSharp();
    const qrImg = await decodePng(PI, qrBuf);
    const W = 576;
    const QR = 240;
    const PAD = 16;
    const textX = PAD + QR + 20;
    const lines = [`CAE:`, `${cae}`, `Vto: ${vto}`, "", "Verificá en", "arca.gob.ar/fe/qr"];
    const size = 24;
    const canvas = PI.make(W, QR + PAD * 2);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, W, QR + PAD * 2);
    ctx.drawImage(qrImg, PAD, PAD, QR, QR);
    ctx.fillStyle = "black";
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.font = `${size}px ${FONT_NAME}`;
    const lineHeight = Math.round(size * 1.25);
    const blockH = lines.length * lineHeight;
    const top = PAD + Math.round((QR - blockH) / 2);
    lines.forEach((ln, i) => {
      if (ln) ctx.fillText(ln, textX, top + (i + 1) * lineHeight);
    });
    const raw = await encodePng(PI, canvas);
    const png = await sharp(raw).grayscale().threshold(150).png().toBuffer();
    if (fiscalQrCache.size >= 200) fiscalQrCache.clear();
    fiscalQrCache.set(key, png);
    return png;
  } catch {
    return null;
  }
}

async function composeFiscalBlock(
  printer: any,
  width: number,
  fiscal: FiscalPrintInfo
): Promise<void> {
  const separator = separatorFor(width);
  const vto = formatFiscalDate(fiscal.caeVto);
  if (width > 32 && fiscal.qrUrl) {
    const bitmap = await renderFiscalSideQr(fiscal, fiscal.cae, vto);
    if (bitmap) {
      printer.alignCenter();
      printer.println(separator);
      await printer.printImageBuffer(bitmap);
      printer.alignLeft();
      return;
    }
  }
  printer.alignCenter();
  printer.println(separator);
  printer.println(`CAE: ${fiscal.cae} · Vto: ${vto}`);
  if (fiscal.qrUrl) {
    let printedQr = false;
    try {
      const png = await renderQrImage(fiscal.qrUrl, 200);
      if (png) {
        printer.alignCenter();
        await printer.printImageBuffer(png);
        printer.println("");
        printedQr = true;
      }
    } catch {}
    if (!printedQr) {
      try {
        printer.printQR(fiscal.qrUrl, { cellSize: 4, correction: "M", model: 2 });
        printer.println("");
      } catch {
        printer.println("QR: arca.gob.ar/fe/qr");
      }
    }
  }
  printer.println("arca.gob.ar/fe/qr");
  printer.alignLeft();
}

async function composeReceipt(
  printer: any,
  vendor: PrinterVendor,
  order: Order,
  extra?: ReceiptExtra
): Promise<void> {
  const width = vendor.paper_size === "58mm" ? 32 : 48;
  const separator = separatorFor(width);

  const now = new Date();
  const dateStr = formatArgDate(now);
  const timeStr = formatArgTime(now);

  printer.alignCenter();
  await composeStoreHeader(printer, vendor, width);
  // Con fiscal, el encabezado de factura reemplaza al título genérico.
  if (extra?.fiscal) {
    await composeFiscalHeader(printer, width, extra.fiscal);
  } else {
    printer.println(extra?.docTitle || "TICKET");
  }
  if (extra?.tableName) printer.println(`Mesa: ${extra.tableName}`);
  if (extra?.subLabel) printer.println(extra.subLabel);
  printer.println(separator);

  // Venta directa: mismo cuerpo que retiro/envío pero sin cartel grande
  // y sin talones: solo "Mostrador · Nro. X" en tamaño normal.
  if (extra?.direct && order.pickup_number != null) {
    printer.println(`Mostrador · Nro. ${order.pickup_number}`);
    printer.println(separator);
  } else if (extra?.retail && order.pickup_number != null) {
    // Retail: número diario grande (el que canta caja/mostrador).
    printer.bold(true);
    printer.setTextSize(2, 2);
    const m = order.method === "delivery" ? "ENVÍO" : "RETIRO";
    printer.println(`${m} Nro. ${order.pickup_number}`);
    printer.bold(false);
    printer.setTextSize(0, 0);
    printer.println(separator);
  }

  printer.alignLeft();
  printer.bold(true);
  printer.println(`Pedido #${order.id.slice(0, 8)}`);
  printer.bold(false);
  printer.println(`${dateStr} ${timeStr}`);
  printer.println(separator);

  // Cierre de mesa fiscal: los ítems/total vienen de la cuenta agregada.
  const hasItemOverride = Array.isArray(extra?.items) && extra.items.length > 0;
  const receiptItems: any[] = hasItemOverride
    ? (extra!.items as any[])
    : (order.items as any[]);
  for (const item of receiptItems) {
    const itemLines = formatItemLine(item, width);
    for (const line of itemLines) {
      printer.println(line);
    }
  }

  printer.println(separator);

  printer.alignRight();
    const receiptCash = hasItemOverride ? 0 : Number((order as any)?.cash_discount) || 0;
    const receiptCashPct = Number((order as any)?.cash_pct) || 0;
    if (receiptCash > 0) {
      printer.println(`Desc. efectivo (${receiptCashPct}%): -$${receiptCash.toLocaleString("es-AR")}`);
    }
    const receiptVol = hasItemOverride ? 0 : Number((order as any)?.volume_discount) || 0;
    if (receiptVol > 0) {
      printer.println(`Desc. volumen: -$${receiptVol.toLocaleString("es-AR")}`);
    }
    const receiptManual = hasItemOverride ? 0 : Number((order as any)?.manual_discount) || 0;
    if (receiptManual > 0) {
      const receiptManualReason = String((order as any)?.manual_discount_reason || "").trim();
      printer.println(`Desc. manual${receiptManualReason ? ` (${receiptManualReason})` : ""}: -$${receiptManual.toLocaleString("es-AR")}`);
    }
    const receiptShip = hasItemOverride ? null : deliveryFeeLine(order);
    if (receiptShip) {
      printer.println(receiptShip);
    }
  printer.bold(true);
  printer.setTextSize(1, 1);
  const receiptTotal = hasItemOverride && extra?.total != null
    ? Number(extra.total)
    : Number(order.total);
  printer.println(`TOTAL: $${receiptTotal.toLocaleString("es-AR")}`);
  printer.setTextSize(0, 0);
  printer.bold(false);

  printer.alignLeft();
  const paymentStr =
    order.payment_method === "efectivo" ? "Efectivo" :
    order.payment_method === "transferencia" ? "Transferencia" :
    order.payment_method === "whatsapp" ? "Coordinado" :
    order.payment_method === "fiado" ? "Fiado" :
    "Tarjeta/Online";
  const paidStr = order.paid_at ? "PAGADO" : "PENDIENTE";
  printer.println("");
  printer.bold(!!order.paid_at);
  printer.println(`Pago: ${paymentStr} — ${paidStr}`);
  printer.bold(false);
  // "¿Con cuánto abonás?": el que cobra sabe cuánto vuelto dar.
  // `extra.cashAmount` manda sobre `order.cash_amount` cuando el total impreso
  // no es el del pedido (cierre de mesa: el total es de la cuenta). Viene del
  // cierre, que solo lo acepta si la mesa se cobró EN EFECTIVO, así que tener
  // el monto ya alcanza para imprimirlo (el `payment_method` del pedido
  // portador puede quedar del momento en que se cargó la consumición).
  const receiptPayments =
    Array.isArray(extra?.payments) && extra!.payments!.length > 0
      ? extra!.payments!
          .filter((p) => Number(p.amount) > 0)
          .map((p) => ({
            method: String(p.method),
            amount: Number(p.amount) || 0,
            tendered: p.tendered != null ? Number(p.tendered) : null,
          }))
      : null;
  if (receiptPayments) {
    // Pago combinado: una línea por medio con su monto + TOTAL PAGADO, y el
    // vuelto de la fila de efectivo (lo que entregó vs lo que se aplicó).
    const splitPaid = receiptPayments.reduce((s, p) => s + p.amount, 0);
    for (const p of receiptPayments) {
      const label = CASH_METHOD_LABELS[p.method] ?? p.method;
      printer.println(`${label}: $${p.amount.toLocaleString("es-AR")}`);
    }
    printer.bold(true);
    printer.println(`TOTAL PAGADO: $${(Math.round(splitPaid * 100) / 100).toLocaleString("es-AR")}`);
    printer.bold(false);
    const splitCash = receiptPayments.find((p) => p.method === "efectivo");
    if (splitCash && splitCash.tendered != null && splitCash.tendered > 0) {
      printer.println(`Abona con: $${splitCash.tendered.toLocaleString("es-AR")}`);
      printer.bold(true);
      printer.println(
        `Vuelto: $${Math.max(0, Math.round((splitCash.tendered - splitCash.amount) * 100) / 100).toLocaleString("es-AR")}`
      );
      printer.bold(false);
    }
  } else {
    const receiptAbona =
      Number(extra?.cashAmount) > 0 ? Number(extra?.cashAmount) : Number((order as any)?.cash_amount) || 0;
    if (receiptAbona > 0 && (Number(extra?.cashAmount) > 0 || order.payment_method === "efectivo")) {
      printer.println(`Abona con: $${receiptAbona.toLocaleString("es-AR")}`);
      const receiptChange = Math.max(0, Math.round((receiptAbona - receiptTotal) * 100) / 100);
      printer.bold(true);
      printer.println(`Vuelto: $${receiptChange.toLocaleString("es-AR")}`);
      printer.bold(false);
    }
  }
  // Fiado: saldo de la cuenta para que el cliente sepa cuánto debe.
  if (order.payment_method === "fiado" && extra?.fiadoBalance != null && Number(extra.fiadoBalance) > 0) {
    printer.println(`Saldo cta. cte.: $${Number(extra.fiadoBalance).toLocaleString("es-AR")}`);
  }

  const showCustomerDetail = extra?.retail || extra?.direct;
  if (showCustomerDetail && (!order.customer_name || order.customer_name === "Mostrador")) {
    printer.println("Consumidor final");
  } else if (order.customer_name && (showCustomerDetail || order.channel !== "app")) {
    printer.println(`Cliente: ${order.customer_name}`);
  }
  if (showCustomerDetail && order.customer_phone) {
    printer.println(`Tel: ${order.customer_phone}`);
  }
  if (showCustomerDetail && order.method === "delivery" && order.customer_address) {
    printer.println(`Dir: ${order.customer_address}`);
  }
  if (order.method === "delivery" && deliveryPrintInfo(order).outOfArea) {
    printer.bold(true);
    printer.println("** ENVIO A CONVENIR **");
    printer.bold(false);
  }

  if (extra?.fiscal) {
    await composeFiscalBlock(printer, width, extra.fiscal);
    printer.cut();
    return;
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

  printer.println("Retirá tu pedido en el mostrador");
  printer.println("con tu número.");
  printer.println(separator);
  printer.println("www.portal659.com.ar");
  printer.println("El centro comercial de tu barrio");
  printer.println(separator);

  printer.cut();
}

/**
 * Comprobante del repartidor (delivery): datos del envío, letra doble.
 * Sin logo, sin datos del negocio, sin pie de portal, sin ítems. Con total y
 * "abona con" (efectivo): el repartidor sale con el vuelto preparado.
 */
async function composeDespacho(printer: any, order: Order): Promise<void> {
  printer.alignCenter();
  printer.setTextSize(1, 1);

  printer.bold(true);
  printer.println("ENVÍO");
  if (order.pickup_number != null) {
    printer.setTextSize(2, 2);
    printer.println(`Nro. ${order.pickup_number}`);
    printer.setTextSize(1, 1);
  }
  const despachoZone = deliveryPrintInfo(order);
  if (despachoZone.outOfArea) {
    printer.println("ZONA: A CONVENIR");
  } else if (despachoZone.zoneName) {
    printer.println(`ZONA: ${despachoZone.zoneName}`);
  }
  printer.bold(false);
  printer.println("");

  printer.println(order.customer_name || "");
  if (order.customer_phone) printer.println(`Tel. ${order.customer_phone}`);
  printer.println("");

  if (order.customer_address) {
    printer.bold(true);
    printer.println("ENTREGAR EN:");
    printer.bold(false);
    // Dirección en foco: la mostramos tal cual (puede ser multi-línea).
    for (const line of String(order.customer_address).split("\n")) {
      if (line.trim()) printer.println(line.trim());
    }
    printer.println("");
  }

  if (order.notes && order.notes.trim()) {
    printer.bold(true);
    printer.println("*** INSTRUCCIONES ***");
    printer.bold(false);
    for (const line of String(order.notes).split("\n")) {
      if (line.trim()) printer.println(line.trim());
    }
    printer.println("");
  }

  // Total + vuelto: el repartidor necesita saber cuánto cambio llevar.
  const despachoTotal = Number(order.total) || 0;
  printer.bold(true);
  printer.println(`TOTAL: $${despachoTotal.toLocaleString("es-AR")}`);
  const despachoAbona = order.payment_method === "efectivo" ? Number((order as any)?.cash_amount) || 0 : 0;
  if (despachoAbona > 0) {
    const despachoChange = Math.max(0, Math.round((despachoAbona - despachoTotal) * 100) / 100);
    printer.println(`ABONA CON: $${despachoAbona.toLocaleString("es-AR")}`);
    printer.println(`VUELTO: $${despachoChange.toLocaleString("es-AR")}`);
  }
  printer.bold(false);

  printer.setTextSize(0, 0);
  printer.cut();
}

async function composePrecuenta(
  printer: any,
  vendor: PrinterVendor,
  tableName: string,
  items: { name: string; price: number; qty: number; modifiers?: string[] }[],
  total: number,
  cash?: { pct: number; total: number } | null,
  volume?: { amount: number } | null,
  manual?: { amount: number } | null
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
  if (volume && volume.amount > 0) {
    printer.println(`Desc. volumen: -$${volume.amount.toLocaleString("es-AR")}`);
  }
  if (manual && manual.amount > 0) {
    printer.println(`Desc. manual: -$${manual.amount.toLocaleString("es-AR")}`);
  }
  printer.bold(true);
  printer.setTextSize(1, 1);
  printer.println(`TOTAL: $${Number(total).toLocaleString("es-AR")}`);
  printer.setTextSize(0, 0);
  printer.bold(false);

  // Info descuento en efectivo (patrón precuenta de POS gastronómicos: el
  // TOTAL legal queda y abajo la alternativa en efectivo, bien visible).
  if (cash && cash.total > 0 && cash.total < total) {
    printer.println("");
    printer.bold(true);
    printer.println(`EFECTIVO (-${cash.pct}%): $${cash.total.toLocaleString("es-AR")}`);
    printer.bold(false);
    printer.alignLeft();
    printer.println("");
    printer.println("Pagando en efectivo");
    printer.println("abonas ese monto.");
  }

  printer.alignLeft();
  printer.println("");
  printer.println("Gracias! Confirmá el pago");
  printer.println("en caja para cerrar la cuenta.");
  printer.println("");
  composeFooter(printer, width);
  printer.cut();
}

async function composeCashClose(
  printer: any,
  vendor: PrinterVendor,
  closing: CashClosingPrintData
): Promise<void> {
  const width = vendor.paper_size === "58mm" ? 32 : 48;
  const separator = separatorFor(width);

  printer.alignCenter();
  await composeStoreHeader(printer, vendor, width);
  printer.println("CIERRE DE CAJA (Z)");
  printer.println("(no es comprobante fiscal)");
  printer.println(separator);

  printer.alignLeft();
  printer.bold(true);
  printer.println(`Desde: ${formatArgDate(new Date(closing.since))} ${formatArgTime(new Date(closing.since))}`);
  printer.println(`Hasta: ${formatArgDate(new Date(closing.closed_at))} ${formatArgTime(new Date(closing.closed_at))}`);
  printer.bold(false);
  {
    const closer = String(closing.closed_by_name || "").trim();
    if (closer) printer.println(`Cerrada por: ${closer}`);
    const handed = String(closing.handed_to || "").trim();
    if (handed) printer.println(`Entregada a: ${handed}`);
  }
  // Turno de caja: apertura + responsable + movimientos (solo cierres con turno).
  if (closing.opened_at != null) {
    const opener = String(closing.opened_by_name || "").trim();
    printer.println(`Apertura: ${formatArgDate(new Date(closing.opened_at))} ${formatArgTime(new Date(closing.opened_at))}${opener ? ` por ${opener}` : ""}`);
    if (closing.opening_amount != null) {
      printer.println(`Fondo inicial: $${Number(closing.opening_amount).toLocaleString("es-AR")}`);
    }
    const mov = closing.movements || null;
    const ing = mov ? Number(mov.ingresos) || 0 : 0;
    const ret = mov ? Number(mov.retiros) || 0 : 0;
    if (ing > 0) printer.println(`Ingresos manuales: $${ing.toLocaleString("es-AR")}`);
    if (ret > 0) printer.println(`Retiros manuales: $${ret.toLocaleString("es-AR")}`);
    if (closing.expected_cash != null) {
      printer.println(`Esperado: $${Number(closing.expected_cash).toLocaleString("es-AR")}`);
    }
  }
  printer.println(separator);

  const ORDER = ["efectivo", "transferencia", "tarjeta", "mixto", "whatsapp", "mercadopago"];
  const byMethod = closing.by_method || {};
  const entries = Object.entries(byMethod).sort(
    (a, b) => (ORDER.indexOf(a[0]) + 1 || 99) - (ORDER.indexOf(b[0]) + 1 || 99)
  );
  for (const [m, d] of entries) {
    const label = CASH_METHOD_LABELS[m] || m;
    const countStr = `(${d.count})`;
    const totalStr = `$${Number(d.total).toLocaleString("es-AR")}`;
    printer.println(`${padRight(label, width - countStr.length - totalStr.length - 1)}${countStr} ${padLeft(totalStr, totalStr.length)}`);
    if (m === "transferencia") {
      const ba = Array.isArray(closing.by_account) ? closing.by_account : (typeof closing.by_account === "string" ? JSON.parse(closing.by_account || "[]") : []);
      if (Array.isArray(ba)) {
        for (const a of ba) {
          const al = `  ${a?.label || "Cuenta"}`;
          const at = `${Number(a?.total || 0).toLocaleString("es-AR")}`;
          printer.println(`${padRight(al, width - at.length)}${padLeft(at, at.length)}`);
        }
      }
    }
  }
  if (entries.length === 0) {
    printer.println("Sin cobros en el periodo");
  }

  printer.println(separator);

  printer.alignRight();
  printer.println(`Pedidos: ${closing.orders_count}`);
  printer.println(`Bruto: $${Number(closing.gross_total).toLocaleString("es-AR")}`);
  if (Number(closing.discounts_total) > 0) {
    printer.println(`Desc. efectivo: -$${Number(closing.discounts_total).toLocaleString("es-AR")}`);
  }
  printer.bold(true);
  printer.setTextSize(1, 1);
  printer.println(`NETO: $${Number(closing.net_total).toLocaleString("es-AR")}`);
  printer.setTextSize(0, 0);
  printer.bold(false);

  if (closing.cash_declared != null) {
    printer.alignLeft();
    printer.println(separator);
    printer.println(`Arqueo (efectivo): $${Number(closing.cash_declared).toLocaleString("es-AR")}`);
    const diff = Number(closing.cash_difference) || 0;
    printer.bold(true);
    printer.println(`Diferencia: ${diff >= 0 ? "+" : "-"}$${Math.abs(diff).toLocaleString("es-AR")}`);
    printer.bold(false);
  }

  // Ajustes post-cierre (si los hay): el Z original sigue arriba intacto y
  // acá van las correcciones + el neto/diferencia ajustados.
  const adjustments = Array.isArray(closing.adjustments) ? closing.adjustments : [];
  if (adjustments.length > 0) {
    printer.alignLeft();
    printer.println(separator);
    printer.bold(true);
    printer.println("AJUSTES POST-CIERRE");
    printer.bold(false);
    for (const a of adjustments) {
      const amount = Number(a.amount) || 0;
      const method = CASH_METHOD_LABELS[a.method] || a.method;
      const venta = a.order_number
        ? ` [${a.kind === "venta_duplicada" ? "anulo" : "cargo"} Venta N.${a.order_number}]`
        : "";
      printer.println(`${amount >= 0 ? "+" : "-"}$${Math.abs(amount).toLocaleString("es-AR")} ${method}: ${a.reason}${venta}`);
    }
    if (closing.adjusted_net_total != null) {
      printer.println(`Neto ajustado: $${Number(closing.adjusted_net_total).toLocaleString("es-AR")}`);
    }
    if (closing.cash_declared != null && closing.adjusted_cash_difference != null) {
      const adj = Number(closing.adjusted_cash_difference) || 0;
      printer.bold(true);
      printer.println(`Diferencia ajustada: ${adj >= 0 ? "+" : "-"}$${Math.abs(adj).toLocaleString("es-AR")}`);
      printer.bold(false);
    }
  }

  if (closing.notes && closing.notes.trim()) {
    printer.alignLeft();
    printer.println("");
    printer.bold(true);
    printer.println("NOTAS:");
    printer.bold(false);
    for (const line of String(closing.notes).split("\n")) {
      if (line.trim()) printer.println(line.trim());
    }
  }

  printer.alignLeft();
  printer.println("");
  {
    const now = new Date();
    printer.println(`Impreso el: ${formatArgDate(now)} ${formatArgTime(now)}`);
  }
  composeFooter(printer, width);
  printer.cut();
}

/** Foto del turno en curso (cierre parcial X): mismos datos del pre-cierre
 * en vivo, sin cerrar ni congelar nada. */
export type CashSnapshotData = {
  since: string;
  now: string;
  orders_count: number;
  gross_total: number;
  discounts_total: number;
  net_total: number;
  by_method: Record<string, { count: number; total: number }> | null;
  by_account?: unknown;
  opening_amount: number | null;
  opened_at: string | null;
  opened_by_name: string | null;
  movements: { ingresos: number; retiros: number } | null;
  expected_cash: number | null;
};

async function composeCashSnapshot(
  printer: any,
  vendor: PrinterVendor,
  snap: CashSnapshotData
): Promise<void> {
  const width = vendor.paper_size === "58mm" ? 32 : 48;
  const separator = separatorFor(width);

  printer.alignCenter();
  await composeStoreHeader(printer, vendor, width);
  printer.println("VISTA PARCIAL DE CAJA (X)");
  printer.println("(no cierra la caja, no congela nada)");
  printer.println(separator);

  printer.alignLeft();
  printer.bold(true);
  printer.println(`Desde: ${formatArgDate(new Date(snap.since))} ${formatArgTime(new Date(snap.since))}`);
  printer.println(`Hasta: ${formatArgDate(new Date(snap.now))} ${formatArgTime(new Date(snap.now))}`);
  printer.bold(false);
  if (snap.opened_at != null) {
    const opener = String(snap.opened_by_name || "").trim();
    printer.println(`Apertura: ${formatArgDate(new Date(snap.opened_at))} ${formatArgTime(new Date(snap.opened_at))}${opener ? ` por ${opener}` : ""}`);
    if (snap.opening_amount != null) {
      printer.println(`Fondo inicial: $${Number(snap.opening_amount).toLocaleString("es-AR")}`);
    }
  }
  printer.println(separator);

  const ORDER = ["efectivo", "transferencia", "tarjeta", "mixto", "whatsapp", "mercadopago"];
  const byMethod = snap.by_method || {};
  const entries = Object.entries(byMethod).sort(
    (a, b) => (ORDER.indexOf(a[0]) + 1 || 99) - (ORDER.indexOf(b[0]) + 1 || 99)
  );
  for (const [m, d] of entries) {
    const label = CASH_METHOD_LABELS[m] || m;
    const countStr = `(${d.count})`;
    const totalStr = `$${Number(d.total).toLocaleString("es-AR")}`;
    printer.println(`${padRight(label, width - countStr.length - totalStr.length - 1)}${countStr} ${padLeft(totalStr, totalStr.length)}`);
    if (m === "transferencia") {
      const ba = Array.isArray(snap.by_account) ? snap.by_account : (typeof snap.by_account === "string" ? JSON.parse(snap.by_account || "[]") : []);
      if (Array.isArray(ba)) {
        for (const a of ba) {
          const al = `  ${a?.label || "Cuenta"}`;
          const at = `${Number(a?.total || 0).toLocaleString("es-AR")}`;
          printer.println(`${padRight(al, width - at.length)}${padLeft(at, at.length)}`);
        }
      }
    }
  }
  if (entries.length === 0) {
    printer.println("Sin cobros en el periodo");
  }

  printer.println(separator);

  printer.alignRight();
  printer.println(`Pedidos: ${snap.orders_count}`);
  printer.println(`Bruto: $${Number(snap.gross_total).toLocaleString("es-AR")}`);
  if (Number(snap.discounts_total) > 0) {
    printer.println(`Desc. efectivo: -$${Number(snap.discounts_total).toLocaleString("es-AR")}`);
  }
  printer.bold(true);
  printer.setTextSize(1, 1);
  printer.println(`NETO: $${Number(snap.net_total).toLocaleString("es-AR")}`);
  printer.setTextSize(0, 0);
  printer.bold(false);

  const mov = snap.movements || null;
  const ing = mov ? Number(mov.ingresos) || 0 : 0;
  const ret = mov ? Number(mov.retiros) || 0 : 0;
  if (ing > 0 || ret > 0 || snap.expected_cash != null) {
    printer.alignLeft();
    printer.println(separator);
    if (ing > 0) printer.println(`Ingresos manuales: $${ing.toLocaleString("es-AR")}`);
    if (ret > 0) printer.println(`Retiros manuales: $${ret.toLocaleString("es-AR")}`);
    if (snap.expected_cash != null) {
      printer.bold(true);
      printer.println(`ESPERADO: $${Number(snap.expected_cash).toLocaleString("es-AR")}`);
      printer.bold(false);
    }
  }

  printer.alignLeft();
  printer.println("");
  {
    const now = new Date();
    printer.println(`Impreso el: ${formatArgDate(now)} ${formatArgTime(now)}`);
  }
  composeFooter(printer, width);
  printer.cut();
}

export type LabelPrintData = {
  name: string;
  price: number;
  /** Código a codificar (SKU/EAN). */
  code: string;
  /** Cantidad de etiquetas (1-50). */
  copies?: number;
  /** 'kg' → el precio es por kilo (se muestra $X /kg). */
  unit?: string | null;
  /** Precio de lista si hay promo (muestra ANTES + AHORRÁS). */
  oldPrice?: number | null;
};

/**
 * Bitmap de la etiqueta de góndola: nombre del producto (bold, hasta 2 líneas)
 * a la IZQUIERDA + logo circular del comercio justificado a la DERECHA (~30%).
 * Espejo del encabezado de tickets (misma maquinaria sharp+pureimage).
 * Devuelve PNG blanco/negro listo para printImageBuffer, o null si falla.
 */
async function renderLabelHeader(
  vendor: PrinterVendor,
  widthPx: number,
  circularPng: Buffer,
  productName: string
): Promise<Buffer | null> {
  try {
    const PI = await loadPureImage();
    const sharp = await loadSharp();
    const name = String(productName || "").trim() || "Producto";
    const logoD = Math.round(widthPx * 0.3);
    const pad = 16;
    const logo = await decodePng(PI, circularPng);

    const realH = logoD + pad * 2;
    const canvas = PI.make(widthPx, realH);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, widthPx, realH);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";

    const textArea = widthPx - (pad + LOGO_D + 20) - pad;

    let size = 44;
    let lines: string[] = [];
    while (size >= 22) {
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
    const textTop = Math.round((realH - blockH) / 2);
    const logoY = Math.round((realH - logoD) / 2);

    ctx.drawImage(logo, pad, logoY, logoD, logoD);
    ctx.fillStyle = "black";
    ctx.font = `${size}px ${FONT_NAME}`;
    lines.forEach((ln, i) => ctx.fillText(ln, pad + LOGO_D + 20, textTop + (i + 1) * lineHeight));

    const raw = await encodePng(PI, canvas);
    return await sharp(raw)
      .grayscale()
      .normalise()
      .threshold(150)
      .png()
      .toBuffer();
  } catch {
    return null;
  }
}

/**
 * CODE128 como bitmap (raster GS v 0): independiente del firmware de la
 * impresora. El comando por hardware (printer.code128 / GS k) depende de que
 * la térmica lo implemente y las POS-58 baratas suelen no hacerlo — salen
 * solo los números. Devuelve PNG b/n listo para printImageBuffer, o null si
 * el código no entra (→ fallback hardware/texto).
 */
async function renderCode128Image(code: string, widthPx: number): Promise<Buffer | null> {
  const widths = code128BarWidths(code);
  if (!widths) return null;
  const key = `code|${code}|${widthPx}`;
  const cached = headerImageCache.get(key);
  if (cached) return cached;
  try {
    const totalModules = widths.reduce((s, w) => s + w, 0);
    // Módulo más grande que entra dejando zona de silencio de 10 módulos por lado.
    let m = 0;
    for (const cand of [3, 2, 1]) {
      if ((totalModules + 20) * cand <= widthPx) {
        m = cand;
        break;
      }
    }
    if (m === 0) return null;
    const H = 80;
    const PI = await loadPureImage();
    const sharp = await loadSharp();
    const canvas = PI.make(widthPx, H);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, widthPx, H);
    ctx.fillStyle = "black";
    const totalPx = totalModules * m;
    let x = Math.round((widthPx - totalPx) / 2);
    let isBar = true;
    for (const w of widths) {
      if (isBar && w > 0) ctx.fillRect(x, 0, w * m, H);
      x += w * m;
      isBar = !isBar;
    }
    const raw = await encodePng(PI, canvas);
    const png = await sharp(raw).grayscale().threshold(150).png().toBuffer();
    if (headerImageCache.size >= 200) headerImageCache.clear();
    headerImageCache.set(key, png);
    return png;
  } catch {
    return null;
  }
}

/**
 * Etiqueta de góndola estilo supermercado:
 *  - Encabezado: nombre (2 líneas) a la izquierda + logo a la derecha (bitmap).
 *  - Precio grande ($X /kg si unit='kg'); promo: ANTES + precio promo + AHORRÁS.
 *  - CODE128 + código.
 * Sin pie (no es un ticket). Papel de etiquetas ≠ rollo.
 */
async function composeLabel(
  printer: any,
  vendor: PrinterVendor,
  label: LabelPrintData
): Promise<void> {
  const width = vendor.paper_size === "58mm" ? 32 : 48;
  const copies = Math.min(50, Math.max(1, Math.floor(Number(label.copies) || 1)));
  const code = String(label.code || "").trim().slice(0, 48);
  const price = Number(label.price) || 0;
  const oldPrice = Number(label.oldPrice ?? NaN);
  const hasPromo =
    Number.isFinite(oldPrice) && oldPrice > 0 && Math.round(oldPrice * 100) !== Math.round(price * 100);
  const isKg = String(label.unit || "").trim().toLowerCase() === "kg";
  const priceLabel = isKg
    ? `$${price.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/kg`
    : `$${price.toLocaleString("es-AR")}`;

  // Encabezado bitmap: nombre izquierda + logo derecha. Fallback: texto.
  let printedHeader = false;
  if (vendor.print_logo !== false && vendor.logo_url) {
    const circular = await makeCircularLogo(vendor.logo_url);
    if (circular) {
      const widthPx = width >= 48 ? 576 : 384;
      const key = `label|${vendor.id}|${vendor.logo_url}|${widthPx}|${label.name}`;
      let img = headerImageCache.get(key) || null;
      if (!img) {
        img = await renderLabelHeader(vendor, widthPx, circular, label.name);
        if (img) {
          if (headerImageCache.size >= 200) headerImageCache.clear();
          headerImageCache.set(key, img);
        }
      }
      if (img) {
        printer.alignCenter();
        await printer.printImageBuffer(img);
        printer.newLine();
        printedHeader = true;
      }
    }
  }
  if (!printedHeader) {
    const name = (String(label.name || "").trim() || "Producto").slice(0, width * 2);
    printer.alignCenter();
    printer.bold(true);
    for (let i = 0; i < name.length; i += width) {
      printer.println(name.slice(i, i + width));
    }
    printer.bold(false);
  }

  // Bloque de precios (estilo supermercado).
  printer.alignCenter();
  if (hasPromo) {
    printer.println(`ANTES: $${oldPrice.toLocaleString("es-AR")}`);
    printer.setTextSize(2, 2);
    printer.bold(true);
    printer.println(priceLabel);
    printer.setTextSize(0, 0);
    printer.bold(false);
    const saving = Math.round((oldPrice - price) * 100) / 100;
    if (saving > 0) printer.println(`AHORRAS $${saving.toLocaleString("es-AR")}`);
  } else {
    printer.setTextSize(2, 2);
    printer.bold(true);
    printer.println(priceLabel);
    printer.setTextSize(0, 0);
    printer.bold(false);
  }

  if (code) {
    // Bitmap primero (funciona en cualquier térmica); hardware y texto de reserva.
    let printedBars = false;
    try {
      const img = await renderCode128Image(code, width >= 48 ? 576 : 384);
      if (img) {
        printer.alignCenter();
        await printer.printImageBuffer(img);
        printedBars = true;
      }
    } catch {}
    if (!printedBars) {
      try {
        printer.code128(code, { width: "MEDIUM", height: 64, text: 2 });
      } catch {
        printer.println(code);
      }
    }
    printer.println(code);
  }
  printer.cut();
}

async function composeTest(printer: any, vendor: PrinterVendor): Promise<void> {
  const width = vendor.paper_size === "58mm" ? 32 : 48;

  printer.alignCenter();
  await composeStoreHeader(printer, vendor, width);
  printer.println("");
  printer.println("PRUEBA DE IMPRESIÓN");
  printer.println(separatorFor(width));
  printer.alignLeft();
  printer.println("");
  printer.println("Si podés leer esto,");
  printer.println("la impresora está funcionando correctamente.");
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
  extra?: ReceiptExtra
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
  extra?: ReceiptExtra
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

export async function printLabel(
  vendor: PrinterVendor,
  label: LabelPrintData
): Promise<{ success: boolean; error?: string }> {
  const res = await createPrinter(vendor);
  if (!res.ok) return { success: false, error: res.error };
  if (!vendor.printer_ip) return { success: false, error: "IP de impresora no configurada" };
  try {
    await composeLabel(res.printer, vendor, label);
    await res.printer.execute();
    return { success: true };
  } catch (e) {
    return { success: false, error: errorMsg(e) };
  }
}

export async function buildLabelBuffer(
  vendor: PrinterVendor,
  label: LabelPrintData
): Promise<BufferResult> {
  const res = await createPrinter(vendor);
  if (!res.ok) return { success: false, error: res.error };
  try {
    await composeLabel(res.printer, vendor, label);
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

export async function printDespacho(
  order: Order,
  vendor: PrinterVendor
): Promise<{ success: boolean; error?: string }> {
  const res = await createPrinter(vendor);
  if (!res.ok) return { success: false, error: res.error };
  if (!vendor.printer_ip) return { success: false, error: "IP de impresora no configurada" };
  try {
    await composeDespacho(res.printer, order);
    await res.printer.execute();
    return { success: true };
  } catch (e) {
    return { success: false, error: errorMsg(e) };
  }
}

export async function buildDespachoBuffer(
  vendor: PrinterVendor,
  order: Order
): Promise<BufferResult> {
  const res = await createPrinter(vendor);
  if (!res.ok) return { success: false, error: res.error };
  try {
    await composeDespacho(res.printer, order);
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
  total: number,
  cash?: { pct: number; total: number } | null,
  volume?: { amount: number } | null,
  manual?: { amount: number } | null
): Promise<{ success: boolean; error?: string }> {
  const res = await createPrinter(vendor);
  if (!res.ok) return { success: false, error: res.error };
  if (!vendor.printer_ip) return { success: false, error: "IP de impresora no configurada" };
  try {
    await composePrecuenta(res.printer, vendor, tableName, items, total, cash, volume, manual);
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
  total: number,
  cash?: { pct: number; total: number } | null,
  volume?: { amount: number } | null,
  manual?: { amount: number } | null
): Promise<BufferResult> {
  const res = await createPrinter(vendor);
  if (!res.ok) return { success: false, error: res.error };
  try {
    await composePrecuenta(res.printer, vendor, tableName, items, total, cash, volume, manual);
    const buffer = (await res.printer.getBuffer()) as Buffer;
    return { success: true, buffer };
  } catch (e) {
    return { success: false, error: errorMsg(e) };
  }
}

async function composePresupuesto(
  printer: any,
  vendor: PrinterVendor,
  quote: QuotePrintData
): Promise<void> {
  const width = vendor.paper_size === "58mm" ? 32 : 48;
  const separator = separatorFor(width);

  printer.alignCenter();
  await composeStoreHeader(printer, vendor, width);
  printer.println(quote.docTitle || "PRESUPUESTO");
  printer.println("(no es comprobante fiscal)");
  printer.println(separator);

  printer.alignLeft();
  const dateStr = formatArgDate(new Date(quote.created_at));
  printer.println(`Fecha: ${dateStr}`);
  printer.println(`Cliente: ${quote.customer_name}`);
  if (quote.customer_phone) printer.println(`Tel: ${quote.customer_phone}`);
  if (quote.service_name) printer.println(`Servicio: ${quote.service_name}`);
  printer.println(separator);
  printer.println(quote.description);
  printer.println(separator);

  for (const it of quote.items) {
    const lineTotal = Math.round(Number(it.qty) * Number(it.unit_price) * 100) / 100;
    const qtyStr = `${Number(it.qty)}x`;
    const priceStr = `$${lineTotal.toLocaleString("es-AR")}`;
    const nameStr = it.description;
    const availableForName = width - qtyStr.length - 1 - priceStr.length;
    if (nameStr.length <= availableForName) {
      printer.println(`${qtyStr} ${padRight(nameStr, availableForName)}${priceStr}`);
    } else {
      printer.println(`${qtyStr} ${nameStr.slice(0, availableForName)}`);
      printer.println(`  ${nameStr.slice(availableForName)}`);
    }
  }

  printer.println(separator);
  printer.alignRight();
  printer.bold(true);
  printer.setTextSize(1, 1);
  printer.println(`TOTAL: $${Number(quote.total).toLocaleString("es-AR")}`);
  printer.setTextSize(0, 0);
  printer.bold(false);
  printer.alignLeft();

  if (quote.deposit_amount != null && Number(quote.deposit_amount) > 0) {
    printer.println("");
    printer.bold(true);
    printer.println(`SENA (${quote.deposit_pct ?? ""}%): $${Number(quote.deposit_amount).toLocaleString("es-AR")}`);
    printer.bold(false);
  }
  if (quote.validity) {
    printer.println("");
    printer.println(`Validez: ${quote.validity}`);
  }
  printer.println("");
  printer.println("Gracias por confiar!");
  printer.println("");
  composeFooter(printer, width);
  printer.cut();
}

export async function printPresupuesto(
  vendor: PrinterVendor,
  quote: QuotePrintData
): Promise<{ success: boolean; error?: string }> {
  const res = await createPrinter(vendor);
  if (!res.ok) return { success: false, error: res.error };
  if (!vendor.printer_ip) return { success: false, error: "IP de impresora no configurada" };
  try {
    await composePresupuesto(res.printer, vendor, quote);
    await res.printer.execute();
    return { success: true };
  } catch (e) {
    return { success: false, error: errorMsg(e) };
  }
}

/** Fecha larga AR ("06/11/2026") para documentos del taller. */
function fmtOrdenDate(iso: string | null | undefined): string {
  if (!iso) return "a convenir";
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return "a convenir";
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/**
 * Comprobante de la orden de servicio para el CLIENTE (80mm):
 * encabezado con logo, N° de orden, cliente, equipo, falla declarada,
 * diagnóstico, fechas (ingreso y entrega, sin hora) y seña/precio si hay.
 */
async function composeOrden(
  printer: any,
  vendor: PrinterVendor,
  o: WorkOrderPrintData
): Promise<void> {
  const width = vendor.paper_size === "58mm" ? 32 : 48;
  const separator = separatorFor(width);

  printer.alignCenter();
  await composeStoreHeader(printer, vendor, width);
  // Título: al doble de ancho NO entra en 58mm (17 chars ×2 = 34 > 32 columnas)
  // y en 80mm "ORDEN DE SERVICIO N° X" completo rozaba las 48 columnas y se iba
  // de línea. En 58mm el título sale al DOBLE DE ALTO con ancho normal
  // (grande sin desbordar); en 80mm al doble de ambos, con el N° aparte.
  printer.bold(true);
  if (width >= 48) {
    printer.setTextSize(1, 1);
    printer.println("ORDEN DE SERVICIO");
    printer.setTextSize(0, 0);
    printer.println(`N° ${Number(o.order_no) || "—"}`);
  } else {
    printer.setTextSize(0, 1);
    printer.println("ORDEN DE SERVICIO");
    printer.setTextSize(1, 1);
    printer.println(`N° ${Number(o.order_no) || "—"}`);
    printer.setTextSize(0, 0);
  }
  printer.bold(false);
  printer.println("(no es comprobante fiscal)");
  printer.println(separator);

  printer.alignLeft();
  printer.println(`Ingreso: ${fmtOrdenDate(o.intake_date)}`);
  printer.bold(true);
  printer.println(`Entrega estimada: ${fmtOrdenDate(o.delivery_date)}`);
  printer.bold(false);
  printer.println(separator);

  printer.println(`Cliente: ${o.customer_name}`);
  if (o.customer_phone) printer.println(`Tel: ${o.customer_phone}`);
  if (o.equipment_label) {
    printer.println("");
    printer.bold(true);
    printer.println("EQUIPO");
    printer.bold(false);
    printer.println(o.equipment_label);
  }
  if (o.declared_issue) {
    printer.println("");
    printer.bold(true);
    printer.println("TRABAJO DECLARADO");
    printer.bold(false);
    printer.println(o.declared_issue);
  }
  if (o.diagnosis) {
    printer.println("");
    printer.bold(true);
    printer.println("DIAGNOSTICO");
    printer.bold(false);
    printer.println(o.diagnosis);
  }

  // Detalle de la cuenta: partidas del presupuesto vinculado a la orden
  // (repuestos, mano de obra, materiales). Sin partidas queda como siempre.
  const items = o.items || [];
  if (items.length > 0) {
    printer.println("");
    printer.bold(true);
    printer.println("DETALLE DE LA CUENTA");
    printer.bold(false);
    for (const it of items) {
      const tag = it.kind === "labor" ? "M.O.: " : it.kind === "repuesto" ? "Repuesto: " : "";
      const imp = `$${(Number(it.qty) * Number(it.unit_price)).toLocaleString("es-AR")}`;
      let desc = `${Number(it.qty)}x ${tag}${it.description || ""}`;
      const maxDesc = width - imp.length - 1;
      if (desc.length > maxDesc) desc = desc.slice(0, maxDesc);
      const pad = Math.max(1, width - imp.length - desc.length);
      printer.println(`${desc}${" ".repeat(pad)}${imp}`);
    }
    printer.println(separator);
  }
  const itemsTotal = items.length > 0
    ? items.reduce((s, it) => s + Number(it.qty) * Number(it.unit_price), 0)
    : 0;

  printer.println("");
  printer.println(separator);
  if (o.paid && (o.amount_paid ?? 0) > 0) {
    // Recibo final: la orden ya está cobrada. Sin emojis (el set PC850 de la
    // impresora térmica los imprime como "?").
    const total = itemsTotal > 0 ? itemsTotal : Number(o.price) || 0;
    if (total > 0) {
      printer.alignRight();
      printer.bold(true);
      printer.println(`TOTAL: $${total.toLocaleString("es-AR")}`);
      printer.bold(false);
      printer.alignLeft();
    }
    if (o.deposit_amount != null && Number(o.deposit_amount) > 0) {
      printer.println(
        o.deposit_paid
          ? `Seña abonada: $${Number(o.deposit_amount).toLocaleString("es-AR")}`
          : `Seña a abonar al retirar: $${Number(o.deposit_amount).toLocaleString("es-AR")}`
      );
    }
    const medio = o.payment_method ? ` · ${o.payment_method}` : "";
    printer.alignCenter();
    printer.bold(true);
    printer.println(`ABONADO $${Number(o.amount_paid).toLocaleString("es-AR")}${medio}`);
    printer.bold(false);
    printer.alignLeft();
    // Saldo (normalmente $0: el cobro cierra la cuenta). Se muestra si quedó algo.
    const saldo =
      Math.round((total - (o.deposit_paid ? Number(o.deposit_amount || 0) : 0) - Number(o.amount_paid)) * 100) / 100;
    if (saldo > 0.009) {
      printer.println(`Saldo pendiente: $${saldo.toLocaleString("es-AR")}`);
    }
  } else {
    const total = itemsTotal > 0 ? itemsTotal : Number(o.price) || 0;
    if (total > 0) {
      printer.alignRight();
      printer.bold(true);
      printer.println(`PRESUPUESTO: $${total.toLocaleString("es-AR")}`);
      printer.bold(false);
      printer.alignLeft();
    }
    if (o.deposit_amount != null && Number(o.deposit_amount) > 0) {
      printer.println(
        o.deposit_paid
          ? `Seña abonada: $${Number(o.deposit_amount).toLocaleString("es-AR")}`
          : `Seña a abonar al retirar: $${Number(o.deposit_amount).toLocaleString("es-AR")}`
      );
    }
  }
  // Entrega efectiva: el equipo ya fue retirado (orden completed).
  if (o.completed_date) {
    printer.println("");
    printer.bold(true);
    printer.println(`Equipo retirado: ${fmtOrdenDate(o.completed_date)}`);
    printer.bold(false);
  }
  printer.println("");
  // Pie: al cobrar/retirar se agradece (el cliente ya se está llevando el
  // equipo); en el comprobante de ingreso sigue el aviso de conservar.
  if (o.paid && (o.amount_paid ?? 0) > 0) {
    printer.println("Gracias por su confianza!");
  } else {
    printer.println("Conserve este comprobante para retirar su equipo.");
  }
  printer.println("Portal 659 · www.portal659.com.ar");
  printer.println("");
  printer.cut();
}

/**
 * Etiqueta para el ELEMENTO (58mm): N° de orden grande + cliente + equipo +
 * falla corta + fecha de entrega. Mínima tinta, para atar/pegar en el equipo.
 */
async function composeOrdenTag(
  printer: any,
  vendor: PrinterVendor,
  o: WorkOrderPrintData
): Promise<void> {
  const width = vendor.paper_size === "58mm" ? 32 : 48;
  const separator = separatorFor(width);

  printer.alignCenter();
  printer.bold(true);
  printer.setTextSize(2, 2);
  printer.println(`N° ${Number(o.order_no) || "—"}`);
  printer.setTextSize(0, 0);
  printer.bold(false);
  printer.println(separator);

  printer.alignLeft();
  const name = o.customer_name.length > width ? `${o.customer_name.slice(0, width - 1)}…` : o.customer_name;
  printer.println(name);
  if (o.equipment_label) {
    const eq = o.equipment_label.length > width * 2 ? `${o.equipment_label.slice(0, width * 2)}…` : o.equipment_label;
    printer.println(eq);
  }
  if (o.declared_issue) {
    printer.bold(true);
    printer.println("Falla:");
    printer.bold(false);
    printer.println(o.declared_issue);
  }
  printer.println(separator);
  printer.bold(true);
  printer.println(`Entrega: ${fmtOrdenDate(o.delivery_date)}`);
  printer.bold(false);
  if (vendor.store_name) printer.println(String(vendor.store_name));
  printer.println("");
  printer.alignCenter();
  printer.println("Portal 659");
  printer.println("");
  printer.cut();
}

export async function printOrden(
  vendor: PrinterVendor,
  o: WorkOrderPrintData
): Promise<{ success: boolean; error?: string }> {
  const res = await createPrinter(vendor);
  if (!res.ok) return { success: false, error: res.error };
  if (!vendor.printer_ip) return { success: false, error: "IP de impresora no configurada" };
  try {
    await composeOrden(res.printer, vendor, o);
    await res.printer.execute();
    return { success: true };
  } catch (e) {
    return { success: false, error: errorMsg(e) };
  }
}

export async function printOrdenTag(
  vendor: PrinterVendor,
  o: WorkOrderPrintData
): Promise<{ success: boolean; error?: string }> {
  const res = await createPrinter(vendor);
  if (!res.ok) return { success: false, error: res.error };
  if (!vendor.printer_ip) return { success: false, error: "IP de impresora no configurada" };
  try {
    await composeOrdenTag(res.printer, vendor, o);
    await res.printer.execute();
    return { success: true };
  } catch (e) {
    return { success: false, error: errorMsg(e) };
  }
}

export async function buildOrdenBuffer(
  vendor: PrinterVendor,
  o: WorkOrderPrintData
): Promise<BufferResult> {
  const res = await createPrinter(vendor);
  if (!res.ok) return { success: false, error: res.error };
  try {
    await composeOrden(res.printer, vendor, o);
    const buffer = (await res.printer.getBuffer()) as Buffer;
    return { success: true, buffer };
  } catch (e) {
    return { success: false, error: errorMsg(e) };
  }
}

export async function buildOrdenTagBuffer(
  vendor: PrinterVendor,
  o: WorkOrderPrintData
): Promise<BufferResult> {
  const res = await createPrinter(vendor);
  if (!res.ok) return { success: false, error: res.error };
  try {
    await composeOrdenTag(res.printer, vendor, o);
    const buffer = (await res.printer.getBuffer()) as Buffer;
    return { success: true, buffer };
  } catch (e) {
    return { success: false, error: errorMsg(e) };
  }
}

/**
 * Comprobante de un TURNO cobrado (80mm/58mm): recibo del servicio con el
 * detalle de la cuenta (partidas), seña, ABONADO con medio de pago y, si el
 * turno se facturó, el bloque FACTURA C (CAE + QR). Para servicios, estética
 * y taller que cobran desde la pestaña Turnos.
 */
export type TurnoPrintData = {
  booking_date: string;
  booking_time: string | null;
  customer_name: string;
  customer_phone: string | null;
  /** Servicio catálogo (o producto) asociado, si tiene. */
  service_label: string | null;
  /** "🚲 Bicicleta Scott XT · Rodado 29 · N° ABC123" (etiqueta del equipo). */
  equipment_label: string | null;
  /** Partidas de la cuenta (detalle del trabajo cobrado). */
  items: { kind?: string | null; description: string; qty: number; unit_price: number }[];
  total: number;
  deposit_amount: number | null;
  deposit_paid: boolean;
  amount_paid: number | null;
  payment_method: string | null;
  paid_at: string | null;
  /** Factura C del turno (bloque fiscal con CAE + QR). */
  fiscal?: FiscalPrintInfo | null;
};

function fmtTurnoFecha(t: TurnoPrintData): string {
  const d = String(t.booking_date || "").slice(0, 10);
  const dd = d ? `${d.slice(8, 10)}/${d.slice(5, 7)}${d.slice(0, 4) !== "0000" ? `/${d.slice(2, 4)}` : ""}` : "—";
  const hh = String(t.booking_time || "").slice(0, 5);
  return hh ? `${dd} ${hh}` : dd;
}

async function composeTurno(
  printer: any,
  vendor: PrinterVendor,
  t: TurnoPrintData
): Promise<void> {
  const width = vendor.paper_size === "58mm" ? 32 : 48;
  const separator = separatorFor(width);

  printer.alignCenter();
  await composeStoreHeader(printer, vendor, width);
  const hasFiscal = !!t.fiscal;
  printer.bold(true);
  if (width >= 48) {
    printer.setTextSize(1, 1);
    printer.println("COMPROBANTE DE SERVICIO");
    printer.setTextSize(0, 0);
  } else {
    printer.setTextSize(0, 1);
    printer.println("COMPROBANTE");
    printer.setTextSize(1, 1);
    printer.println("DE SERVICIO");
    printer.setTextSize(0, 0);
  }
  printer.bold(false);
  if (hasFiscal && t.fiscal) {
    await composeFiscalHeader(printer, width, t.fiscal);
  } else {
    printer.println("(no es comprobante fiscal)");
  }
  printer.println(separator);

  printer.alignLeft();
  printer.println(`Fecha: ${fmtTurnoFecha(t)}`);
  printer.println(`Cliente: ${t.customer_name || "Sin nombre"}`);
  if (t.customer_phone) printer.println(`Tel: ${t.customer_phone}`);
  if (t.service_label) {
    printer.println("");
    printer.bold(true);
    printer.println("SERVICIO");
    printer.bold(false);
    printer.println(t.service_label);
  }
  if (t.equipment_label) {
    printer.println("");
    printer.bold(true);
    printer.println("EQUIPO");
    printer.bold(false);
    printer.println(t.equipment_label);
  }

  // Detalle de la cuenta: partidas del trabajo cobrado.
  if (t.items.length > 0) {
    printer.println("");
    printer.bold(true);
    printer.println("DETALLE DE LA CUENTA");
    printer.bold(false);
    for (const it of t.items) {
      const tag = it.kind === "labor" ? "M.O.: " : it.kind === "repuesto" ? "Repuesto: " : "";
      const imp = `$${(Number(it.qty) * Number(it.unit_price)).toLocaleString("es-AR")}`;
      let desc = `${Number(it.qty)}x ${tag}${it.description || ""}`;
      const maxDesc = width - imp.length - 1;
      if (desc.length > maxDesc) desc = desc.slice(0, maxDesc);
      const pad = Math.max(1, width - imp.length - desc.length);
      printer.println(`${desc}${" ".repeat(pad)}${imp}`);
    }
    printer.println(separator);
  }
  const itemsTotal = t.items.length > 0
    ? t.items.reduce((s, it) => s + Number(it.qty) * Number(it.unit_price), 0)
    : 0;
  const total = itemsTotal > 0 ? itemsTotal : Number(t.total) || 0;

  printer.println("");
  printer.println(separator);
  if (total > 0) {
    printer.alignRight();
    printer.bold(true);
    printer.println(`TOTAL: $${total.toLocaleString("es-AR")}`);
    printer.bold(false);
    printer.alignLeft();
  }
  if (t.deposit_amount != null && Number(t.deposit_amount) > 0) {
    printer.println(
      t.deposit_paid
        ? `Seña abonada: $${Number(t.deposit_amount).toLocaleString("es-AR")}`
        : `Seña a abonar: $${Number(t.deposit_amount).toLocaleString("es-AR")}`
    );
  }
  const medio = t.payment_method ? ` · ${t.payment_method}` : "";
  printer.alignCenter();
  printer.bold(true);
  printer.println(`ABONADO $${Number(t.amount_paid || 0).toLocaleString("es-AR")}${medio}`);
  printer.bold(false);
  printer.alignLeft();
  const saldo = Math.round((total - (t.deposit_paid ? Number(t.deposit_amount || 0) : 0) - Number(t.amount_paid || 0)) * 100) / 100;
  if (saldo > 0.009) {
    printer.println(`Saldo pendiente: $${saldo.toLocaleString("es-AR")}`);
  }
  if (hasFiscal && t.fiscal) {
    await composeFiscalBlock(printer, width, t.fiscal);
  }
  printer.println("");
  printer.println("Gracias por su confianza!");
  printer.println("Portal 659 · www.portal659.com.ar");
  printer.println("");
  printer.cut();
}

export async function printTurno(
  vendor: PrinterVendor,
  t: TurnoPrintData
): Promise<{ success: boolean; error?: string }> {
  const res = await createPrinter(vendor);
  if (!res.ok) return { success: false, error: res.error };
  if (!vendor.printer_ip) return { success: false, error: "IP de impresora no configurada" };
  try {
    await composeTurno(res.printer, vendor, t);
    await res.printer.execute();
    return { success: true };
  } catch (e) {
    return { success: false, error: errorMsg(e) };
  }
}

export async function buildTurnoBuffer(
  vendor: PrinterVendor,
  t: TurnoPrintData
): Promise<BufferResult> {
  const res = await createPrinter(vendor);
  if (!res.ok) return { success: false, error: res.error };
  try {
    await composeTurno(res.printer, vendor, t);
    const buffer = (await res.printer.getBuffer()) as Buffer;
    return { success: true, buffer };
  } catch (e) {
    return { success: false, error: errorMsg(e) };
  }
}

export async function buildPresupuestoBuffer(
  vendor: PrinterVendor,
  quote: QuotePrintData
): Promise<BufferResult> {
  const res = await createPrinter(vendor);
  if (!res.ok) return { success: false, error: res.error };
  try {
    await composePresupuesto(res.printer, vendor, quote);
    const buffer = (await res.printer.getBuffer()) as Buffer;
    return { success: true, buffer };
  } catch (e) {
    return { success: false, error: errorMsg(e) };
  }
}

/**
 * Oblea de envío extendido (Portal 659 Envíos) en térmica (contingencia de la
 * oblea A4): código grande + QR al tracking + destino + zona. Copia logística
 * opcional (copies=2, separada por corte).
 */
async function composeShipmentLabel(
  printer: any,
  label: ShipmentLabelData
): Promise<void> {
  const copies = Math.min(5, Math.max(1, Math.floor(Number(label.copies) || 1)));

  for (let c = 0; c < copies; c++) {
    if (c > 0) {
      printer.cut();
      printer.newLine();
    }

    printer.alignCenter();
    printer.bold(true);
    printlnWrapped(printer, "PORTAL 659 ENVÍOS", 48);
    printer.bold(false);

    printer.setTextSize(2, 2);
    printer.bold(true);
    printer.println(String(label.code || "").toUpperCase().slice(0, 24));
    printer.setTextSize(0, 0);
    printer.bold(false);

    printer.println("Zona: " + (label.zone_name || "Zona extendida"));
    printlnWrapped(printer, "Para: " + (label.customer_name || "Consumidor final") + (label.customer_phone ? " · " + label.customer_phone : ""), 48);
    if (label.customer_address) {
      printlnWrapped(printer, "Dirección: " + label.customer_address, 48);
    }
    if (label.store_name) {
      printlnWrapped(printer, "Retira: " + label.store_name, 48);
    }

    printer.newLine();
    const qr = await renderQrImage(label.trackUrl, 320);
    if (qr) {
      await printer.printImageBuffer(qr);
      printer.newLine();
    }
    printlnWrapped(printer, "Seguimiento: " + label.trackUrl, 48);
    if (c === 1) {
      printer.alignCenter();
      printer.bold(true);
      printer.println("--- COPIA LOGISTICA ---");
      printer.bold(false);
    }
  }
  printer.cut();
}

function printlnWrapped(printer: any, text: string, width: number): void {
  const t = String(text || "");
  for (let i = 0; i < t.length; i += width) {
    printer.println(t.slice(i, i + width));
  }
}

export async function printShipmentLabel(
  vendor: PrinterVendor,
  label: ShipmentLabelData
): Promise<{ success: boolean; error?: string }> {
  const res = await createPrinter(vendor);
  if (!res.ok) return { success: false, error: res.error };
  if (!vendor.printer_ip) return { success: false, error: "IP de impresora no configurada" };
  try {
    await composeShipmentLabel(res.printer, label);
    await res.printer.execute();
    return { success: true };
  } catch (e) {
    return { success: false, error: errorMsg(e) };
  }
}

export async function buildShipmentLabelBuffer(
  vendor: PrinterVendor,
  label: ShipmentLabelData
): Promise<BufferResult> {
  const res = await createPrinter(vendor);
  if (!res.ok) return { success: false, error: res.error };
  try {
    await composeShipmentLabel(res.printer, label);
    const buffer = (await res.printer.getBuffer()) as Buffer;
    return { success: true, buffer };
  } catch (e) {
    return { success: false, error: errorMsg(e) };
  }
}

export async function printCashClose(
  vendor: PrinterVendor,
  closing: CashClosingPrintData
): Promise<{ success: boolean; error?: string }> {
  const res = await createPrinter(vendor);
  if (!res.ok) return { success: false, error: res.error };
  if (!vendor.printer_ip) return { success: false, error: "IP de impresora no configurada" };
  try {
    await composeCashClose(res.printer, vendor, closing);
    await res.printer.execute();
    return { success: true };
  } catch (e) {
    return { success: false, error: errorMsg(e) };
  }
}

export async function buildCashCloseBuffer(
  vendor: PrinterVendor,
  closing: CashClosingPrintData
): Promise<BufferResult> {
  const res = await createPrinter(vendor);
  if (!res.ok) return { success: false, error: res.error };
  try {
    await composeCashClose(res.printer, vendor, closing);
    const buffer = (await res.printer.getBuffer()) as Buffer;
    return { success: true, buffer };
  } catch (e) {
    return { success: false, error: errorMsg(e) };
  }
}

export async function printCashSnapshot(
  vendor: PrinterVendor,
  snap: CashSnapshotData
): Promise<{ success: boolean; error?: string }> {
  const res = await createPrinter(vendor);
  if (!res.ok) return { success: false, error: res.error };
  if (!vendor.printer_ip) return { success: false, error: "IP de impresora no configurada" };
  try {
    await composeCashSnapshot(res.printer, vendor, snap);
    await res.printer.execute();
    return { success: true };
  } catch (e) {
    return { success: false, error: errorMsg(e) };
  }
}

export async function buildCashSnapshotBuffer(
  vendor: PrinterVendor,
  snap: CashSnapshotData
): Promise<BufferResult> {
  const res = await createPrinter(vendor);
  if (!res.ok) return { success: false, error: res.error };
  try {
    await composeCashSnapshot(res.printer, vendor, snap);
    const buffer = (await res.printer.getBuffer()) as Buffer;
    return { success: true, buffer };
  } catch (e) {
    return { success: false, error: errorMsg(e) };
  }
}

export type BridgeJob = {
  type: string;
  payload: string;
  printerIp: string | null;
  printerPort: number;
  width: number;
  /** Tercer modo: 'usb' = el agente imprime en la cola USB local (spooler RAW). */
  backend?: "tcp" | "usb";
  /** Cola USB por trabajo (impresora de etiquetas ≠ impresora de tickets). */
  printerUsbName?: string | null;
};

function bridgeJob(
  type: string,
  buffer: Buffer,
  vendor: PrinterVendor,
  overrides?: { backend?: "tcp" | "usb"; printerUsbName?: string | null }
): BridgeJob {
  const usb = overrides?.backend
    ? overrides.backend === "usb"
    : (vendor as { print_mode?: string | null }).print_mode === "usb";
  return {
    type,
    payload: buffer.toString("base64"),
    printerIp: vendor.printer_ip,
    printerPort: vendor.printer_port || 9100,
    width: vendor.paper_size === "58mm" ? 32 : 48,
    ...(usb ? { backend: "usb" as const } : {}),
    ...(overrides?.printerUsbName ? { printerUsbName: overrides.printerUsbName } : {}),
  };
}

/**
 * Etiqueta adhesiva para la impresora de etiquetas (USB, por el agente).
 * NO depende del modo de la impresora de tickets: siempre sale por el
 * backend USB con la cola que configuró el comercio para etiquetas.
 */
export async function dispatchSticker(params: {
  vendor: PrinterVendor & { print_token?: string | null };
  png: Buffer;
  widthMm: number;
  heightMm: number;
  copies: number;
  language: "tspl" | "zpl" | "escpos";
  usbName?: string | null;
}): Promise<DispatchResult> {
  const mode = "usb" as const;
  if (!params.vendor.print_token) {
    return {
      ok: false,
      mode,
      error:
        "Falta el token del puente de impresión. El agente es el mismo para la impresora de tickets y la de etiquetas: " +
        "configurá la sección Impresora (Configuración → Impresora) y volvé a probar.",
    };
  }
  const usbName = String(params.usbName ?? "").trim();
  if (!usbName) {
    return {
      ok: false,
      mode,
      error:
        "Falta la cola USB de la impresora de etiquetas. Elegila en Configuración → Balanza → Impresora de etiquetas " +
        "(el agente de este equipo expone la lista de colas con el botón “Buscar colas”).",
    };
  }
  const built = await buildStickerBuffer({
    png: params.png,
    widthMm: params.widthMm,
    heightMm: params.heightMm,
    copies: params.copies,
    language: params.language,
  });
  if (!built.ok) return { ok: false, mode, error: built.error };
  const pushed = await pushToBridge(
    params.vendor.print_token,
    bridgeJob("sticker", built.buffer, params.vendor, { backend: "usb", printerUsbName: usbName })
  );
  return {
    ok: pushed.ok,
    mode,
    offline: pushed.offline,
    error: pushed.error,
    usbUsed: pushed.usbUsed ?? usbName,
  };
}

async function pushToBridge(
  token: string | null | undefined,
  job: BridgeJob
): Promise<{ ok: boolean; offline?: boolean; error?: string; printerIpUsed?: string | null; autoFixed?: boolean; usbUsed?: string | null }> {
  if (!token) {
    return { ok: false, error: "Falta el token del puente (regeneralo en la sección Impresora)" };
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
    | { ok?: boolean; offline?: boolean; error?: string; printerIpUsed?: string; autoFixed?: boolean; usbUsed?: string }
    | null;
  if (!data) {
    return { ok: false, error: `El relay respondió ${res.status}` };
  }
  return {
    ok: data.ok === true,
    offline: data.offline === true,
    error: data.error,
    printerIpUsed: typeof data.printerIpUsed === "string" ? data.printerIpUsed : null,
    autoFixed: data.autoFixed === true,
    usbUsed: typeof data.usbUsed === "string" ? data.usbUsed : null,
  };
}

export async function dispatchPrint(params: {
  vendor: PrinterVendor;
  order?: Order;
  type: PrintJobType;
  extra?: {
    tableName?: string;
    subLabel?: string;
    /** Título del ticket retail (ej. "COMPROBANTE"). */
    docTitle?: string;
    /** Comprobante de venta retail: Nro. diario + datos del cliente. */
    retail?: boolean;
    /** Venta directa: ticket completo con "Mostrador · Nro. X" normal. */
    direct?: boolean;
    /** Saldo de cuenta corriente (fiado) para imprimir en el ticket. */
    fiadoBalance?: number;
    items?: { name: string; price: number; qty: number; modifiers?: string[] }[];
    total?: number;
    /** Info de efectivo en precuenta: % y total a abonar en efectivo. */
    cashPct?: number;
    cashTotal?: number;
    /** Descuento por pack en precuenta (se imprime como línea propia). */
    volumeDiscount?: number;
    /** Descuento manual en precuenta (se imprime como línea propia). */
    manualDiscount?: number;
    /** Cierre de caja (Z) guardado, para imprimir tal cual. */
    closing?: CashClosingPrintData;
    /** Vista parcial de caja (X): snapshot en vivo, sin cerrar. */
    snapshot?: CashSnapshotData;
    /** Presupuesto de oficio (servicios): cliente + partidas + total + seña. */
    quote?: QuotePrintData;
    /** Etiqueta de góndola (nombre + precio + CODE128). */
    label?: LabelPrintData;
    /** Oblea de envío extendido (Portal 659 Envíos): código + QR + destino. */
    shipmentLabel?: ShipmentLabelData;
    /** Orden de servicio (taller): comprobante del cliente / etiqueta del equipo. */
    workOrder?: WorkOrderPrintData;
    /** Comprobante de un turno cobrado (servicio/estética/taller). */
    turno?: TurnoPrintData;
    /** Factura electrónica ARCA (bloque fiscal con CAE + QR en ticket). */
    fiscal?: FiscalPrintInfo | null;
  };
}): Promise<DispatchResult> {
  const { vendor } = params;
  const mode: "server" | "app" | "usb" =
    vendor.print_mode === "app" ? "app" : vendor.print_mode === "usb" ? "usb" : "server";

  if (params.type === "test") {
    if (mode === "app" || mode === "usb") {
      const built = await buildTestBuffer(vendor);
      if (!built.success) return { ok: false, mode, error: built.error };
      const pushed = await pushToBridge(vendor.print_token, bridgeJob("test", built.buffer, vendor));
      return { ok: pushed.ok, mode, offline: pushed.offline, error: pushed.error, printerIpUsed: pushed.printerIpUsed ?? null, autoFixed: pushed.autoFixed === true };
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
    const cashPct = Number(params.extra?.cashPct) || 0;
    const cashTotal = Number(params.extra?.cashTotal) || 0;
    const cash = cashPct > 0 && cashTotal > 0 && cashTotal < total ? { pct: cashPct, total: cashTotal } : null;
    const volumeAmount = Number(params.extra?.volumeDiscount) || 0;
    const volume = volumeAmount > 0 ? { amount: volumeAmount } : null;
    const manualAmount = Number(params.extra?.manualDiscount) || 0;
    const manual = manualAmount > 0 ? { amount: manualAmount } : null;
    if (mode === "app" || mode === "usb") {
      const built = await buildPrecuentaBuffer(vendor, tableName, items, total, cash, volume, manual);
      if (!built.success) return { ok: false, mode, error: built.error };
      const pushed = await pushToBridge(vendor.print_token, bridgeJob("precuenta", built.buffer, vendor));
      return { ok: pushed.ok, mode, offline: pushed.offline, error: pushed.error };
    }
    if (!vendor.printer_ip) return { ok: true, mode, skipped: true };
    const r = await printPrecuenta(vendor, tableName, items, total, cash, volume, manual);
    return { ok: r.success, mode, error: r.error };
  }

  // Cierre de caja (Z): no es un pedido; imprime el cierre guardado.
  if (params.type === "cash_close") {
    const closing = params.extra?.closing;
    if (!closing) return { ok: false, mode, error: "Cierre requerido" };
    if (mode === "app" || mode === "usb") {
      const built = await buildCashCloseBuffer(vendor, closing);
      if (!built.success) return { ok: false, mode, error: built.error };
      const pushed = await pushToBridge(vendor.print_token, bridgeJob("cash_close", built.buffer, vendor));
      return { ok: pushed.ok, mode, offline: pushed.offline, error: pushed.error, printerIpUsed: pushed.printerIpUsed ?? null, autoFixed: pushed.autoFixed === true };
    }
    if (!vendor.printer_ip) return { ok: true, mode, skipped: true };
    const r = await printCashClose(vendor, closing);
    return { ok: r.success, mode, error: r.error };
  }

  // Vista parcial de caja (X): foto del turno en curso, sin cerrar.
  if (params.type === "cash_snapshot") {
    const snapshot = params.extra?.snapshot;
    if (!snapshot) return { ok: false, mode, error: "Snapshot requerido" };
    if (mode === "app" || mode === "usb") {
      const built = await buildCashSnapshotBuffer(vendor, snapshot);
      if (!built.success) return { ok: false, mode, error: built.error };
      const pushed = await pushToBridge(vendor.print_token, bridgeJob("cash_snapshot", built.buffer, vendor));
      return { ok: pushed.ok, mode, offline: pushed.offline, error: pushed.error, printerIpUsed: pushed.printerIpUsed ?? null, autoFixed: pushed.autoFixed === true };
    }
    if (!vendor.printer_ip) return { ok: true, mode, skipped: true };
    const r = await printCashSnapshot(vendor, snapshot);
    return { ok: r.success, mode, error: r.error };
  }

  // Etiqueta de góndola: no es un pedido; nombre + precio + CODE128.
  if (params.type === "label") {
    const label = params.extra?.label;
    if (!label || !label.code) return { ok: false, mode, error: "Etiqueta sin código" };
    if (mode === "app" || mode === "usb") {
      const built = await buildLabelBuffer(vendor, label);
      if (!built.success) return { ok: false, mode, error: built.error };
      const pushed = await pushToBridge(vendor.print_token, bridgeJob("label", built.buffer, vendor));
      return { ok: pushed.ok, mode, offline: pushed.offline, error: pushed.error, printerIpUsed: pushed.printerIpUsed ?? null, autoFixed: pushed.autoFixed === true };
    }
    if (!vendor.printer_ip) return { ok: true, mode, skipped: true };
    const r = await printLabel(vendor, label);
    return { ok: r.success, mode, error: r.error };
  }

  // Oblea de envío extendido: no es un pedido; imprime el Código + QR + destino.
  if (params.type === "shipment_label") {
    const label = params.extra?.shipmentLabel;
    if (!label || !label.code || !label.trackUrl) return { ok: false, mode, error: "Oblea sin código ni tracking" };
    if (mode === "app" || mode === "usb") {
      const built = await buildShipmentLabelBuffer(vendor, label);
      if (!built.success) return { ok: false, mode, error: built.error };
      const pushed = await pushToBridge(vendor.print_token, bridgeJob("shipment_label", built.buffer, vendor));
      return { ok: pushed.ok, mode, offline: pushed.offline, error: pushed.error, printerIpUsed: pushed.printerIpUsed ?? null, autoFixed: pushed.autoFixed === true };
    }
    if (!vendor.printer_ip) return { ok: true, mode, skipped: true };
    const r = await printShipmentLabel(vendor, label);
    return { ok: r.success, mode, error: r.error };
  }

  // Órdenes de servicio (taller): comprobante del cliente y etiqueta del
  // equipo. No son pedidos: igual que el presupuesto, imprime datos propios.
  if (params.type === "orden" || params.type === "orden_tag") {
    const o = params.extra?.workOrder;
    if (!o) return { ok: false, mode, error: "Orden requerida" };
    if (mode === "app" || mode === "usb") {
      const built = params.type === "orden" ? await buildOrdenBuffer(vendor, o) : await buildOrdenTagBuffer(vendor, o);
      if (!built.success) return { ok: false, mode, error: built.error };
      const pushed = await pushToBridge(vendor.print_token, bridgeJob(params.type, built.buffer, vendor));
      return { ok: pushed.ok, mode, offline: pushed.offline, error: pushed.error, printerIpUsed: pushed.printerIpUsed ?? null, autoFixed: pushed.autoFixed === true };
    }
    if (!vendor.printer_ip) return { ok: true, mode, skipped: true };
    const r = params.type === "orden" ? await printOrden(vendor, o) : await printOrdenTag(vendor, o);
    return { ok: r.success, mode, error: r.error };
  }

  // Turno cobrado (servicio/estética/taller): comprobante con el detalle de
  // la cuenta + bloque fiscal si el turno tiene Factura C. No es un pedido.
  if (params.type === "turno") {
    const t = params.extra?.turno;
    if (!t) return { ok: false, mode, error: "Turno requerido" };
    if (mode === "app" || mode === "usb") {
      const built = await buildTurnoBuffer(vendor, t);
      if (!built.success) return { ok: false, mode, error: built.error };
      const pushed = await pushToBridge(vendor.print_token, bridgeJob("turno", built.buffer, vendor));
      return { ok: pushed.ok, mode, offline: pushed.offline, error: pushed.error, printerIpUsed: pushed.printerIpUsed ?? null, autoFixed: pushed.autoFixed === true };
    }
    if (!vendor.printer_ip) return { ok: true, mode, skipped: true };
    const r = await printTurno(vendor, t);
    return { ok: r.success, mode, error: r.error };
  }

  // Presupuesto de oficio: no es un pedido; imprime el cotizado guardado.
  if (params.type === "presupuesto") {    const quote = params.extra?.quote;
    if (!quote) return { ok: false, mode, error: "Presupuesto requerido" };
    if (mode === "app" || mode === "usb") {
      const built = await buildPresupuestoBuffer(vendor, quote);
      if (!built.success) return { ok: false, mode, error: built.error };
      const pushed = await pushToBridge(vendor.print_token, bridgeJob("presupuesto", built.buffer, vendor));
      return { ok: pushed.ok, mode, offline: pushed.offline, error: pushed.error, printerIpUsed: pushed.printerIpUsed ?? null, autoFixed: pushed.autoFixed === true };
    }
    if (!vendor.printer_ip) return { ok: true, mode, skipped: true };
    const r = await printPresupuesto(vendor, quote);
    return { ok: r.success, mode, error: r.error };
  }

  if (!params.order) return { ok: false, mode, error: "orderId requerido" };
  const order = params.order;

  if (mode === "app" || mode === "usb") {
    let built: BufferResult;
    if (params.type === "ticket") built = await buildReceiptBuffer(vendor, order, params.extra);
    else if (params.type === "retiro") built = await buildRetiroReceiptBuffer(vendor, order);
    else if (params.type === "despacho") built = await buildDespachoBuffer(vendor, order);
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
  else if (params.type === "despacho") r = await printDespacho(order, vendor);
  else r = await printComanda(order, vendor);
  return { ok: r.success, mode, error: r.error };
}