"use client";

import { Modal } from "@/components/ui/modal";

type SummaryItem = {
  name: string;
  price: number;
  qty: number;
  modifiers?: string[];
};

type OrderSummaryModalProps = {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  vendorName: string;
  items: SummaryItem[];
  total: number;
  method: "delivery" | "pickup";
  address?: string;
  paymentMethod?: string;
  loading?: boolean;
};

export function OrderSummaryModal({
  open,
  onClose,
  onConfirm,
  vendorName,
  items,
  total,
  method,
  address,
  paymentMethod,
  loading,
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
            return (
              <div key={idx} className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  {item.qty}x {item.name}
                  {modStr}
                </span>
                <span className="font-medium tabular-nums">
                  ${(item.price * item.qty).toLocaleString("es-AR")}
                </span>
              </div>
            );
          })}
        </div>

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
