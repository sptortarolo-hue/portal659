"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * Botón "Facturar" (Factura C ARCA) para el detalle de un pedido cobrado.
 * Solo se muestra si el comercio tiene Gestión + fiscal configurado y listo.
 * Idempotente: si el pedido ya tiene comprobante, lo muestra en vez de duplicar.
 */
type InvoiceRef = {
  id: string;
  order_id: string;
  cbte_tipo?: number | null;
  punto_venta: number;
  cbte_nro: number;
  cae: string;
  asoc_pto?: number | null;
  asoc_nro?: number | null;
};

export function FiscalBillButton({ orderId }: { orderId: string }) {
  const [ready, setReady] = useState(false);
  const [existing, setExisting] = useState<InvoiceRef | null>(null);
  const [creditNote, setCreditNote] = useState<InvoiceRef | null>(null);
  const [busy, setBusy] = useState(false);
  const [ncBusy, setNcBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);
  const [printMsg, setPrintMsg] = useState<string | null>(null);

  async function refreshInvoices(): Promise<InvoiceRef[]> {
    const inv = await fetch("/api/vendor/fiscal/invoices").then((r) => r.json()).catch(() => null);
    return (inv?.invoices || []) as InvoiceRef[];
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const cfg = await fetch("/api/vendor/fiscal/config").then((r) => r.json());
        if (!alive) return;
        if (cfg?.ready !== true) return;
        setReady(true);
        const list = await refreshInvoices();
        if (!alive) return;
        const found = list.find((i) => i.order_id === orderId && (i.cbte_tipo ?? 11) === 11);
        if (found) setExisting(found);
        const nc = list.find((i) => (i.cbte_tipo ?? 0) === 13 && i.asoc_pto === found?.punto_venta && i.asoc_nro === found?.cbte_nro);
        if (nc) setCreditNote(nc);
      } catch {
        /* sin fiscal disponible: no se muestra nada */
      }
    })();
    return () => {
      alive = false;
    };
  }, [orderId]);

  if (!ready) return null;

  // Reimprime el ticket CON el bloque fiscal (CAE + QR). El ticket que
  // salió al cobrar no lo trae porque el CAE llega después (fondo).
  // Con invoiceId imprime ese comprobante puntual (NC en vez de factura).
  async function reprint(invoiceId?: string) {
    setPrinting(true);
    setPrintMsg(null);
    try {
      const res = await fetch("/api/print", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, type: "ticket", ...(invoiceId ? { invoiceId } : {}) }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.ok || data.skipped) {
        setPrintMsg(data.skipped ? "Impresora no configurada" : "Ticket fiscal impreso ✓");
      } else {
        setPrintMsg(`No se pudo imprimir: ${data.error || "revisá la impresora"}`);
      }
    } catch {
      setPrintMsg("Sin conexión con la impresora");
    }
    setPrinting(false);
  }

  async function issueCreditNote() {
    if (!existing) return;
    if (!window.confirm(`¿Anular la Factura C ${String(existing.punto_venta).padStart(4, "0")}-${String(existing.cbte_nro).padStart(8, "0")} con nota de crédito por el total?`)) return;
    setNcBusy(true);
    setMsg(null);
    setErr(null);
    try {
      const res = await fetch("/api/vendor/fiscal/nota-credito", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.invoice) {
        setCreditNote(data.invoice);
        setMsg("Nota de crédito emitida ✓");
      } else if (data.error) {
        setErr(data.hint ? `${data.error} 💡 ${data.hint}` : data.error);
      } else {
        setErr("Se cortó esperando a ARCA (probá Probar conexión en Config → Fiscal)");
      }
    } catch {
      setErr("Sin conexión (la factura sigue vigente)");
    }
    setNcBusy(false);
  }

  if (existing) {
    return (
      <div className="space-y-1">
        <p className="w-full rounded-xl border border-green-300 bg-green-50 px-3 py-2 text-center text-xs font-bold text-green-700 dark:border-green-900 dark:bg-green-950 dark:text-green-400">
          🧾 Factura C {String(existing.punto_venta).padStart(4, "0")}-
          {String(existing.cbte_nro).padStart(8, "0")} · CAE …{String(existing.cae).slice(-4)}
        </p>
        {creditNote ? (
          <div className="space-y-1">
            <p className="w-full rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-center text-xs font-bold text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400">
              ↩️ Anulada con NC {String(creditNote.punto_venta).padStart(4, "0")}-
              {String(creditNote.cbte_nro).padStart(8, "0")}
            </p>
            <Button variant="outline" className="w-full" disabled={printing} onClick={() => reprint(creditNote.id)}>
              {printing ? "🖨️ Imprimiendo…" : "🖨️ Imprimir nota de crédito"}
            </Button>
          </div>
        ) : (
          <Button variant="outline" className="w-full text-red-600 border-red-200 hover:bg-red-50" disabled={ncBusy} onClick={issueCreditNote}>
            {ncBusy ? "↩️ Anulando en ARCA…" : "↩️ Anular con nota de crédito"}
          </Button>
        )}
        <Button variant="outline" className="w-full" disabled={printing} onClick={() => reprint()}>
          {printing ? "🖨️ Imprimiendo…" : "🖨️ Reimprimir ticket fiscal"}
        </Button>
        {printMsg && <p className="text-xs font-medium text-muted-foreground">{printMsg}</p>}
      </div>
    );
  }

  async function bill() {
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      const res = await fetch("/api/vendor/fiscal/emitir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.invoice) {
        setExisting(data.invoice);
        setMsg("Comprobante emitido ✓");
      } else if (data.error) {
        setErr(data.hint ? `${data.error} 💡 ${data.hint}` : data.error);
      } else {
        setErr("Se cortó esperando a ARCA (probá Probar conexión en Config → Fiscal)");
      }
    } catch {
      setErr("Sin conexión (el cobro queda como sin fiscal)");
    }
    setBusy(false);
  }

  return (
    <div className="space-y-1">
      <Button variant="outline" className="w-full" disabled={busy} onClick={bill}>
        {busy ? "🧾 Facturando en ARCA…" : "🧾 Facturar (Factura C)"}
      </Button>
      {msg && <p className="text-xs font-medium text-green-600">{msg}</p>}
      {err && <p className="text-xs font-medium text-red-600">⚠️ {err}</p>}
    </div>
  );
}
