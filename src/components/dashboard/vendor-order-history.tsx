"use client";

import { useCallback, useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { ORDER_STATUS_LABELS, ORDER_STATUS_COLORS, statusLabel } from "@/lib/order-utils";
import type { OrderStatus } from "@/types/database";

type HistoryOrder = {
  id: string;
  customer_name: string;
  customer_phone: string;
  method: "pickup" | "delivery";
  payment_method: string | null;
  status: OrderStatus;
  total: number;
  created_at: string;
  pickup_number: number | null;
};

const PAYMENT_LABELS: Record<string, string> = {
  whatsapp: "Coordinar",
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  mercadopago: "Mercado Pago",
};

export function VendorOrderHistory({ isModa = false }: { isModa?: boolean }) {
  const [orders, setOrders] = useState<HistoryOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const pageSize = 25;

  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [method, setMethod] = useState("");
  const [payment, setPayment] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("page_size", String(pageSize));
      if (q) params.set("q", q);
      if (status) params.set("status", status);
      if (method) params.set("method", method);
      if (payment) params.set("payment_method", payment);
      if (dateFrom) params.set("date_from", dateFrom);
      if (dateTo) params.set("date_to", dateTo);

      const res = await fetch(`/api/vendor/orders/history?${params}`);
      const data = await res.json();
      if (!data.error) {
        setOrders(data.orders || []);
        setTotal(data.total || 0);
        if ((data.orders || []).length === 0 && data.page > 1) setPage((p) => p - 1);
      }
    } finally {
      setLoading(false);
    }
  }, [page, q, status, method, payment, dateFrom, dateTo, pageSize]);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // Doble confirmación de borrado
  const [deleteTarget, setDeleteTarget] = useState<HistoryOrder | null>(null);
  const [confirmStage, setConfirmStage] = useState<1 | 2>(1);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);

  function openDelete(order: HistoryOrder) {
    setDeleteTarget(order);
    setConfirmStage(1);
    setConfirmText("");
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    const res = await fetch(`/api/vendor/orders/${deleteTarget.id}`, { method: "DELETE" });
    const data = await res.json();
    setDeleting(false);
    setDeleteTarget(null);
    if (data.ok) fetchOrders();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-xl font-semibold">Histórico de pedidos</h2>
        <span className="text-xs text-muted-foreground">{total} pedido{total !== 1 ? "s" : ""}</span>
      </div>

      {/* Buscador + filtros */}
      <div className="relative">
        <input
          type="text"
          value={q}
          onChange={(e) => { setQ(e.target.value); setPage(1); }}
          placeholder="Buscar nombre, teléfono o #ID..."
          className="w-full h-10 pl-9 pr-3 text-sm rounded-xl border border-input bg-background"
        />
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">🔍</span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="h-9 rounded-md border border-input bg-background px-2 text-sm col-span-2">
          <option value="">Todos los estados</option>
          {Object.entries(ORDER_STATUS_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select value={method} onChange={(e) => { setMethod(e.target.value); setPage(1); }} className="h-9 rounded-md border border-input bg-background px-2 text-sm">
          <option value="">Método</option>
          <option value="pickup">Retiro</option>
          <option value="delivery">Delivery</option>
        </select>
        <select value={payment} onChange={(e) => { setPayment(e.target.value); setPage(1); }} className="h-9 rounded-md border border-input bg-background px-2 text-sm">
          <option value="">Pago</option>
          <option value="efectivo">Efectivo</option>
          <option value="transferencia">Transferencia</option>
          <option value="whatsapp">Coordinar</option>
          <option value="mercadopago">Mercado Pago</option>
        </select>
        <div className="col-span-2 sm:col-span-1">
          <input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm" title="Desde" />
        </div>
        <div className="col-span-2 sm:col-span-1">
          <input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm" title="Hasta" />
        </div>
      </div>

      {/* Lista */}
      {loading ? (
        <div className="space-y-2">
          {[...Array(6)].map((_, i) => <div key={i} className="h-14 rounded-xl bg-muted animate-pulse" />)}
        </div>
      ) : orders.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-4xl mb-3">📜</div>
          <p className="text-muted-foreground text-sm">No se encontraron pedidos</p>
        </div>
      ) : (
        <div className="space-y-2">
          {orders.map((o) => (
            <div key={o.id} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm">{o.customer_name}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${ORDER_STATUS_COLORS[o.status]}`}>
                    {statusLabel(o.status, isModa)}
                  </span>
                  {(o as any).is_preview && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold bg-violet-100 text-violet-700">
                      🧪 PRUEBA
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground truncate">
                  {new Date(o.created_at).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" })}
                  {" · "}{o.customer_phone}
                  {o.pickup_number != null ? ` · Nro. ${o.pickup_number}` : ""}
                </p>
                <p className="text-[11px] text-muted-foreground/70">
                  {o.method === "delivery" ? "🛵 Delivery" : "🏠 Retiro"} · {PAYMENT_LABELS[o.payment_method || ""] || o.payment_method || "-"}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="font-bold text-sm">${Number(o.total).toLocaleString("es-AR")}</p>
                <button
                  onClick={() => openDelete(o)}
                  className="text-[11px] font-medium text-red-500 hover:text-red-600 mt-1"
                >
                  Borrar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Paginación */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="rounded-lg border border-input px-3 py-1.5 text-sm disabled:opacity-40"
          >
            ← Anterior
          </button>
          <span className="text-xs text-muted-foreground">Página {page} de {totalPages}</span>
          <button
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="rounded-lg border border-input px-3 py-1.5 text-sm disabled:opacity-40"
          >
            Siguiente →
          </button>
        </div>
      )}

      {/* Modal de doble confirmación */}
      <Modal
        open={!!deleteTarget}
        onClose={() => { if (!deleting) setDeleteTarget(null); }}
        title={confirmStage === 1 ? "¿Estás seguro?" : "Confirmar borrado"}
        footer={
          confirmStage === 1 ? (
            <>
              <button onClick={() => setDeleteTarget(null)} className="flex-1 rounded-xl border border-border py-3 text-sm font-medium hover:bg-muted transition-colors">
                Cancelar
              </button>
              <button onClick={() => setConfirmStage(2)} className="flex-1 rounded-xl bg-primary text-primary-foreground py-3 text-sm font-semibold">
                Sí, continuar
              </button>
            </>
          ) : (
            <>
              <button onClick={() => setDeleteTarget(null)} disabled={deleting} className="flex-1 rounded-xl border border-border py-3 text-sm font-medium hover:bg-muted transition-colors">
                Cancelar
              </button>
              <button
                onClick={confirmDelete}
                disabled={confirmText.trim().toLowerCase() !== "confirmar" || deleting}
                className="flex-1 rounded-xl bg-red-600 text-white py-3 text-sm font-semibold disabled:opacity-40"
              >
                {deleting ? "Borrando..." : "Borrar definitivamente"}
              </button>
            </>
          )
        }
      >
        {confirmStage === 1 ? (
          <p className="text-sm text-muted-foreground">
            Vas a borrar el pedido de <b>{deleteTarget?.customer_name}</b> por{" "}
            <b>${Number(deleteTarget?.total || 0).toLocaleString("es-AR")}</b>.
            Esta acción no tiene vuelta atrás.
          </p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Para confirmar, escribí la palabra <b>confirmar</b>. El pedido se borrará de forma
              permanente y <b>no se puede deshacer</b>.
            </p>
            <Input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="confirmar"
              autoFocus
            />
          </div>
        )}
      </Modal>
    </div>
  );
}