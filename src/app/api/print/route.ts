import { getAuthSupabase } from "@/lib/auth-utils";
import { NextResponse } from "next/server";
import { printComanda, printReceipt, printTest } from "@/lib/thermal-printer";
import type { Order } from "@/types/database";

export async function POST(request: Request) {
  const supabase = getAuthSupabase(request);
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Error de conexión" }, { status: 503 });
  }

  const { data: user } = await supabase.auth.getUser();
  if (!user?.user) {
    return NextResponse.json({ ok: false, error: "No autenticado" }, { status: 401 });
  }

  const body = await request.json();
  const { orderId, test, type, tableName, subLabel } = body;

  const { data: vendor } = await supabase
    .from("vendors")
    .select("id, store_name, printer_ip, printer_port, paper_size, auto_print")
    .eq("user_id", user.user.id)
    .maybeSingle();

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

  const { data: orderRows } = await supabase
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .eq("vendor_id", vendor.id);

  if (!orderRows || orderRows.length === 0) {
    return NextResponse.json({ ok: false, error: "Pedido no encontrado" }, { status: 404 });
  }

  const order = orderRows[0] as Order;

  if (type === "ticket") {
    const result = await printReceipt(order, vendor, { tableName, subLabel });
    return NextResponse.json(result);
  }

  const result = await printComanda(order, vendor);
  return NextResponse.json(result);
}
