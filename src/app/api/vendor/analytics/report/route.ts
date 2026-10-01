import { getAuthUser } from "@/lib/auth";
import { queryMany, queryOne } from "@/lib/db";
import { getVendorByRequest } from "@/lib/vendor-utils";
import { resolveVendorPlan } from "@/lib/plans";
import { CASH_METHOD_LABELS } from "@/lib/cash-methods";
import { NextResponse } from "next/server";
import type { Plan, Vendor } from "@/types/database";
import ExcelJS from "exceljs";

export const dynamic = "force-dynamic";

const TZ_AR = "America/Argentina/Buenos_Aires";
const CHANNEL_LABEL: Record<string, string> = { app: "App / WhatsApp", mostrador: "Mostrador", mesa: "Mesas" };
const METHOD_LABEL: Record<string, string> = { pickup: "Retiro", delivery: "Domicilio" };

const TIPOS = ["ventas", "productos", "cobros", "clientes"] as const;
type Tipo = (typeof TIPOS)[number];
const TITLES: Record<Tipo, string> = {
  ventas: "Ventas del período",
  productos: "Productos",
  cobros: "Medios de cobro",
  clientes: "Clientes",
};

/** Día civil en horario argentino ("YYYY-MM-DD"). */
function dayKey(value: string | Date): string {
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toLocaleDateString("en-CA", { timeZone: TZ_AR });
}

/** Revenue de un ítem (pack-aware: con pack, price = paquete y qty = unidades). */
function itemRevenue(item: { price: number; qty: number; pack_size?: number | null }): number {
  const pack = Number(item.pack_size);
  if (pack >= 2) return item.price * (item.qty / pack);
  return item.price * item.qty;
}

const r0 = (n: unknown) => Math.round(Number(n) || 0);
const dayLabel = (key: string) => `${key.slice(8)}/${key.slice(5, 7)}`;

type OrderRow = Record<string, any>;

