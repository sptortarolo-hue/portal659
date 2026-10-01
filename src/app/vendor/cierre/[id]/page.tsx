"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { CASH_METHOD_LABELS } from "@/lib/cash-methods";

type MethodTotals = { count: number; total: number };

type Closing = {
  id: string;
  closed_at: string;
  since: string;
  orders_count: number;
  gross_total: number;
  discounts_total: number;
  net_total: number;
  by_method: Record<string, MethodTotals> | null;
  cash_declared: number | null;
  cash_difference: number | null;
  notes: string | null;
  opened_at?: string | null;
  opening_amount?: number | null;
  opened_by_name?: string | null;
  closed_by_name?: string | null;
  movements?: { ingresos: number; retiros: number } | null;
  expected_cash?: number | null;
};

const METHOD_ORDER = ["efectivo", "transferencia", "tarjeta", "mixto", "whatsapp", "mercadopago"];

function money(n: number | null | undefined): string {
  return `$${Number(n || 0).toLocaleString("es-AR")}`;
}

function fmt(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Cierre de caja (Z) en A4 para imprimir en papel o guardar como PDF del
 * navegador. Mismos datos del ticket térmico + firma responsable.
 */
export default function CierrePrintPage() {
  const params = useParams();
  const id = String(params?.id || "");
  const [data, setData] = useState<{ closing: Closing; vendor: any } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const [hRes, vRes] = await Promise.all([
          fetch("/api/vendor/cash-closing/history").catch(() => null),
          fetch("/api/vendor/me").catch(() => null),
        ]);
        const hist = hRes?.ok ? await hRes.json().catch(() => ({})) : {};
        const closing = (hist.closings || []).find((c: any) => c.id === id);
        if (!closing) {
          setError("Cierre no encontrado");
          return;
        }
        const vendor = vRes?.ok ? (await vRes.json().catch(() => ({})))?.vendor : null;
        setData({ closing, vendor });
      } catch {
        setError("Error de conexión");
      }
    })();
  }, [id]);

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

  const { closing: c, vendor } = data;
  const methods = Object.entries(c.by_method || {}).sort(
    (a, b) => (METHOD_ORDER.indexOf(a[0]) + 1 || 99) - (METHOD_ORDER.indexOf(b[0]) + 1 || 99)
  );
  const diff = c.cash_difference != null ? Number(c.cash_difference) : null;
  const movIng = Number(c.movements?.ingresos) || 0;
  const movRet = Number(c.movements?.retiros) || 0;

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
            {[vendor?.phone, vendor?.whatsapp].filter(Boolean).join(" · ") !== "" && (
              <p className="text-sm text-neutral-600">{[vendor?.phone, vendor?.whatsapp].filter(Boolean).join(" · ")}</p>
            )}
          </div>
          <div className="text-right flex-shrink-0">
            <p className="text-xl font-bold">CIERRE DE CAJA (Z)</p>
            <p className="text-sm text-neutral-600">{fmt(c.closed_at)}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 text-sm mb-4">
          <p><span className="font-bold">Desde:</span> {fmt(c.since)}</p>
          <p><span className="font-bold">Hasta:</span> {fmt(c.closed_at)}</p>
          {c.closed_by_name && (
            <p><span className="font-bold">Cerrada por:</span> {c.closed_by_name}</p>
          )}
          <p><span className="font-bold">Pedidos:</span> {c.orders_count}</p>
        </div>

        {c.opened_at != null && (
          <div className="border border-neutral-300 rounded-lg p-3 mb-4 text-sm">
            <p className="font-bold mb-1">Turno de caja</p>
            <div className="grid grid-cols-2 gap-2">
              <p><span className="font-bold">Apertura:</span> {fmt(c.opened_at)}{c.opened_by_name ? ` por ${c.opened_by_name}` : ""}</p>
              <p><span className="font-bold">Fondo inicial:</span> {money(c.opening_amount)}</p>
              {movIng > 0 && <p><span className="font-bold">Ingresos manuales:</span> {money(movIng)}</p>}
              {movRet > 0 && <p><span className="font-bold">Retiros manuales:</span> {money(movRet)}</p>}
              {c.expected_cash != null && (
                <p><span className="font-bold">Esperado:</span> {money(c.expected_cash)}</p>
              )}
            </div>
          </div>
        )}

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
              <tr><td colSpan={3} className="py-1 text-neutral-500">Sin cobros en el período</td></tr>
            )}
            {methods.map(([m, d]) => (
              <tr key={m} className="border-b border-neutral-100">
                <td className="py-1 pr-2">{CASH_METHOD_LABELS[m] || m}</td>
                <td className="py-1 pr-2 text-right">{d.count}</td>
                <td className="py-1 text-right">${Number(d.total).toLocaleString("es-AR")}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="text-sm space-y-0.5 mb-4">
          <p className="flex justify-between"><span>Bruto:</span> <span>${Number(c.gross_total).toLocaleString("es-AR")}</span></p>
          {Number(c.discounts_total) > 0 && (
            <p className="flex justify-between"><span>Desc. efectivo:</span> <span>−${Number(c.discounts_total).toLocaleString("es-AR")}</span></p>
          )}
          <p className="flex justify-between text-lg font-bold"><span>NETO:</span> <span>${Number(c.net_total).toLocaleString("es-AR")}</span></p>
        </div>

        {c.cash_declared != null && (
          <div className="border border-neutral-300 rounded-lg p-3 mb-4 text-sm">
            <p className="flex justify-between"><span className="font-bold">Arqueo (contado):</span> <span>{money(c.cash_declared)}</span></p>
            {diff != null && (
              <p className="flex justify-between font-bold">
                <span>Diferencia:</span>
                <span>{diff === 0 ? "Cuadra ✓" : `${diff > 0 ? "Sobra" : "Falta"} ${money(Math.abs(diff))}`}</span>
              </p>
            )}
          </div>
        )}

        {c.notes && (
          <p className="text-sm mb-6"><span className="font-bold">Notas:</span> {c.notes}</p>
        )}

        <div className="grid grid-cols-2 gap-8 mt-10 text-sm">
          <div className="border-t border-black pt-1 text-center">Firma responsable</div>
          <div className="border-t border-black pt-1 text-center">Aclaración</div>
        </div>
      </div>
    </main>
  );
}
