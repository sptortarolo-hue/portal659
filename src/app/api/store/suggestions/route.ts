import { queryMany, queryOne } from "@/lib/db";
import { NextResponse } from "next/server";
import { loadSuggestibleContext, isEligible, hasSuggestibleColumn } from "@/lib/suggestible-server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const vendorId = url.searchParams.get("vendorId");
  const slug = url.searchParams.get("slug");

  let vid = vendorId;
  if (!vid && slug) {
    const v = await queryOne<{ id: string }>(
      `SELECT id FROM vendors WHERE slug = $1 LIMIT 1`,
      [slug]
    ).catch(() => null);
    vid = v?.id || null;
  }
  if (!vid) {
    return NextResponse.json({ suggestions: [] });
  }

  const hasCol = await hasSuggestibleColumn();
  if (!hasCol) {
    return NextResponse.json({ suggestions: [] });
  }

  const rows = await queryMany<any>(
    `SELECT id, name, price, promo_price, image_url, unit, pack_size, cash_discount_excluded,
            presentation_label, presentation_qty, parent_id, stock, stock_control, available
       FROM products
      WHERE vendor_id = $1 AND suggestible = true AND available = true
      ORDER BY suggestible_position ASC, name ASC`,
    [vid]
  ).catch(() => []);

  const ctx = await loadSuggestibleContext(vid);

  const suggestions = (rows || [])
    .filter((p: any) => {
      const elig = isEligible(p, ctx);
      if (!elig.eligible) return false;
      // stock
      if (p.stock_control === true && Number(p.stock) <= 0) return false;
      return true;
    })
    .map((p: any) => ({
      id: String(p.id),
      name: String(p.name),
      price: Number(p.price) || 0,
      promo_price: p.promo_price != null ? Number(p.promo_price) : null,
      image: p.image_url != null ? String(p.image_url) : null,
      unit: p.unit != null ? String(p.unit) : "unidad",
      packSize: p.pack_size != null ? Number(p.pack_size) : null,
      cashExcluded: p.cash_discount_excluded === true,
      presentationLabel: p.presentation_label != null ? String(p.presentation_label) : null,
      presentationQty: p.presentation_qty != null ? Number(p.presentation_qty) : null,
    }));

  return NextResponse.json(
    { suggestions },
    { headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=120" } }
  );
}
