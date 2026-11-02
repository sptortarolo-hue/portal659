"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/modal";

type Props = {
  open: boolean;
  onClose: () => void;
  amount: number;
  orderId?: string | null;
  concept?: string;
  fiscalAutoEmit?: boolean;
  onPaid?: (qrId: string) => void;
};

export function MpQrModal({ open, onClose, amount, orderId, concept, fiscalAutoEmit, onPaid }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [qrId, setQrId] = useState<string | null>(null);
  const [status, setStatus] = useState<"pending" | "paid" | "expired" | "cancelled">("pending");
  const [paid, setPaid] = useState(false);

  useEffect(() => {
    if (!open) {
      setQrImage(null);
      setQrId(null);
      setStatus("pending");
      setPaid(false);
      setError(null);
      return;
    }
    let cancelled = false;
    async function generate() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/vendor/mp-qr", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId: orderId || null, amount, concept: concept || null }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "No se pudo generar el QR");
        if (cancelled) return;
        setQrImage(data.qrImage || null);
        setQrId(data.id || null);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    generate();
    return () => { cancelled = true; };
  }, [open, amount, orderId, concept]);

  // Polling de estado.
  useEffect(() => {
    if (!open || !qrId || paid) return;
    let cancelled = false;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/vendor/mp-qr/${qrId}`);
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        if (data.status === "paid") {
          setPaid(true);
          setStatus("paid");
          onPaid?.(qrId);
          clearInterval(timer);
        } else if (data.status === "expired" || data.status === "cancelled") {
          setStatus(data.status);
          clearInterval(timer);
        }
      } catch {
        /* ignorar */
      }
    }, 3000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [open, qrId, paid, onPaid]);

  return (
    <Modal open={open} onClose={onClose} title="Cobrar con QR de Mercado Pago" size="md">
      <div className="p-6 space-y-4 text-center">
        {loading && <p className="text-sm text-muted-foreground">Generando QR…</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}
        {!loading && !error && qrImage && !paid && (
          <>
            <p className="text-sm text-muted-foreground">
              El cliente escanea con cualquier app de pago (Mercado Pago, bancos, billeteras).
            </p>
            <img src={qrImage} alt="QR de pago" className="mx-auto rounded-xl border border-border" width={280} height={280} />
            <p className="text-2xl font-bold">${amount.toLocaleString("es-AR")}</p>
            {concept && <p className="text-xs text-muted-foreground">{concept}</p>}
            <p className="text-xs text-muted-foreground">Esperando confirmación de pago…</p>
          </>
        )}
        {paid && (
          <div className="space-y-2">
            <div className="text-5xl">✅</div>
            <p className="text-lg font-semibold">Pago acreditado</p>
            <p className="text-sm text-muted-foreground">
              ${amount.toLocaleString("es-AR")} cobrado por QR de Mercado Pago.
            </p>
            {fiscalAutoEmit && (
              <p className="text-xs text-muted-foreground">Emitiendo comprobante…</p>
            )}
          </div>
        )}
        {status === "expired" && (
          <div className="space-y-2">
            <div className="text-5xl">⏰</div>
            <p className="text-lg font-semibold">QR vencido</p>
            <p className="text-sm text-muted-foreground">Generá un nuevo QR para cobrar.</p>
          </div>
        )}
      </div>
      <div className="border-t border-border px-6 py-4 flex justify-end">
        <button
          onClick={onClose}
          className="px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-muted transition-colors"
        >
          {paid ? "Cerrar" : "Cancelar"}
        </button>
      </div>
    </Modal>
  );
}