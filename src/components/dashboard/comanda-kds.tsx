"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  timeAgo,
  canTransition,
  ORDER_STATUS_LABELS,
  KDS_COLUMNS,
  buildClientWhatsAppUrl,
  orderCondition,
  orderReadyLabel,
  orderCompleteActionLabel,
  CONDITION_META,
} from "@/lib/order-utils";
import { playNewOrderSound, playOrderReadySound, playUrgentSound, resumeAudioContext } from "@/lib/sounds";
import type { Order, OrderStatus } from "@/types/database";

type Props = {
  vendorId: string;
  vendorName: string;
  accessToken: string;
};

function useTimer() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(interval);
  }, []);
  return now;
}

function useBrowserNotifications() {
  const [permission, setPermission] = useState<NotificationPermission>("default");
  useEffect(() => {
    if ("Notification" in window) setPermission(Notification.permission);
  }, []);
  const requestPermission = useCallback(async () => {
    if (!("Notification" in window)) return;
    const result = await Notification.requestPermission();
    setPermission(result);
  }, []);
  const notify = useCallback((title: string, body: string) => {
    if (permission !== "granted") return;
    try { new Notification(title, { body, icon: "/icon.svg", tag: "portal659-order" }); } catch {}
  }, [permission]);
  return { permission, requestPermission, notify };
}

function vibrate(pattern: number[]) {
  try { navigator.vibrate?.(pattern); } catch {}
}

function getNextStatus(current: OrderStatus, method?: "delivery" | "pickup"): OrderStatus | null {
  if (current === "ready" && method === "pickup") return "completed";
  const flow: Record<string, OrderStatus> = {
    new: "confirmed", confirmed: "preparing", preparing: "ready", ready: "sent", sent: "completed",
  };
  return flow[current] || null;
}

function getActionButtonLabel(next: OrderStatus, order: Order): string {
  if (next === "ready") return orderReadyLabel(order);
  if (next === "sent" || (next === "completed" && order.status === "ready")) return orderCompleteActionLabel(order);
  const labels: Record<OrderStatus, string> = {
    new: "Aceptar", confirmed: "Preparar", preparing: "Listo",
    ready: "Enviar", sent: "Entregado", completed: "Completado", cancelled: "Cancelar",
  };
  return labels[next] || next;
}

function getStatusBorder(status: OrderStatus): string {
  const map: Record<OrderStatus, string> = {
    new: "border-l-status-new",
    confirmed: "border-l-status-confirmed",
    preparing: "border-l-status-preparing",
    ready: "border-l-status-ready",
    sent: "border-l-status-sent",
    completed: "border-l-status-completed",
    cancelled: "border-l-status-cancelled",
  };
  return map[status] || "border-l-border";
}

function getStatusBg(status: OrderStatus): string {
  const map: Record<OrderStatus, string> = {
    new: "bg-status-new/10 dark:bg-status-new/20",
    confirmed: "bg-status-confirmed/10 dark:bg-status-confirmed/20",
    preparing: "bg-status-preparing/10 dark:bg-status-preparing/20",
    ready: "bg-status-ready/10 dark:bg-status-ready/20",
    sent: "bg-status-sent/10 dark:bg-status-sent/20",
    completed: "bg-status-completed/10 dark:bg-status-completed/20",
    cancelled: "bg-status-cancelled/10 dark:bg-status-cancelled/20",
  };
  return map[status] || "";
}

function getTimeColor(elapsed: number, estimated: number | null): string {
  if (!estimated) return "";
  const remaining = Math.max(0, estimated - elapsed);
  if (remaining <= 0) return "border-red-500 bg-red-50 dark:bg-red-950/30";
  if (remaining <= 5) return "border-amber-400 bg-amber-50 dark:bg-amber-950/30";
  return "";
}

