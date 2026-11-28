"use client";

/**
 * Pantalla de confirmación de la venta en el Mostrador (Paso 1 del plan).
 *
 * Componente NUEVO y aditivo: el toast de siempre sigue existiendo, esto se
 * muestra encima solo cuando el flag está activo. No modifica `pos/order` ni
 * la lógica de cobro/impresión.
 */

import { useEffect, useState } from "react";
import { CheckCircle2, Printer, MessageCircle } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";

export type PosSuccessData = {
  orderId: string;
  orderNumber?: string | null;
  total: number;
  paymentLabel: string;
  cashAmount?: number | null;
  invoice?: { punto_venta: number | string; cbte_nro: number | string; cae?: string | null } | null;
  customerPhone?: string | null;
  storeName?: string | null;
  isRetail?: boolean;
};

const money = (n: number) =>
  Number(n || 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function PosSuccessModal({
  data,
  onClose,
}: {
  data: PosSuccessData | null;
  onClose: () => void;
}) {
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    if (!data) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Enter") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [data, onClose]);

  if (!data) return null;

  const change =
    data.cashAmount != null && data.cashAmount > data.total
      ? Math.round((data.cashAmount - data.total) * 100) / 100
      : 0;
  const waPhone = String(data.customerPhone || "").replace(/[^\d]/g, "");
  const waText =
    `Hola! Te confirmamos tu compra en ${data.storeName || "nuestro local"}` +
    (data.orderNumber ? ` · ${data.orderNumber}` : "") +
    ` por $${money(data.total)}. ¡Gracias!`;

  async function reprint() {
    setPrinting(true);
    try {
      await fetch("/api/print", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: data!.orderId,
          type: data!.isRetail ? "ticket" : "retiro",
        }),
      });
    } catch {
      /* best-effort: el ticket ya se imprimió al cobrar */
    }
    setPrinting(false);
  }

  return (
    <Modal open onClose={onClose} title="Venta realizada" size="sm" zIndex={80}>
      <div className="space-y-3 text-center">
        <CheckCircle2 className="mx-auto h-11 w-11 text-emerald-600" />
        {data.orderNumber && (
          <p className="text-sm font-medium tabular-nums text-muted-foreground">{data.orderNumber}</p>
        )}

        <div className="rounded-lg bg-muted/50 p-4">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Total</p>
          <p className="text-3xl font-semibold tabular-nums">${money(data.total)}</p>
          {change > 0 && (
            <p className="mt-1 text-sm font-medium text-primary tabular-nums">
              Vuelto ${money(change)}
            </p>
          )}
        </div>

        <p className="text-sm text-muted-foreground">{data.paymentLabel}</p>

        {data.invoice && (
          <div className="rounded-md border border-border px-3 py-2 text-left text-xs">
            <p className="font-medium">
              Factura C {String(data.invoice.punto_venta).padStart(4, "0")}-
              {String(data.invoice.cbte_nro).padStart(8, "0")}
            </p>
            {data.invoice.cae && (
              <p className="mt-0.5 tabular-nums text-muted-foreground">
                CAE …{String(data.invoice.cae).slice(-4)}
              </p>
            )}
          </div>
        )}

        <div className="flex flex-wrap justify-center gap-2 border-t border-border pt-3">
          <Button type="button" variant="outline" onClick={reprint} disabled={printing}>
            <Printer className="mr-1.5 h-4 w-4" />
            {printing ? "Imprimiendo…" : "Reimprimir"}
          </Button>
          {waPhone.length >= 8 && (
            <a
              href={`https://wa.me/${waPhone}?text=${encodeURIComponent(waText)}`}
              target="_blank"
              rel="noreferrer"
            >
              <Button type="button" variant="outline">
                <MessageCircle className="mr-1.5 h-4 w-4" />
                WhatsApp
              </Button>
            </a>
          )}
        </div>
        <Button type="button" className="w-full" onClick={onClose}>
          Nueva venta <span className="ml-1 text-xs opacity-70">Enter</span>
        </Button>
      </div>
    </Modal>
  );
}
