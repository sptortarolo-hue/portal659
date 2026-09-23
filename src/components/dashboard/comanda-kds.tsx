"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  canTransition,
  KDS_COLUMNS,
  buildClientWhatsAppUrl,
  orderCondition,
  orderReadyLabel,
  orderCompleteActionLabel,
  orderNeedsKitchen,
  nextStatusFor,
  kitchenProgress,
  CONDITION_META,
} from "@/lib/order-utils";
import { playNewOrderSound, playOrderReadySound, playUrgentSound, resumeAudioContext } from "@/lib/sounds";
import type { Order, OrderStatus } from "@/types/database";

type Props = {
  vendorId: string;
  vendorName: string;
  accessToken: string;
  prepTimeMin?: number | null;
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

function getActionButtonLabel(next: OrderStatus, order: Order): string {
  // Mostrador/mesa saltean "preparar": del estado nuevo pasan a "Listo p/ entregar".
  if (order.status === "new") {
    return next === "ready" ? `✅ ${orderReadyLabel(order)}` : "Aceptar y empezar a preparar";
  }
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
  order, now, vendorName, accessToken, onAction, onUndo, onToggleItem, onMarkAll,
}: {
  order: Order; now: number; vendorName: string; accessToken: string;
  onAction: (orderId: string, status: OrderStatus) => Promise<string | null>;
  onUndo: (orderId: string, status: OrderStatus) => void;
  onToggleItem: (orderId: string, index: number) => void;
  onMarkAll: (orderId: string) => void;
}) {
  const created = new Date(order.created_at).getTime();
  const elapsed = Math.floor((now - created) / 60000);
  const remaining = order.estimated_minutes ? Math.max(0, order.estimated_minutes - elapsed) : null;
  const isOverdue = remaining !== null && remaining <= 0 && order.status !== "completed" && order.status !== "cancelled";
  const isUrgent = remaining !== null && remaining <= 5 && remaining > 0;
  const timeColor = getTimeColor(elapsed, order.estimated_minutes);
  const nextStatus = nextStatusFor(order.status, order.method, false, order.channel, orderNeedsKitchen(order));
  const canAct = nextStatus && canTransition(order.status, nextStatus);
  const isTerminal = order.status === "completed" || order.status === "cancelled";

  const showWhatsApp =
    (order.method === "delivery" && order.status === "sent") ||
    (order.method === "pickup" && order.status === "ready");
  // Mostrador y mesa son ventas presenciales: no tienen WhatsApp del cliente.
  const isCounterChannel = order.channel === "mostrador" || order.channel === "mesa";
  const waUrl = showWhatsApp && !isCounterChannel ? buildClientWhatsAppUrl(order.status, order, vendorName) : null;

  const [undoVisible, setUndoVisible] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [printStatus, setPrintStatus] = useState<"ok" | "error" | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const progress = kitchenProgress(order);
  const allDone = progress.total > 0 && progress.done >= progress.total;
  // El cierre "Listo" exige todo tildado (gate estricto, también en server).
  const blockedByKitchen = nextStatus === "ready" && !allDone;
  const [toggling, setToggling] = useState<number | null>(null);
  const [markingAll, setMarkingAll] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Solo se tilda en estados operativos de cocina.
  const canTick = order.status === "new" || order.status === "preparing";

  function handleToggle(index: number) {
    if (!canTick || toggling !== null) return;
    setToggling(index);
    vibrate([20]);
    onToggleItem(order.id, index);
    // Se libera al llegar el polling/refresh (el estado es server-driven).
    setTimeout(() => setToggling(null), 1500);
  }

  function handleMarkAll() {
    if (!canTick || markingAll || allDone) return;
    setMarkingAll(true);
    vibrate([20]);
    onMarkAll(order.id);
    setTimeout(() => setMarkingAll(false), 1500);
  }

  async function handleAction(status: OrderStatus) {
    setActionError(null);
    const err = await onAction(order.id, status);
    if (err) {
      setActionError(err);
      vibrate([100, 50, 100]);
      setTimeout(() => setActionError(null), 4000);
      return;
    }
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
          <span className="font-mono text-[13px] font-extrabold text-foreground">{order.pickup_number != null ? `Nro. ${order.pickup_number}` : `#${order.id.slice(0, 6)}`}</span>
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

      {/* Progreso de cocina */}
      {progress.total > 0 && (
        <div className="flex items-center gap-2 mb-1.5">
          <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${allDone ? "bg-green-500" : "bg-primary"}`}
              style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }}
            />
          </div>
          <span className={`text-[10px] font-extrabold tabular-nums ${allDone ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}`}>
            {progress.done}/{progress.total}
          </span>
          {canTick && !allDone && (
            <button
              onClick={(e) => { e.stopPropagation(); handleMarkAll(); }}
              disabled={markingAll}
              className="text-[10px] font-bold text-primary hover:underline disabled:opacity-50"
            >
              {markingAll ? "…" : "Todos"}
            </button>
          )}
        </div>
      )}

      {/* Items con checkbox de cocina (se muestran TODOS: cocina los necesita completos) */}
      <div className="space-y-0.5 mb-1.5">
        {(order.items || []).map((item, i) => {
          const done = progress.flags[i] === true;
          const row = (
            <>
              <span
                className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border-2 text-[12px] font-bold transition-colors ${
                  done
                    ? "border-green-500 bg-green-500 text-white"
                    : "border-muted-foreground/40 bg-transparent text-transparent"
                }`}
                aria-hidden
              >
                ✓
              </span>
              <span className="font-bold text-foreground tabular-nums min-w-[22px] flex-shrink-0">{item.qty}x</span>
              {/* min-w-0 flex-1 + wrap: sin esto un nombre o modifier largo
                  ensanchaba la tarjeta y la página se iba de pantalla en mobile.
                  Los modifiers NO se truncan: cocina los necesita completos. */}
              <span className={`min-w-0 flex-1 break-words font-medium ${done ? "text-muted-foreground line-through opacity-70" : "text-foreground"}`}>
                {item.name}
                {item.modifiers && item.modifiers.length > 0 && (
                  <span className="text-[10px] font-bold text-red-600 dark:text-red-400">
                    {" "}({item.modifiers.join(", ")})
                  </span>
                )}
              </span>
            </>
          );
          return canTick ? (
            <button
              key={i}
              onClick={(e) => { e.stopPropagation(); handleToggle(i); }}
              disabled={toggling !== null}
              className={`flex w-full items-start gap-1.5 rounded-lg px-1 py-1 text-left text-[13px] leading-tight transition-colors active:scale-[0.99] ${toggling === i ? "opacity-50" : "hover:bg-muted/60"}`}
              aria-pressed={done}
              aria-label={`Tildar ${item.qty}x ${item.name}`}
            >
              {row}
            </button>
          ) : (
            <div key={i} className="flex items-start gap-1.5 px-1 py-0.5 text-[13px] leading-tight">
              {row}
            </div>
          );
        })}
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
          {!isTerminal && order.status !== "new" && orderNeedsKitchen(order) && (
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
      {actionError && (
        <p className="mt-2 rounded-lg bg-red-50 border border-red-200 px-2 py-1.5 text-[11px] font-bold text-red-600 dark:bg-red-950/30 dark:border-red-900 dark:text-red-400">
          ⚠️ {actionError}
        </p>
      )}
      {!isTerminal && canAct && (
        <div className="mt-2 flex gap-1.5">
          {undoVisible ? (
            <button onClick={handleUndo}
              className="flex-1 py-2 sm:py-2.5 rounded-lg bg-muted text-xs sm:text-sm font-bold text-muted-foreground hover:bg-muted/80 transition-colors">
              ↩️ Deshacer
            </button>
          ) : blockedByKitchen ? (
            <div className="flex-1 py-2 sm:py-2.5 rounded-lg bg-muted text-muted-foreground text-xs sm:text-sm font-bold text-center">
              ☐ Tildá todo ({progress.done}/{progress.total})
            </div>
          ) : (
            <button onClick={() => handleAction(nextStatus!)}
              className="flex-1 py-2 sm:py-2.5 rounded-lg bg-primary text-primary-foreground text-xs sm:text-sm font-bold hover:bg-primary/90 transition-colors active:scale-[0.97]">
              {getActionButtonLabel(nextStatus!, order)}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Fila agregada por producto (vista "Por producto"): suma pendientes de todos los tickets activos. */
function ProductAggregate({ orders }: { orders: Order[] }) {
  const rows = (() => {
    const map = new Map<string, { name: string; modifiers: string; pending: number; total: number; tickets: Set<string> }>();
    for (const o of orders) {
      if (o.status === "completed" || o.status === "cancelled") continue;
      const { flags } = kitchenProgress(o);
      (o.items || []).forEach((it, idx) => {
        if (it?.requires_prep === false) return;
        const key = `${it.name}||${(it.modifiers || []).join(",")}`;
        let row = map.get(key);
        if (!row) {
          row = { name: it.name, modifiers: (it.modifiers || []).join(", "), pending: 0, total: 0, tickets: new Set() };
          map.set(key, row);
        }
        row.total += it.qty;
        if (!flags[idx]) row.pending += it.qty;
        row.tickets.add(o.pickup_number != null ? `Nro. ${o.pickup_number}` : `#${o.id.slice(0, 6)}`);
      });
    }
    return [...map.values()].sort((a, b) => b.pending - a.pending || b.total - a.total);
  })();

  if (rows.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="text-4xl mb-3">🎉</div>
        <p className="text-sm font-medium text-muted-foreground">Nada pendiente en cocina</p>
      </div>
    );
  }
  return (
    <div className="space-y-2 pb-4">
      {rows.map((r) => (
        <div
          key={`${r.name}||${r.modifiers}`}
          className={`rounded-xl border border-border bg-card p-2.5 ${r.pending === 0 ? "opacity-60" : ""}`}
        >
          <div className="flex items-center gap-2">
            <span
              className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md border-2 text-[13px] font-bold ${
                r.pending === 0 ? "border-green-500 bg-green-500 text-white" : "border-muted-foreground/40 text-transparent"
              }`}
              aria-hidden
            >
              ✓
            </span>
            <span className={`font-extrabold tabular-nums ${r.pending === 0 ? "text-green-600 dark:text-green-400" : "text-foreground"}`}>
              {r.pending}x
            </span>
            <span className={`min-w-0 flex-1 break-words text-[13px] font-medium ${r.pending === 0 ? "text-muted-foreground line-through" : "text-foreground"}`}>
              {r.name}
              {r.modifiers && (
                <span className="text-[10px] font-bold text-red-600 dark:text-red-400"> ({r.modifiers})</span>
              )}
            </span>
            {r.pending < r.total && (
              <span className="text-[10px] font-bold text-muted-foreground tabular-nums flex-shrink-0">
                de {r.total}
              </span>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground mt-1 pl-8 truncate">
            🧾 {[...r.tickets].join(" · ")}
          </p>
        </div>
      ))}
      <p className="text-center text-[11px] text-muted-foreground pt-1">
        Resumen para cantar producción — tildá los ítems desde la vista Por pedido.
      </p>
    </div>
  );
}

export default function ComandaKDS({ vendorId, vendorName, accessToken, prepTimeMin = null }: Props) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [activeTab, setActiveTab] = useState<OrderStatus | "all">("new");
  const [boardView, setBoardView] = useState<"tickets" | "products">("tickets");
  // Fullscreen del navegador (modo cocina: la página esconde sidebar, header
  // y bottom nav en sm+ mientras esté activo + esta pestaña visible).
  const [isFs, setIsFs] = useState(false);
  useEffect(() => {
    const onFs = () => setIsFs(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => {
      document.removeEventListener("fullscreenchange", onFs);
      // Al salir de la Comanda no quedar atrapado sin navegación.
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };
  }, []);

  function toggleFullscreen() {
    resumeAudioContext();
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
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
    // Timeout: si la red queda colgada (p. ej. conexión móvil suspendida),
    // mostramos error con reintento en lugar de un spinner eterno.
    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), 8000);
    try {
      const res = await fetch("/api/vendor/orders", {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: ac.signal,
      });
      const data = await res.json();
      if (data.orders) {
        setOrders((prev) => {
          const prevMap = new Map(prev.map((o) => [o.id, o.status]));
          // La comanda solo muestra pedidos que requieren elaboración de cocina.
          const next = (data.orders as Order[]).filter(orderNeedsKitchen);
          next.forEach((o) => previousStatusRef.current.set(o.id, prevMap.get(o.id) || o.status));
          return next;
        });
      }
      setLoadError(false);
    } catch {
      setLoadError(true);
    } finally {
      clearTimeout(timeout);
    }
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
        // La comanda solo ve pedidos que requieren elaboración de cocina.
        const next = (data.orders as Order[]).filter(orderNeedsKitchen);
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
          notifyRef.current("Pedido listo", `${ready.customer_name} - Nro. ${ready.pickup_number ?? ready.id.slice(0, 8)}`);
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

  async function handleAction(orderId: string, status: OrderStatus): Promise<string | null> {
    const estimated = status === "preparing" ? (prepTimeMin ?? 30) : undefined;
    setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, status } : o)));
    try {
      const res = await fetch(`/api/vendor/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ status, estimated_minutes: estimated }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Revierte el optimista y muestra el motivo (ej. cocina incompleta).
        fetchOrders();
        return (data as { error?: string }).error || "No se pudo actualizar";
      }
      if (data.order) {
        setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, ...(data.order as Partial<Order>) } : o)));
      }
      const order = ordersRef.current.find((o) => o.id === orderId);
      if (status === "preparing" && order && orderNeedsKitchen(order)) {
        fetch("/api/print", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({ orderId }),
        }).catch(() => {});
      }
      return null;
    } catch { fetchOrders(); return "Sin conexión, reintentá"; }
  }

  /** Tildado optimista de un ítem (el server es la fuente de verdad). */
  function handleToggleItem(orderId: string, index: number) {
    setOrders((prev) =>
      prev.map((o) => {
        if (o.id !== orderId) return o;
        const len = (o.items || []).length;
        const base = Array.isArray(o.kitchen_done) ? [...o.kitchen_done] : [];
        while (base.length < len) base.push(false);
        if (index < 0 || index >= len) return o;
        base[index] = !base[index];
        return { ...o, kitchen_done: base };
      })
    );
    fetch(`/api/vendor/orders/${orderId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ toggle_item: index }),
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok || (data as { order?: unknown }).order) {
          if (res.ok && (data as { order?: Order }).order) {
            setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, kitchen_done: (data as { order: Order }).order.kitchen_done } : o)));
          } else {
            fetchOrders();
          }
        }
      })
      .catch(() => fetchOrders());
  }

  /** Marca todos los ítems del pedido como listos. */
  function handleMarkAll(orderId: string) {
    const order = ordersRef.current.find((o) => o.id === orderId);
    if (!order) return;
    const full = Array.from({ length: (order.items || []).length }, () => true);
    setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, kitchen_done: full } : o)));
    fetch(`/api/vendor/orders/${orderId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ kitchen_done: full }),
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (res.ok && (data as { order?: Order }).order) {
          setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, kitchen_done: (data as { order: Order }).order.kitchen_done } : o)));
          vibrate([30, 50, 30]);
        } else {
          fetchOrders();
        }
      })
      .catch(() => fetchOrders());
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

  if (loadError && orders.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
        <p className="text-sm text-muted-foreground">No se pudo cargar la comanda. Revisá tu conexión.</p>
        <Button variant="outline" size="sm" onClick={() => { setLoading(true); fetchOrders(); }}>
          Reintentar
        </Button>
      </div>
    );
  }

  const renderColumn = (status: OrderStatus, label: string, emoji: string) => {
    const items = columnOrders(status);
    const avgMinutes = items.length > 0
      ? Math.round(items.reduce((sum, o) => {
          const elapsed = (now - new Date(o.created_at).getTime()) / 60000;
          return sum + elapsed;
        }, 0) / items.length)
      : null;
    const overdueCount = items.filter((o) => {
      const remaining = o.estimated_minutes ? o.estimated_minutes - (now - new Date(o.created_at).getTime()) / 60000 : null;
      return remaining !== null && remaining <= 0;
    }).length;
    return (
      <div key={status} className="flex flex-col min-w-0">
        <div className={`flex items-center gap-1.5 mb-2 px-2 ${getStatusBg(status)} rounded-lg py-2`}>
          <span className="text-base">{emoji}</span>
          <span className="text-sm font-bold text-foreground">{label}</span>
          {items.length > 0 && (
            <span className="ml-auto text-xs font-bold bg-foreground/10 text-foreground px-2 py-0.5 rounded-full">{items.length}</span>
          )}
          {overdueCount > 0 && (
            <span className="text-xs font-bold bg-red-500 text-white px-1.5 py-0.5 rounded-full animate-pulse">{overdueCount}</span>
          )}
          {avgMinutes !== null && (
            <span className="text-[10px] text-muted-foreground ml-0.5">~{avgMinutes}m</span>
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
                onToggleItem={handleToggleItem}
                onMarkAll={handleMarkAll}
              />
            ))
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-3">
      {/* Header — SIN backdrop-blur: sticky + backdrop-filter tiene un bug de
          compositing en Chrome/WebView Android (se "va" durante el scroll). */}
      <div className="flex items-center justify-between sticky top-0 z-10 bg-background py-2 -mx-4 px-4 border-b border-border/50">
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
          <button
            onClick={toggleFullscreen}
            className={`hidden sm:inline-flex text-xs px-2 py-1.5 rounded-lg font-medium transition-colors ${
              isFs
                ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-900"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
            title={isFs ? "Salir de pantalla completa" : "Pantalla completa"}
          >
            {isFs ? "✕ Salir" : "⛶"}
          </button>
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

      {/* Vista: Por pedido | Por producto */}
      <div className="flex gap-1.5">
        {(["tickets", "products"] as const).map((v) => (
          <button
            key={v}
            onClick={() => setBoardView(v)}
            className={`flex-1 py-1.5 rounded-xl text-[11px] font-bold transition-all ${
              boardView === v ? "bg-foreground text-background shadow-sm" : "bg-muted text-muted-foreground"
            }`}
          >
            {v === "tickets" ? "🧾 Por pedido" : "📊 Por producto"}
          </button>
        ))}
      </div>

      {/* Mobile: single column with tabs */}
      <div
        ref={listRef}
        className="sm:hidden space-y-2 pb-4"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {boardView === "products" ? (
          <ProductAggregate orders={activeOrders} />
        ) : activeTab === "all" ? (
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
                onToggleItem={handleToggleItem}
                onMarkAll={handleMarkAll}
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
              onToggleItem={handleToggleItem}
              onMarkAll={handleMarkAll}
            />
          ))
        )}
        {boardView === "tickets" &&
          ((activeTab === "all" && activeOrders.length === 0) ||
            (activeTab !== "all" && columnOrders(activeTab as OrderStatus).length === 0)) && (
            <div className="text-center py-12">
              <div className="text-4xl mb-3">🎉</div>
              <p className="text-sm font-medium text-muted-foreground">
                {activeTab === "new" ? "No hay pedidos nuevos" : `Sin pedidos en ${tabs.find((t) => t.key === activeTab)?.label}`}
              </p>
            </div>
          )}
      </div>

      {/* Desktop: kanban board o agregado por producto */}
      {boardView === "products" ? (
        <div className="hidden sm:block max-w-3xl">
          <ProductAggregate orders={activeOrders} />
        </div>
      ) : (
        <div className="hidden sm:grid kds-kanban">
          {KDS_COLUMNS.filter((c) => c.status !== "sent").map((col) =>
            renderColumn(col.status, col.label, col.emoji)
          )}
        </div>
      )}

      {/* Salida flotante del modo cocina (la página esconde su nav en sm+). */}
      {isFs && (
        <button
          onClick={toggleFullscreen}
          className="fixed bottom-4 right-4 z-[70] rounded-full bg-red-600 px-4 py-3 text-sm font-bold text-white shadow-lg active:scale-95"
          aria-label="Salir de pantalla completa"
        >
          ✕ Salir
        </button>
      )}
    </div>
  );
}
