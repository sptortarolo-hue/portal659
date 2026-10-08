import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryMany } from "@/lib/db";
import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import {
  EXPENSE_CATEGORIES,
  EXPENSE_SOURCE_LABELS,
  normalizeExpenseCategory,
  type ExpenseSource,
} from "@/lib/expenses";
import { recordExpense } from "@/lib/expenses-server";

const GATE_MSG = "Los gastos forman parte del plan Gestión integral";
const MAX_RANGE_DAYS = 366;

function parseDate(v: string | null, fallback: Date): Date {
  if (!v) return fallback;
  const d = new Date(v.length <= 10 ? `${v}T00:00:00-03:00` : v);
  return Number.isNaN(d.getTime()) ? fallback : d;
}

/**
 * Libro de gastos: lista + totales con filtros.
 * GET /api/vendor/expenses?from=&to=&category=&source=&q=&format=json|xlsx|csv
 */
export async function GET(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (!gate.plan.can("pos")) {
    return NextResponse.json({ error: GATE_MSG, code: "plan_limit" }, { status: 403 });
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
  const category = normalizeExpenseCategory(url.searchParams.get("category"));
  const sourceRaw = (url.searchParams.get("source") || "").trim();
  const source: ExpenseSource | null =
    sourceRaw === "manual" || sourceRaw === "caja" || sourceRaw === "compra" ? sourceRaw : null;
  const q = (url.searchParams.get("q") || "").trim().toLowerCase();

  let rows: Record<string, any>[];
  try {
    const conds = [`e.vendor_id = $1`, `e.spent_at >= $2`, `e.spent_at <= $3`];
    const params: unknown[] = [
      gate.vendor.id,
      from.toISOString().slice(0, 10),
      to.toISOString().slice(0, 10),
    ];
    if (category) {
      params.push(category);
      conds.push(`e.category = $${params.length}`);
    }
    if (source) {
      params.push(source);
      conds.push(`e.source = $${params.length}`);
    }
    if (q) {
      params.push(`%${q}%`);
      conds.push(
        `(LOWER(COALESCE(e.supplier, '')) LIKE $${params.length} OR LOWER(COALESCE(e.note, '')) LIKE $${params.length} OR LOWER(e.category) LIKE $${params.length})`
      );
    }
    rows = await queryMany<Record<string, any>>(
      `SELECT e.id, e.source, e.source_id, e.category, e.amount, e.spent_at,
              e.supplier, e.note, e.payment_method, e.created_at,
              p.full_name AS created_by_name
       FROM expenses e LEFT JOIN profiles p ON p.id = e.created_by
       WHERE ${conds.join(" AND ")}
       ORDER BY e.spent_at DESC, e.created_at DESC
       LIMIT 1000`,
      params
    );
  } catch {
    return NextResponse.json(
      { error: "Falta aplicar la migración de gastos en la base de datos", code: "migration_pending" },
      { status: 503 }
    );
  }
  rows = rows || [];

  let total = 0;
  const byCategory: Record<string, { count: number; total: number }> = {};
  for (const r of rows) {
    const amount = Number(r.amount) || 0;
    total += amount;
    const c = String(r.category || "Varios");
    if (!byCategory[c]) byCategory[c] = { count: 0, total: 0 };
    byCategory[c].count++;
    byCategory[c].total = Math.round((byCategory[c].total + amount) * 100) / 100;
  }
  total = Math.round(total * 100) / 100;

  const payload = {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    count: rows.length,
    total,
    byCategory,
    expenses: rows.map((r) => ({
      id: r.id,
      source: r.source,
      source_id: r.source_id,
      category: r.category,
      amount: Number(r.amount) || 0,
      spent_at: r.spent_at,
      supplier: r.supplier,
      note: r.note,
      payment_method: r.payment_method,
      created_by_name: r.created_by_name || null,
      created_at: r.created_at,
    })),
  };

  const format = url.searchParams.get("format") || "json";
  if (format !== "xlsx" && format !== "csv") return NextResponse.json(payload);

  const vendor = gate.vendor as Record<string, unknown>;
  const storeName = String(vendor?.store_name || "Comercio");
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `portal659-gastos-${stamp}`;
  const fmtDate = (v: string) => String(v).slice(0, 10).split("-").reverse().join("/");
  const detailRows = payload.expenses.map((e) => ({
    fecha: fmtDate(String(e.spent_at)),
    categoria: e.category,
    origen: EXPENSE_SOURCE_LABELS[e.source as ExpenseSource] || e.source,
    proveedor: e.supplier || "—",
    detalle: e.note || "—",
    medio: e.payment_method || "—",
    monto: e.amount,
  }));

  if (format === "xlsx") {
    const wb = new ExcelJS.Workbook();
    wb.creator = "Portal 659";
    const moneyFmt = '"$"#,##0.00';
    const meta = wb.addWorksheet("Resumen");
    meta.columns = [
      { header: "Campo", key: "k", width: 22 },
      { header: "Valor", key: "v", width: 42 },
    ];
    meta.addRow({ k: "Comercio", v: storeName });
    meta.addRow({ k: "Reporte", v: "Libro de gastos" });
    meta.addRow({ k: "Período", v: `${payload.from} al ${payload.to}` });
    meta.addRow({ k: "Emitido", v: new Date().toLocaleString("es-AR") });
    meta.addRow({ k: "Total", v: payload.total });
    const catWs = wb.addWorksheet("Por categoría");
    catWs.columns = [
      { header: "Categoría", key: "c", width: 24 },
      { header: "Movimientos", key: "count", width: 14 },
      { header: "Total", key: "total", width: 18 },
    ];
    catWs.getRow(1).font = { bold: true };
    for (const [c, d] of Object.entries(byCategory)) {
      catWs.addRow({ c, count: d.count, total: d.total });
    }
    catWs.getColumn(3).numFmt = moneyFmt;
    const det = wb.addWorksheet("Detalle");
    det.columns = [
      { header: "Fecha", key: "fecha", width: 12 },
      { header: "Categoría", key: "categoria", width: 20 },
      { header: "Origen", key: "origen", width: 12 },
      { header: "Proveedor", key: "proveedor", width: 26 },
      { header: "Detalle", key: "detalle", width: 34 },
      { header: "Medio", key: "medio", width: 16 },
      { header: "Monto", key: "monto", width: 16 },
    ];
    det.getRow(1).font = { bold: true };
    for (const r of detailRows) det.addRow(r);
    det.getColumn(7).numFmt = moneyFmt;
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
    ["Reporte", "Libro de gastos"].map(cell).join(";"),
    [`Período`, `${payload.from} al ${payload.to}`].map(cell).join(";"),
    ["Emitido", new Date().toLocaleString("es-AR")].map(cell).join(";"),
    ["Total", payload.total].map(cell).join(";"),
    "",
    ["Categoría", "Movimientos", "Total"].map(cell).join(";"),
    ...Object.entries(byCategory).map(([c, d]) => [c, d.count, d.total].map(cell).join(";")),
    "",
    ["Fecha", "Categoría", "Origen", "Proveedor", "Detalle", "Medio", "Monto"].map(cell).join(";"),
    ...detailRows.map((r) => [r.fecha, r.categoria, r.origen, r.proveedor, r.detalle, r.medio, r.monto].map(cell).join(";")),
  ];
  return new NextResponse(String.fromCharCode(0xFEFF) + lines.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}.csv"`,
    },
  });
}

