import { getVendorByRequest } from "@/lib/vendor-utils";
import { withTransaction } from "@/lib/db";
import { isMissingColumnError } from "@/lib/modifier-rules";
import { NextResponse } from "next/server";
import type { ModifierOption } from "@/types/database";

export const dynamic = "force-dynamic";

/** Sabores iniciales del kit (editables después desde Modificadores). */
const STARTER_FLAVORS: { label: string; category: string }[] = [
  // Cremas
  { label: "Vainilla", category: "Cremas" },
  { label: "Crema Americana", category: "Cremas" },
  { label: "Crema del Cielo", category: "Cremas" },
  { label: "Crema Oreo", category: "Cremas" },
  { label: "Tramontana", category: "Cremas" },
  { label: "Tiramisú", category: "Cremas" },
  { label: "Menta Granizada", category: "Cremas" },
  { label: "Sambayón", category: "Cremas" },
  { label: "Flan", category: "Cremas" },
  { label: "Mascarpone", category: "Cremas" },
  // Chocolates
  { label: "Chocolate", category: "Chocolates" },
  { label: "Chocolate Suizo", category: "Chocolates" },
  { label: "Chocolate con Almendras", category: "Chocolates" },
  { label: "Chocolate Marroc", category: "Chocolates" },
  { label: "Chocolate Blanco", category: "Chocolates" },
  // Dulce de leche
  { label: "Dulce de Leche", category: "Dulce de leche" },
  { label: "Dulce de Leche Granizado", category: "Dulce de leche" },
  { label: "Dulce de Leche con Nuez", category: "Dulce de leche" },
  { label: "Dulce de Leche con Brownie", category: "Dulce de leche" },
  // Frutales
  { label: "Frutilla", category: "Frutales" },
  { label: "Frutilla al Agua", category: "Frutales" },
  { label: "Limón", category: "Frutales" },
  { label: "Durazno", category: "Frutales" },
  { label: "Ananá", category: "Frutales" },
  { label: "Maracuyá", category: "Frutales" },
  { label: "Naranja", category: "Frutales" },
  { label: "Frutos del Bosque", category: "Frutales" },
  { label: "Banana", category: "Frutales" },
];

