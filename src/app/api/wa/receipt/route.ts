import { NextResponse } from "next/server";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { randomBytes } from "crypto";
import { queryOne } from "@/lib/db";
import { authWaBot } from "@/lib/wa-bot";
import { getSiteUrl } from "@/lib/site-url";
import { logApiError } from "@/lib/api-error";

const MAX_SIZE = 5 * 1024 * 1024; // 5MB
const IMG_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/**
 * POST /api/wa/receipt — sube el comprobante de transferencia que el cliente
 * mandó por WhatsApp al bot. Auth interna con WA_BOT_SECRET (el cerebro del
 * bot lo envía). Guarda el archivo en UPLOAD_DIR/receipts/<vendor_id>/ y
 * setea orders.transfer_proof_url. El comercio lo confirma a mano como hoy.
 *
 * Body multipart: orderId (string), vendorId (string), file (File).
 */
export async function POST(request: Request) {
  if (!authWaBot(request)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "multipart requerido" }, { status: 400 });
  const orderId = String(form.get("orderId") || "");
  const vendorId = String(form.get("vendorId") || "");
  const file = form.get("file") as File | null;

  if (!orderId || !vendorId) {
    return NextResponse.json({ error: "orderId y vendorId requeridos" }, { status: 400 });
  }
  if (!file || !file.size) {
    return NextResponse.json({ error: "Archivo requerido" }, { status: 400 });
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: "El archivo no puede superar 5 MB" }, { status: 400 });
  }
  const isImage = IMG_TYPES.has(file.type);
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name || "");
  if (!isImage && !isPdf) {
    return NextResponse.json(
      { error: "El comprobante debe ser una imagen (JPG/PNG) o un PDF" },
      { status: 400 }
    );
  }

  // El pedido existe, es del vendor correcto y todavía no tiene comprobante.
  const order = await queryOne<{
    id: string; vendor_id: string; customer_name: string; payment_method: string; payment_status: string;
    transfer_proof_url: string | null; pickup_number: number | null; total: number;
  }>(
    `SELECT id, vendor_id, customer_name, payment_method, payment_status, transfer_proof_url, pickup_number, total
     FROM orders WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
    [orderId, vendorId]
  );
  if (!order) {
    return NextResponse.json({ error: "Pedido no encontrado" }, { status: 404 });
  }
  if (order.payment_method !== "transferencia") {
    return NextResponse.json({ error: "El pedido no es por transferencia" }, { status: 400 });
  }
  if (order.payment_status === "paid") {
    // Ya acreditado a mano: el comprobante ya no hace falta.
    return NextResponse.json({ error: "El pago ya fue acreditado — no hace falta el comprobante." }, { status: 409 });
  }
  if (order.transfer_proof_url) {
    // Ya hay uno: no pisa, pero responde la URL vieja — el PDF nuevo no hace falta.
    return NextResponse.json({ ok: true, url: order.transfer_proof_url, reused: true });
  }

  const bytes = Buffer.from(await file.arrayBuffer());

  // Imagen → resize/sharp para que pese poco y se vea en el panel; PDF → pasa directo.
  let out: Buffer = bytes;
  let ext = isPdf ? "pdf" : "jpg";
  if (isImage) {
    try {
      const sharp = (await import("sharp")).default;
      out = await sharp(bytes).rotate().resize({ width: 1200, withoutEnlargement: true }).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
      ext = "jpg";
    } catch (e) {
      logApiError("wa-receipt/sharp", e);
      out = bytes;
      ext = file.type === "image/png" ? "png" : "jpg";
    }
  }

  const uploadRoot = process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads");
  const dir = path.join(uploadRoot, "receipts", vendorId);
  await mkdir(dir, { recursive: true });
  const filename = `${Date.now()}-${randomBytes(4).toString("hex")}.${ext}`;
  await writeFile(path.join(dir, filename), out);

  const url = `${getSiteUrl()}/uploads/receipts/${vendorId}/${filename}`;

  await queryOne(
    `UPDATE orders SET transfer_proof_url = $1, updated_at = now() WHERE id = $2 RETURNING id`,
    [url, orderId]
  );

  // Notificar al dueño: le llegó un comprobante y tiene que confirmar el pedido.
  try {
    const vendor = await queryOne<{ user_id: string; store_name: string }>(
      `SELECT user_id, store_name FROM vendors WHERE id = $1 LIMIT 1`,
      [vendorId]
    );
    if (vendor?.user_id) {
      const nro = order.pickup_number != null ? `Nro. ${order.pickup_number}` : `#${orderId.slice(0, 8)}`;
      await queryOne(
        `INSERT INTO notifications (user_id, title, body, type, link) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [
          vendor.user_id,
          "🧾 Comprobante recibido",
          `${order.customer_name} mandó el comprobante del pedido ${nro}. Miralo y confirmá el pago.`,
          "order",
          "/vendor/dashboard",
        ]
      );
      const { sendPushToUser } = await import("@/lib/push");
      await sendPushToUser(vendor.user_id, {
        title: "🧾 Comprobante recibido",
        body: `${order.customer_name} mandó el comprobante del pedido ${nro}. Miralo y confirmá el pago.`,
        link: "/vendor/dashboard",
      }).catch(() => {});
    }
  } catch (e) {
    logApiError("wa-receipt/notify", e);
  }

  return NextResponse.json({ ok: true, url });
}
