"use client";

import { useEffect, useState, Fragment } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { CASH_METHOD_LABELS } from "@/lib/cash-methods";

const METHOD_ORDER = ["efectivo", "transferencia", "tarjeta", "mixto", "whatsapp", "mercadopago"];

function money(n: number | null | undefined): string {
  return `$${Number(n || 0).toLocaleString("es-AR")}`;
}

function fmtDate(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

function fmtDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Consolidado de cierres por rango (estilo ZZ) en A4: totales agregados +
 * detalle por cierre. ?from=YYYY-MM-DD&to=YYYY-MM-DD (default: 30 días).
 */
function ReportePrintInner() {
  const search = useSearchParams();
  const from = search?.get("from") || "";
  const to = search?.get("to") || "";
  const [data, setData] = useState<any>(null);
  const [vendor, setVendor] = useState<any>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const q = new URLSearchParams();
        if (from) q.set("from", from);
        if (to) q.set("to", to);
        const [rRes, vRes] = await Promise.all([
          fetch(`/api/vendor/cash-closing/report?${q.toString()}`).catch(() => null),
          fetch("/api/vendor/me").catch(() => null),
        ]);
        if (!rRes?.ok) {
          const d = await rRes?.json().catch(() => ({}));
          setError(d?.error || "No se pudo cargar el reporte");
          return;
        }
        setData(await rRes.json().catch(() => null));
        setVendor(vRes?.ok ? (await vRes.json().catch(() => ({})))?.vendor : null);
      } catch {
        setError("Error de conexión");
      }
    })();
  }, [from, to]);

  if (error) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center p-4">
        <p className="text-sm text-red-600">{error}</p>
      </main>
    );
  }
  if (!data) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center p-4">
        <p className="text-sm text-muted-foreground">Cargando...</p>
      </main>
    );
  }

  const methods = Object.entries(data.byMethod || {}).sort(
    (a: any, b: any) => (METHOD_ORDER.indexOf(a[0]) + 1 || 99) - (METHOD_ORDER.indexOf(b[0]) + 1 || 99)
  );

  return (
    <main className="min-h-screen bg-muted/40">
      <style>{`@page { size: A4; margin: 12mm; } @media print { .no-print { display: none !important; } body { background: white; } }`}</style>

      <div className="no-print max-w-2xl mx-auto px-4 py-3 flex items-center gap-2">
        <a href="/vendor/dashboard" className="text-sm text-muted-foreground hover:text-foreground">
          ← Volver al panel
        </a>
        <div className="ml-auto">
          <Button size="sm" onClick={() => window.print()}>🖨️ Imprimir</Button>
        </div>
      </div>

      <div className="max-w-2xl mx-auto bg-white text-black rounded-xl sm:rounded-none p-8 mb-8 print:mb-0 print:rounded-none shadow print:shadow-none">
        <div className="flex items-start justify-between gap-4 border-b-2 border-black pb-4 mb-4">
          <div>
            <h1 className="text-2xl font-bold">{vendor?.store_name || ""}</h1>
            {vendor?.address && <p className="text-sm text-neutral-600">{vendor.address}</p>}
          </div>
          <div className="text-right flex-shrink-0">
            <p className="text-xl font-bold">CIERRES CONSOLIDADOS</p>
            <p className="text-sm text-neutral-600">{fmtDate(data.from)} → {fmtDate(data.to)}</p>
            <p className="text-sm text-neutral-600">{data.count} cierre{data.count === 1 ? "" : "s"} · {data.orders} pedidos</p>
          </div>
        </div>

        <table className="w-full text-sm mb-4">
          <thead>
            <tr className="border-b border-neutral-300 text-left text-neutral-600">
              <th className="py-1 pr-2">Medio de pago</th>
              <th className="py-1 pr-2 text-right">Cant</th>
              <th className="py-1 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {methods.length === 0 && (
              <tr><td colSpan={3} className="py-1 text-neutral-500">Sin cierres en el rango</td></tr>
            )}
            {methods.map(([m, d]: any) => (
              <tr key={m} className="border-b border-neutral-100">
                <td className="py-1 pr-2">{CASH_METHOD_LABELS[m] || m}</td>
                <td className="py-1 pr-2 text-right">{d.count}</td>
                <td className="py-1 text-right">${Number(d.total).toLocaleString("es-AR")}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="text-sm space-y-0.5 mb-4">
          <p className="flex justify-between"><span>Bruto:</span> <span>${Number(data.gross).toLocaleString("es-AR")}</span></p>
          {Number(data.discounts) > 0 && (
            <p className="flex justify-between"><span>Desc. efectivo:</span> <span>−${Number(data.discounts).toLocaleString("es-AR")}</span></p>
          )}
          <p className="flex justify-between text-lg font-bold"><span>NETO:</span> <span>${Number(data.net).toLocaleString("es-AR")}</span></p>
        </div>

        <div className="border border-neutral-300 rounded-lg p-3 mb-4 text-sm">
          <p className="font-bold mb-1">Efectivo del período</p>
          <div className="grid grid-cols-2 gap-2">
            <p><span className="font-bold">Fondo inicial total:</span> {money(data.opening)}</p>
            <p><span className="font-bold">Esperado total:</span> {money(data.expected)}</p>
            <p><span className="font-bold">Contado total:</span> {money(data.declared)}</p>
            <p><span className="font-bold">Ingresos manuales:</span> {money(data.ingresos)}</p>
            <p><span className="font-bold">Retiros manuales:</span> {money(data.retiros)}</p>
            <p>
              <span className="font-bold">Diferencia:</span>{" "}
              {Number(data.sobra) === 0 && Number(data.falta) === 0
                ? "Cuadra ✓"
                : `${Number(data.sobra) > 0 ? `Sobra ${money(data.sobra)}` : ""}${Number(data.sobra) > 0 && Number(data.falta) > 0 ? " · " : ""}${Number(data.falta) > 0 ? `Falta ${money(data.falta)}` : ""}`}
            </p>
          </div>
        </div>

        <p className="font-bold text-sm mb-2">Detalle por cierre</p>
        <table className="w-full text-sm mb-6">
          <thead>
            <tr className="border-b border-neutral-300 text-left text-neutral-600">
              <th className="py-1 pr-2">Cierre</th>
              <th className="py-1 pr-2 text-right">Neto</th>
              <th className="py-1 text-right">Dif.</th>
            </tr>
          </thead>
          <tbody>
            {(data.closings || []).map((c: any) => {
              const diff = c.cash_difference != null ? Number(c.cash_difference) : null;
              const movs = (c.movement_list || []) as any[];
              return (
                <Fragment key={c.id}>
                  <tr key={c.id} className="border-b border-neutral-100">
                    <td className="py-1 pr-2">
                      {fmtDateTime(c.closed_at)}
                      {c.opened_by_name ? <span className="text-neutral-500"> · {c.opened_by_name}</span> : null}
                      {c.handed_to ? <span className="text-neutral-500"> → {c.handed_to}</span> : null}
                    </td>
                    <td className="py-1 pr-2 text-right">${Number(c.net_total).toLocaleString("es-AR")}</td>
                    <td className="py-1 text-right">
                      {diff == null ? "—" : diff === 0 ? "✓" : `${diff > 0 ? "+" : "−"}${money(Math.abs(diff))}`}
                    </td>
                  </tr>
                  {movs.map((m: any, i: number) => (
                    <tr key={`${c.id}-m${i}`} className="border-b border-neutral-100 text-neutral-600">
                      <td className="py-1 pr-2 pl-4">
                        {m.kind === "retiro" ? "− Retiro" : "+ Ingreso"}: {m.reason || "—"}
                        {m.by_name ? ` (${m.by_name})` : ""}
                      </td>
                      <td className="py-1 pr-2 text-right">${Number(m.amount).toLocaleString("es-AR")}</td>
                      <td className="py-1 text-right">{fmtDateTime(m.created_at)}</td>
                    </tr>
                  ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>

        <div className="grid grid-cols-2 gap-8 mt-10 text-sm">
          <div className="border-t border-black pt-1 text-center">Firma responsable</div>
          <div className="border-t border-black pt-1 text-center">Aclaración</div>
        </div>
      </div>
    </main>
  );
}

export default function ReportePrintPage() {
  return (
    <Suspense fallback={
      <main className="min-h-screen bg-background flex items-center justify-center p-4">
        <p className="text-sm text-muted-foreground">Cargando...</p>
      </main>
    }>
      <ReportePrintInner />
    </Suspense>
  );
}
