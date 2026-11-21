import { getVendorByRequest } from "@/lib/vendor-utils";
import { queryMany, queryOne } from "@/lib/db";
import { NextResponse } from "next/server";
import { loadSuggestibleContext, isEligible, hasSuggestibleColumn } from "@/lib/suggestible-server";

export async function GET(request: Request) {
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const hasCol = await hasSuggestibleColumn();
  const ctx = await loadSuggestibleContext(vendor.id);

  const offers = await queryMany<any>(
    `SELECT id, name, price, image_url, available, suggestible, suggestible_position,
            parent_id, stock, stock_control, unit, category, sku
       FROM products WHERE vendor_id = $1 ORDER BY name ASC`,
    [vendor.id]
  ).catch(() => []);

  const items = (offers || []).map((p: any) => {
    const elig = isEligible(p, ctx);
    return {
      id: String(p.id),
      name: String(p.name),
      price: Number(p.price) || 0,
      image: p.image_url != null ? String(p.image_url) : null,
      available: p.available === true || p.available === "t",
      suggestible: hasCol && p.suggestible === true,
      position: Number(p.suggestible_position) || 0,
      eligible: elig.eligible,
      reason: elig.reason,
      stock: p.stock != null ? Number(p.stock) : null,
      stockControl: p.stock_control === true,
      unit: p.unit != null ? String(p.unit) : "unidad",
      category: p.category != null ? String(p.category) : null,
    };
  });

  return NextResponse.json({ items, hasColumn: hasCol });
}
