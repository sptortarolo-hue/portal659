import { queryOne } from "@/lib/db";
import { getVendorByRequest } from "@/lib/vendor-utils";
import { NextResponse } from "next/server";
import { printComanda, printReceipt, printTest } from "@/lib/thermal-printer";
import type { Order } from "@/types/database";

export async function POST(request: Request) {
  const { userId } = await getVendorByRequest(request);
  if (!userId) {
    return NextResponse.json({ ok: false, error: "No autenticado" }, { status: 401 });
  }

  const body = await request.json();
  const { orderId, test, type, tableName, subLabel } = body;

  const vendor = await queryOne<{
    id: string;
    store_name: string;
    printer_ip: string | null;
    printer_port: number | null;
    paper_size: string | null;
    auto_print: boolean | null;
  }>(
    `SELECT id, store_name, printer_ip, printer_port, paper_size, auto_print FROM vendors WHERE user_id = $1 LIMIT 1`,
    [userId]
  );

  if (!vendor) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 403 });
  }

  if (!vendor.printer_ip) {
    return NextResponse.json({ ok: true, skipped: true, reason: "Impresora no configurada" });
  }

  if (test) {
    const result = await printTest(vendor);
    return NextResponse.json(result);
  }

  if (!orderId) {
    return NextResponse.json({ ok: false, error: "orderId requerido" }, { status: 400 });
  }

  const order = await queryOne<Order>(
    `SELECT * FROM orders WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
    [orderId, vendor.id]
  );

  if (!order) {
    return NextResponse.json({ ok: false, error: "Pedido no encontrado" }, { status: 404 });
  }

  if (type === "ticket") {
    const result = await printReceipt(order, vendor, { tableName, subLabel });
    return NextResponse.json(result);
  }

  const result = await printComanda(order, vendor);
  return NextResponse.json(result);
}