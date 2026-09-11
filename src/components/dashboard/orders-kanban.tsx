"use client";

import { useCallback } from "react";
import type { Order, OrderStatus } from "@/types/database";
import {
  ORDER_STATUS_LABELS,
  ORDER_STATUS_COLORS,
  MODA_STATUS_LABELS,
  flowSteps,
  nextStatusFor,
  orderCondition,
  CONDITION_META,
  orderReadyLabel,
} from "@/lib/order-utils";
import { AlertTriangle, ChevronRight, Banknote, MessageSquare, CheckCircle, Truck, Plus, ChefHat, Package } from "lucide-react";

type OrdersKanbanProps = {
  orders: Order[];
  isModa: boolean;
  selectedOrder: Order | null;
  onSelectOrder: (order: Order | null) => void;
  onRefresh?: () => void;
  isLoading?: boolean;
  /** Si hay filtro de estado, mostrar solo esa columna. */
  focusStatus?: string | null;
};

const ACTIVE_STATUSES: OrderStatus[] = [
  "new",
  "confirmed",
  "preparing",
  "ready",
  "sent",
];

function OrderCard({
  order,
  isModa,
  onClick,
  onNextStatus,
  style,
}: {
  order: Order;
  isModa: boolean;
  onClick: () => void;
  onNextStatus: () => void;
  style?: React.CSSProperties;
}) {
  const statusLabels = isModa ? MODA_STATUS_LABELS : ORDER_STATUS_LABELS;
  const endMs = ["completed", "cancelled"].includes(order.status) && order.closed_at
    ? new Date(order.closed_at).getTime()
    : Date.now();
  const elapsed = Math.floor((endMs - new Date(order.created_at).getTime()) / 60000);
  const remaining = order.estimated_minutes
    ? Math.max(0, order.estimated_minutes - elapsed)
    : null;
  const isOverdue = remaining !== null && remaining <= 0 && !["completed", "cancelled"].includes(order.status);

  return (
    <div
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }}
      role="button"
      tabIndex={0}
      style={style}
      className={`w-full p-3 rounded-xl border-2 transition-all cursor-pointer animate-in fade-in slide-in-from-top-2 duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
        isOverdue ? "border-red-400 bg-red-50 dark:bg-red-950/20" : "border-border bg-card hover:border-primary/40 hover:shadow-sm"
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <p className="font-semibold text-sm truncate">{order.customer_name}</p>
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            <span className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full ${ORDER_STATUS_COLORS[order.status]}`}>
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-current" />
              {order.status === "ready" ? orderReadyLabel(order) : statusLabels[order.status]}
            </span>
            <span className={`inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full border ${CONDITION_META[orderCondition(order)].pillClass}`}>
              {CONDITION_META[orderCondition(order)].label}
            </span>
            {order.is_preview && (
              <span className="inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded-full border bg-violet-100 text-violet-700 border-violet-200">
                🧪 PRUEBA
              </span>
            )}
            {order.pickup_number != null && (
              <span className="inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-status-new/15 text-status-new border-status-new/20">
                Nro. {order.pickup_number}
              </span>
            )}
            {order.payment_method === "transferencia" && order.channel === "app" && order.payment_status === "pending" && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-amber-100 text-amber-700 border-amber-200">
                <AlertTriangle className="h-2.5 w-2.5" /> Pago pendiente
              </span>
            )}
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <span className="text-sm font-bold tabular-nums">${Number(order.total).toLocaleString("es-AR")}</span>
          <p className={`text-[10px] font-medium ${isOverdue ? "text-red-500" : "text-muted-foreground"}`}>
            {["completed", "cancelled"].includes(order.status)
              ? order.status === "completed"
                ? `Tardo ${elapsed} min`
                : `${elapsed} min`
              : `${elapsed} min`}
            {!["completed", "cancelled"].includes(order.status) && remaining !== null && !isOverdue && ` ~ ${remaining} rest`}
          </p>
        </div>
      </div>

      {!["cancelled"].includes(order.status) && (
        <div className="flex items-center gap-0.5 mb-2">
          {flowSteps(isModa).map((step, idx) => (
            <div
              key={step}
              className={`h-1.5 flex-1 rounded-full transition-all ${
                flowSteps(isModa).indexOf(step) <= flowSteps(isModa).indexOf(order.status as OrderStatus)
                  ? "bg-primary"
                  : "bg-muted"
              }`}
            />
          ))}
        </div>
      )}

      <div className="space-y-0.5 mb-2">
        {(order.items || []).slice(0, 2).map((item, i) => (
          <p key={i} className="text-xs text-muted-foreground truncate">
            {item.qty}x {item.name}
            {item.modifiers && item.modifiers.length > 0 && (
              <span className="text-red-500 font-medium"> ({item.modifiers.join(", ")})</span>
            )}
          </p>
        ))}
        {(order.items || []).length > 2 && (
          <p className="text-[10px] text-muted-foreground/50">+{order.items.length - 2} mas</p>
        )}
      </div>

      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>
          {order.payment_method === "efectivo" && <Banknote className="mr-1 h-3 w-3" />}
          {order.payment_method === "transferencia" && <Banknote className="mr-1 h-3 w-3" />}
          {order.payment_method === "whatsapp" && <MessageSquare className="mr-1 h-3 w-3" />}
          {new Date(order.created_at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); onNextStatus(); }}
          className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-primary hover:text-primary/80 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          aria-label="Avanzar al siguiente estado"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function KanbanColumn({
  status,
  orders,
  isModa,
  onSelectOrder,
  onNextStatus,
  count,
}: {
  status: OrderStatus;
  orders: Order[];
  isModa: boolean;
  onSelectOrder: (order: Order) => void;
  onNextStatus: (order: Order) => void;
  count: number;
}) {
  const statusLabels = isModa ? MODA_STATUS_LABELS : ORDER_STATUS_LABELS;

  const getEmptyIcon = () => {
    switch (status) {
      case "new":
        return <Plus className="h-6 w-6 mx-auto mb-2 opacity-30" />;
      case "confirmed":
        return <ChefHat className="h-6 w-6 mx-auto mb-2 opacity-30" />;
      case "preparing":
        return <Package className="h-6 w-6 mx-auto mb-2 opacity-30" />;
      case "ready":
        return <CheckCircle className="h-6 w-6 mx-auto mb-2 opacity-30" />;
      case "sent":
        return <Truck className="h-6 w-6 mx-auto mb-2 opacity-30" />;
      default:
        return <Package className="h-6 w-6 mx-auto mb-2 opacity-30" />;
    }
  };

  const getEmptyText = () => {
    switch (status) {
      case "new":
        return "Nuevos pedidos aparecerán aquí";
      case "confirmed":
        return "Pedidos aceptados";
      case "preparing":
        return "En preparación";
      case "ready":
        return "Listos para entregar";
      case "sent":
        return "En camino";
      default:
        return "Sin pedidos";
    }
  };

  const ariaLabels: Record<OrderStatus, string> = {
    new: "Pedidos nuevos por aceptar",
    confirmed: "Pedidos confirmados",
    preparing: "Pedidos en preparación",
    ready: "Pedidos listos para entregar",
    sent: "Pedidos en camino",
    completed: "Pedidos entregados",
    cancelled: "Pedidos cancelados",
  };

  return (
    <div className="flex-1 min-w-[220px] flex flex-col" aria-labelledby={`column-${status}-label`}>
      <div className="px-3 py-2.5 flex items-center justify-between border-b border-border bg-muted/50 rounded-t-xl">
        <h3 id={`column-${status}-label`} className="font-semibold text-sm flex items-center gap-2">
          <span className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full ${ORDER_STATUS_COLORS[status]}`}>
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-current" />
            {status === "ready" ? "Listo" : statusLabels[status]}
          </span>
          <span className="text-lg font-bold tabular-nums text-muted-foreground">{count}</span>
        </h3>
      </div>
      <div
        className="flex-1 overflow-y-auto p-2 space-y-2 min-h-[400px]"
        role="list"
        aria-label={ariaLabels[status]}
      >
        {orders.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground/50 text-sm">
            {getEmptyIcon()}
            <p>{getEmptyText()}</p>
          </div>
        ) : (
          orders.map((order, index) => (
            <OrderCard
              key={order.id}
              order={order}
              isModa={isModa}
              onClick={() => onSelectOrder(order)}
              onNextStatus={() => onNextStatus(order)}
              style={{ animationDelay: `${index * 50}ms` }}
            />
          ))
        )}
      </div>
    </div>
  );
}

export function OrdersKanban({
  orders,
  isModa,
  selectedOrder,
  onSelectOrder,
  onRefresh,
  isLoading,
  focusStatus,
}: OrdersKanbanProps) {
  const steps = flowSteps(isModa);
  const activeSteps = steps.filter((s) => ACTIVE_STATUSES.includes(s));
  // Con filtro de estado (ej. clic en "Enviados"), mostrar solo esa columna
  // para que nunca quede fuera de pantalla.
  const focusActive =
    focusStatus && focusStatus !== "all" && (activeSteps as string[]).includes(focusStatus);
  const visibleSteps = focusActive ? [focusStatus as OrderStatus] : activeSteps;

  const ordersByStatus = activeSteps.reduce(
    (acc, status) => {
      acc[status] = orders.filter((o) => o.status === status);
      return acc;
    },
    {} as Record<OrderStatus, Order[]>
  );

  if (isLoading) {
    return (
      <div className="flex gap-3 overflow-x-auto pb-4 px-1">
        {activeSteps.map((status) => (
          <div key={status} className="flex-1 min-w-[280px] max-w-[320px] flex flex-col">
            <div className="px-3 py-2.5 flex items-center justify-between border-b border-border bg-muted/50 rounded-t-xl">
              <h3 className="font-semibold text-sm flex items-center gap-2">
                <span className="h-4 w-4 bg-skeleton rounded-full" />
                <span className="h-4 w-16 bg-skeleton rounded" />
              </h3>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-2 min-h-[400px]">
              {[1, 2, 3].map((i) => (
                <div key={i} className="p-3 rounded-xl border border-skeleton bg-skeleton animate-pulse" />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  const handleNextStatus = useCallback(
    async (order: Order) => {
      const needsKitchen = (order.items || []).some((i) => i?.requires_prep !== false);
      const next = nextStatusFor(order.status, order.method, isModa, order.channel, needsKitchen);
      if (!next) return;

      try {
        const payload: Record<string, unknown> = { status: next };
        if (next === "preparing" && !isModa) {
          payload.estimated_minutes = 30;
        }
        const res = await fetch(`/api/vendor/orders/${order.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (data.error) {
          console.error("Error updating order:", data.error);
          return;
        }
        if (next === "preparing" && needsKitchen) {
          fetch("/api/print", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ orderId: order.id }),
          }).catch(() => {});
        }
        onRefresh?.();
      } catch {
        console.error("Error al actualizar el pedido");
      }
    },
    [isModa, onRefresh]
  );

  // Filtro terminal (ej. "completed"): el Kanban solo muestra estados activos.
  if (focusStatus && focusStatus !== "all" && !focusActive) {
    return (
      <div className="text-center py-12 text-sm text-muted-foreground">
        Los pedidos entregados están en la pestaña Histórico.
      </div>
    );
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-4 px-1">
      {visibleSteps.map((status) => (
        <KanbanColumn
          key={status}
          status={status}
          orders={ordersByStatus[status] || []}
          isModa={isModa}
          onSelectOrder={onSelectOrder}
          onNextStatus={handleNextStatus}
          count={ordersByStatus[status]?.length || 0}
        />
      ))}
    </div>
  );
}