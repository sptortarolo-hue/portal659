import { getVendorByRequest } from "@/lib/vendor-utils";
import { queryMany, queryOne } from "@/lib/db";
import { resolveVendorPlan } from "@/lib/plans";
import { NextResponse } from "next/server";
import type { Plan, Vendor } from "@/types/database";

export async function GET(request: Request) {
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) {
    return NextResponse.json({ error: "No tenés un local registrado" }, { status: 403 });
  }

  const offers = await queryMany<Record<string, unknown>>(
    `SELECT * FROM products WHERE vendor_id = $1 ORDER BY created_at DESC`,
    [vendor.id]
  );
  return NextResponse.json({ offers });
}

export async function POST(request: Request) {
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) {
    return NextResponse.json({ error: "No tenés un local registrado" }, { status: 403 });
  }

  const fullVendor = await queryOne<Vendor>(
    `SELECT * FROM vendors WHERE id = $1 LIMIT 1`,
    [vendor.id]
  );
  const body = await request.json();
  const { name, description, price, category, featured_today, image_url } = body;
  const stock = body.stock ?? null;
  const stock_low_threshold = body.stock_low_threshold ?? null;
  const stock_control = body.stock_control ?? false;

  if (!name || !price) {
    return NextResponse.json({ error: "El nombre y el precio son obligatorios" }, { status: 400 });
  }

  const plans = await queryMany<Plan>(`SELECT * FROM plans`);
  const plan = resolveVendorPlan(fullVendor as Vendor, plans || []);
  if (plan.maxProducts != null) {
    const countRow = await queryOne<{ c: number }>(
      `SELECT count(*)::int AS c FROM products WHERE vendor_id = $1`,
      [vendor.id]
    );
    const count = countRow?.c || 0;
    if (count >= plan.maxProducts) {
      return NextResponse.json(
        {
          error: `Tu plan permite hasta ${plan.maxProducts} productos. Actualizá a Gestión integral para productos ilimitados.`,
          code: "plan_limit",
        },
        { status: 403 }
      );
    }
  }

  const offer = await queryOne<Record<string, unknown>>(
    `INSERT INTO products (vendor_id, name, description, price, currency, category, neighborhood, type, available, featured_today, image_url, stock, stock_low_threshold, stock_control)
     VALUES ($1, $2, $3, $4, 'ARS', $5, $6, 'food', true, $7, $8, $9, $10, $11) RETURNING *`,
    [
      vendor.id,
      name,
      description || null,
      parseFloat(price),
      category || "otras",
      fullVendor?.neighborhood || null,
      !!featured_today,
      image_url || null,
      stock,
      stock_low_threshold,
      stock_control,
    ]
  );

  return NextResponse.json({ offer });
}