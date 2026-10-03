import { query, queryOne, queryMany } from "@/lib/db";
import { getVendorByRequest } from "@/lib/vendor-utils";
import { NextResponse } from "next/server";
import { dispatchPrint, type CashClosingPrintData, type FiscalPrintInfo, type PrinterVendor } from "@/lib/thermal-printer";
import { resolveVendorPlan } from "@/lib/plans";
import type { Order, Plan, Vendor } from "@/types/database";

export async function POST(request: Request) {
  const { vendor: gateVendor, staffRole } = await getVendorByRequest(request);
  if (!gateVendor) {
    return NextResponse.json({ ok: false, error: "No autenticado" }, { status: 401 });
  }
  // Repartidores no imprimen (mismo alcance que antes: dueño/admin/preview).
  if (staffRole === "delivery") {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 403 });
  }

  const body = await request.json();
  const { orderId, test, type, tableName, subLabel, items, total } = body;
  // Info de efectivo para precuenta (viene del panel, es solo informativa).
  const cashPct = Number(body.cashPct) || 0;
  const cashTotal = Number(body.cashTotal) || 0;

  const vendor = await queryOne<PrinterVendor & Vendor>(
    `SELECT * FROM vendors WHERE id = $1 LIMIT 1`,
    [gateVendor.id]
  );

  if (!vendor) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 403 });
  }

  const plans = await queryMany<Plan>(`SELECT * FROM plans`);
  const plan = resolveVendorPlan(vendor, plans || []);
  if (!plan.can("printer")) {
    return NextResponse.json(
      { ok: false, error: "Impresión exclusiva del plan Gestión integral", code: "plan_limit" },
      { status: 403 }
    );
  }

  if (test) {
    const result = await dispatchPrint({ vendor, type: "test" });
    await recordLastPrint(vendor.id, result);
    return printResponse(result);
  }

  // Cierre de caja (Z): imprime el cierre guardado tal cual quedó en la DB.
  if (type === "cash_close") {
    const closingId = body.closingId;
    if (!closingId) {
      return NextResponse.json({ ok: false, error: "closingId requerido" }, { status: 400 });
    }
    const closing = await queryOne<CashClosingPrintData>(
      `SELECT c.closed_at, c.since, c.orders_count, c.gross_total, c.discounts_total, c.net_total,
              c.by_method, c.cash_declared, c.cash_difference, c.notes,
              s.opened_at, c.opening_amount, p.full_name AS opened_by_name,
              cb.full_name AS closed_by_name,
              c.movements, c.expected_cash
       FROM cash_closings c
       LEFT JOIN cash_shifts s ON s.id = c.shift_id
       LEFT JOIN profiles p ON p.id = s.opened_by
       LEFT JOIN profiles cb ON cb.id = c.created_by
       WHERE c.id = $1 AND c.vendor_id = $2 LIMIT 1`,
      [closingId, vendor.id]
    ).catch(async () => {
      // Migración de turnos sin aplicar: ticket legacy sin datos de apertura.
      return queryOne<CashClosingPrintData>(
        `SELECT closed_at, since, orders_count, gross_total, discounts_total, net_total,
                by_method, cash_declared, cash_difference, notes
         FROM cash_closings WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
        [closingId, vendor.id]
      );
    });
    if (!closing) {
      return NextResponse.json({ ok: false, error: "Cierre no encontrado" }, { status: 404 });
    }
    const result = await dispatchPrint({ vendor, type: "cash_close", extra: { closing } });
    await recordLastPrint(vendor.id, result);
    return printResponse(result);
  }

  // Presupuesto de oficio (servicios): imprime el cotizado guardado. Gatea por
  // quotes_respond (Oficios), no por impresora: el plomero imprime su
  // presupuesto aunque no tenga cocina ni POS.
  if (type === "presupuesto") {
    if (!plan.can("quotes_respond")) {
      return NextResponse.json(
        { ok: false, error: "Imprimir presupuestos requiere el plan Oficios", code: "plan_limit" },
        { status: 403 }
      );
    }
    const quoteId = body.quoteId;
    if (!quoteId) {
      return NextResponse.json({ ok: false, error: "quoteId requerido" }, { status: 400 });
    }
    const quote = await queryOne<Record<string, unknown>>(
      `SELECT customer_name, customer_phone, service_name, description, quoted_price,
              deposit_pct, deposit_amount, preferred_date, created_at
       FROM quotes WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
      [quoteId, vendor.id]
    );
    if (!quote) {
      return NextResponse.json({ ok: false, error: vendor.vertical === "estetica" ? "Consulta no encontrada" : "Presupuesto no encontrado" }, { status: 404 });
    }
    const items = await queryMany<{ kind: string; description: string; qty: number; unit_price: number }>(
      `SELECT kind, description, qty, unit_price FROM quote_items WHERE quote_id = $1 ORDER BY position ASC`,
      [quoteId]
    ).catch(() => []);
    const total = items.length > 0
      ? Math.round(items.reduce((s, it) => s + Number(it.qty) * Number(it.unit_price), 0) * 100) / 100
      : Number(quote.quoted_price) || 0;
    const result = await dispatchPrint({
      vendor,
      type: "presupuesto",
      extra: {
        quote: {
          docTitle: vendor.vertical === "estetica" ? "CONSULTA" : undefined,
          customer_name: String(quote.customer_name || ""),
          customer_phone: (quote.customer_phone as string) || null,
          service_name: (quote.service_name as string) || null,
          description: String(quote.description || ""),
          items: (items || []).map((it) => ({
            kind: String(it.kind || "material"),
            description: String(it.description || ""),
            qty: Number(it.qty) || 0,
            unit_price: Number(it.unit_price) || 0,
          })),
          total,
          deposit_pct: quote.deposit_pct != null ? Number(quote.deposit_pct) : null,
          deposit_amount: quote.deposit_amount != null ? Number(quote.deposit_amount) : null,
          validity: quote.preferred_date ? `Fecha estimada: ${quote.preferred_date}` : null,
          created_at: String(quote.created_at || new Date().toISOString()),
        },
      },
    });
    await recordLastPrint(vendor.id, result);
    return printResponse(result);
  }

  // Precuenta de mesa: no es un pedido; solo ítems + total + nombre de mesa.
  if (type === "precuenta") {
    if (!Array.isArray(items) || items.length === 0 || !total) {
      return NextResponse.json({ ok: false, error: "items y total requeridos" }, { status: 400 });
    }
    const result = await dispatchPrint({
      vendor,
      type: "precuenta",
      extra: { tableName, items, total: Number(total), cashPct, cashTotal, volumeDiscount: Number(body.volumeDiscount) || 0 },
    });
    await recordLastPrint(vendor.id, result);
    return printResponse(result);
  }

  // Etiqueta de góndola: por productId único o productIds[] (lote, máx 50).
  // Valida dueño + trae nombre/precio/promo/SKU/unit de cada producto.
  if (type === "label") {
    const singleId = typeof body.productId === "string" && body.productId ? body.productId : null;
    const idsList = Array.isArray(body.productIds)
      ? body.productIds
          .filter((v: unknown): v is string => typeof v === "string" && !!v)
          .slice(0, 50)
      : [];
    const ids = singleId ? [singleId] : idsList;
    if (ids.length === 0) {
      return NextResponse.json({ ok: false, error: "productId requerido" }, { status: 400 });
    }
    const selectSql = (skuExpr: string) =>
      `SELECT id, name, price, promo_price, unit, ${skuExpr} FROM products WHERE vendor_id = $1 AND id = ANY($2::uuid[]) ORDER BY name`;
    let products: Array<{
      id: string;
      name: string;
      price: number;
      promo_price: number | null;
      unit: string | null;
      sku: string | null;
    }> = [];
    try {
      products = await queryMany(selectSql("sku"), [vendor.id, ids]);
    } catch {
      products = await queryMany(selectSql("NULL::text AS sku"), [vendor.id, ids]);
    }
    if (products.length === 0) {
      return NextResponse.json({ ok: false, error: "Producto no encontrado" }, { status: 404 });
    }
    const sinCodigo: string[] = [];
    const toPrint = products.map((p) => {
      const sku = String((p as any).sku || "").trim();
      if (sku) return { ...p, _code: sku };
      sinCodigo.push(String(p.name));
      return { ...p, _code: `P-${String(p.id).replace(/-/g, "").slice(0, 10).toUpperCase()}` };
    });
    if (toPrint.length === 0) {
      return NextResponse.json({ ok: false, error: "No hay productos para imprimir" }, { status: 400 });
    }
    const copies = Math.min(50, Math.max(1, Math.floor(Number(body.copies) || 1)));
    let printed = 0;
    let lastResult: { ok: boolean; error?: string } = { ok: false };
    for (const p of toPrint) {
      const result = await dispatchPrint({
        vendor,
        type: "label",
        extra: {
          label: {
            name: String(p.name || "Producto"),
            price: Number(p.promo_price ?? p.price) || 0,
            oldPrice: p.promo_price != null ? Number(p.price) : null,
            unit: p.unit ?? null,
            code: p._code,
            copies,
          },
        },
      });
      await recordLastPrint(vendor.id, result);
      lastResult = result;
      if (result.ok) printed++;
    }
    return NextResponse.json({
      ok: lastResult.ok,
      printed,
      total: toPrint.length,
      sinCodigo,
      ...(lastResult.ok ? {} : { error: lastResult.error || "No se pudo imprimir" }),
    });
  }

  if (!orderId) {
    return NextResponse.json({ ok: false, error: "orderId requerido" }, { status: 400 });
  }

  const order = await queryOne<Order>(
    `SELECT * FROM orders WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
    [orderId, vendor.id]
  );

  if (!order) {
    return NextResponse.json({ error: "Pedido no encontrado" }, { status: 404 });
  }

  // Fiado impago: saldo de la cuenta para el ticket (tolerante).
  async function fiadoBalanceExtra(vendorId: string, o: Order): Promise<{ fiadoBalance?: number }> {
    try {
      if ((o.payment_method as string) !== "fiado" || o.paid_at || !o.customer_phone) return {};
      const r = await queryOne<{ balance: number }>(
        `SELECT COALESCE(SUM(CASE WHEN kind = 'charge' THEN amount ELSE -amount END), 0) AS balance
         FROM account_moves WHERE vendor_id = $1 AND customer_phone = $2`,
        [vendorId, o.customer_phone]
      );
      const b = Math.round(Number(r?.balance) * 100) / 100;
      return Number.isFinite(b) && b > 0 ? { fiadoBalance: b } : {};
    } catch {
      return {};
    }
  }

  const resolvedType = type === "ticket" ? "ticket" : type === "retiro" ? "retiro" : type === "despacho" ? "despacho" : "comanda";
  // Venta directa: ticket completo en todas las verticales, sin cartel
  // grande ni talones: "Mostrador · Nro. X" en tamaño normal.
  const isDirectOrder = (order as any)?.is_direct === true;
  // Retail (moda/comercio/estética): el ticket sale como COMPROBANTE con Nro. diario
  // y datos del cliente; gastronomía mantiene TICKET. La directa no usa retail.
  const isRetailVendor = !isDirectOrder && (vendor.vertical === "moda" || vendor.vertical === "comercio" || vendor.vertical === "estetica");
  // Bloque fiscal: si el pedido tiene comprobante ARCA, el ticket lo imprime
  // con CAE + QR (tolerante a migración fiscal sin aplicar).
  let fiscal: FiscalPrintInfo | null = null;
  if (resolvedType === "ticket") {
    try {
      // invoiceId opcional: reimprime un comprobante puntual (ej. la NC en
      // vez de la factura). Sin él, el primero del pedido.
      const invoiceId = typeof body.invoiceId === "string" && body.invoiceId ? body.invoiceId : null;
      type InvRow = {
        cbte_tipo: number;
        punto_venta: number;
        cbte_nro: number;
        cae: string;
        cae_vto: string;
        total: number;
        created_at: string;
        asoc_pto: number | null;
        asoc_nro: number | null;
        receptor_doc_tipo: number | null;
        receptor_doc_nro: string | null;
        receptor_nombre: string | null;
      };
      const caeVtoSql = `CASE WHEN pg_typeof(cae_vto) = 'date'::regtype THEN to_char(cae_vto, 'YYYYMMDD') ELSE cae_vto::text END AS cae_vto`;
      const whereSql = invoiceId
        ? `WHERE vendor_id = $1 AND id = $2 LIMIT 1`
        : `WHERE vendor_id = $1 AND order_id = $2 ORDER BY created_at ASC LIMIT 1`;
      const whereVals = invoiceId ? [vendor.id, invoiceId] : [vendor.id, orderId];
      // Tolerante a migrate-fiscal-nc.sql sin aplicar (sin asoc_* igual
      // imprime la factura) y a migrate-fiscal-receptor.sql sin aplicar.
      let inv: InvRow | null = null;
      try {
        inv =
          (await queryOne<InvRow>(
            `SELECT cbte_tipo, punto_venta, cbte_nro, cae, ${caeVtoSql}, total, created_at, asoc_pto, asoc_nro,
                    receptor_doc_tipo, receptor_doc_nro, receptor_nombre
             FROM invoices ${whereSql}`,
            whereVals
          )) ?? null;
      } catch {
        inv =
          (await queryOne<InvRow>(
            `SELECT cbte_tipo, punto_venta, cbte_nro, cae, ${caeVtoSql}, total, created_at,
                    NULL::integer AS asoc_pto, NULL::bigint AS asoc_nro,
                    NULL::integer AS receptor_doc_tipo, NULL::text AS receptor_doc_nro,
                    NULL::text AS receptor_nombre
             FROM invoices ${whereSql}`,
            whereVals
          )) ?? null;
      }
      if (inv && vendor.cuit) {
        const { buildQrUrl } = await import("@/lib/arca/qr");
        const cbteTipo = Number(inv.cbte_tipo) || 11;
        fiscal = {
          cuit: vendor.cuit,
          puntoVenta: Number(inv.punto_venta),
          cbteNro: Number(inv.cbte_nro),
          cae: String(inv.cae),
          caeVto: String(inv.cae_vto).replace(/\D/g, ""),
          fechaEmision: inv.created_at ? new Date(inv.created_at).toISOString() : null,
          condIva: vendor.fiscal_cond_iva ?? null,
          docLabel: cbteTipo === 13 ? "NOTA DE CRÉDITO C" : "FACTURA C",
          receptorDocTipo: inv.receptor_doc_tipo ?? null,
          receptorDocNro: inv.receptor_doc_nro ?? null,
          receptorNombre: inv.receptor_nombre ?? null,
          asocLabel:
            cbteTipo === 13 && inv.asoc_nro != null
              ? `${String(inv.asoc_pto ?? inv.punto_venta).padStart(4, "0")}-${String(inv.asoc_nro).padStart(8, "0")}`
              : null,
          qrUrl: buildQrUrl({
            cuit: vendor.cuit,
            ptoVta: Number(inv.punto_venta),
            cbteTipo,
            cbteNro: Number(inv.cbte_nro),
            importe: Number(inv.total),
            cae: String(inv.cae),
            fecha: new Date(),
          }),
        };
      }
    } catch {
      fiscal = null;
    }
  }
  const result = await dispatchPrint({
    vendor,
    order,
    type: resolvedType,
    extra: {
      tableName,
      subLabel,
      ...(resolvedType === "ticket" && isDirectOrder
        ? { docTitle: "TICKET", direct: true }
        : resolvedType === "ticket" && isRetailVendor
          ? { docTitle: "COMPROBANTE", retail: true }
          : {}),
      ...(await fiadoBalanceExtra(vendor.id, order)),
    },
  });
  await recordLastPrint(vendor.id, result);
  return printResponse(result);
}

function printResponse(result: { ok: boolean; mode: string; skipped?: boolean; offline?: boolean; error?: string }) {
  const body: Record<string, unknown> = { ok: result.ok, mode: result.mode };
  if (result.skipped) body.reason = "Impresora no configurada";
  if (result.offline) body.offline = true;
  body.error = result.error;
  return NextResponse.json(body);
}

async function recordLastPrint(
  vendorId: string,
  result: { ok: boolean; skipped?: boolean; error?: string }
) {
  if (result.skipped) return;
  await query(
    `UPDATE vendors SET last_print_at = now(), last_print_ok = $1, last_print_error = $2 WHERE id = $3`,
    [result.ok, result.ok ? null : result.error || null, vendorId]
  );
}