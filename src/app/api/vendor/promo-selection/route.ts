import { getVendorByRequest } from "@/lib/vendor-utils";
import { query, queryMany, queryOne } from "@/lib/db";
import { NextResponse } from "next/server";

type SelectionRow = {
  product_ids: unknown;
  updated_at: string;
  mode: unknown;
};

function normalizeIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids: string[] = [];
  for (const v of value) {
    if (typeof v === "string" && v.length > 0 && !ids.includes(v)) ids.push(v);
    if (ids.length >= 3) break;
  }
  return ids;
}

export async function GET(request: Request) {
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  try {
    try {
      const row = await queryOne<SelectionRow>(
        `SELECT product_ids, updated_at, mode FROM vendor_promo_images WHERE vendor_id = $1 LIMIT 1`,
        [vendor.id]
      );
      return NextResponse.json({
        productIds: normalizeIds(row?.product_ids),
        updatedAt: row?.updated_at || null,
        mode: row?.mode === "manual" ? "manual" : "auto",
      });
    } catch {
      const legacy = await queryOne<Omit<SelectionRow, "mode">>(
        `SELECT product_ids, updated_at FROM vendor_promo_images WHERE vendor_id = $1 LIMIT 1`,
        [vendor.id]
      );
      return NextResponse.json({
        productIds: normalizeIds(legacy?.product_ids),
        updatedAt: legacy?.updated_at || null,
        mode: "auto",
      });
    }
  } catch {
    return NextResponse.json(
      { error: "Falta aplicar supabase/self-host/migrate-promo-share.sql en la DB" },
      { status: 503 }
    );
  }
}

export async function PATCH(request: Request) {
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  let body: { productIds?: unknown; mode?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  const ids = normalizeIds(body.productIds);
  if (!Array.isArray(body.productIds) || (body.productIds as unknown[]).length > 3) {
    return NextResponse.json({ error: "Máximo 3 productos" }, { status: 400 });
  }
  const mode = body.mode === "manual" ? "manual" : "auto";
  try {
    if (ids.length > 0) {
      const valid = await queryMany<{ id: string }>(
        `SELECT id FROM products
         WHERE vendor_id = $1 AND id = ANY($2) AND available = true
           AND (promo_price IS NOT NULL OR promo_only = true)
         LIMIT 3`,
        [vendor.id, ids]
      );
      const validIds = new Set((valid || []).map((r) => r.id));
      const ordered = ids.filter((id) => validIds.has(id));
      if (ordered.length !== ids.length) {
        return NextResponse.json(
          { error: "Algún producto no está en promo" },
          { status: 400 }
        );
      }
    }
    try {
      await query(
        `INSERT INTO vendor_promo_images (vendor_id, image_url, product_ids, updated_at, mode)
         VALUES ($1, '', $2::jsonb, now(), $3)
         ON CONFLICT (vendor_id) DO UPDATE
         SET product_ids = $2::jsonb, updated_at = now(), mode = $3`,
        [vendor.id, JSON.stringify(ids), mode]
      );
    } catch {
      await query(
        `INSERT INTO vendor_promo_images (vendor_id, image_url, product_ids, updated_at)
         VALUES ($1, '', $2::jsonb, now())
         ON CONFLICT (vendor_id) DO UPDATE
         SET product_ids = $2::jsonb, updated_at = now()`,
        [vendor.id, JSON.stringify(ids)]
      );
    }
    const row = await queryOne<SelectionRow>(
      `SELECT product_ids, updated_at, mode FROM vendor_promo_images WHERE vendor_id = $1 LIMIT 1`,
      [vendor.id]
    ).catch(() => null);
    return NextResponse.json({
      productIds: normalizeIds(row?.product_ids),
      updatedAt: row?.updated_at || null,
      mode: row?.mode === "manual" ? "manual" : mode,
    });
  } catch {
    return NextResponse.json(
      { error: "Falta aplicar supabase/self-host/migrate-promo-share.sql en la DB" },
      { status: 503 }
    );
  }
}
