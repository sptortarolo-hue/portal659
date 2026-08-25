import type { Order, OrderItem } from "@/types/database";

let ThermalPrinter: any = null;
let PrinterTypes: any = null;

async function loadModule() {
  if (!ThermalPrinter) {
    const mod = await import("node-thermal-printer");
    ThermalPrinter = mod.ThermalPrinter || mod.default?.ThermalPrinter;
    PrinterTypes = mod.PrinterTypes || mod.default?.PrinterTypes;
  }
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

export async function printComanda(
  order: Order,
  vendor: { store_name: string; printer_ip: string | null; printer_port: number | null; paper_size: string | null }
): Promise<{ success: boolean; error?: string }> {
  await loadModule();

  if (!ThermalPrinter || !PrinterTypes) {
    return { success: false, error: "Módulo de impresión no disponible" };
  }

  if (!vendor.printer_ip) {
    return { success: false, error: "IP de impresora no configurada" };
  }

  const width = vendor.paper_size === "58mm" ? 32 : 48;
  const port = vendor.printer_port || 9100;
  const interfaceStr = `tcp://${vendor.printer_ip}:${port}`;

  try {
    const printer = new ThermalPrinter({
      type: PrinterTypes.EPSON,
      interface: interfaceStr,
      width,
      options: { timeout: 5000 },
    });

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
    printer.println("========================================");

    printer.alignLeft();
    printer.bold(true);
    printer.println(`Pedido #${order.id.slice(0, 8)}`);
    printer.bold(false);
    printer.println(`${dateStr} ${timeStr}`);
    printer.println("----------------------------------------");

    const methodStr = order.method === "delivery" ? "🛵 Delivery" : "🏪 Retiro en local";
    const paymentStr =
      order.payment_method === "efectivo" ? "💵 Efectivo" :
      order.payment_method === "transferencia" ? "🏦 Transferencia" :
      "📱 Coordinar";
    printer.println(`${methodStr}  |  ${paymentStr}`);
    printer.println("----------------------------------------");

    const separator = width >= 48 ? "========================================" : "================================";
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
    printer.println("========================================");
    printer.cut();

    await printer.execute();
    return { success: true };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Error desconocido";
    return { success: false, error: msg };
  }
}

export async function printTest(
  vendor: { store_name: string; printer_ip: string | null; printer_port: number | null; paper_size: string | null }
): Promise<{ success: boolean; error?: string }> {
  await loadModule();

  if (!ThermalPrinter || !PrinterTypes) {
    return { success: false, error: "Módulo de impresión no disponible" };
  }

  if (!vendor.printer_ip) {
    return { success: false, error: "IP de impresora no configurada" };
  }

  const width = vendor.paper_size === "58mm" ? 32 : 48;
  const port = vendor.printer_port || 9100;

  try {
    const printer = new ThermalPrinter({
      type: PrinterTypes.EPSON,
      interface: `tcp://${vendor.printer_ip}:${port}`,
      width,
      options: { timeout: 5000 },
    });

    printer.alignCenter();
    printer.bold(true);
    printer.setTextSize(1, 1);
    printer.println(vendor.store_name);
    printer.setTextSize(0, 0);
    printer.bold(false);
    printer.println("");
    printer.println("PRUEBA DE IMPRESION");
    printer.println("========================================");
    printer.alignLeft();
    printer.println("");
    printer.println("Si puedes leer esto,");
    printer.println("la impresora esta funcionando correctamente.");
    printer.println("");
    printer.println(`Ancho: ${vendor.paper_size || "80mm"}`);
    printer.println(`Puerto: ${port}`);
    printer.println("");
    printer.alignCenter();
    printer.println("========================================");
    printer.cut();

    await printer.execute();
    return { success: true };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Error desconocido";
    return { success: false, error: msg };
  }
}
