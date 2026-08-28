import { getVendorByRequest } from "@/lib/vendor-utils";
import { queryMany, queryOne, query } from "@/lib/db";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) {
    return NextResponse.json({ error: "No tenés un local registrado" }, { status: 403 });
  }

  const categories = await queryMany<Record<string, unknown>>(
    `SELECT * FROM vendor_categories WHERE vendor_id = $1 ORDER BY position ASC`,
    [vendor.id]
  );
  return NextResponse.json({ categories });
}

export async function POST(request: Request) {
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) {
    return NextResponse.json({ error: "No tenés un local registrado" }, { status: 403 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  const { name } = body;
  if (!name || !name.trim()) {
    return NextResponse.json({ error: "El nombre de la categoría es obligatorio" }, { status: 400 });
  }

  const countRow = await queryOne<{ c: number }>(
    `SELECT count(*)::int AS c FROM vendor_categories WHERE vendor_id = $1`,
    [vendor.id]
  );

  try {
    const category = await queryOne<Record<string, unknown>>(
      `INSERT INTO vendor_categories (vendor_id, name, position) VALUES ($1, $2, $3) RETURNING *`,
      [vendor.id, name.trim(), countRow?.c || 0]
    );

    return NextResponse.json({ category });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error al crear la categoría";
    const isDuplicate = /duplicate|unique/i.test(msg);
    return NextResponse.json(
      { error: isDuplicate ? "Ya existe una categoría con ese nombre" : msg },
      { status: 500 }
    );
  }
}