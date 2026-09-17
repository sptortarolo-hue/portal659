"use client";

import { Modal } from "@/components/ui/modal";

type SummaryItem = {
  name: string;
  price: number;
  qty: number;
  modifiers?: string[];
  /** Total de la línea ya calculado (pack-aware). Si falta, price×qty. */
  lineTotal?: number;
};

type OrderSummaryModalProps = {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  vendorName: string;
  items: SummaryItem[];
  total: number;
  deliveryFee?: number;
  method: "delivery" | "pickup";
  address?: string;
  paymentMethod?: string;
  loading?: boolean;
  cashDiscount?: number;
  cashPct?: number;
  volumeDiscount?: number;
  volumeLabel?: string;
};

export function OrderSummaryModal({
  open,
  onClose,
  onConfirm,
  vendorName,
  items,
  total,
  deliveryFee = 0,
  method,
  address,
  paymentMethod,
  loading,
  cashDiscount = 0,
  cashPct = 0,
  volumeDiscount = 0,
  volumeLabel,
}: OrderSummaryModalProps) {
  const paymentLabel =
    paymentMethod === "efectivo"
      ? "Efectivo"
      : paymentMethod === "transferencia"
      ? "Transferencia"
      : "Coordinar";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Revisá tu pedido"
      footer={
        <>
          <button
            onClick={onClose}
            className="flex-1 rounded-xl border border-border py-3 text-sm font-medium hover:bg-muted transition-colors"
          >
            Editar
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="flex-1 rounded-xl bg-whatsapp text-white py-3 text-sm font-semibold hover:bg-whatsapp-dark transition-colors disabled:opacity-50"
          >
            {loading ? "Enviando..." : "Enviar por WhatsApp"}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Tu pedido para <span className="font-medium text-foreground">{vendorName}</span>
        </p>

        <div className="space-y-2">
          {items.map((item, idx) => {
            const modStr =
              item.modifiers && item.modifiers.length > 0
                ? ` (${item.modifiers.join(", ")})`
                : "";
            const itemTotal = item.lineTotal ?? (item.price * item.qty);
            return (
              <div key={idx} className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  {item.qty}x {item.name}
                  {modStr}
                </span>
                <span className="font-medium tabular-nums">
                  ${itemTotal.toLocaleString("es-AR")}
                </span>
              </div>
            );
          })}
        </div>

        {deliveryFee > 0 && (
          <div className="border-t border-border pt-3 flex justify-between text-sm text-muted-foreground">
            <span>Envío</span>
            <span className="tabular-nums">${deliveryFee.toLocaleString("es-AR")}</span>
          </div>
        )}
        {cashDiscount > 0 && (
          <div className="flex justify-between text-sm font-medium text-green-700">
            <span>Desc. efectivo ({Number(cashPct).toLocaleString("es-AR")}%)</span>
            <span className="tabular-nums">−${Number(cashDiscount).toLocaleString("es-AR")}</span>
          </div>
        )}
        {volumeDiscount > 0 && (
          <div className="flex justify-between text-sm font-medium text-emerald-700">
            <span>Desc. volumen{volumeLabel ? ` (${volumeLabel})` : ""}</span>
            <span className="tabular-nums">−${Number(volumeDiscount).toLocaleString("es-AR")}</span>
          </div>
        )}
        <div className="border-t border-border pt-3 flex justify-between font-bold">
          <span>Total</span>
          <span>${total.toLocaleString("es-AR")}</span>
        </div>

        <div className="rounded-xl bg-muted/50 p-3 text-xs text-muted-foreground space-y-1">
          <p>
            {method === "delivery" ? "🛵 Delivery" : "🏠 Retiro en local"}
            {address && method === "delivery" ? ` — ${address}` : ""}
          </p>
          <p>💳 {paymentLabel}</p>
        </div>
      </div>
    </Modal>
  );
}
