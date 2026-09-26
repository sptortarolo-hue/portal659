/**
 * Carga un comprobante + arma su PDF (genera y guarda pdf_url si falta).
 * Usado por el endpoint de descarga y por el envío por email.
 */
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { queryOne } from "@/lib/db";
import { getSiteUrl } from "@/lib/site-url";
import { buildInvoicePdf } from "@/lib/arca/pdf";
import { buildQrUrl } from "@/lib/arca/qr";
import type { Order, Vendor } from "@/types/database";
import type { FiscalInvoice } from "@/lib/arca/emit";

export type InvoicePdfBundle = {
  pdf: Buffer;
  fname: string;
  publicUrl: string | null;
  invoice: FiscalInvoice;
};

export async function getInvoicePdfBundle(
  vendor: Vendor,
  invoiceId: string
): Promise<InvoicePdfBundle | null> {
  const invoice = await queryOne<FiscalInvoice>(
    `SELECT * FROM invoices WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
    [invoiceId, vendor.id]
  );
  if (!invoice) return null;

  const order = await queryOne<Order>(
    `SELECT items, customer_name, payment_method, created_at FROM orders WHERE id = $1 LIMIT 1`,
    [(invoice as { order_id: string }).order_id]
  );

  const qrUrl = buildQrUrl({
    cuit: (vendor.cuit || "").replace(/\D/g, ""),
    ptoVta: Number(invoice.punto_venta),
    cbteTipo: Number(invoice.cbte_tipo) || 11,
    cbteNro: Number(invoice.cbte_nro),
    importe: Number(invoice.total),
    cae: String(invoice.cae),
    fecha: new Date(),
  });

  const pdf = await buildInvoicePdf({
    vendor: {
      store_name: vendor.store_name,
      cuit: vendor.cuit,
      fiscal_cond_iva: vendor.fiscal_cond_iva,
      address: vendor.address,
      phone: vendor.phone || vendor.whatsapp,
      logo_url: vendor.logo_url,
    },
    invoice: {
      cbte_tipo: Number(invoice.cbte_tipo) || 11,
      punto_venta: Number(invoice.punto_venta),
      cbte_nro: Number(invoice.cbte_nro),
      cae: String(invoice.cae),
      cae_vto: String(invoice.cae_vto),
      total: Number(invoice.total),
      created_at: String(invoice.created_at),
      asoc_pto: (invoice as { asoc_pto?: number | null }).asoc_pto ?? null,
      asoc_nro: (invoice as { asoc_nro?: number | null }).asoc_nro ?? null,
    },
    order: order
      ? {
          items: order.items || [],
          customer_name: order.customer_name,
          payment_method: order.payment_method,
          created_at: order.created_at,
        }
      : null,
    qrUrl,
  });

  const prefix = Number(invoice.cbte_tipo) === 13 ? "NC" : "C";
  const fname = `${prefix}-${String(invoice.punto_venta).padStart(4, "0")}-${String(invoice.cbte_nro).padStart(8, "0")}.pdf`;
  let publicUrl: string | null = null;
  try {
    const root = process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads");
    const dir = path.join(root, "fiscal", vendor.id);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, fname), pdf);
    publicUrl = `${getSiteUrl()}/uploads/fiscal/${vendor.id}/${fname}`;
    try {
      await queryOne(`UPDATE invoices SET pdf_url = $2 WHERE id = $1 RETURNING id`, [
        (invoice as { id: string }).id,
        publicUrl,
      ]);
    } catch {
      /* sin columna pdf_url: se sirve igual sin guardar */
    }
  } catch {
    /* disco no disponible: se sirve igual sin guardar */
  }

  return { pdf, fname, publicUrl, invoice };
}
