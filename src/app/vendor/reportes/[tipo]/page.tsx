"use client";

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { SalesEvolution, ShareDonut, fmtARS } from "@/components/dashboard/analytics-charts";

const TIPOS = ["ventas", "productos", "cobros", "clientes"] as const;

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-neutral-300 rounded-lg p-3 text-center">
      <p className="text-lg font-bold tabular-nums">{value}</p>
      <p className="text-[11px] text-neutral-600 mt-0.5">{label}</p>
    </div>
  );
}

function DataTable({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  if (rows.length === 0) return <p className="text-sm text-neutral-500">Sin datos en el período.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-neutral-300 text-left text-neutral-600">
            {head.map((h, i) => (
              <th key={i} className={`py-1 pr-2 font-medium ${i > 0 ? "text-right" : ""}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-neutral-100 last:border-0">
              {r.map((c, j) => (
                <td key={j} className={`py-1 pr-2 tabular-nums ${j > 0 ? "text-right" : ""}`}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ReportePage() {
  const params = useParams();
  const search = useSearchParams();
  const tipo = String(params?.tipo || "");
  const valid = (TIPOS as readonly string[]).includes(tipo);
  const [range, setRange] = useState(() => {
    const r = Number(search?.get("range") || 30);
    return [7, 30, 90, 365].includes(r) ? r : 30;
  });
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = () => {
    if (!valid) return;
    setLoading(true);
    setError("");
    fetch(`/api/vendor/analytics/report?tipo=${tipo}&range=${range}&format=json`)
      .then(async (r) => {
        const d = await r.json().catch(() => null);
        if (r.ok && d && d.meta) setData(d);
        else setError(d?.error || "No se pudo cargar el reporte.");
      })
      .catch(() => setError("No se pudo cargar el reporte. Revisá tu conexión."))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [tipo, range]);

  const isGest = (data?.meta?.plan?.analyticsDays ?? 0) >= 99999;

  return (
    <main className="min-h-screen bg-muted/40">
      <style>{`@page { size: A4; margin: 12mm; } @media print { .no-print { display: none !important; } body { background: white; } }`}</style>

      <div className="no-print max-w-4xl mx-auto px-4 py-3 flex items-center gap-2 flex-wrap">
        <Link href="/vendor/dashboard" className="text-sm text-muted-foreground hover:text-foreground">
          ← Volver al panel
        </Link>
        {valid && data && isGest && (
          <div className="flex gap-1.5">
            {[7, 30, 90, 365].map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`text-xs font-medium rounded-full px-3 py-1.5 transition-colors ${
                  range === r ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70"
                }`}
              >
                {r === 365 ? "Año" : `${r}d`}
              </button>
            ))}
          </div>
        )}
        <div className="ml-auto flex gap-2">
          {valid && data && (
            <a href={`/api/vendor/analytics/report?tipo=${tipo}&range=${range}&format=xlsx`}>
              <Button size="sm" variant="outline">⬇️ Excel</Button>
            </a>
          )}
          <Button size="sm" onClick={() => window.print()}>🖨️ Imprimir</Button>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 pb-10">
        {!valid ? (
          <p className="text-sm text-muted-foreground">Reporte no encontrado.</p>
        ) : loading ? (
          <p className="text-sm text-muted-foreground">Cargando reporte...</p>
        ) : error || !data ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <p className="text-sm text-muted-foreground">{error || "Sin datos."}</p>
            <button onClick={load} className="text-sm font-medium text-primary underline">Reintentar</button>
          </div>
        ) : (
          <div className="bg-white text-black rounded-xl sm:rounded-none p-8 shadow print:shadow-none print:rounded-none">
            <div className="flex items-start justify-between gap-4 border-b-2 border-black pb-4 mb-4">
              <div>
                <h1 className="text-2xl font-bold">{data.meta.store}</h1>
                <p className="text-sm text-neutral-600">
                  {data.meta.title} · {data.meta.since} al {data.meta.until} ({data.meta.range} días)
                </p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-xl font-bold">REPORTE</p>
                <p className="text-sm text-neutral-600">
                  Emitido {new Date(data.meta.generatedAt).toLocaleString("es-AR")}
                </p>
              </div>
            </div>

            {tipo === "ventas" && (
              <div className="space-y-6">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <Stat label="Facturación" value={fmtARS(data.summary.revenue)} />
                  <Stat label="Pedidos" value={String(data.summary.orders)} />
                  <Stat label="Ticket promedio" value={fmtARS(data.summary.ticket)} />
                  <Stat label="Cancelados" value={String(data.summary.cancelled)} />
                  <Stat label="Desc. efectivo" value={fmtARS(data.summary.cashDiscount)} />
                  <Stat label="Desc. volumen" value={fmtARS(data.summary.volumeDiscount)} />
                </div>
                <SalesEvolution data={data.byDay} range={data.meta.range} periodLabel={`del ${data.meta.since} al ${data.meta.until}`} />
                <div className="grid sm:grid-cols-3 gap-4">
                  <ShareDonut title="Por canal" entries={data.byChannel} />
                  <ShareDonut title="Retiro vs domicilio" entries={data.byMethod} />
                  <ShareDonut title="Medios de cobro" entries={data.byPay} />
                </div>
                <div>
                  <h3 className="font-bold text-sm mb-2">Detalle por día</h3>
                  <DataTable
                    head={["Fecha", "Pedidos", "Facturación"]}
                    rows={(data.byDay || []).map((d: any) => [d.label, d.count, fmtARS(d.revenue)])}
                  />
                </div>
                <div>
                  <h3 className="font-bold text-sm mb-2">Top productos</h3>
                  <DataTable
                    head={["Producto", "Unidades", "Facturación", "%"]}
                    rows={(data.topProducts || []).map((p: any) => [p.name, p.qty, fmtARS(p.revenue), `${p.share}%`])}
                  />
                </div>
              </div>
            )}

            {tipo === "productos" && (
              <div className="space-y-6">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <Stat label="Facturación" value={fmtARS(data.summary.revenue)} />
                  <Stat label="Unidades" value={String(data.summary.units)} />
                  <Stat label="Productos con venta" value={String(data.summary.products)} />
                </div>
                <div>
                  <h3 className="font-bold text-sm mb-2">Productos</h3>
                  <DataTable
                    head={["Producto", "Categoría", "Unidades", "Facturación", "%"]}
                    rows={(data.rows || []).map((p: any) => [p.name, p.category, p.qty, fmtARS(p.revenue), `${p.share}%`])}
                  />
                </div>
                <div>
                  <h3 className="font-bold text-sm mb-2">Por categoría</h3>
                  <DataTable
                    head={["Categoría", "Unidades", "Facturación"]}
                    rows={(data.byCategory || []).map((c: any) => [c.category, c.qty, fmtARS(c.revenue)])}
                  />
                </div>
                {(data.dead || []).length > 0 && (
                  <div>
                    <h3 className="font-bold text-sm mb-2">Sin ventas en el período</h3>
                    <DataTable
                      head={["Producto", "Categoría"]}
                      rows={(data.dead || []).map((p: any) => [p.name, p.category])}
                    />
                  </div>
                )}
              </div>
            )}

            {tipo === "cobros" && (
              <div className="space-y-6">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <Stat label="Facturación" value={fmtARS(data.summary.revenue)} />
                  <Stat label="Cobros" value={String(data.summary.orders)} />
                  <Stat label="Ticket promedio" value={fmtARS(data.summary.ticket)} />
                  <Stat label="Desc. efectivo" value={fmtARS(data.summary.cashDiscount)} />
                  <Stat label="Desc. volumen" value={fmtARS(data.summary.volumeDiscount)} />
                </div>
                <ShareDonut title="Medios de cobro" entries={data.byPay} />
                <div>
                  <h3 className="font-bold text-sm mb-2">Detalle por día</h3>
                  <DataTable
                    head={["Fecha", "Facturación", "Desc. efectivo", "Desc. volumen"]}
                    rows={(data.daily || []).map((d: any) => [d.label, fmtARS(d.revenue), fmtARS(d.cash), fmtARS(d.volume)])}
                  />
                </div>
              </div>
            )}

            {tipo === "clientes" && (
              <div className="space-y-6">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <Stat label="Clientes" value={String(data.summary.customers)} />
                  <Stat label="Recurrentes" value={String(data.summary.recurring)} />
                  <Stat label="De una compra" value={String(data.summary.single)} />
                  <Stat label="Facturación" value={fmtARS(data.summary.revenue)} />
                </div>
                <div>
                  <h3 className="font-bold text-sm mb-2">Clientes</h3>
                  <DataTable
                    head={["Cliente", "Teléfono", "Pedidos", "Facturación", "Última compra"]}
                    rows={(data.rows || []).map((c: any) => [c.name, c.phone || "—", c.orders, fmtARS(c.revenue), c.last])}
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
