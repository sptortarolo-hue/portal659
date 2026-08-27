import { getServiceClient } from "@/lib/supabase";
import { NextResponse } from "next/server";
import { withRateLimit } from "@/lib/api-wrapper";
import { sendEmail, orderConfirmationEmail } from "@/lib/email";
import { resolveVendorPlan } from "@/lib/plans";

export const POST = withRateLimit(async (request: Request) => {
  const supabase = getServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "Error de conexión" }, { status: 503 });
  }

  const body = await request.json();
  const {
    vendorId,
    customerName,
    customerPhone,
    customerAddress,
    method,
    paymentMethod,
    customerId,
    items,
    total,
    notes,
  } = body;

  if (!vendorId || !customerName || !customerPhone || !items || !total) {
    return NextResponse.json(
      { error: "Faltan datos requeridos" },
      { status: 400 }
    );
  }

  // Gating: el carrito/checkout requiere un plan con la feature cart activa
  const { data: vendorRow } = await supabase
    .from("vendors")
    .select("vertical, plan_id, plan_status, plan_expires_at, trial_ends_at")
    .eq("id", vendorId)
    .single();

  if (vendorRow) {
    const { data: planRows } = await supabase.from("plans").select("*");
    const plan = resolveVendorPlan(vendorRow, planRows || []);
    if (!plan.can("cart")) {
      return NextResponse.json(
        { error: "Este comercio no acepta pedidos online por ahora. Consultalo directamente por WhatsApp." },
        { status: 403 }
      );
    }
  }

  const { data, error } = await supabase.from("orders").insert({
    vendor_id: vendorId,
    customer_id: customerId || null,
    customer_name: customerName,
    customer_phone: customerPhone,
    customer_address: customerAddress || null,
    method: method === "pickup" ? "pickup" : "delivery",
    payment_method: paymentMethod || "whatsapp",
    items,
    total,
    status: "new",
    notes: notes || null,
  }).select("id").single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { data: vendor } = await supabase
    .from("vendors")
    .select("user_id, store_name")
    .eq("id", vendorId)
    .single();

  if (vendor?.user_id) {
    const itemCount = items.reduce((s: number, i: any) => s + i.qty, 0);
    const paymentLabel = paymentMethod === "efectivo" ? "💵 Efectivo" : paymentMethod === "transferencia" ? "🏦 Transferencia" : "📱 Coordinar";
    await supabase.from("notifications").insert({
      user_id: vendor.user_id,
      title: "Nuevo pedido recibido",
      body: `${customerName} hizo un pedido de ${itemCount} producto${itemCount > 1 ? "s" : ""} por $${Number(total).toLocaleString("es-AR")} · ${paymentLabel}`,
      type: "order",
      link: "/vendor/dashboard",
    });

    const { data: userProfile } = await supabase.auth.admin.getUserById(vendor.user_id);
    if (userProfile?.user?.email) {
      const emailContent = orderConfirmationEmail(vendor.store_name, items, total);
      await sendEmail({
        to: userProfile.user.email,
        ...emailContent,
      });
    }
  }

  return NextResponse.json({ ok: true, orderId: data?.id });
}, { maxRequests: 10 });
