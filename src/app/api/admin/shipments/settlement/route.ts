import { isAdmin } from "@/lib/admin-utils";
import { queryMany } from "@/lib/db";
import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { formatShipmentCode, SHIPMENT_STATUS_LABELS } from "@/lib/shipping";

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // exceljs no corre en edge

/**
 * Admin: liquidación de envíos por logística partner (Opción A: sin campo de
 * tarifa — el reporte lista lo cobrado al comprador como envío; la tarifa que
 * se le paga al carrier se pacta aparte y sale de este listado).
 * - GET /api/admin/shipments/settlement?carrierId=<uuid|all>&from=YYYY-MM-DD&to=YYYY-MM-DD&format=json|xlsx|csv
 * - Default: mes en curso (TZ AR).
 */
const TZ_AR = "America/Argentina/Buenos_Aires";

function fechaAR(offsetDays = 0): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ_AR,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(Date.now() + offsetDays * 24 * 3600 * 1000)); // YYYY-MM-DD en AR
}

/** Día de un timestamp (Date o string ISO) en TZ AR: YYYY-MM-DD. */
function diaAR(ts: string | Date | null | undefined): string {
  if (!ts) return "";
  const d = ts instanceof Date ? ts : new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ_AR, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

function monthStartAR(): string {
  return `${fechaAR().slice(0, 7)}-01`;
}

export async function GET(request: Request) {
  if (!(await isAdmin(request))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const iso = (s: string | null) => (/^\d{4}-\d{2}-\d{2}$/.test(s || "") ? s! : null);
  const from = iso(searchParams.get("from")) || monthStartAR();
  const to = iso(searchParams.get("to")) || fechaAR();
  const carrierParam = String(searchParams.get("carrierId") || "all").trim();
  const allCarriers = carrierParam === "all" || !carrierParam;
  const format =
    searchParams.get("format") === "xlsx" ? "xlsx" : searchParams.get("format") === "csv" ? "csv" : "json";

  // Rango acotado (patrón analytics: no liquidar O(kilómetros)).
  const fromD = new Date(`${from}T00:00:00Z`).getTime();
  const toD = new Date(`${to}T00:00:00Z`).getTime();
  if (Number.isFinite(fromD) && Number.isFinite(toD) && toD - fromD > 366 * 24 * 3600 * 1000) {
    return NextResponse.json({ error: "Rango demasiado amplio (máx 366 días)" }, { status: 400 });
  }

  try {
    const rows = await queryMany<{
      id: string;
      code: string;
      status: string;
      requested_at: string;
      delivered_at: string | null;
      pod_photo_url: string | null;
      pickup_number: number | null;
      delivery_fee: number | null;
      vendor_name: string | null;
      carrier_name: string | null;
      zone_name: string | null;
    }>(
      `SELECT s.id::text, s.code, s.status, s.requested_at, s.delivered_at, s.pod_photo_url,
              o.pickup_number, o.delivery_fee,
              v.store_name AS vendor_name, c.name AS carrier_name, s.shipping_zone_name AS zone_name
       FROM shipments s
       JOIN orders o ON o.id = s.order_id
       LEFT JOIN vendors v ON v.id = s.vendor_id
       LEFT JOIN carriers c ON c.id = s.carrier_id
       WHERE (s.requested_at AT TIME ZONE '${TZ_AR}')::date >= $1
         AND (s.requested_at AT TIME ZONE '${TZ_AR}')::date <= $2
         AND ($3::uuid IS NULL OR s.carrier_id = $3::uuid)
       ORDER BY s.requested_at ASC`,
      [from, to, allCarriers ? null : carrierParam]
    );

    const list = (rows || []).map((r) => ({
      code: formatShipmentCode(String(r.code)),
      fecha: diaAR(r.requested_at),
      carrier: r.carrier_name || "Sin asignar",
      comercio: r.vendor_name || "—",
      pedido: r.pickup_number != null ? `#${String(r.pickup_number).padStart(4, "0")}` : "—",
      zona: r.zone_name || "—",
      fee: Math.round(Number(r.delivery_fee) || 0),
      estado: SHIPMENT_STATUS_LABELS[r.status as keyof typeof SHIPMENT_STATUS_LABELS] || r.status,
      pod: r.pod_photo_url ? "Sí" : "No",
      entregado: diaAR(r.delivered_at),
    }));

    const byStatus: Record<string, number> = {};
    for (const r of (rows || [])) {
      const key = SHIPMENT_STATUS_LABELS[r.status as keyof typeof SHIPMENT_STATUS_LABELS] || r.status;
      byStatus[key] = (byStatus[key] || 0) + 1;
    }
    const totals = {
      envios: list.length,
      ...byStatus,
      feeCobrado: list.reduce((s, r) => s + r.fee, 0),
      feeEntregados: list.reduce((s, r) => (r.estado === "Entregado" ? s + r.fee : s), 0),
    };

    if (format === "json") {
      return NextResponse.json({ from, to, carrier: allCarriers ? "all" : carrierParam, rows: list, totals });
    }

    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const filename = `portal659-envios-liquidacion-${stamp}`;
    const periodo = `${from} al ${to === "2999-12-31" ? "hoy" : to}`;
    const alcance = allCarriers ? "Todas las logísticas" : list[0]?.carrier || "Logística seleccionada";

    if (format === "xlsx") {
      const wb = new ExcelJS.Workbook();
      wb.creator = "Portal 659";
      const moneyFmt = '"$"#,##0';
      const metaWs = wb.addWorksheet("Resumen");
      metaWs.columns = [
        { header: "Campo", key: "k", width: 22 },
        { header: "Valor", key: "v", width: 42 },
      ];
      metaWs.getRow(1).font = { bold: true };
      metaWs.addRow({ k: "Alcance", v: alcance });
      metaWs.addRow({ k: "Período", v: periodo });
      metaWs.addRow({ k: "Emitido", v: new Date().toLocaleString("es-AR") });
      metaWs.addRow({ k: "Envíos", v: totals.envios });
      for (const [k, v] of Object.entries(byStatus)) metaWs.addRow({ k, v });
      const moneyRow1 = metaWs.addRow({ k: "Total envío cobrado", v: totals.feeCobrado });
      moneyRow1.getCell(2).numFmt = moneyFmt;
      const moneyRow2 = metaWs.addRow({ k: "De entregados", v: totals.feeEntregados });
      moneyRow2.getCell(2).numFmt = moneyFmt;

      const ws = wb.addWorksheet("Envíos");
      ws.columns = [
        { header: "Código", key: "code", width: 14 },
        { header: "Aviso", key: "fecha", width: 12 },
        { header: "Logística", key: "carrier", width: 24 },
        { header: "Comercio", key: "comercio", width: 26 },
        { header: "Pedido", key: "pedido", width: 10 },
        { header: "Zona", key: "zona", width: 20 },
        { header: "Envío cobrado", key: "fee", width: 15 },
        { header: "Estado", key: "estado", width: 18 },
        { header: "POD foto", key: "pod", width: 10 },
        { header: "Entregado", key: "entregado", width: 12 },
      ];
      ws.getRow(1).font = { bold: true };
      for (const r of list) ws.addRow(r);
      ws.getColumn(7).numFmt = moneyFmt;

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
      ["Alcance", alcance].map(cell).join(";"),
      ["Período", periodo].map(cell).join(";"),
      ["Emitido", new Date().toLocaleString("es-AR")].map(cell).join(";"),
      "",
      ["Código", "Aviso", "Logística", "Comercio", "Pedido", "Zona", "Envío cobrado", "Estado", "POD foto", "Entregado"].map(cell).join(";"),
      ...list.map((r) =>
        [r.code, r.fecha, r.carrier, r.comercio, r.pedido, r.zona, r.fee, r.estado, r.pod, r.entregado].map(cell).join(";")
      ),
      "",
      // Label en la col "Zona" (6) para que el monto caiga bajo "Envío cobrado" (7).
      [...Array(5).fill(""), "Total cobrado", totals.feeCobrado, "", "", ""].map(cell).join(";"),
      [...Array(5).fill(""), "De entregados", totals.feeEntregados, "", "", ""].map(cell).join(";"),
    ];
    return new NextResponse("\uFEFF" + lines.join("\r\n"), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}.csv"`,
      },
    });
  } catch (e) {
    console.error("[settlement] error:", e);
    return NextResponse.json(
      { error: "Falta aplicar la migración migrate-portal-shipments.sql en la base" },
      { status: 503 }
    );
  }
}
