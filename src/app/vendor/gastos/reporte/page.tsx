"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { EXPENSE_SOURCE_LABELS, type ExpenseSource } from "@/lib/expenses";

function money(n: number | null | undefined): string {
  return `$${Number(n || 0).toLocaleString("es-AR")}`;
}

function fmtDate(v: string | null | undefined): string {
  if (!v) return "—";
  return String(v).slice(0, 10).split("-").reverse().join("/");
}

/**
 * Libro de gastos en A4 (respeta los filtros de la URL).
 * ?from=&to=&category=&source=&q=
 */
function GastosPrintInner() {
  const search = useSearchParams();
  const qs = search?.toString() || "";
  const [data, setData] = useState<any>(null);
  const [vendor, setVendor] = useState<any>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const [rRes, vRes] = await Promise.all([
          fetch(`/api/vendor/expenses?${qs}`).catch(() => null),
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qs]);

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

  const byCat = Object.entries(data.byCategory || {}).sort(
    (a: any, b: any) => b[1].total - a[1].total
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
            <p className="text-xl font-bold">LIBRO DE GASTOS</p>
            <p className="text-sm text-neutral-600">{fmtDate(data.from)} → {fmtDate(data.to)}</p>
            <p className="text-sm text-neutral-600">{data.count} movimientos</p>
          </div>
        </div>

        <p className="text-right text-xl font-bold mb-4">TOTAL: {money(data.total)}</p>

        {byCat.length > 0 && (
          <table className="w-full text-sm mb-4">
            <thead>
              <tr className="border-b border-neutral-300 text-left text-neutral-600">
                <th className="py-1 pr-2">Categoría</th>
                <th className="py-1 pr-2 text-right">Cant</th>
                <th className="py-1 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {byCat.map(([c, d]: any) => (
                <tr key={c} className="border-b border-neutral-100">
                  <td className="py-1 pr-2">{c}</td>
                  <td className="py-1 pr-2 text-right">{d.count}</td>
                  <td className="py-1 text-right">${Number(d.total).toLocaleString("es-AR")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <p className="font-bold text-sm mb-2">Detalle</p>
        <table className="w-full text-sm mb-6">
          <thead>
            <tr className="border-b border-neutral-300 text-left text-neutral-600">
              <th className="py-1 pr-2">Fecha</th>
              <th className="py-1 pr-2">Categoría</th>
              <th className="py-1 pr-2">Origen</th>
              <th className="py-1 pr-2">Proveedor/Detalle</th>
              <th className="py-1 text-right">Monto</th>
            </tr>
          </thead>
          <tbody>
            {(data.expenses || []).length === 0 && (
              <tr><td colSpan={5} className="py-1 text-neutral-500">Sin gastos en el rango</td></tr>
            )}
            {(data.expenses || []).map((e: any) => (
              <tr key={e.id} className="border-b border-neutral-100">
                <td className="py-1 pr-2">{fmtDate(e.spent_at)}</td>
                <td className="py-1 pr-2">{e.category}</td>
                <td className="py-1 pr-2">{EXPENSE_SOURCE_LABELS[e.source as ExpenseSource] || e.source}</td>
                <td className="py-1 pr-2">
                  {[e.supplier, e.note].filter(Boolean).join(" · ") || "—"}
                  {e.payment_method ? <span className="text-neutral-500"> ({e.payment_method})</span> : null}
                </td>
                <td className="py-1 text-right">${Number(e.amount).toLocaleString("es-AR")}</td>
              </tr>
            ))}
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

export default function GastosPrintPage() {
  return (
    <Suspense fallback={
      <main className="min-h-screen bg-background flex items-center justify-center p-4">
        <p className="text-sm text-muted-foreground">Cargando...</p>
      </main>
    }>
      <GastosPrintInner />
    </Suspense>
  );
}
