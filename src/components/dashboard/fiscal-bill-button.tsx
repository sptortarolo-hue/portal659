"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * Botón "Facturar" (Factura C ARCA) para el detalle de un pedido cobrado.
 * Solo se muestra si el comercio tiene Gestión + fiscal configurado y listo.
 * Idempotente: si el pedido ya tiene comprobante, lo muestra en vez de duplicar.
 */
export function FiscalBillButton({ orderId }: { orderId: string }) {
  const [ready, setReady] = useState(false);
  const [existing, setExisting] = useState<{
    punto_venta: number;
    cbte_nro: number;
    cae: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const cfg = await fetch("/api/vendor/fiscal/config").then((r) => r.json());
        if (!alive) return;
        if (cfg?.ready !== true) return;
        setReady(true);
        const inv = await fetch("/api/vendor/fiscal/invoices").then((r) => r.json()).catch(() => null);
        const found = (inv?.invoices || []).find((i: { order_id: string }) => i.order_id === orderId);
        if (found && alive) setExisting(found);
      } catch {
        /* sin fiscal disponible: no se muestra nada */
      }
    })();
    return () => {
      alive = false;
    };
  }, [orderId]);

  if (!ready) return null;

  if (existing) {
    return (
      <p className="w-full rounded-xl border border-green-300 bg-green-50 px-3 py-2 text-center text-xs font-bold text-green-700 dark:border-green-900 dark:bg-green-950 dark:text-green-400">
        🧾 Factura C {String(existing.punto_venta).padStart(4, "0")}-
        {String(existing.cbte_nro).padStart(8, "0")} · CAE …{String(existing.cae).slice(-4)}
      </p>
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
