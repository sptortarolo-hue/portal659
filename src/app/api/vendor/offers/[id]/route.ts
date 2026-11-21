import { getVendorByRequest, resolveCategoryName } from "@/lib/vendor-utils";
import { queryOne, withTransaction } from "@/lib/db";
import { isValidDateOnly, toDateOnly } from "@/lib/expiry";
import { normalizePlu } from "@/lib/scale-barcode";
import { NextResponse } from "next/server";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const params = await context.params;
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const body = await request.json();
  // Tarjetas de regalo: se gestionan en la pestaña Tarjetas (montos, foto,
  // pausar, borrar). El catálogo no las toca: precio/categoría/sku van
  // atados a la denominación y romperlos desarma la venta.
  const current = await queryOne<{ sku: string | null; category: string | null }>(
    `SELECT sku, category FROM products WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
    [params.id, vendor.id]
  ).catch(() => null);
  const isGift =
    String(current?.sku || "").startsWith("GC-") ||
    String(current?.category || "").trim().toLowerCase() === "giftcards";
  if (isGift) {
    return NextResponse.json(
      { error: "Las tarjetas de regalo se gestionan en la pestaña Tarjetas" },
      { status: 409 }
    );
  }
  const allowedFields = [
    "name", "description", "price", "category", "image_url",
    "available", "featured_today", "stock", "promo_price",
    "stock_low_threshold", "currency", "neighborhood", "type", "unit",
    "has_variants", "stock_control", "requires_prep", "cash_discount_excluded",
    "pack_size", "size_guide", "promo_only", "sku", "supplier_id", "expires_at",
    "online_available", "scale_plu", "margin_list_id",
    "count_pack", "package_price",
    "parent_id", "presentation_label", "presentation_qty", "presentation_unit",
  "suggestible",
  ] as const;

  const safeUpdate: Record<string, unknown> = {};
  for (const key of allowedFields) {
    if (key in body) safeUpdate[key] = body[key];
  }
  // Tolerante a migración de packs sin aplicar: sin la columna, se ignora.
  if ("pack_size" in safeUpdate) {
    const hasPack = await queryOne<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_name = 'products' AND column_name = 'pack_size'
       ) AS exists`
    );
    if (hasPack?.exists === true) {
      safeUpdate.pack_size =
        Number.isInteger(Number(safeUpdate.pack_size)) && Number(safeUpdate.pack_size) >= 2
          ? Math.floor(Number(safeUpdate.pack_size))
          : null;
    } else {
      delete safeUpdate.pack_size;
    }
  }
  // Guía de talles (moda): tolerante a migración sin aplicar.
  if ("size_guide" in safeUpdate) {
    const hasSizeGuide = await queryOne<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_name = 'products' AND column_name = 'size_guide'
       ) AS exists`
    );
    if (hasSizeGuide?.exists === true) {
      safeUpdate.size_guide =
        safeUpdate.size_guide && String(safeUpdate.size_guide).trim()
          ? String(safeUpdate.size_guide).trim().slice(0, 2000)
          : null;
    } else {
      delete safeUpdate.size_guide;
    }
  }
  // Unidad de venta (balanza): 'kg' o 'unidad'. Tolerante a migración sin aplicar.
  if ("unit" in safeUpdate) {
    const hasUnit = await queryOne<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_name = 'products' AND column_name = 'unit'
       ) AS exists`
    );
    if (hasUnit?.exists === true) {
      safeUpdate.unit = safeUpdate.unit === "kg" ? "kg" : "unidad";
    } else {
      delete safeUpdate.unit;
    }
  }
  // Envasado (migrate-elaboration.sql): count_pack + package_price.
  if ("count_pack" in safeUpdate || "package_price" in safeUpdate) {
    const hasElab = await queryOne<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_name = 'products' AND column_name = 'count_pack'
       ) AS exists`
    ).catch(() => ({ exists: false }));
    const wantsCountPack = safeUpdate.count_pack === true;
    const pp = safeUpdate.package_price;
    const wantsPackagePrice = pp !== undefined && pp !== null && String(pp).trim() !== "";
    if (hasElab?.exists !== true) {
      // Sin migración: se ignora en silencio, salvo que se intente guardar envasado.
      if (wantsCountPack || wantsPackagePrice) {
        return NextResponse.json({ error: "Falta aplicar migrate-elaboration.sql para guardar productos envasados" }, { status: 503 });
      }
      delete safeUpdate.count_pack;
      delete safeUpdate.package_price;
    } else {
      if ("count_pack" in safeUpdate) {
        safeUpdate.count_pack = safeUpdate.count_pack === true;
      }
      if ("package_price" in safeUpdate) {
        const v = safeUpdate.package_price;
        if (v === null || v === "" || v === undefined) {
          safeUpdate.package_price = null;
        } else {
          const n = Number(v);
          if (!isFinite(n) || n < 0) {
            return NextResponse.json({ error: "El precio del paquete debe ser un número mayor o igual a 0" }, { status: 400 });
          }
          safeUpdate.package_price = Math.round(n * 100) / 100;
        }
      }
      if (safeUpdate.count_pack === true) {
        const urow = await queryOne<{ unit: string | null }>(
          `SELECT unit FROM products WHERE id = $1 AND vendor_id = $2`,
          [params.id, vendor.id]
        );
        const effUnit = "unit" in safeUpdate ? String(safeUpdate.unit || "") : String(urow?.unit || "");
        if (effUnit !== "kg") {
          return NextResponse.json({ error: "Un producto envasado debe ser por kilo (unidad kg)" }, { status: 400 });
        }
      }
    }
  }
  // SKU: tolerante a migración sin aplicar; vacío limpia.
  if ("sku" in safeUpdate) {
    const hasSku = await queryOne<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_name = 'products' AND column_name = 'sku'
       ) AS exists`
    );
    if (hasSku?.exists === true) {
      safeUpdate.sku =
        safeUpdate.sku != null && String(safeUpdate.sku).trim() !== ""
          ? String(safeUpdate.sku).trim().slice(0, 64)
          : null;
    } else {
      delete safeUpdate.sku;
    }
  }
  if ("sku" in safeUpdate && safeUpdate.sku != null) {
    const dup = await queryOne<{ id: string }>(
      `SELECT id FROM products WHERE vendor_id = $1 AND sku = $2 AND id <> $3 LIMIT 1`,
      [vendor.id, safeUpdate.sku, params.id]
    ).catch(() => null);
    if (dup) {
      return NextResponse.json({ error: `El código "${safeUpdate.sku}" ya está en otro producto` }, { status: 400 });
    }
  }
  // PLU de balanza: se guarda normalizado y sin duplicados. Vacío = se usa el
  // SKU como fallback. Tolerante a migración sin aplicar (solo si hay algo
  // que guardar: un null nunca debe romper el ABM).
  if ("scale_plu" in safeUpdate) {
    const hasScalePlu = await queryOne<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_name = 'products' AND column_name = 'scale_plu'
       ) AS exists`
    ).catch(() => ({ exists: false }));
    const rawPlu = safeUpdate.scale_plu;
    const nextPlu = rawPlu != null && String(rawPlu).trim() !== "" ? normalizePlu(rawPlu) : null;
    if (hasScalePlu?.exists !== true) {
      // Sin la columna: guardar un PLU avisa; limpiar (null) simplemente se
      // ignora (el catálogo manda `scale_plu: null` en cada guardado de un
      // producto que no es "Por peso" y eso no debe romper el ABM).
      if (nextPlu != null) {
        return NextResponse.json(
          { error: "Falta aplicar supabase/self-host/migrate-scale-labels.sql para guardar el PLU de balanza" },
          { status: 503 }
        );
      }
      delete safeUpdate.scale_plu;
    } else {
      safeUpdate.scale_plu = nextPlu;
    }
  }
  // Presentaciones (migrate-product-presentations.sql): tolerante a migración sin aplicar.
  const hasPresCol = await queryOne<{ exists: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'products' AND column_name = 'parent_id') AS exists`
  ).catch(() => ({ exists: false }));
  if (hasPresCol?.exists !== true) {
    delete safeUpdate.parent_id;
    delete safeUpdate.presentation_label;
    delete safeUpdate.presentation_qty;
    delete safeUpdate.presentation_unit;
  } else {
    if ("parent_id" in safeUpdate) {
      const v = safeUpdate.parent_id;
      safeUpdate.parent_id = v != null && String(v).trim() !== "" ? String(v).trim() : null;
    }
    if ("presentation_label" in safeUpdate) {
      const v = safeUpdate.presentation_label;
      safeUpdate.presentation_label = v != null && String(v).trim() !== "" ? String(v).trim().slice(0, 64) : null;
    }
    if ("presentation_qty" in safeUpdate) {
      const v = safeUpdate.presentation_qty;
      if (v == null || v === "") {
        safeUpdate.presentation_qty = null;
      } else {
        const n = Number(v);
        safeUpdate.presentation_qty = Number.isFinite(n) && n > 0 ? n : null;
      }
    }
    if ("presentation_unit" in safeUpdate) {
      const v = String(safeUpdate.presentation_unit ?? "").trim();
      safeUpdate.presentation_unit = v === "kg" || v === "u" || v === "ml" ? v : null;
    }
  }
  if ("scale_plu" in safeUpdate && safeUpdate.scale_plu != null) {
    const dupPlu = await queryOne<{ id: string; name: string }>(
      `SELECT id, name FROM products
       WHERE vendor_id = $1 AND lower(btrim(scale_plu)) = lower($2) AND id <> $3 LIMIT 1`,
      [vendor.id, safeUpdate.scale_plu, params.id]
    ).catch(() => null);
    if (dupPlu) {
      return NextResponse.json(
        { error: `El PLU de balanza "${safeUpdate.scale_plu}" ya está en “${dupPlu.name}”` },
        { status: 400 }
      );
    }
  }
  // Proveedor habitual (inventario): tolerante a migración sin aplicar.
  if ("supplier_id" in safeUpdate) {
    const hasSupplier = await queryOne<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_name = 'products' AND column_name = 'supplier_id'
       ) AS exists`
    );
    if (hasSupplier?.exists === true) {
      const sid =
        safeUpdate.supplier_id != null && String(safeUpdate.supplier_id).trim() !== ""
          ? String(safeUpdate.supplier_id).trim()
          : null;
      if (sid) {
        const owned = await queryOne<{ id: string }>(
          `SELECT id FROM suppliers WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
          [sid, vendor.id]
        ).catch(() => null);
        if (!owned) {
          return NextResponse.json({ error: "Proveedor no encontrado" }, { status: 400 });
        }
      }
      safeUpdate.supplier_id = sid;
    } else {
      delete safeUpdate.supplier_id;
    }
  }
  // Vencimiento del stock (inventario): tolerante a migración sin aplicar.
  if ("expires_at" in safeUpdate) {
    const hasExpires = await queryOne<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_name = 'products' AND column_name = 'expires_at'
       ) AS exists`
    );
    if (hasExpires?.exists === true) {
      const raw = safeUpdate.expires_at;
      if (raw != null && String(raw).trim() !== "" && !isValidDateOnly(String(raw))) {
        return NextResponse.json({ error: "Fecha de vencimiento inválida (usá AAAA-MM-DD)" }, { status: 400 });
      }
      safeUpdate.expires_at = raw != null && String(raw).trim() !== "" ? toDateOnly(raw) : null;
    } else {
      delete safeUpdate.expires_at;
    }
  }
  // Productos sugeribles en el carrito (migrate-product-suggestions.sql):
  // tolerante a migración sin aplicar. Valida elegibilidad si se activa.
  if ("suggestible" in safeUpdate) {
    const hasSuggestible = await queryOne<{ exists: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'products' AND column_name = 'suggestible') AS exists`
    ).catch(() => ({ exists: false }));
    if (hasSuggestible?.exists !== true) {
      if (safeUpdate.suggestible === true) {
        return NextResponse.json(
          { error: "Falta aplicar migrate-product-suggestions.sql para marcar productos sugeribles" },
          { status: 503 }
        );
      }
      delete safeUpdate.suggestible;
    } else {
      const want = safeUpdate.suggestible === true;
      safeUpdate.suggestible = want;
      if (want) {
        // Validar elegibilidad
        const { loadSuggestibleContext, isEligible } = await import("@/lib/suggestible-server");
        const ctx = await loadSuggestibleContext(vendor.id);
        const prod = await queryOne<any>(
          `SELECT id, available, parent_id FROM products WHERE id = $1 AND vendor_id = $2`,
          [params.id, vendor.id]
        ).catch(() => null);
        if (prod) {
          const elig = isEligible(prod, ctx);
          if (!elig.eligible) {
            return NextResponse.json(
              { error: elig.reason || "Este producto no es sugerible" },
              { status: 400 }
            );
          }
        }
        // posición = max actual + 1 si no tenía
        const cur = await queryOne<{ suggestible: boolean; suggestible_position: number }>(
          `SELECT suggestible, suggestible_position FROM products WHERE id = $1 AND vendor_id = $2`,
          [params.id, vendor.id]
        ).catch(() => null);
        if (!cur?.suggestible) {
          const maxPos = await queryOne<{ m: number | null }>(
            `SELECT COALESCE(MAX(suggestible_position), 0) AS m FROM products WHERE vendor_id = $1`,
            [vendor.id]
          ).catch(() => ({ m: 0 }));
          safeUpdate.suggestible_position = (Number(maxPos?.m) || 0) + 1;
        }
      } else {
        safeUpdate.suggestible_position = 0;
      }
    }
  }
  // Venta online on/off (taller): tolerante a migración sin aplicar.
  if ("online_available" in safeUpdate) {
    const hasOnline = await queryOne<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_name = 'products' AND column_name = 'online_available'
       ) AS exists`
    );
    if (hasOnline?.exists === true) {
      safeUpdate.online_available = safeUpdate.online_available === true;
    } else {
      delete safeUpdate.online_available;
    }
  }
  // Lista de margen (migrate-margin-lists.sql): tolerante a migración sin
  // aplicar; valida que la lista sea del propio comercio.
  if ("margin_list_id" in safeUpdate) {
    const hasMarginList = await queryOne<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_name = 'products' AND column_name = 'margin_list_id'
       ) AS exists`
    ).catch(() => ({ exists: false }));
    if (hasMarginList?.exists === true) {
      const raw = safeUpdate.margin_list_id;
      const mlid =
        raw != null && String(raw).trim() !== "" ? String(raw).trim() : null;
      if (mlid) {
        const owned = await queryOne<{ id: string }>(
          `SELECT id FROM margin_lists WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
          [mlid, vendor.id]
        ).catch(() => null);
        if (!owned) {
          return NextResponse.json({ error: "Lista de margen no encontrada" }, { status: 400 });
        }
        safeUpdate.margin_list_id = mlid;
      } else {
        safeUpdate.margin_list_id = null;
      }
    } else {
      delete safeUpdate.margin_list_id;
    }
  }
  // Costo de compra manual (inventario): tolerante a migración sin aplicar.
  // Solo números >= 0 (null/ausente = sin cambio).
  if ("cost_last" in body) {
    const hasCost = await queryOne<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_name = 'products' AND column_name = 'cost_last'
       ) AS exists`
    );
    const n = Number(body.cost_last);
    if (hasCost?.exists === true && Number.isFinite(n) && n >= 0) {
      safeUpdate.cost_last = Math.round(n * 100) / 100;
    }
  }
  if ("cash_discount_excluded" in safeUpdate) {
    safeUpdate.cash_discount_excluded = safeUpdate.cash_discount_excluded === true;
  }
  // Solo-promo (vidriera): tolerante a migración sin aplicar.
  if ("promo_only" in safeUpdate) {
    const hasPromoOnly = await queryOne<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_name = 'products' AND column_name = 'promo_only'
       ) AS exists`
    );
    if (hasPromoOnly?.exists === true) {
      safeUpdate.promo_only = safeUpdate.promo_only === true;
    } else {
      delete safeUpdate.promo_only;
    }
  }
  // Normalizar categoría igual que al crear (evita variantes duplicadas).
  if ("category" in safeUpdate) {
    safeUpdate.category = await resolveCategoryName(vendor.id, safeUpdate.category);
  }
  if (Object.keys(safeUpdate).length === 0) {
    return NextResponse.json({ error: "No hay campos válidos para actualizar" }, { status: 400 });
  }

  const setClauses: string[] = [];
  const values: unknown[] = [params.id, vendor.id];
  let idx = 3;
  for (const [key, val] of Object.entries(safeUpdate)) {
    setClauses.push(`${key} = $${idx}`);
    values.push(val);
    idx++;
  }

  // Ajuste manual de stock desde el menú: deja rastro en kardex (razón manual).
  let manualDelta: number | null = null;
  if ("stock" in safeUpdate) {
    const prev = await queryOne<{ stock: number | null }>(
      `SELECT stock FROM products WHERE id = $1 AND vendor_id = $2`,
      [params.id, vendor.id]
    ).catch(() => null);
    const oldS = prev?.stock == null ? null : Number(prev.stock);
    const newS = safeUpdate.stock == null ? null : Number(safeUpdate.stock);
    if (oldS != null && Number.isFinite(newS as number) && (newS as number) !== oldS) {
      manualDelta = (newS as number) - oldS;
    }
  }

  const offer = await queryOne<Record<string, unknown>>(
    `UPDATE products SET ${setClauses.join(", ")} WHERE id = $1 AND vendor_id = $2 RETURNING *`,
    values
  );
  // Oferta del día única por comercio: al destacar un producto se apaga la
  // oferta anterior del mismo vendor (vale para todos los paneles, que usan
  // este PATCH para el toggle Destacar/Quitar).
  if (safeUpdate.featured_today === true && offer) {
    await queryOne(
      `UPDATE products SET featured_today = false WHERE vendor_id = $1 AND id <> $2`,
      [vendor.id, params.id]
    ).catch(() => {});
  }
  if (manualDelta != null && manualDelta !== 0) {
    const { logStockMovement } = await import("@/lib/stock-ledger");
    await withTransaction(async (tx) => {
      await logStockMovement(tx, {
        vendorId: vendor.id,
        product_id: params.id,
        qty_delta: manualDelta as number,
        reason: "manual",
      });
    }).catch(() => {});
  }

  // El catálogo cambió: mover el versionado de la tarjeta promo (?v=).
  const { touchPromoVersion } = await import("@/lib/promo-server");
  await touchPromoVersion(vendor.id);

  return NextResponse.json({
    offer: offer && "expires_at" in offer ? { ...offer, expires_at: toDateOnly(offer.expires_at) } : offer,
  });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const params = await context.params;
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  // Tarjetas: se borran desde la pestaña Tarjetas (borra montos + producto
  // juntos para no dejar huérfanos).
  const current = await queryOne<{ sku: string | null; category: string | null }>(
    `SELECT sku, category FROM products WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
    [params.id, vendor.id]
  ).catch(() => null);
  if (
    current &&
    (String(current.sku || "").startsWith("GC-") ||
      String(current.category || "").trim().toLowerCase() === "giftcards")
  ) {
    return NextResponse.json(
      { error: "Las tarjetas de regalo se borran desde la pestaña Tarjetas" },
      { status: 409 }
    );
  }

  await queryOne(
    `DELETE FROM products WHERE id = $1 AND vendor_id = $2 RETURNING id`,
    [params.id, vendor.id]
  );

  const body = await request.json();
  // Combo: si vienen líneas, se reemplazan en la misma transacción.
  // Tolerante a DB sin la tabla (migración sin aplicar).
  if (Array.isArray(body.combo_items)) {
    const incoming = body.combo_items
      .filter((x: any) => x && typeof x.product_id === "string")
      .map((x: any) => ({ product_id: String(x.product_id), qty: Math.max(1, Math.round(Number(x.qty) || 1)) }));
    try {
      const cur = await queryOne<{ id: string }>(
        `SELECT id FROM products WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
        [params.id, vendor.id]
      );
      if (cur) {
        await withTransaction(async (tx) => {
          await tx.queryVoid(`DELETE FROM combo_items WHERE combo_product_id = $1`, [params.id]);
          for (let i = 0; i < incoming.length; i++) {
            const c = incoming[i];
            await tx.queryVoid(
              `INSERT INTO combo_items (vendor_id, combo_product_id, member_product_id, qty, position)
               VALUES ($1, $2, $3, $4, $5)
               ON CONFLICT (combo_product_id, member_product_id) DO UPDATE SET qty = EXCLUDED.qty, position = EXCLUDED.position`,
              [vendor.id, params.id, c.product_id, c.qty, i]
            );
          }
        });
      }
    } catch {
      /* sin tabla: se ignora */
    }
  }
}