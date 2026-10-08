import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryMany } from "@/lib/db";
import { CASH_METHOD_LABELS } from "@/lib/cash-methods";
import { NextResponse } from "next/server";
import ExcelJS from "exceljs";

const MAX_RANGE_DAYS = 366;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function parseDate(v: string | null, fallback: Date): Date {
  if (!v) return fallback;
  const d = new Date(v.length <= 10 ? `${v}T00:00:00-03:00` : v);
  return Number.isNaN(d.getTime()) ? fallback : d;
}

/**
 * Consolidado de cierres (estilo ZZ): agrega los Z del rango.
 * GET /api/vendor/cash-closing/report?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Sin params: últimos 30 días. Rango máximo: 366 días.
 */
export async function GET(request: Request) {
  const gate = await gateRequest(request, { allowStaff: true });
  if (!gate.ok) return gateError(gate);
  if (!gate.plan.can("pos")) {
    return NextResponse.json(
      { error: "Los reportes de caja forman parte del plan Gestión integral", code: "plan_limit" },
      { status: 403 }
    );
  }

  const url = new URL(request.url);
  const now = new Date();
  const defFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  let from = parseDate(url.searchParams.get("from"), defFrom);
  let to = parseDate(url.searchParams.get("to"), now);
  if (from > to) [from, to] = [to, from];
  if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * 24 * 60 * 60 * 1000) {
    from = new Date(to.getTime() - MAX_RANGE_DAYS * 24 * 60 * 60 * 1000);
  }

  let rows: Record<string, any>[];
  try {
    rows = await queryMany<Record<string, any>>(
      `SELECT c.id, c.closed_at, c.since, c.orders_count, c.gross_total,
              c.discounts_total, c.net_total, c.by_method, c.cash_declared,
              c.cash_difference, c.notes, c.opening_amount, c.movements,
              c.expected_cash, s.opened_at, p.full_name AS opened_by_name,
              cb.full_name AS closed_by_name
       FROM cash_closings c
       LEFT JOIN cash_shifts s ON s.id = c.shift_id
       LEFT JOIN profiles p ON p.id = s.opened_by
       LEFT JOIN profiles cb ON cb.id = c.created_by
       WHERE c.vendor_id = $1 AND c.closed_at >= $2 AND c.closed_at <= $3
       ORDER BY c.closed_at ASC`,
      [gate.vendor.id, from.toISOString(), to.toISOString()]
    );
  } catch {
    // Migración de turnos sin aplicar: consolidado legacy sin esos datos.
    rows = await queryMany<Record<string, any>>(
      `SELECT id, closed_at, since, orders_count, gross_total,
              discounts_total, net_total, by_method, cash_declared,
              cash_difference, notes
       FROM cash_closings
       WHERE vendor_id = $1 AND closed_at >= $2 AND closed_at <= $3
       ORDER BY closed_at ASC`,
      [gate.vendor.id, from.toISOString(), to.toISOString()]
    );
  }
  rows = rows || [];

  const byMethod: Record<string, { count: number; total: number }> = {};
  let gross = 0;
  let discounts = 0;
  let net = 0;
  let orders = 0;
  let expected = 0;
  let declared = 0;
  let sobra = 0;
  let falta = 0;
  let opening = 0;
  let ingresos = 0;
  let retiros = 0;
  for (const r of rows) {
    for (const [m, d] of Object.entries((r.by_method || {}) as Record<string, any>)) {
      if (!byMethod[m]) byMethod[m] = { count: 0, total: 0 };
      byMethod[m].count += Number(d?.count) || 0;
      byMethod[m].total += Number(d?.total) || 0;
    }
    gross += Number(r.gross_total) || 0;
    discounts += Number(r.discounts_total) || 0;
    net += Number(r.net_total) || 0;
    orders += Number(r.orders_count) || 0;
    if (r.expected_cash != null) expected += Number(r.expected_cash) || 0;
    if (r.cash_declared != null) declared += Number(r.cash_declared) || 0;
    const diff = r.cash_difference != null ? Number(r.cash_difference) : null;
    if (diff != null) {
      if (diff > 0) sobra += diff;
      else falta += Math.abs(diff);
    }
    if (r.opening_amount != null) opening += Number(r.opening_amount) || 0;
    ingresos += Number(r.movements?.ingresos) || 0;
    retiros += Number(r.movements?.retiros) || 0;
  }
  for (const d of Object.values(byMethod)) d.total = round2(d.total);

  const payload = {
    from: from.toISOString(),
    to: to.toISOString(),
    count: rows.length,
    orders,
    byMethod,
    gross: round2(gross),
    discounts: round2(discounts),
    net: round2(net),
    expected: round2(expected),
    declared: round2(declared),
    sobra: round2(sobra),
    falta: round2(falta),
    opening: round2(opening),
    ingresos: round2(ingresos),
    retiros: round2(retiros),
    closings: rows,
  };

  const format = url.searchParams.get("format") || "json";
  if (format !== "xlsx" && format !== "csv") return NextResponse.json(payload);

  const vendor = gate.vendor as Record<string, unknown>;
  const storeName = String(vendor?.store_name || "Comercio");
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `portal659-caja-${stamp}`;
  const fmtDT = (v: string) =>
    new Date(v).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const methodRows = Object.entries(byMethod).map(([m, d]) => ({
    medio: CASH_METHOD_LABELS[m] || m,
    count: d.count,
    total: d.total,
  }));
  const detailRows = rows.map((r) => {
    const diff = r.cash_difference != null ? Number(r.cash_difference) : null;
    return {
      cierre: fmtDT(r.closed_at),
      abiertaPor: r.opened_by_name || "—",
      pedidos: Number(r.orders_count) || 0,
      neto: Number(r.net_total) || 0,
      esperado: r.expected_cash != null ? Number(r.expected_cash) : "",
      contado: r.cash_declared != null ? Number(r.cash_declared) : "",
      dif: diff == null ? "" : diff === 0 ? "Cuadra" : `${diff > 0 ? "Sobra " : "Falta "}${Math.abs(diff)}`,
    };
  });

  if (format === "xlsx") {
    const wb = new ExcelJS.Workbook();
    wb.creator = "Portal 659";
    const moneyFmt = '"$"#,##0.00';
    const table = (
      name: string,
      cols: { header: string; key: string; width?: number; numFmt?: string }[],
      recs: Record<string, any>[]
    ) => {
      const ws = wb.addWorksheet(name);
      ws.columns = cols.map((c) => ({ header: c.header, key: c.key, width: c.width || 20 }));
      ws.getRow(1).font = { bold: true };
      for (const r of recs) ws.addRow(r);
      cols.forEach((c, i) => {
        if (c.numFmt) ws.getColumn(i + 1).numFmt = c.numFmt;
      });
      return ws;
    };
    const meta = wb.addWorksheet("Resumen");
    meta.columns = [
      { header: "Campo", key: "k", width: 22 },
      { header: "Valor", key: "v", width: 42 },
    ];
    meta.addRow({ k: "Comercio", v: storeName });
    meta.addRow({ k: "Reporte", v: "Cierres de caja consolidados" });
    meta.addRow({ k: "Período", v: `${from.toISOString().slice(0, 10)} al ${to.toISOString().slice(0, 10)}` });
    meta.addRow({ k: "Emitido", v: new Date().toLocaleString("es-AR") });
    const sumRows = [
      { k: "Cierres", v: payload.count },
      { k: "Pedidos", v: payload.orders },
      { k: "Neto", v: payload.net },
      { k: "Bruto", v: payload.gross },
      { k: "Desc. efectivo", v: payload.discounts },
      { k: "Fondo inicial", v: payload.opening },
      { k: "Esperado", v: payload.expected },
      { k: "Contado", v: payload.declared },
      { k: "Sobra", v: payload.sobra },
      { k: "Falta", v: payload.falta },
      { k: "Ingresos manuales", v: payload.ingresos },
      { k: "Retiros manuales", v: payload.retiros },
    ];
    table("Resumen números", [{ header: "Concepto", key: "k" }, { header: "Valor", key: "v", numFmt: moneyFmt }], sumRows);
    table("Por método", [
      { header: "Medio", key: "medio", width: 24 },
      { header: "Pedidos", key: "count", width: 12 },
      { header: "Total", key: "total", numFmt: moneyFmt },
    ], methodRows);
    table("Detalle", [
      { header: "Cierre", key: "cierre", width: 18 },
      { header: "Abierta por", key: "abiertaPor", width: 22 },
      { header: "Pedidos", key: "pedidos", width: 12 },
      { header: "Neto", key: "neto", numFmt: moneyFmt },
      { header: "Esperado", key: "esperado", numFmt: moneyFmt },
      { header: "Contado", key: "contado", numFmt: moneyFmt },
      { header: "Dif.", key: "dif", width: 16 },
    ], detailRows);
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
    ["Comercio", storeName].map(cell).join(";"),
    ["Reporte", "Cierres de caja consolidados"].map(cell).join(";"),
    [`Período`, `${from.toISOString().slice(0, 10)} al ${to.toISOString().slice(0, 10)}`].map(cell).join(";"),
    ["Emitido", new Date().toLocaleString("es-AR")].map(cell).join(";"),
    "",
    ["Concepto", "Valor"].map(cell).join(";"),
    ...[
      ["Cierres", payload.count],
      ["Pedidos", payload.orders],
      ["Neto", payload.net],
      ["Bruto", payload.gross],
      ["Desc. efectivo", payload.discounts],
      ["Fondo inicial", payload.opening],
      ["Esperado", payload.expected],
      ["Contado", payload.declared],
      ["Sobra", payload.sobra],
      ["Falta", payload.falta],
      ["Ingresos manuales", payload.ingresos],
      ["Retiros manuales", payload.retiros],
    ].map((r) => r.map(cell).join(";")),
    "",
    ["Medio", "Pedidos", "Total"].map(cell).join(";"),
    ...methodRows.map((r) => [r.medio, r.count, r.total].map(cell).join(";")),
    "",
    ["Cierre", "Abierta por", "Pedidos", "Neto", "Esperado", "Contado", "Dif."].map(cell).join(";"),
    ...detailRows.map((r) => [r.cierre, r.abiertaPor, r.pedidos, r.neto, r.esperado, r.contado, r.dif].map(cell).join(";")),
  ];
  return new NextResponse(String.fromCharCode(0xFEFF) + lines.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}.csv"`,
    },
  });
}