/** Carga manual de un gasto. Body: { category, amount, spent_at?, supplier?, note?, payment_method? } */
export async function POST(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (!gate.plan.can("pos")) {
    return NextResponse.json({ error: GATE_MSG, code: "plan_limit" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const category = normalizeExpenseCategory(body?.category);
  if (!category) {
    return NextResponse.json(
      { error: `Categoría inválida (usá: ${EXPENSE_CATEGORIES.join(", ")})` },
      { status: 400 }
    );
  }
  const amount = Number(body?.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount >= 1e9) {
    return NextResponse.json({ error: "Indicá un monto mayor a 0" }, { status: 400 });
  }
  const spentAt =
    typeof body?.spent_at === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.spent_at)
      ? body.spent_at
      : null;

  const id = await recordExpense({
    vendorId: gate.vendor.id,
    source: "manual",
    category,
    amount,
    spentAt,
    supplier: typeof body?.supplier === "string" ? body.supplier : null,
    note: typeof body?.note === "string" ? body.note : null,
    paymentMethod: typeof body?.payment_method === "string" ? body.payment_method : null,
    createdBy: gate.previewSession ? null : gate.user.id,
  });
  if (!id) {
    return NextResponse.json(
      { error: "No se pudo guardar (¿falta la migración migrate-expenses.sql?)" },
      { status: 400 }
    );
  }
  return NextResponse.json({ ok: true, id });
}
