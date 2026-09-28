"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";

/**
 * Presupuesto A4 para imprimir en papel (window.print) o guardar como PDF
 * del navegador. La versión PDF con logo sale de /api/vendor/quotes/[id]/pdf.
 */
export default function PresupuestoPrintPage() {
  const params = useParams();
  const id = String(params?.id || "");
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const [qRes, vRes] = await Promise.all([
          fetch("/api/vendor/quotes").catch(() => null),
          fetch("/api/vendor/me").catch(() => null),
        ]);
        const qList = qRes?.ok ? await qRes.json().catch(() => ({})) : {};
        const quote = (qList.quotes || []).find((q: any) => q.id === id);
        if (!quote) {
          setError("Presupuesto no encontrado");
          return;
        }
        const itemsRes = await fetch(`/api/vendor/quotes/${id}/items`).catch(() => null);
        const itemsData = itemsRes?.ok ? await itemsRes.json().catch(() => ({})) : {};
        const vendor = vRes?.ok ? (await vRes.json().catch(() => ({})))?.vendor : null;
        setData({ quote, items: itemsData.items || [], vendor });
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

  const { quote, items, vendor } = data;
  const total = items.length > 0
    ? items.reduce((s: number, it: any) => s + Number(it.qty) * Number(it.unit_price), 0)
    : Number(quote.quoted_price) || 0;

  return (
    <main className="min-h-screen bg-muted/40">
      <style>{`@page { size: A4; margin: 12mm; } @media print { .no-print { display: none !important; } body { background: white; } }`}</style>

      <div className="no-print max-w-2xl mx-auto px-4 py-3 flex items-center gap-2">
        <a href="/vendor/dashboard" className="text-sm text-muted-foreground hover:text-foreground">
          ← Volver al panel
        </a>
        <div className="ml-auto flex gap-2">
          <a href={`/api/vendor/quotes/${id}/pdf`}>
            <Button size="sm" variant="outline">⬇️ PDF</Button>
          </a>
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
            <p className="text-xl font-bold">PRESUPUESTO</p>
            <p className="text-sm text-neutral-600">
              {quote.created_at ? new Date(quote.created_at).toLocaleDateString("es-AR") : ""}
            </p>
          </div>
        </div>

        <div className="mb-4">
          <p className="text-sm font-bold">Cliente</p>
          <p>{quote.customer_name}</p>
          {quote.customer_phone && <p className="text-sm text-neutral-600">Tel: {quote.customer_phone}</p>}
          {quote.service_name && <p className="text-sm text-neutral-600">Servicio: {quote.service_name}</p>}
          {quote.preferred_date && <p className="text-sm text-neutral-600">Fecha estimada: {quote.preferred_date}</p>}
        </div>

        <p className="text-sm mb-4 whitespace-pre-wrap">{quote.description}</p>

        {items.length > 0 && (
          <table className="w-full text-sm mb-4">
            <thead>
              <tr className="border-b border-neutral-300 text-left text-neutral-600">
                <th className="py-1 pr-2">Cant</th>
                <th className="py-1 pr-2">Descripción</th>
                <th className="py-1 pr-2 text-right">P. Unit</th>
                <th className="py-1 text-right">Importe</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it: any) => (
                <tr key={it.id} className="border-b border-neutral-100">
                  <td className="py-1 pr-2">{it.qty}</td>
                  <td className="py-1 pr-2">{it.kind === "labor" ? "Mano de obra: " : ""}{it.description}</td>
                  <td className="py-1 pr-2 text-right">${Number(it.unit_price).toLocaleString("es-AR")}</td>
                  <td className="py-1 text-right">${(Number(it.qty) * Number(it.unit_price)).toLocaleString("es-AR")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <p className="text-right text-xl font-bold mb-2">TOTAL: ${Number(total).toLocaleString("es-AR")}</p>
        {quote.deposit_amount != null && Number(quote.deposit_amount) > 0 && (
          <p className="text-right text-sm font-bold mb-2">
            Seña ({quote.deposit_pct ?? ""}%): ${Number(quote.deposit_amount).toLocaleString("es-AR")}
          </p>
        )}
        <p className="text-xs text-neutral-500 mt-4">
          Presupuesto sin compromiso. Validez: 30 días salvo indicación contraria. Este documento no es comprobante fiscal.
        </p>
        <p className="text-xs text-neutral-400 mt-1">Emitido con Portal 659</p>
      </div>
    </main>
  );
}
