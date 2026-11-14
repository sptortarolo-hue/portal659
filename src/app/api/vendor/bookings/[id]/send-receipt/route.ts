import { NextResponse } from "next/server";
import { getVendorByRequest } from "@/lib/vendor-utils";
import { query, queryOne, queryMany } from "@/lib/db";
import { getSiteUrl } from "@/lib/site-url";
import { renderReceiptImage } from "@/lib/ticket-image";
import { sendOrLink } from "@/lib/wa-dispatch";
import { mkdir, writeFile } from "fs/promises";
import path from "path";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const wantSend = body?.send !== false;

  const booking = await queryOne<{
    id: string;
    vendor_id: string;
    customer_name: string | null;
    customer_phone: string | null;
    booking_date: string;
    booking_time: string;
    service_price: number | null;
    amount_paid: number | null;
    payment_method: string | null;
    deposit_amount: number | null;
    deposit_status: string | null;
    is_preview: boolean | null;
  }>(
    `SELECT id, vendor_id, customer_name, customer_phone, booking_date::text AS booking_date,
            booking_time::text AS booking_time, service_price::numeric AS service_price,
            amount_paid::numeric AS amount_paid, payment_method, deposit_amount::numeric AS deposit_amount,
            deposit_status, is_preview
     FROM bookings WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
    [id, vendor.id]
  ).catch(() => null);

  if (!booking) return NextResponse.json({ error: "Turno no encontrado" }, { status: 404 });
  if (booking.is_preview === true) {
    return NextResponse.json({ error: "No se envían comprobantes de turnos de prueba" }, { status: 400 });
  }
  if (!booking.customer_phone) {
    return NextResponse.json({ error: "El turno no tiene teléfono del cliente" }, { status: 400 });
  }

  // Factura fiscal vinculada (si se emitió).
  const invoice = await queryOne<{
    id: string;
    number: string | null;
    cae: string | null;
    cae_expiry: string | null;
    pdf_url: string | null;
    total: number | null;
    cbte_tipo: number | null;
    punto_venta: number | null;
    cbte_nro: number | null;
    created_at: string | null;
  }>(
    `SELECT id, number, cae, cae_expiry::text AS cae_expiry, pdf_url, total::numeric AS total,
            cbte_tipo, punto_venta, cbte_nro, created_at::text AS created_at
     FROM invoices WHERE booking_id = $1 AND vendor_id = $2 LIMIT 1`,
    [id, vendor.id]
  ).catch(() => null);

  const isFiscal = !!invoice && !!invoice.cae;

  const total = invoice?.total != null ? Number(invoice.total) : Number(booking.service_price || 0);

  // QR fiscal (si hay factura).
  let qrData: string | null = null;
  if (isFiscal && invoice) {
    try {
      const v = await queryOne<{ cuit: string | null; fiscal_punto_venta: number | null }>(
        `SELECT cuit, fiscal_punto_venta FROM vendors WHERE id = $1 LIMIT 1`,
        [vendor.id]
      ).catch(() => null);
      const cuit = v?.cuit || "";
      const ptoVta = invoice.punto_venta || v?.fiscal_punto_venta || 1;
      const cbteTipo = invoice.cbte_tipo || 11;
      const cbteNro = invoice.cbte_nro || 0;
      const importe = invoice.total != null ? Number(invoice.total) : total;
      const cae = invoice.cae!;
      const fecha = invoice.created_at ? new Date(invoice.created_at) : new Date();
      const { buildQrUrl } = await import("@/lib/arca/qr");
      qrData = buildQrUrl({ cuit, ptoVta, cbteTipo, cbteNro, importe, cae, fecha });
    } catch { /* sin QR */ }
  }

  // Servicio y profesional del turno (vertical estética/taller/servicio).
  let serviceName: string | null = null;
  let staffName: string | null = null;
  try {
    const refs = await queryOne<{ service_id: string | null; staff_id: string | null }>(
      `SELECT service_id, staff_id FROM bookings WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
      [id, vendor.id]
    );
    if (refs?.service_id) {
      const s = await queryOne<{ name: string }>(
        `SELECT name FROM services WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
        [refs.service_id, vendor.id]
      ).catch(() => null);
      serviceName = s?.name || null;
    }
    if (refs?.staff_id) {
      const st = await queryOne<{ name: string }>(
        `SELECT name FROM estetica_staff WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
        [refs.staff_id, vendor.id]
      ).catch(() => null);
      staffName = st?.name || null;
    }
  } catch {
    /* sin migración de estética: se sigue con los datos básicos */
  }

  // Partidas de la cuenta (si las hay).
  let items: { name: string; qty?: number; price?: number }[] = [];
  try {
    const parts = await queryMany<{ name: string; qty: number; unit_price: number }>(
      `SELECT name, qty::numeric AS qty, unit_price::numeric AS unit_price
       FROM work_order_parts WHERE booking_id = $1 AND vendor_id = $2`,
      [id, vendor.id]
    );
    items = parts.map((p) => ({ name: p.name, qty: Number(p.qty), price: Number(p.unit_price) }));
  } catch {
    /* sin migración: sin partidas */
  }
  if (items.length === 0 && booking.service_price && booking.service_price > 0) {
    items = [{ name: serviceName || "Servicio", qty: 1, price: Number(booking.service_price) }];
  }


  const depositPaid = booking.deposit_status === "paid" ? Number(booking.deposit_amount || 0) : 0;
  const amountPaid = Number(booking.amount_paid || 0);

  // Vendor info (logo, datos).
  const v = await queryOne<{
    store_name: string;
    logo_url: string | null;
    address: string | null;
    phone: string | null;
    whatsapp: string | null;
    instagram: string | null;
    facebook: string | null;
  }>(
    `SELECT store_name, logo_url, address, phone, whatsapp, instagram, facebook
     FROM vendors WHERE id = $1 LIMIT 1`,
    [vendor.id]
  ).catch(() => null);

  // Toggles del encabezado impreso (pueden no estar migrados).
  const printCfg = await queryOne<{
    print_logo: boolean | null;
    print_address: boolean | null;
    print_phone: boolean | null;
    print_social: boolean | null;
  }>(
    `SELECT print_logo, print_address, print_phone, print_social
     FROM vendors WHERE id = $1 LIMIT 1`,
    [vendor.id]
  ).catch(() => null);

  const png = await renderReceiptImage({
    storeName: v?.store_name || (vendor as any).store_name || "Comercio",
    logoUrl: v?.logo_url,
    address: v?.address,
    phone: v?.phone,
    whatsapp: v?.whatsapp,
    instagram: v?.instagram,
    facebook: v?.facebook,
    printLogo: printCfg?.print_logo,
    printAddress: printCfg?.print_address,
    printPhone: printCfg?.print_phone,
    printSocial: printCfg?.print_social,
    customerName: booking.customer_name,
    date: booking.booking_date,
    time: String(booking.booking_time).slice(0, 5),
    staffName,
    bookingRef: id.slice(0, 8),
    items,
    total,
    depositPaid,
    amountPaid: amountPaid > 0 ? amountPaid : undefined,
    paymentMethod: booking.payment_method,
    invoiceNumber: invoice?.number || null,
    cae: invoice?.cae || null,
    caeVto: invoice?.cae_expiry || null,
    isFiscal,
    qrData,
    docTitle: isFiscal ? "FACTURA C" : "TICKET",
    footer: isFiscal ? "Factura C — documento fiscal" : "Comprobante de servicio",
  });

  if (!png) {
    return NextResponse.json({ error: "No se pudo generar la imagen del comprobante" }, { status: 500 });
  }

  // Guardar en uploads.
  const uploadRoot = process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads");
  const dir = path.join(uploadRoot, "receipts", vendor.id);
  await mkdir(dir, { recursive: true });
  const filename = `ticket-${id}-${Date.now()}.png`;
  await writeFile(path.join(dir, filename), png);
  const imageUrl = `${getSiteUrl()}/uploads/receipts/${vendor.id}/${filename}`;

  if (!wantSend) {
    return NextResponse.json({ ok: true, url: imageUrl, mode: "manual" });
  }

  const b64 = png.toString("base64");
  const caption = isFiscal
    ? `Factura C ${invoice?.number || ""} — ${v?.store_name || ""}`
    : `Comprobante de servicio — ${v?.store_name || ""}`;

  const result = await sendOrLink({
    vendorId: vendor.id,
    phone: booking.customer_phone,
    text: caption,
    imageData: b64,
  });

  return NextResponse.json({
    ok: true,
    url: imageUrl,
    mode: result.mode,
    sent: result.ok,
    reason: result.reason,
  });
}
