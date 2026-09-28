import { gateRequest } from "@/lib/subscription-gate";
import { queryMany, queryOne } from "@/lib/db";
import { buildQuotePdf } from "@/lib/quote-pdf";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Descarga el presupuesto en PDF A4 (para imprimir o enviar por WhatsApp). */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await gateRequest(request);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  if (!gate.plan.can("quotes_respond")) {
    return NextResponse.json(
      { error: "El documento del presupuesto requiere el plan Oficios." },
      { status: 403 }
    );
  }

  const { id } = await params;
  const quote = await queryOne<Record<string, unknown>>(
    `SELECT customer_name, customer_phone, service_name, description, preferred_date,
            quoted_price, deposit_pct, deposit_amount, created_at
     FROM quotes WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
    [id, gate.vendor.id]
  );
  if (!quote) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  const items = await queryMany<{ kind: string; description: string; qty: number; unit_price: number }>(
    `SELECT kind, description, qty, unit_price FROM quote_items WHERE quote_id = $1 ORDER BY position ASC`,
    [id]
  ).catch(() => []);

  const vendor = await queryOne<Record<string, unknown>>(
    `SELECT store_name, address, phone, whatsapp, logo_url FROM vendors WHERE id = $1 LIMIT 1`,
    [gate.vendor.id]
  );

  const pdf = await buildQuotePdf({
    vendor: {
      store_name: String(vendor?.store_name || ""),
      address: (vendor?.address as string) || null,
      phone: (vendor?.phone as string) || null,
      whatsapp: (vendor?.whatsapp as string) || null,
      logo_url: (vendor?.logo_url as string) || null,
    },
    quote: {
      customer_name: String(quote.customer_name || ""),
      customer_phone: (quote.customer_phone as string) || "",
      service_name: (quote.service_name as string) || null,
      description: String(quote.description || ""),
      preferred_date: (quote.preferred_date as string) || null,
      quoted_price: quote.quoted_price != null ? Number(quote.quoted_price) : null,
      deposit_pct: quote.deposit_pct != null ? Number(quote.deposit_pct) : null,
      deposit_amount: quote.deposit_amount != null ? Number(quote.deposit_amount) : null,
      created_at: String(quote.created_at || new Date().toISOString()),
    },
    items: (items || []).map((it) => ({
      kind: (it.kind === "labor" ? "labor" : "material") as "material" | "labor",
      description: String(it.description || ""),
      qty: Number(it.qty) || 0,
      unit_price: Number(it.unit_price) || 0,
    })),
  });

  // Buffer → Uint8Array para NextResponse (sin copiar de más).
  const body = new Uint8Array(pdf);
  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="presupuesto-${id.slice(0, 8)}.pdf"`,
    },
  });
}