function TicketCard({
  order, now, vendorName, accessToken, onAction, onUndo,
}: {
  order: Order; now: number; vendorName: string; accessToken: string;
  onAction: (orderId: string, status: OrderStatus) => void;
  onUndo: (orderId: string, status: OrderStatus) => void;
}) {
  const created = new Date(order.created_at).getTime();
  const elapsed = Math.floor((now - created) / 60000);
  const remaining = order.estimated_minutes ? Math.max(0, order.estimated_minutes - elapsed) : null;
  const isOverdue = remaining !== null && remaining <= 0 && order.status !== "completed" && order.status !== "cancelled";
  const isUrgent = remaining !== null && remaining <= 5 && remaining > 0;
  const timeColor = getTimeColor(elapsed, order.estimated_minutes);
  const nextStatus = getNextStatus(order.status, order.method);
  const canAct = nextStatus && canTransition(order.status, nextStatus);
  const isTerminal = order.status === "completed" || order.status === "cancelled";

  const showWhatsApp =
    (order.method === "delivery" && order.status === "sent") ||
    (order.method === "pickup" && order.status === "ready");
  const waUrl = showWhatsApp ? buildClientWhatsAppUrl(order.status, order, vendorName) : null;

  const [undoVisible, setUndoVisible] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [printStatus, setPrintStatus] = useState<"ok" | "error" | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleAction(status: OrderStatus) {
    onAction(order.id, status);
    setUndoVisible(true);
    vibrate([30]);
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    undoTimerRef.current = setTimeout(() => setUndoVisible(false), 3000);
  }

  function handleUndo() {
    setUndoVisible(false);
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    onUndo(order.id, order.status);
  }

  async function handlePrint() {
    setPrinting(true);
    setPrintStatus(null);
    try {
      const res = await fetch("/api/print", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ orderId: order.id }),
      });
      const data = await res.json();
      if (data.ok || data.skipped) {
        setPrintStatus("ok");
        vibrate([20]);
      } else {
        setPrintStatus("error");
        window.open(`/vendor/imprimir/${order.id}`, "_blank", "noopener");
      }
    } catch {
      setPrintStatus("error");
      window.open(`/vendor/imprimir/${order.id}`, "_blank", "noopener");
    }
    setPrinting(false);
    setTimeout(() => setPrintStatus(null), 3000);
  }

  useEffect(() => {
    return () => { if (undoTimerRef.current) clearTimeout(undoTimerRef.current); };
  }, []);

  return (
    <div className={`rounded-xl border-l-4 border border-border bg-card p-2.5 transition-all animate-ticket-enter ${
      getStatusBorder(order.status)
    } ${timeColor} ${isOverdue ? "animate-pulse" : ""} ${
      order.status === "new" ? "animate-flash-border" : ""
    }`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[11px] font-bold text-foreground/70">#{order.id.slice(0, 6)}</span>
          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${CONDITION_META[orderCondition(order)].pillClass}`}>
            {CONDITION_META[orderCondition(order)].label}
          </span>
          {order.modification_notes && (
            <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400">Editado</span>
          )}
        </div>
        <div className="text-right">
          <span className={`text-xs font-bold tabular-nums ${isOverdue ? "text-red-600 dark:text-red-400" : isUrgent ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>
            {elapsed}m
          </span>
          {remaining !== null && (
            <span className={`text-[9px] ml-1 ${isOverdue ? "text-red-500" : isUrgent ? "text-amber-500" : "text-muted-foreground/50"}`}>
              {isOverdue ? `+${-remaining}` : `~${remaining}`}
            </span>
          )}
        </div>
      </div>

      {/* Items */}
      <div className="space-y-0.5 mb-1.5">
        {order.items.slice(0, 4).map((item, i) => (
          <div key={i} className="flex items-start gap-1 text-[13px] leading-tight">
            <span className="font-bold text-foreground tabular-nums min-w-[22px]">{item.qty}x</span>
            <span className="text-foreground font-medium truncate">{item.name}</span>
            {item.modifiers && item.modifiers.length > 0 && (
              <span className="text-[10px] font-bold text-red-600 dark:text-red-400 ml-0.5">
                ({item.modifiers.join(", ")})
              </span>
            )}
          </div>
        ))}
        {order.items.length > 4 && (
          <p className="text-[10px] text-muted-foreground pl-7">+{order.items.length - 4} más</p>
        )}
      </div>

      {/* Notes */}
      {order.notes && (
        <div className="bg-amber-50 border border-amber-200 rounded px-1.5 py-1 mb-1.5 dark:bg-amber-950/20 dark:border-amber-800">
          <p className="text-[10px] text-amber-700 dark:text-amber-400 truncate">📝 {order.notes}</p>
        </div>
      )}

      {order.modification_notes && (
        <div className="bg-blue-50 border border-blue-200 rounded px-1.5 py-1 mb-1.5 dark:bg-blue-950/20 dark:border-blue-800">
          <p className="text-[10px] text-blue-700 dark:text-blue-400 truncate">✏️ {order.modification_notes}</p>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <p className="text-[11px] text-muted-foreground truncate">{order.customer_name}</p>
          <p className="text-xs font-bold text-foreground">${Number(order.total).toLocaleString("es-AR")}</p>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {!isTerminal && (
            <button
              onClick={(e) => { e.stopPropagation(); handlePrint(); }}
              className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground"
              title="Imprimir comanda"
            >
              {printStatus === "ok" ? "✅" : printStatus === "error" ? "❌" : printing ? "⏳" : "🖨️"}
            </button>
          )}
          {waUrl && (
            <a href={waUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
              className="p-1.5 rounded-lg hover:bg-green-50 dark:hover:bg-green-950 transition-colors text-green-600">
              📱
            </a>
          )}
        </div>
      </div>

      {/* Action + Undo */}
      {!isTerminal && canAct && (
        <div className="mt-2 flex gap-1.5">
          {undoVisible ? (
            <button onClick={handleUndo}
              className="flex-1 py-1.5 rounded-lg bg-muted text-xs font-bold text-muted-foreground hover:bg-muted/80 transition-colors">
              ↩️ Deshacer
            </button>
          ) : (
            <button onClick={() => handleAction(nextStatus!)}
              className="flex-1 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-bold hover:bg-primary/90 transition-colors active:scale-[0.97]">
              {getActionButtonLabel(nextStatus!, order)}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function ComandaKDS({ vendorId, vendorName, accessToken }: Props) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [activeTab, setActiveTab] = useState<OrderStatus | "all">("new");
  const [loading, setLoading] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const touchStartY = useRef(0);

  const now = useTimer();
  const { permission, requestPermission, notify } = useBrowserNotifications();

  const soundEnabledRef = useRef(soundEnabled);
  useEffect(() => { soundEnabledRef.current = soundEnabled; }, [soundEnabled]);
  const notifyRef = useRef(notify);
  useEffect(() => { notifyRef.current = notify; }, [notify]);
  const ordersRef = useRef(orders);
  useEffect(() => { ordersRef.current = orders; }, [orders]);

  const previousStatusRef = useRef<Map<string, OrderStatus>>(new Map());

  async function fetchOrders() {
    try {
      const res = await fetch("/api/vendor/orders", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json();
      if (data.orders) {
        setOrders((prev) => {
          const prevMap = new Map(prev.map((o) => [o.id, o.status]));
          const next = data.orders as Order[];
          next.forEach((o) => previousStatusRef.current.set(o.id, prevMap.get(o.id) || o.status));
          return next;
        });
      }
    } catch {}
    setLoading(false);
  }

  useEffect(() => { fetchOrders(); }, []);

  // Polling: detecta pedidos nuevos y cambios de estado (reemplaza realtime)
  useEffect(() => {
    if (!accessToken) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/vendor/orders", {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const data = await res.json();
        if (!data.orders) return;
        const next = data.orders as Order[];
        const nextIds = new Set(next.map((o) => o.id));
        const prevMap = new Map(ordersRef.current.map((o) => [o.id, o.status]));

        // Pedidos nuevos
        const fresh = next.filter((o) => !prevMap.has(o.id));
        if (fresh.length > 0) {
          if (soundEnabledRef.current) playNewOrderSound();
          vibrate([100, 50, 100]);
          fresh.forEach((order) => {
            notifyRef.current("Nuevo pedido", `${order.customer_name} - $${Number(order.total).toLocaleString("es-AR")}`);
          });
          setOrders((prev) => [...fresh, ...prev.filter((o) => !nextIds.has(o.id))]);
        }

        // Cambios de estado (notificación cuando pasa a "ready")
        const statusChanges = next.filter((o) => prevMap.has(o.id) && prevMap.get(o.id) !== o.status);
        const ready = statusChanges.find((o) => o.status === "ready");
        if (ready && soundEnabledRef.current) {
          playOrderReadySound();
          vibrate([200, 100, 200]);
          notifyRef.current("Pedido listo", `${ready.customer_name} - #${ready.id.slice(0, 8)}`);
        }
        if (fresh.length > 0 || statusChanges.length > 0) {
          setOrders((prev) => {
            const merged = next.map((o) => prev.find((p) => p.id === o.id) ? { ...prev.find((p) => p.id === o.id)!, ...o } : o);
            const mergedIds = new Set(merged.map((o) => o.id));
            return [...merged, ...prev.filter((o) => !mergedIds.has(o.id))];
          });
        }
      } catch {}
    }, 15000);
    return () => clearInterval(interval);
  }, [accessToken]);

  useEffect(() => {
    if (activeTab !== "new") return;
    const interval = setInterval(() => {
      const newOrders = ordersRef.current.filter((o) => o.status === "new");
      const overdue = newOrders.filter((o) => {
        const elapsed = Math.floor((Date.now() - new Date(o.created_at).getTime()) / 60000);
        return o.estimated_minutes != null && elapsed > o.estimated_minutes;
      });
      if (overdue.length > 0 && soundEnabledRef.current) playUrgentSound();
    }, 30000);
    return () => clearInterval(interval);
  }, [activeTab]);

  async function handleAction(orderId: string, status: OrderStatus) {
    const estimated = status === "confirmed" ? 30 : undefined;
    setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, status } : o)));
    try {
      await fetch(`/api/vendor/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ status, estimated_minutes: estimated }),
      });
      if (status === "confirmed") {
        fetch("/api/print", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({ orderId }),
        }).catch(() => {});
      }
    } catch { fetchOrders(); }
  }

  function handleUndo(orderId: string, _currentStatus: OrderStatus) {
    const prevStatus = previousStatusRef.current.get(orderId);
    if (prevStatus) handleAction(orderId, prevStatus);
  }

  function handleTouchStart(e: React.TouchEvent) {
    if (listRef.current && listRef.current.scrollTop <= 0) {
      touchStartY.current = e.touches[0].clientY;
    }
  }

  function handleTouchMove(e: React.TouchEvent) {
    if (listRef.current && listRef.current.scrollTop <= 0) {
      const diff = e.touches[0].clientY - touchStartY.current;
      if (diff > 0) setPullDistance(Math.min(diff, 100));
    }
  }

  async function handleTouchEnd() {
    if (pullDistance > 60) {
      setRefreshing(true);
      await fetchOrders();
      setRefreshing(false);
    }
    setPullDistance(0);
  }

  const activeOrders = orders.filter((o) => o.status !== "completed" && o.status !== "cancelled");
  const activeCount = activeOrders.length;

  const columnOrders = (status: OrderStatus) =>
    orders
      .filter((o) => o.status === status)
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  const tabs: { key: OrderStatus | "all"; label: string; emoji: string; count: number }[] = [
    { key: "new", label: "Nuevos", emoji: "🆕", count: columnOrders("new").length },
    { key: "confirmed", label: "Aceptados", emoji: "✅", count: columnOrders("confirmed").length },
    { key: "preparing", label: "Preparando", emoji: "🍳", count: columnOrders("preparing").length },
    { key: "ready", label: "Listos", emoji: "📦", count: columnOrders("ready").length },
    { key: "all", label: "Todos", emoji: "📋", count: activeCount },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-6 w-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const renderColumn = (status: OrderStatus, label: string, emoji: string) => {
    const items = columnOrders(status);
    return (
      <div key={status} className="flex flex-col min-w-0">
        <div className={`flex items-center gap-1.5 mb-2 px-1 ${getStatusBg(status)} rounded-lg py-1.5`}>
          <span className="text-sm">{emoji}</span>
          <span className="text-xs font-bold text-foreground">{label}</span>
          {items.length > 0 && (
            <span className="ml-auto text-[10px] font-bold bg-foreground/10 text-foreground px-1.5 py-0.5 rounded-full">{items.length}</span>
          )}
        </div>
        <div className="space-y-2 kds-kanban-column">
          {items.length === 0 ? (
            <div className="text-center py-6 text-muted-foreground text-xs">Sin pedidos</div>
          ) : (
            items.map((order) => (
              <TicketCard
                key={order.id}
                order={order}
                now={now}
                vendorName={vendorName}
                accessToken={accessToken}
                onAction={handleAction}
                onUndo={handleUndo}
              />
            ))
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between sticky top-0 z-10 bg-background/95 backdrop-blur-sm py-2 -mx-4 px-4 border-b border-border/50">
        <div className="flex items-center gap-2">
          <h2 className="font-display text-lg font-bold">Comanda</h2>
          {activeCount > 0 && (
            <span className="bg-primary text-primary-foreground text-xs font-bold px-2 py-0.5 rounded-full">{activeCount}</span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => { resumeAudioContext(); setSoundEnabled(!soundEnabled); }}
            className={`text-xs px-2 py-1.5 rounded-lg font-medium transition-colors ${
              soundEnabled ? "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400" : "bg-muted text-muted-foreground"
            }`}
          >
            {soundEnabled ? "🔊" : "🔇"}
          </button>
          {permission !== "granted" && (
            <button onClick={requestPermission} className="text-xs px-2 py-1.5 rounded-lg bg-primary/10 text-primary font-medium">
              🔔
            </button>
          )}
        </div>
      </div>

      {/* Tab pills — mobile only */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide -mx-4 px-4 sm:hidden">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`flex-shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-[11px] font-bold transition-all ${
              activeTab === t.key
                ? "bg-primary text-primary-foreground shadow-sm"
                : "bg-muted text-muted-foreground"
            }`}
          >
            <span>{t.emoji}</span>
            {t.label}
            {t.count > 0 && (
              <span className={`text-[9px] px-1 py-0.5 rounded-full font-bold ${
                activeTab === t.key ? "bg-primary-foreground/20" : "bg-foreground/10"
              }`}>{t.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* Pull to refresh indicator */}
      {pullDistance > 0 && (
        <div className="text-center py-1" style={{ height: pullDistance / 2 }}>
          <div className={`inline-block h-4 w-4 border-2 border-primary border-t-transparent rounded-full ${refreshing ? "animate-spin" : ""}`}
            style={{ opacity: Math.min(1, pullDistance / 60) }} />
        </div>
      )}

      {/* Mobile: single column with tabs */}
      <div
        ref={listRef}
        className="sm:hidden space-y-2 pb-4"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {activeTab === "all" ? (
          activeOrders
            .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
            .map((order) => (
              <TicketCard
                key={order.id}
                order={order}
                now={now}
                vendorName={vendorName}
                accessToken={accessToken}
                onAction={handleAction}
                onUndo={handleUndo}
              />
            ))
        ) : (
          columnOrders(activeTab as OrderStatus).map((order) => (
            <TicketCard
              key={order.id}
              order={order}
              now={now}
              vendorName={vendorName}
              accessToken={accessToken}
              onAction={handleAction}
              onUndo={handleUndo}
            />
          ))
        )}
        {((activeTab === "all" && activeOrders.length === 0) ||
          (activeTab !== "all" && columnOrders(activeTab as OrderStatus).length === 0)) && (
          <div className="text-center py-12">
            <div className="text-4xl mb-3">🎉</div>
            <p className="text-sm font-medium text-muted-foreground">
              {activeTab === "new" ? "No hay pedidos nuevos" : `Sin pedidos en ${tabs.find((t) => t.key === activeTab)?.label}`}
            </p>
          </div>
        )}
      </div>

      {/* Desktop: kanban board */}
      <div className="hidden sm:grid kds-kanban">
        {KDS_COLUMNS.filter((c) => c.status !== "sent").map((col) =>
          renderColumn(col.status, col.label, col.emoji)
        )}
      </div>
    </div>
  );
}
