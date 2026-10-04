import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryMany } from "@/lib/db";
import { NextResponse } from "next/server";
import ExcelJS from "exceljs";

/**
 * Reporte de comisiones por profesional (v1: solo reporte, sin split
 * automático de dinero). Suma turnos CONFIRMADOS en el rango (default: mes
 * en curso) con precio y % snapshot del momento de la reserva.
 * - GET /api/vendor/estetica-staff/report?from=YYYY-MM-DD&to=YYYY-MM-DD&format=json|xlsx|csv
 */
export async function GET(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (gate.vendor.vertical !== "estetica") {
    return NextResponse.json({ error: "Solo disponible para estética" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const iso = (s: string | null) => (/^\d{4}-\d{2}-\d{2}$/.test(s || "") ? s! : null);
  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const from = iso(searchParams.get("from")) || monthStart;
  const to = iso(searchParams.get("to")) || "2999-12-31";
  const format = searchParams.get("format") === "xlsx" ? "xlsx" : searchParams.get("format") === "csv" ? "csv" : "json";

  try {
    let rows;
    try {
      // Snapshot (migrate-estetica-commissions.sql).
      rows = await queryMany<{
        staff_id: string | null;
        staff_name: string | null;
        turnos: number;
        total: number;
        comision: number;
      }>(
        `SELECT b.staff_id::text AS staff_id, st.name AS staff_name,
                COUNT(*)::int AS turnos,
                COALESCE(SUM(b.service_price), 0)::float AS total,
                COALESCE(SUM(b.service_price * COALESCE(b.commission_pct, 0) / 100), 0)::float AS comision
         FROM bookings b
         LEFT JOIN estetica_staff st ON st.id = b.staff_id
         WHERE b.vendor_id = $1 AND b.status = 'confirmed'
           AND b.booking_date >= $2 AND b.booking_date <= $3
         GROUP BY b.staff_id, st.name
         ORDER BY comision DESC`,
        [gate.vendor.id, from, to]
      );
    } catch {
      // Sin snapshot: precio/% vigentes del catálogo.
      rows = await queryMany<{
        staff_id: string | null;
        staff_name: string | null;
        turnos: number;
        total: number;
        comision: number;
      }>(
        `SELECT b.staff_id::text AS staff_id, st.name AS staff_name,
                COUNT(*)::int AS turnos,
                COALESCE(SUM(s.price), 0)::float AS total,
                COALESCE(SUM(s.price * COALESCE(s.commission_pct, st.commission_pct, 0) / 100), 0)::float AS comision
         FROM bookings b
         LEFT JOIN services s ON s.id = b.service_id
         LEFT JOIN estetica_staff st ON st.id = b.staff_id
         WHERE b.vendor_id = $1 AND b.status = 'confirmed'
           AND b.booking_date >= $2 AND b.booking_date <= $3
         GROUP BY b.staff_id, st.name
         ORDER BY comision DESC`,
        [gate.vendor.id, from, to]
      );
    }
    const list = (rows || []).map((r) => ({
      staffId: r.staff_id,
      staffName: r.staff_name || "Sin asignar",
      turnos: Number(r.turnos) || 0,
      total: Math.round(Number(r.total) || 0),
      comision: Math.round(Number(r.comision) || 0),
    }));
    const totals = {
      turnos: list.reduce((s, r) => s + r.turnos, 0),
      total: list.reduce((s, r) => s + r.total, 0),
      comision: list.reduce((s, r) => s + r.comision, 0),
    };
    if (format === "json") return NextResponse.json({ from, to, rows: list, totals });

    const store = String((gate.vendor as any)?.store_name || "Mi comercio");
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const filename = `portal659-comisiones-${stamp}`;

    if (format === "xlsx") {
      const wb = new ExcelJS.Workbook();
      wb.creator = "Portal 659";
      const moneyFmt = '"$"#,##0';
      const metaWs = wb.addWorksheet("Resumen");
      metaWs.columns = [
        { header: "Campo", key: "k", width: 22 },
        { header: "Valor", key: "v", width: 42 },
      ];
      metaWs.addRow({ k: "Comercio", v: store });
      metaWs.addRow({ k: "Reporte", v: "Comisiones por profesional" });
      metaWs.addRow({ k: "Período", v: `${from} al ${to}` });
      metaWs.addRow({ k: "Emitido", v: new Date().toLocaleString("es-AR") });
      const ws = wb.addWorksheet("Comisiones");
      ws.columns = [
        { header: "Profesional", key: "staffName", width: 30 },
        { header: "Turnos", key: "turnos", width: 12 },
        { header: "Facturación", key: "total", width: 16 },
        { header: "Comisión", key: "comision", width: 16 },
      ];
      ws.getRow(1).font = { bold: true };
      for (const r of list) ws.addRow(r);
      ws.addRow({ staffName: "TOTAL", turnos: totals.turnos, total: totals.total, comision: totals.comision });
      ws.getColumn(3).numFmt = moneyFmt;
      ws.getColumn(4).numFmt = moneyFmt;
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
      ["Comercio", store].map(cell).join(";"),
      ["Reporte", "Comisiones por profesional"].map(cell).join(";"),
      ["Período", `${from} al ${to}`].map(cell).join(";"),
      ["Emitido", new Date().toLocaleString("es-AR")].map(cell).join(";"),
      "",
      ["Profesional", "Turnos", "Facturación", "Comisión"].map(cell).join(";"),
      ...list.map((r) => [r.staffName, r.turnos, r.total, r.comision].map(cell).join(";")),
      ["TOTAL", totals.turnos, totals.total, totals.comision].map(cell).join(";"),
    ];
    return new NextResponse("\uFEFF" + lines.join("\r\n"), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}.csv"`,
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Falta aplicar la migración migrate-estetica.sql en la base" },
      { status: 503 }
    );
  }
}
