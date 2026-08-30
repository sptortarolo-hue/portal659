import type { Order, OrderItem } from "@/types/database";

let ThermalPrinter: any = null;
let PrinterTypes: any = null;

export type PrinterVendor = {
  id: string;
  store_name: string | null;
  printer_ip: string | null;
  printer_port: number | null;
  paper_size: string | null;
  print_mode?: string | null;
  print_token?: string | null;
};

export type PrintJobType = "ticket" | "comanda" | "retiro" | "test";

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
    return { ok: true, printer };
  } catch (e) {
    return { ok: false, error: errorMsg(e) };
  }
}

function separatorFor(width: number): string {
  return width >= 48 ? "========================================" : "================================";
}

function composeComanda(printer: any, vendor: PrinterVendor, order: Order): void {
  const width = vendor.paper_size === "58mm" ? 32 : 48;

  const now = new Date();
  const dateStr = now.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
  const timeStr = now.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });

  printer.alignCenter();
  printer.bold(true);
  printer.setTextSize(1, 1);
  printer.println(vendor.store_name);
  printer.setTextSize(0, 0);
  printer.bold(false);
  printer.println("COMANDA");
  printer.println(separatorFor(width));

  printer.alignLeft();
  printer.bold(true);
  printer.println(`Pedido #${order.id.slice(0, 8)}`);
  printer.bold(false);
  if (order.pickup_number != null) {
    printer.setTextSize(1, 1);
    printer.bold(true);
    printer.println(`RETIRO Nro. ${order.pickup_number}`);
    printer.bold(false);
    printer.setTextSize(0, 0);
  }
  printer.println(`${dateStr} ${timeStr}`);
  printer.println("----------------------------------------");

  const methodStr = order.method === "delivery" ? "🛵 Delivery" : "🏪 Retiro en local";
  const paymentStr =
    order.payment_method === "efectivo" ? "💵 Efectivo" :
    order.payment_method === "transferencia" ? "🏦 Transferencia" :
    "📱 Coordinar";
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
  printer.alignCenter();
  printer.println(separator);
  printer.cut();
}

function composeReceipt(
  printer: any,
  vendor: PrinterVendor,
  order: Order,
  extra?: { tableName?: string; subLabel?: string }
): void {
  const width = vendor.paper_size === "58mm" ? 32 : 48;
  const separator = separatorFor(width);

  const now = new Date();
  const dateStr = now.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
  const timeStr = now.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });

  printer.alignCenter();
  printer.bold(true);
  printer.setTextSize(1, 1);
  printer.println(vendor.store_name);
  printer.setTextSize(0, 0);
  printer.bold(false);
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
  printer.println(`Pago: ${paymentStr} — ${paidStr}`);
  printer.bold(false);

  if (order.customer_name && order.channel !== "app") {
    printer.println(`Cliente: ${order.customer_name}`);
  }

  printer.println("");
  printer.alignCenter();
  printer.println(separator);
  printer.cut();
}

function composeRetiroReceipt(printer: any, vendor: PrinterVendor, order: Order): void {
  const width = vendor.paper_size === "58mm" ? 32 : 48;

  printer.alignCenter();
  printer.bold(true);
  printer.setTextSize(1, 1);
  printer.println(vendor.store_name || "");
  printer.setTextSize(0, 0);
  printer.println("RETIRO");
  printer.bold(true);
  printer.setTextSize(2, 2);
  printer.println(`Nro. ${order.pickup_number ?? "--"}`);
  printer.setTextSize(1, 1);
  printer.bold(false);
  printer.println(separatorFor(width));

  printer.println("Retira tu pedido en el mostrador");
  printer.println("con tu numero de retiro.");
  printer.println("");

  printer.println(separatorFor(width));
  printer.println("www.portal659.com.ar");
  printer.println("El centro comercial de tu barrio");
  printer.println("");
  printer.println(separatorFor(width));
  printer.cut();
}

function composeTest(printer: any, vendor: PrinterVendor): void {
  const width = vendor.paper_size === "58mm" ? 32 : 48;

  printer.alignCenter();
  printer.bold(true);
  printer.setTextSize(1, 1);
  printer.println(vendor.store_name);
  printer.setTextSize(0, 0);
  printer.bold(false);
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
  printer.alignCenter();
  printer.println(separatorFor(width));
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
    composeComanda(res.printer, vendor, order);
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
    composeReceipt(res.printer, vendor, order, extra);
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
    composeTest(res.printer, vendor);
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
    composeComanda(res.printer, vendor, order);
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
    composeReceipt(res.printer, vendor, order, extra);
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
    composeTest(res.printer, vendor);
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
    composeRetiroReceipt(res.printer, vendor, order);
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
    composeRetiroReceipt(res.printer, vendor, order);
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
    | { ok?: boolean; offline?: boolean; error?: string }
    | null;
  if (!data) {
    return { ok: false, error: `El relay respondió ${res.status}` };
  }
  return { ok: data.ok === true, offline: data.offline === true, error: data.error };
}

export async function dispatchPrint(params: {
  vendor: PrinterVendor;
  order?: Order;
  type: PrintJobType;
  extra?: { tableName?: string; subLabel?: string };
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