async function fetchReportOrders(vendorId: string, sinceISO: string): Promise<OrderRow[]> {
  // Tolerante a migraciones sin aplicar (mismo patrón que analytics).
  const cols = await queryMany<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'orders' AND column_name IN ('payment_method', 'cash_discount', 'volume_discount')`
  );
  const have = new Set((cols || []).map((r) => r.column_name));
  const extra = ["payment_method", "cash_discount", "volume_discount"]
    .filter((c) => have.has(c))
    .map((c) => `, ${c}`)
    .join("");
  return queryMany<OrderRow>(
    `SELECT id, items, total, status, method, channel, customer_name, customer_phone, customer_id, created_at${extra} FROM orders WHERE vendor_id = $1 AND is_preview = false AND created_at >= $2 ORDER BY created_at DESC`,
    [vendorId, sinceISO]
  );
}

function summarize(orders: OrderRow[]) {
  const completed = orders.filter((o) => o.status === "completed");
  const revenue = completed.reduce((s, o) => s + Number(o.total), 0);
  const cash = completed.reduce((s, o) => s + (Number(o.cash_discount) || 0), 0);
  const volume = completed.reduce((s, o) => s + (Number(o.volume_discount) || 0), 0);
  return {
    completed,
    revenue: r0(revenue),
    orders: completed.length,
    ticket: completed.length > 0 ? Math.round(revenue / completed.length) : 0,
    cancelled: orders.filter((o) => o.status === "cancelled").length,
    cash: r0(cash),
    volume: r0(volume),
  };
}

export async function GET(request: Request) {
  const authUser = await getAuthUser(request);
  if (!authUser) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const { vendor: resolved } = await getVendorByRequest(request);
  if (!resolved) return NextResponse.json({ error: "No tenés un local" }, { status: 403 });

  const vendor = await queryOne<Vendor & { store_name: string }>(
    `SELECT id, vertical, plan_id, plan_status, plan_expires_at, trial_ends_at, visible, store_name FROM vendors WHERE id = $1 LIMIT 1`,
    [resolved.id]
  );
  if (!vendor) return NextResponse.json({ error: "No tenés un local" }, { status: 403 });

  const plans = await queryMany<Plan>(`SELECT * FROM plans`);
  const plan = resolveVendorPlan(vendor, plans);
  if (!(plan.analyticsDays > 0)) {
    return NextResponse.json({ error: "Los reportes están disponibles en planes pagos" }, { status: 403 });
  }

  const url = new URL(request.url);
  const tipo = String(url.searchParams.get("tipo") || "ventas") as Tipo;
  if (!(TIPOS as readonly string[]).includes(tipo)) {
    return NextResponse.json({ error: "Tipo de reporte inválido (ventas, productos, cobros, clientes)" }, { status: 400 });
  }
  const format = String(url.searchParams.get("format") || "json");
  if (!["json", "xlsx", "csv"].includes(format)) {
    return NextResponse.json({ error: "Formato inválido (json, xlsx, csv)" }, { status: 400 });
  }

  const rangeParam = Number(url.searchParams.get("range") || 0);
  const lookback = rangeParam > 0
    ? Math.min(Math.max(rangeParam, 7), 366)
    : Math.min(Math.max(plan.analyticsDays, 30), 366);
  const now = new Date();
  const since = new Date(now.getTime() - lookback * 24 * 60 * 60 * 1000);
  const prevSince = new Date(now.getTime() - 2 * lookback * 24 * 60 * 60 * 1000);

  const orders = await fetchReportOrders(vendor.id, prevSince.toISOString());
  const current = orders.filter((o) => new Date(o.created_at) >= since);
  const previous = orders.filter((o) => new Date(o.created_at) < since);
  const sum = summarize(current);
  const prev = summarize(previous);
  const pctDelta = (cur: number, prv: number) =>
    prv > 0 ? Math.round(((cur - prv) / prv) * 100) : null;

  const meta = {
    tipo,
    title: TITLES[tipo],
    store: (vendor as any).store_name || "",
    range: lookback,
    since: dayKey(since),
    until: dayKey(now),
    generatedAt: now.toISOString(),
    plan: { slug: plan.slug, analyticsDays: plan.analyticsDays },
  };

  // ---- Series y agregados compartidos (solo completados, como el dashboard)
  const byDayMap = new Map<string, { count: number; revenue: number; cash: number; volume: number }>();
  for (const o of sum.completed) {
    const k = dayKey(o.created_at);
    const e = byDayMap.get(k) || { count: 0, revenue: 0, cash: 0, volume: 0 };
    e.count++;
    e.revenue += Number(o.total);
    e.cash += Number(o.cash_discount) || 0;
    e.volume += Number(o.volume_discount) || 0;
    byDayMap.set(k, e);
  }
  const byDay = [...byDayMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, d]) => ({ date, label: dayLabel(date), count: d.count, revenue: r0(d.revenue), cash: r0(d.cash), volume: r0(d.volume) }));

  const tally = (keyFn: (o: OrderRow) => string, labels?: Record<string, string>) => {
    const m = new Map<string, { count: number; revenue: number }>();
    for (const o of sum.completed) {
      const k = keyFn(o);
      const e = m.get(k) || { count: 0, revenue: 0 };
      e.count++;
      e.revenue += Number(o.total);
      m.set(k, e);
    }
    return [...m.entries()]
      .map(([k, d]) => ({ key: k, label: labels?.[k] || k, count: d.count, revenue: r0(d.revenue) }))
      .sort((a, b) => b.revenue - a.revenue);
  };
  const byChannel = tally((o) => o.channel || "app", CHANNEL_LABEL);
  const byMethod = tally((o) => o.method || "delivery", METHOD_LABEL);
  const byPay = tally((o) => (o as any).payment_method || "whatsapp", CASH_METHOD_LABELS);

  let payload: Record<string, any> = { meta };

  if (tipo === "ventas") {
    payload.summary = {
      revenue: sum.revenue,
      orders: sum.orders,
      ticket: sum.ticket,
      cancelled: sum.cancelled,
      cashDiscount: sum.cash,
      volumeDiscount: sum.volume,
      revenueDelta: pctDelta(sum.revenue, prev.revenue),
      ordersDelta: pctDelta(sum.orders, prev.orders),
      ticketDelta: pctDelta(sum.ticket, prev.ticket),
    };
    payload.byDay = byDay;
    payload.byChannel = byChannel;
    payload.byMethod = byMethod;
    payload.byPay = byPay;
  }

  if (tipo === "productos" || tipo === "ventas") {
    // Agregado de ítems (pack-aware, saltea líneas manuales de mostrador).
    const sales = new Map<string, { name: string; qty: number; revenue: number }>();
    for (const o of sum.completed) {
      for (const item of o.items || []) {
        if ((item as any)?.manual) continue;
        const e = sales.get(item.name) || { name: item.name, qty: 0, revenue: 0 };
        e.qty += Number(item.qty) || 0;
        e.revenue += itemRevenue(item);
        sales.set(item.name, e);
      }
    }
    const rows = [...sales.values()]
      .map((r) => ({ ...r, qty: r.qty, revenue: r0(r.revenue) }))
      .sort((a, b) => b.revenue - a.revenue);
    const totalRev = rows.reduce((s, r) => s + r.revenue, 0);
    const withShare = rows.map((r) => ({ ...r, share: totalRev > 0 ? Math.round((r.revenue / totalRev) * 100) : 0 }));
    if (tipo === "productos") {
      const prods = await queryMany<{ name: string; category: string | null; available: boolean }>(
        `SELECT name, category, available FROM products WHERE vendor_id = $1`,
        [vendor.id]
      );
      const catByName = new Map((prods || []).map((p) => [p.name, p.category || "Sin categoría"]));
      const sold = new Set(rows.map((r) => r.name));
      const byCat = new Map<string, { qty: number; revenue: number }>();
      for (const r of rows) {
        const c = catByName.get(r.name) || "Sin categoría";
        const e = byCat.get(c) || { qty: 0, revenue: 0 };
        e.qty += r.qty;
        e.revenue += r.revenue;
        byCat.set(c, e);
      }
      payload.summary = {
        revenue: sum.revenue,
        units: rows.reduce((s, r) => s + r.qty, 0),
        products: rows.length,
      };
      payload.rows = withShare.map((r) => ({ ...r, category: catByName.get(r.name) || "Sin categoría" }));
      payload.byCategory = [...byCat.entries()]
        .map(([category, d]) => ({ category, qty: d.qty, revenue: d.revenue }))
        .sort((a, b) => b.revenue - a.revenue);
      payload.dead = (prods || [])
        .filter((p) => p.available && !sold.has(p.name))
        .map((p) => ({ name: p.name, category: p.category || "Sin categoría" }));
    } else {
      payload.topProducts = withShare.slice(0, 10);
    }
  }

  if (tipo === "cobros") {
    payload.summary = {
      revenue: sum.revenue,
      orders: sum.orders,
      ticket: sum.ticket,
      cashDiscount: sum.cash,
      volumeDiscount: sum.volume,
    };
    payload.byPay = byPay;
    payload.daily = byDay;
  }

  if (tipo === "clientes") {
    const m = new Map<string, { name: string; phone: string; orders: number; revenue: number; last: string }>();
    for (const o of sum.completed) {
      const phone = String(o.customer_phone || "").trim();
      const key = phone || String(o.customer_id || "") || String(o.customer_name || "") || "s/d";
      const e = m.get(key) || { name: String(o.customer_name || "—"), phone, orders: 0, revenue: 0, last: "" };
      if (String(o.customer_name || "").trim()) e.name = String(o.customer_name).trim();
      if (phone) e.phone = phone;
      e.orders++;
      e.revenue += Number(o.total);
      const dk = dayKey(o.created_at);
      if (!e.last || dk > e.last) e.last = dk;
      m.set(key, e);
    }
    const rows = [...m.values()]
      .map((r) => ({ ...r, revenue: r0(r.revenue) }))
      .sort((a, b) => b.revenue - a.revenue);
    payload.summary = {
      customers: rows.length,
      recurring: rows.filter((r) => r.orders > 1).length,
      single: rows.filter((r) => r.orders <= 1).length,
      revenue: sum.revenue,
    };
    payload.rows = rows;
  }

  const stamp = dayKey(now).replace(/-/g, "");
  const filename = `portal659-reporte-${tipo}-${stamp}`;

  if (format === "json") return NextResponse.json(payload);

  if (format === "xlsx") {
    const wb = new ExcelJS.Workbook();
    wb.creator = "Portal 659";
    const moneyFmt = '"$"#,##0';
    const addMeta = (ws: ExcelJS.Worksheet) => {
      ws.columns = [
        { header: "Campo", key: "k", width: 22 },
        { header: "Valor", key: "v", width: 42 },
      ];
      ws.addRow({ k: "Comercio", v: meta.store });
      ws.addRow({ k: "Reporte", v: meta.title });
      ws.addRow({ k: "Período", v: `${meta.since} al ${meta.until} (${meta.range} días)` });
      ws.addRow({ k: "Emitido", v: new Date(meta.generatedAt).toLocaleString("es-AR") });
    };
    const table = (
      name: string,
      cols: { header: string; key: string; width?: number; numFmt?: string }[],
      rows: Record<string, any>[]
    ) => {
      const ws = wb.addWorksheet(name);
      ws.columns = cols.map((c) => ({ header: c.header, key: c.key, width: c.width || 20 }));
      ws.getRow(1).font = { bold: true };
      for (const r of rows) ws.addRow(r);
      cols.forEach((c, i) => {
        if (c.numFmt) ws.getColumn(i + 1).numFmt = c.numFmt;
      });
      return ws;
    };

    const metaWs = wb.addWorksheet("Resumen");
    addMeta(metaWs);
    const sumRows: Record<string, any>[] = [];
    const push = (k: string, v: number | string) => sumRows.push({ k, v });
    const s = (payload.summary || {}) as Record<string, any>;
    if (tipo === "ventas") {
      push("Facturación", s.revenue);
      push("Pedidos", s.orders);
      push("Ticket promedio", s.ticket);
      push("Cancelados", s.cancelled);
      push("Desc. efectivo", s.cashDiscount);
      push("Desc. volumen", s.volumeDiscount);
      table("Resumen números", [{ header: "Concepto", key: "k" }, { header: "Valor", key: "v", numFmt: moneyFmt }], sumRows);
      table("Por día", [
        { header: "Fecha", key: "label", width: 12 },
        { header: "Pedidos", key: "count", width: 12 },
        { header: "Facturación", key: "revenue", numFmt: moneyFmt },
      ], payload.byDay);
      table("Por canal", [
        { header: "Canal", key: "label", width: 24 },
        { header: "Pedidos", key: "count", width: 12 },
        { header: "Facturación", key: "revenue", numFmt: moneyFmt },
      ], payload.byChannel);
      table("Retiro/Domicilio", [
        { header: "Método", key: "label", width: 24 },
        { header: "Pedidos", key: "count", width: 12 },
        { header: "Facturación", key: "revenue", numFmt: moneyFmt },
      ], payload.byMethod);
      table("Medios de cobro", [
        { header: "Medio", key: "label", width: 24 },
        { header: "Cobros", key: "count", width: 12 },
        { header: "Facturación", key: "revenue", numFmt: moneyFmt },
      ], payload.byPay);
      table("Top productos", [
        { header: "Producto", key: "name", width: 34 },
        { header: "Unidades", key: "qty", width: 12 },
        { header: "Facturación", key: "revenue", numFmt: moneyFmt },
        { header: "%", key: "share", width: 10 },
      ], payload.topProducts);
    }
    if (tipo === "productos") {
      push("Facturación", s.revenue);
      push("Unidades", s.units);
      push("Productos con venta", s.products);
      table("Resumen números", [{ header: "Concepto", key: "k" }, { header: "Valor", key: "v", numFmt: moneyFmt }], sumRows);
      table("Productos", [
        { header: "Producto", key: "name", width: 34 },
        { header: "Categoría", key: "category", width: 22 },
        { header: "Unidades", key: "qty", width: 12 },
        { header: "Facturación", key: "revenue", numFmt: moneyFmt },
        { header: "%", key: "share", width: 10 },
      ], payload.rows);
      table("Por categoría", [
        { header: "Categoría", key: "category", width: 28 },
        { header: "Unidades", key: "qty", width: 12 },
        { header: "Facturación", key: "revenue", numFmt: moneyFmt },
      ], payload.byCategory);
      if ((payload.dead || []).length > 0) {
        table("Sin ventas", [
          { header: "Producto", key: "name", width: 34 },
          { header: "Categoría", key: "category", width: 22 },
        ], payload.dead);
      }
    }
    if (tipo === "cobros") {
      push("Facturación", s.revenue);
      push("Cobros", s.orders);
      push("Ticket promedio", s.ticket);
      push("Desc. efectivo", s.cashDiscount);
      push("Desc. volumen", s.volumeDiscount);
      table("Resumen números", [{ header: "Concepto", key: "k" }, { header: "Valor", key: "v", numFmt: moneyFmt }], sumRows);
      table("Medios de cobro", [
        { header: "Medio", key: "label", width: 24 },
        { header: "Cobros", key: "count", width: 12 },
        { header: "Facturación", key: "revenue", numFmt: moneyFmt },
      ], payload.byPay);
      table("Por día", [
        { header: "Fecha", key: "label", width: 12 },
        { header: "Facturación", key: "revenue", numFmt: moneyFmt },
        { header: "Desc. efectivo", key: "cash", numFmt: moneyFmt },
        { header: "Desc. volumen", key: "volume", numFmt: moneyFmt },
      ], payload.daily);
    }
    if (tipo === "clientes") {
      push("Clientes", s.customers);
      push("Recurrentes", s.recurring);
      push("De una compra", s.single);
      push("Facturación", s.revenue);
      table("Resumen números", [{ header: "Concepto", key: "k" }, { header: "Valor", key: "v", numFmt: moneyFmt }], sumRows);
      table("Clientes", [
        { header: "Cliente", key: "name", width: 30 },
        { header: "Teléfono", key: "phone", width: 20 },
        { header: "Pedidos", key: "orders", width: 12 },
        { header: "Facturación", key: "revenue", numFmt: moneyFmt },
        { header: "Última compra", key: "last", width: 16 },
      ], payload.rows);
    }

    const buf = await wb.xlsx.writeBuffer();
    return new NextResponse(buf as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}.xlsx"`,
      },
    });
  }

  // CSV (separador ; + BOM para Excel en español).
  const cell = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines: string[] = [
    ["Comercio", meta.store].map(cell).join(";"),
    ["Reporte", meta.title].map(cell).join(";"),
    [`Período`, `${meta.since} al ${meta.until} (${meta.range} días)`].map(cell).join(";"),
    ["Emitido", new Date(meta.generatedAt).toLocaleString("es-AR")].map(cell).join(";"),
    "",
  ];
  const csvTable = (headers: string[], rows: Record<string, any>[], keys: string[]) => {
    lines.push(headers.map(cell).join(";"));
    for (const r of rows || []) lines.push(keys.map((k) => cell(r[k])).join(";"));
    lines.push("");
  };
  if (tipo === "ventas") {
    const s = payload.summary;
    csvTable(["Concepto", "Valor"], [
      { k: "Facturación", v: s.revenue }, { k: "Pedidos", v: s.orders }, { k: "Ticket promedio", v: s.ticket },
      { k: "Cancelados", v: s.cancelled }, { k: "Desc. efectivo", v: s.cashDiscount }, { k: "Desc. volumen", v: s.volumeDiscount },
    ], ["k", "v"]);
    csvTable(["Fecha", "Pedidos", "Facturación"], payload.byDay, ["label", "count", "revenue"]);
    csvTable(["Canal", "Pedidos", "Facturación"], payload.byChannel, ["label", "count", "revenue"]);
    csvTable(["Método", "Pedidos", "Facturación"], payload.byMethod, ["label", "count", "revenue"]);
    csvTable(["Medio de cobro", "Cobros", "Facturación"], payload.byPay, ["label", "count", "revenue"]);
    csvTable(["Producto", "Unidades", "Facturación", "%"], payload.topProducts, ["name", "qty", "revenue", "share"]);
  }
  if (tipo === "productos") {
    const s = payload.summary;
    csvTable(["Concepto", "Valor"], [
      { k: "Facturación", v: s.revenue }, { k: "Unidades", v: s.units }, { k: "Productos con venta", v: s.products },
    ], ["k", "v"]);
    csvTable(["Producto", "Categoría", "Unidades", "Facturación", "%"], payload.rows, ["name", "category", "qty", "revenue", "share"]);
    csvTable(["Categoría", "Unidades", "Facturación"], payload.byCategory, ["category", "qty", "revenue"]);
    if ((payload.dead || []).length > 0) csvTable(["Sin ventas", "Categoría"], payload.dead, ["name", "category"]);
  }
  if (tipo === "cobros") {
    const s = payload.summary;
    csvTable(["Concepto", "Valor"], [
      { k: "Facturación", v: s.revenue }, { k: "Cobros", v: s.orders }, { k: "Ticket promedio", v: s.ticket },
      { k: "Desc. efectivo", v: s.cashDiscount }, { k: "Desc. volumen", v: s.volumeDiscount },
    ], ["k", "v"]);
    csvTable(["Medio de cobro", "Cobros", "Facturación"], payload.byPay, ["label", "count", "revenue"]);
    csvTable(["Fecha", "Facturación", "Desc. efectivo", "Desc. volumen"], payload.daily, ["label", "revenue", "cash", "volume"]);
  }
  if (tipo === "clientes") {
    const s = payload.summary;
    csvTable(["Concepto", "Valor"], [
      { k: "Clientes", v: s.customers }, { k: "Recurrentes", v: s.recurring }, { k: "De una compra", v: s.single }, { k: "Facturación", v: s.revenue },
    ], ["k", "v"]);
    csvTable(["Cliente", "Teléfono", "Pedidos", "Facturación", "Última compra"], payload.rows, ["name", "phone", "orders", "revenue", "last"]);
  }
  return new NextResponse("\uFEFF" + lines.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}.csv"`,
    },
  });
}
