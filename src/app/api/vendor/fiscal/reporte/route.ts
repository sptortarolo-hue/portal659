import { queryMany, queryOne } from "@/lib/db";
import { getVendorByRequest } from "@/lib/vendor-utils";
import { resolveVendorPlan } from "@/lib/plans";
import type { Plan, Vendor } from "@/types/database";
import { NextResponse } from "next/server";

type Row = {
  cbte_tipo: number;
  total: number;
  created_at: string;
  cbte_nro: number;
  punto_venta: number;
  cae: string;
  env: string;
  customer_name: string | null;
};

const csvCell = (v: string | number | null | undefined): string => {
  const s = String(v ?? "");
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * Reporte fiscal por período (facturado − anulado = neto).
 * GET /api/vendor/fiscal/reporte?desde=YYYY-MM-DD&hasta=YYYY-MM-DD[&format=csv]
 * Default: mes actual. Incluye facturas (11) y NC (13).
 */
export async function GET(request: Request) {
  const { vendor: gateVendor } = await getVendorByRequest(request);
  if (!gateVendor) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  const vendor = await queryOne<Vendor>(
    `SELECT * FROM vendors WHERE id = $1 LIMIT 1`,
    [gateVendor.id]
  );
  if (!vendor) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const plans = await queryMany<Plan>(`SELECT * FROM plans`);
  const plan = resolveVendorPlan(vendor, plans || []);
  if (!plan.can("fiscal")) {
    return NextResponse.json(
      { error: "Facturación electrónica exclusiva del plan Gestión integral", code: "plan_limit" },
      { status: 403 }
    );
  }

  const { searchParams } = new URL(request.url);
  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const desde = searchParams.get("desde") || monthStart;
  const hasta = searchParams.get("hasta") || now.toISOString().slice(0, 10);
  const format = searchParams.get("format") || "json";

  const rows = await queryMany<Row>(
    `SELECT i.cbte_tipo, i.total, i.created_at, i.cbte_nro, i.punto_venta,
            i.cae, i.env, o.customer_name
     FROM invoices i LEFT JOIN orders o ON o.id = i.order_id
     WHERE i.vendor_id = $1 AND i.created_at >= $2::date
       AND i.created_at < ($3::date + INTERVAL '1 day')
     ORDER BY i.created_at ASC`,
    [vendor.id, desde, hasta]
  );
  const list = rows || [];

  const sum = (tipo: number) =>
    list.filter((r) => Number(r.cbte_tipo) === tipo).reduce((s, r) => s + Number(r.total), 0);
  const facturado = sum(11);
  const anulado = sum(13);
  const summary = {
    desde,
    hasta,
    facturas: list.filter((r) => Number(r.cbte_tipo) === 11).length,
    notas_credito: list.filter((r) => Number(r.cbte_tipo) === 13).length,
    facturado: Math.round(facturado * 100) / 100,
    anulado: Math.round(anulado * 100) / 100,
    neto: Math.round((facturado - anulado) * 100) / 100,
  };

  if (format === "csv") {
    const header = ["Fecha", "Tipo", "Número", "Cliente", "Total", "CAE", "Entorno"];
    const lines = list.map((r) =>
      [
        csvCell(String(r.created_at).slice(0, 10)),
        csvCell(Number(r.cbte_tipo) === 13 ? "Nota de Crédito C" : "Factura C"),
        csvCell(
          `${String(r.punto_venta).padStart(4, "0")}-${String(r.cbte_nro).padStart(8, "0")}`
        ),
        csvCell(r.customer_name || ""),
        csvCell(Number(r.total).toFixed(2)),
        csvCell(r.cae),
        csvCell(r.env === "homo" ? "Prueba" : "Producción"),
      ].join(",")
    );
    const csv = "﻿" + [header.join(","), ...lines].join("\n");
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="fiscal-${desde}_${hasta}.csv"`,
      },
    });
  }

  const byDay: Record<string, { facturado: number; anulado: number; count: number }> = {};
  for (const r of list) {
    const day = String(r.created_at).slice(0, 10);
    byDay[day] = byDay[day] || { facturado: 0, anulado: 0, count: 0 };
    if (Number(r.cbte_tipo) === 13) byDay[day].anulado += Number(r.total);
    else byDay[day].facturado += Number(r.total);
    byDay[day].count += 1;
  }

  return NextResponse.json({ summary, by_day: byDay, rows: list });
}
