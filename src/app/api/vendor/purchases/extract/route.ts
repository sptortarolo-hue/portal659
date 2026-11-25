import { NextResponse } from "next/server";
import { gateRequest, gateError } from "@/lib/subscription-gate";
import { saveUploadedFile } from "@/lib/upload-file";
import { extractInvoice, suggestMatches, MATCH_THRESHOLD, type CatalogItem } from "@/lib/invoice-extract";
import { queryMany, queryOne } from "@/lib/db";
import { fileSha256, findDuplicatePurchase } from "@/lib/purchase-dedupe";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const GATE_MSG = "Compras e inventario forman parte del plan Gestión integral";

export async function POST(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (!gate.plan.can("recipes") && !gate.plan.can("inventory")) {
    return NextResponse.json({ error: GATE_MSG }, { status: 403 });
  }

  const form = await request.formData();
  const file = form.get("file") as File | null;
  if (!file || !file.size) {
    return NextResponse.json({ error: "Archivo requerido" }, { status: 400 });
  }

  const isPdf =
    file.type === "application/pdf" || (file.name || "").toLowerCase().endsWith(".pdf");
  const isImage = file.type.startsWith("image/");
  if (!isPdf && !isImage) {
    return NextResponse.json(
      { error: "El archivo debe ser una imagen o un PDF" },
      { status: 400 }
    );
  }

  let url: string;
  try {
    url = await saveUploadedFile({ file, folder: "purchases", vendorId: gate.vendor.id });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "No se pudo subir el archivo" },
      { status: 400 }
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const mimeType =
    file.type ||
    (isPdf ? "application/pdf" : "image/jpeg");
  console.log("[extract] start", {
    vendorId: gate.vendor.id,
    mimeType,
    size: buffer.length,
    name: String(file.name || "").slice(0, 80),
  });

  try {
    const { extracted, raw, usedProvider } = await extractInvoice(buffer, mimeType);

    // Catálogo del comercio para sugerir match por línea.
    const [ings, prods, vars] = await Promise.all([
      queryMany<{ id: string; name: string }>(
        `SELECT id, name FROM ingredients WHERE vendor_id = $1`,
        [gate.vendor.id]
      ).catch(() => []),
      queryMany<{ id: string; name: string }>(
        `SELECT id, name FROM products WHERE vendor_id = $1`,
        [gate.vendor.id]
      ).catch(() => []),
      queryMany<{ id: string; product_id: string; color: string | null; talle: string | null }>(
        `SELECT v.id, v.product_id, v.color, v.talle
           FROM product_variants v JOIN products p ON p.id = v.product_id
          WHERE p.vendor_id = $1`,
        [gate.vendor.id]
      ).catch(() => []),
    ]);

    const catalog: CatalogItem[] = [];
    for (const i of ings || []) catalog.push({ id: i.id, name: i.name, kind: "ingredient" });
    for (const p of prods || []) catalog.push({ id: p.id, name: p.name, kind: "product" });
    for (const v of vars || []) {
      const label = [v.color, v.talle].filter((s) => String(s || "").trim()).join(" ");
      catalog.push({
        id: v.id,
        name: label ? `${v.product_id} ${label}` : v.id,
        kind: "variant",
      });
    }

    // Mejor: para variantes usamos el nombre del producto padre si lo tenemos.
    // (El join anterior no trae el nombre; lo resolvemos aparte.)
    const prodNameById = new Map((prods || []).map((p) => [p.id, p.name]));
    for (const c of catalog) {
      if (c.kind === "variant") {
        // c.name quedó como "productId color talle"; lo rearmamos con el nombre real.
        const parts = c.name.split(" ");
        const pid = parts[0];
        const rest = parts.slice(1).join(" ");
        const pname = prodNameById.get(pid);
        if (pname) c.name = rest ? `${pname} (${rest})` : pname;
      }
    }

    const itemsWithSuggestions = extracted.items.map((it) => {
      const suggestions = suggestMatches(it.description, catalog, 3);
      const best = suggestions.length > 0 && suggestions[0].score >= MATCH_THRESHOLD ? suggestions[0] : null;
      return { ...it, suggestions, bestMatch: best };
    });

    // Dedupe: hash del archivo + match fuerte/débil con compras existentes.
    const supplierName = String(extracted.supplier_name || "").trim();
    const supplier = supplierName
      ? await queryOne<{ id: string }>(
          `SELECT id FROM suppliers
            WHERE vendor_id=$1 AND lower(btrim(name))=lower(btrim($2)) LIMIT 1`,
          [gate.vendor.id, supplierName]
        ).catch(() => null)
      : null;
    const total = extracted.items.reduce((s, i) => s + (Number(i.line_total) || 0), 0);
    const duplicate = await findDuplicatePurchase({
      vendorId: gate.vendor.id,
      supplierId: supplier?.id || null,
      receiptNumber: extracted.receipt_number,
      total,
      purchasedAt: extracted.purchased_at,
      fileHash: fileSha256(buffer),
    }).catch(() => null);

    console.log("[extract] ok", { usedProvider, items: extracted.items.length, duplicate: duplicate?.type || null });
    return NextResponse.json({
      url,
      extracted: { ...extracted, items: itemsWithSuggestions },
      raw,
      usedProvider,
      duplicate,
      fileHash: fileSha256(buffer),
    });
  } catch (e: any) {
    const msg = e?.message || "No se pudo leer el comprobante";
    console.error("[extract] error", msg);
    // El archivo ya quedó guardado: lo devolvemos para que el comerciante
    // lo use manualmente si la IA falla.
    return NextResponse.json({ error: msg, url }, { status: 502 });
  }
}