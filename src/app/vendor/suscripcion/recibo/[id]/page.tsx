"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";

/**
 * Recibo X en A4 para imprimir (window.print) o bajar el PDF con logo.
 * Documento NO válido como factura (patrón presupuesto: @page + .no-print).
 */
export default function ReciboPrintPage() {
  const params = useParams();
  const id = String(params?.id || "");
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const [me, vRes] = await Promise.all([
          fetch("/api/subscriptions/me").catch(() => null),
          fetch("/api/vendor/me").catch(() => null),
        ]);
        const meData = me?.ok ? await me.json().catch(() => ({})) : {};
        const receipt = (meData.receipts || []).find((r: any) => r.id === id);
        if (!receipt) {
          setError("Recibo no encontrado");
          return;
        }
        const vendor = vRes?.ok ? ((await vRes.json()) as any)?.vendor : null;
        setData({ receipt, vendor });
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
        <p className="text-muted-foreground">Cargando...</p>
      </main>
    );
  }

  const r = data.receipt;
  const v = data.vendor || {};
  const number = `${String(r.seq).padStart(4, "0")}/${r.year}`;
  const fmt = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString("es-AR") : "-";
  const fmtLong = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString("es-AR", { dateStyle: "long", timeStyle: "short" }) : "-";

  return (
    <main className="min-h-screen bg-muted/40">
      <style>{`@page { size: A4; margin: 12mm; } @media print { .no-print { display: none !important; } body { background: white; } }`}</style>

      <div className="no-print max-w-2xl mx-auto px-4 py-3 flex items-center gap-2">
        <a href="/vendor/suscripcion" className="text-sm text-muted-foreground hover:text-foreground">
          ← Volver a mi suscripción
        </a>
        <div className="ml-auto flex gap-2">
          <a href={`/api/vendor/suscripcion/recibo/${id}/pdf`} target="_blank" rel="noopener noreferrer">
            <Button variant="outline" size="sm">Bajar PDF</Button>
          </a>
          <Button size="sm" onClick={() => window.print()}>Imprimir</Button>
        </div>
      </div>

      <div className="max-w-2xl mx-auto bg-card border border-border rounded-2xl p-8 my-4 print:border-0 print:rounded-none print:my-0">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-bold">Portal 659</h1>
            <p className="text-xs text-muted-foreground">Centro comercial del barrio · www.portal659.com.ar</p>
          </div>
          <div className="text-right">
            <p className="font-display text-xl font-bold">RECIBO X</p>
            <p className="text-sm font-semibold">Nº {number}</p>
            <p className="text-xs text-muted-foreground">Fecha: {fmtLong(r.issued_at)}</p>
          </div>
        </div>

        <hr className="my-6 border-border" />

        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Recibimos de</p>
        <p className="font-semibold text-lg mt-1">{v.store_name || "-"}</p>
        {v.address && <p className="text-sm text-muted-foreground">{v.address}</p>}
        {(v.phone || v.whatsapp) && (
          <p className="text-sm text-muted-foreground">{[v.phone, v.whatsapp].filter(Boolean).join(" · ")}</p>
        )}

        <div className="mt-6 rounded-xl border border-border p-4 space-y-1">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Concepto</p>
          <p className="font-semibold">Plan {r.plan_name || "Pagado"}</p>
          {r.period_start && r.period_end && (
            <p className="text-sm text-muted-foreground">
              Período abonado: del {fmt(r.period_start)} al {fmt(r.period_end)}
            </p>
          )}
          <p className="text-sm text-muted-foreground">
            Medio de pago: {r.method === "transferencia" ? "Transferencia bancaria" : r.method}
          </p>
          <div className="flex items-center justify-between border-t border-border mt-3 pt-3">
            <span className="font-semibold text-muted-foreground">TOTAL</span>
            <span className="text-2xl font-bold">
              ${Number(r.amount || 0).toLocaleString("es-AR", { minimumFractionDigits: 2 })}
            </span>
          </div>
        </div>

        <p className="mt-6 text-sm font-bold">Documento no válido como factura.</p>
        <p className="text-xs text-muted-foreground">
          Este comprobante respalda el pago de la suscripción y no tiene validez fiscal.
        </p>
      </div>
    </main>
  );
}