function num(v: unknown, def: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

/**
 * Kit heladería de un click: crea 1/4, 1/2 y 1 kg (+ cucuruchos opcionales)
 * con requires_prep=false y UN solo grupo "Gustos" con override de min/max
 * por tamaño en el link. Idempotencia simple: si ya hay un grupo "Gustos" o
 * productos "Helado %", devuelve 409.
 */
export async function POST(request: Request) {
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const prices = body?.prices || {};
  const maxIn = body?.max || {};
  const minIn = body?.min || {};
  const includeCucuruchos = body?.include_cucuruchos !== false;
  const category = String(body?.category || "Helados").trim().slice(0, 60) || "Helados";

  const priceCuarto = num(prices.cuarto, 0);
  const priceMedio = num(prices.medio, 0);
  const priceKilo = num(prices.kilo, 0);
  if (!(priceCuarto > 0) || !(priceMedio > 0) || !(priceKilo > 0)) {
    return NextResponse.json({ error: "Indicá los 3 precios (1/4, 1/2 y 1 kg)" }, { status: 400 });
  }
  const priceCuc2 = num(prices.cucurucho_2, 0);
  const priceCuc3 = num(prices.cucurucho_3, 0);
  if (includeCucuruchos && (!(priceCuc2 > 0) || !(priceCuc3 > 0))) {
    return NextResponse.json({ error: "Indicá los precios de los cucuruchos (2 y 3 bochas)" }, { status: 400 });
  }

  const clampN = (v: unknown, def: number) => Math.min(8, Math.max(1, Math.floor(num(v, def)) || def));
  const sizes = [
    { name: "Helado 1/4 kg", price: priceCuarto, max: clampN(maxIn.cuarto, 2), min: clampN(minIn.cuarto, 1) },
    { name: "Helado 1/2 kg", price: priceMedio, max: clampN(maxIn.medio, 3), min: clampN(minIn.medio, 1) },
    { name: "Helado 1 kg", price: priceKilo, max: clampN(maxIn.kilo, 4), min: clampN(minIn.kilo, 1) },
  ];
  if (includeCucuruchos) {
    sizes.push(
      { name: "Cucurucho 2 bochas", price: priceCuc2, max: clampN(maxIn.cucurucho_2, 2), min: clampN(minIn.cucurucho_2, 1) },
      { name: "Cucurucho 3 bochas", price: priceCuc3, max: clampN(maxIn.cucurucho_3, 3), min: clampN(minIn.cucurucho_3, 1) },
    );
  }
  for (const s of sizes) s.min = Math.min(s.min, s.max);

  const created = await withTransaction(async (tx) => {
    // Guardia anti-duplicados (doble click / correr 2 veces).
    const dupGroup = await tx.queryOne<{ id: string }>(
      `SELECT id FROM modifier_groups WHERE vendor_id = $1 AND group_name ILIKE 'gustos' LIMIT 1`,
      [vendor.id]
    );
    if (dupGroup) throw new Error("DUPLICATE_GROUP");
    const dupProduct = await tx.queryOne<{ id: string }>(
      `SELECT id FROM products WHERE vendor_id = $1 AND (name ILIKE 'helado %' OR name ILIKE 'cucurucho %') LIMIT 1`,
      [vendor.id]
    );
    if (dupProduct) throw new Error("DUPLICATE_PRODUCT");

    const insertProduct = async (name: string, price: number): Promise<string> => {
      try {
        const row = await tx.queryOne<{ id: string }>(
          `INSERT INTO products (vendor_id, name, price, category, type, available, requires_prep)
           VALUES ($1, $2, $3, $4, 'food', true, false) RETURNING id`,
          [vendor.id, name, price, category]
        );
        if (!row) throw new Error("No se pudo crear " + name);
        return row.id;
      } catch (e) {
        if (!isMissingColumnError(e)) throw e;
        const row = await tx.queryOne<{ id: string }>(
          `INSERT INTO products (vendor_id, name, price, category, type, available)
           VALUES ($1, $2, $3, $4, 'food', true) RETURNING id`,
          [vendor.id, name, price, category]
        );
        if (!row) throw new Error("No se pudo crear " + name);
        return row.id;
      }
    };

    const productIds = [];
    for (const s of sizes) {
      productIds.push({ ...s, id: await insertProduct(s.name, s.price) });
    }

    const options: ModifierOption[] = STARTER_FLAVORS.map((f) => ({
      label: f.label,
      price_mod: 0,
      category: f.category,
    }));
    // Default del grupo = el más permisivo; cada link lleva su override exacto.
    const groupMax = Math.max(...sizes.map((s) => s.max));
    let group: { id: string } | undefined;
    try {
      group = await tx.queryOne<{ id: string }>(
        `INSERT INTO modifier_groups (vendor_id, group_name, options, required, max_selections, min_selections, is_variant)
         VALUES ($1, 'Gustos', $2, true, $3, 1, true) RETURNING id`,
        [vendor.id, JSON.stringify(options), groupMax]
      );
    } catch (e) {
      if (!isMissingColumnError(e)) throw e;
      group = await tx.queryOne<{ id: string }>(
        `INSERT INTO modifier_groups (vendor_id, group_name, options, required, max_selections, is_variant)
         VALUES ($1, 'Gustos', $2, true, $3, true) RETURNING id`,
        [vendor.id, JSON.stringify(options), groupMax]
      );
    }
    if (!group) throw new Error("No se pudo crear el grupo Gustos");

    try {
      let pos = 0;
      for (const p of productIds) {
        await tx.queryVoid(
          `INSERT INTO product_modifier_links (group_id, product_id, position, max_selections, min_selections)
           VALUES ($1, $2, $3, $4, $5)`,
          [group.id, p.id, pos++, p.max, p.min]
        );
      }
    } catch (e) {
      if (!isMissingColumnError(e)) throw e;
      let pos = 0;
      for (const p of productIds) {
        await tx.queryVoid(
          `INSERT INTO product_modifier_links (group_id, product_id, position)
           VALUES ($1, $2, $3)`,
          [group.id, p.id, pos++]
        );
      }
    }

    return { products: productIds.map((p) => ({ id: p.id, name: p.name })), group_id: group.id };
  }).catch((e: Error) => {
    if (e?.message === "DUPLICATE_GROUP" || e?.message === "DUPLICATE_PRODUCT") return null;
    throw e;
  });

  if (!created) {
    return NextResponse.json(
      { error: "Ya tenés un grupo Gustos o productos de helado: revisá el menú antes de crear el kit de nuevo." },
      { status: 409 }
    );
  }
  return NextResponse.json({ ok: true, ...created });
}
