import { getVendorByRequest } from "@/lib/vendor-utils";
import { queryMany } from "@/lib/db";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();
  if (q.length < 2) return NextResponse.json({ results: [] });

  const vendorId = vendor.id;
  const like = `%${q}%`;

  const [products, customers, orders] = await Promise.all([
    queryMany<any>(
      `SELECT id, name, sku, price, category, image_url FROM products WHERE vendor_id = $1 AND (name ILIKE $2 OR sku ILIKE $2 OR category ILIKE $2) LIMIT 8`,
      [vendorId, like]
    ).catch(() => []),
    queryMany<any>(
      `SELECT id, name, phone, address, total_orders FROM customers WHERE vendor_id = $1 AND (name ILIKE $2 OR phone ILIKE $2 OR address ILIKE $2) LIMIT 8`,
      [vendorId, like]
    ).catch(() => []),
    queryMany<any>(
      `SELECT id, customer_name, customer_phone, total, status, pickup_number FROM orders WHERE vendor_id = $1 AND (customer_name ILIKE $2 OR customer_phone ILIKE $2 OR CAST(pickup_number AS TEXT) ILIKE $2) LIMIT 8`,
      [vendorId, like]
    ).catch(() => []),
  ]);

  const results = [
    ...products.map((p: any) => ({ type: "product", id: p.id, title: p.name, subtitle: `${p.category || ""} · $${p.price}`, image: p.image_url, tab: "menu" })),
    ...customers.map((c: any) => ({ type: "customer", id: c.id, title: c.name || c.phone, subtitle: `${c.phone} · ${c.total_orders || 0} pedidos`, tab: "clientes" })),
    ...orders.map((o: any) => ({ type: "order", id: o.id, title: `Pedido #${o.pickup_number || o.id.slice(0, 8)}`, subtitle: `${o.customer_name} · $${o.total} · ${o.status}`, tab: "orders" })),
  ];

  return NextResponse.json({ results });
}
