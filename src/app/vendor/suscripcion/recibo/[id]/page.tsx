"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";

/**
 * Recibo X en A4 para imprimir (window.print) o bajar el PDF con logo.
 * Documento NO válido como factura (patrón presupuesto: @page + .no-print).
 * Lee un endpoint propio del recibo (no el panel completo), así el admin puede
 * abrirlo desde /admin/suscripciones sin 403.
 */
export default function ReciboPrintPage() {
  const params = useParams();
  const id = String(params?.id || "");
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [resendBusy, setResendBusy] = useState(false);
  const [resendMsg, setResendMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const res = await fetch(`/api/vendor/suscripcion/recibo/${id}`);
        const json = await res.json().catch(() => ({}));
        if (!res.ok || json.error) {
          setError(json.error || "No se pudo cargar el recibo");
          return;
        }
        setData(json);
      } catch {
        setError("Error de conexión");
      }
    })();
  }, [id]);

  async function resend() {
    if (!data?.vendor_id) return;
    setResendBusy(true);
    setResendMsg(null);
    try {
      const res = await fetch("/api/admin/suscripciones", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendorId: data.vendor_id, action: "resend_receipt", receiptId: id }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.error) {
        setResendMsg({ ok: false, text: json.error || "No se pudo reenviar el recibo" });
      } else if (json.emailed) {
        setResendMsg({ ok: true, text: `Reenviado a ${json.to || "el comercio"}` });
        setData((d: any) => (d ? { ...d, receipt: { ...d.receipt, emailed_at: new Date().toISOString() } } : d));
      } else {
        setResendMsg({ ok: false, text: json.error || "No se pudo enviar el mail" });
      }
    } catch {
      setResendMsg({ ok: false, text: "Error de conexión" });
    } finally {
      setResendBusy(false);
    }
  }

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
  const isAdmin = !!data.admin;
  const number = `${String(r.seq).padStart(4, "0")}/${r.year}`;
  const fmt = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString("es-AR") : "-";
  const fmtLong = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString("es-AR", { dateStyle: "long", timeStyle: "short" }) : "-";

  return (
    <main className="min-h-screen bg-muted/40">
      <style>{`@page { size: A4; margin: 12mm; } @media print { .no-print { display: none !important; } body { background: white; } }`}</style>

      <div className="no-print max-w-2xl mx-auto px-4 py-3 flex flex-wrap items-center gap-2">
        <a
          href={isAdmin ? "/admin/suscripciones" : "/vendor/suscripcion"}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          {isAdmin ? "← Volver a suscripciones" : "← Volver a mi suscripción"}
        </a>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {isAdmin && (
            <Button variant="outline" size="sm" disabled={resendBusy} onClick={resend}>
              {resendBusy ? "Enviando..." : "Reenviar por mail"}
            </Button>
          )}
          <a href={`/api/vendor/suscripcion/recibo/${id}/pdf`} target="_blank" rel="noopener noreferrer">
            <Button variant="outline" size="sm">Bajar PDF</Button>
          </a>
          <Button size="sm" onClick={() => window.print()}>Imprimir</Button>
        </div>
      </div>

      {resendMsg && (
        <div className="no-print max-w-2xl mx-auto px-4">
          <p className={`text-xs ${resendMsg.ok ? "text-green-700 dark:text-green-400" : "text-red-600"}`}>
            {resendMsg.text}
          </p>
        </div>
      )}

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
            Medio de pago: {r.method_label || (r.method === "transferencia" ? "Transferencia bancaria" : r.method)}
          </p>
          {r.promo_pct && r.promo_list_price ? (
            <p className="text-xs text-muted-foreground">
              Precio promo −{r.promo_pct}% (lista ${Number(r.promo_list_price).toLocaleString("es-AR")})
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">Precio de lista</p>
          )}
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
        <p className="no-print mt-3 text-[11px] text-muted-foreground">
          {r.emailed_at ? `Enviado por mail el ${fmtLong(r.emailed_at)}` : "Todavía no se envió por mail"}
        </p>
      </div>
    </main>
  );
}
