"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { OrderTimeline } from "@/components/orders/order-timeline";
import { DeliveryLiveMap } from "@/components/orders/delivery-live-map";
import { Button } from "@/components/ui/button";
import {
  statusLabel,
  ORDER_STATUS_COLORS,
  orderReadyLabel,
  estimatedRemaining,
  timeAgo,
} from "@/lib/order-utils";
import { orderLineTotal } from "@/lib/order-line";
import { formatDeliveryWindow } from "@/lib/delivery-schedule";
import type { OrderStatus } from "@/types/database";

type TrackOrder = {
  id: string;
  customer_name: string;
  method: "delivery" | "pickup";
  items: { name: string; price: number; qty: number; modifiers?: string[] }[];
  total: number;
  status: OrderStatus;
  payment_method: string;
  payment_status: string | null;
  pickup_number: number | null;
  estimated_minutes: number | null;
  delivery_window: string | null;
  created_at: string;
  timeline: { status: string; created_at: string }[];
  courier_lat: number | null;
  courier_lng: number | null;
  courier_updated_at: string | null;
  // Pesables (modo confirmar).
  weight_confirmed_at?: string | null;
  weight_approved_at?: string | null;
  weight_estimated_total?: number | null;
  weight_tolerance_pct?: number | null;
  weight_confirm_mode?: string | null;
  vendors: {
    store_name: string;
    slug: string;
    whatsapp: string;
    phone: string;
    vertical: string;
    prep_time_min: number | null;
    lat: number | null;
    lng: number | null;
    delivery_coordinar?: boolean | null;
  } | null;
};

export default function SeguimientoPedidoPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token;
  const [order, setOrder] = useState<TrackOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [countdown, setCountdown] = useState<number | null>(null);
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  // Pesables: pagar el total real / aceptarlo si difiere del estimado.
  const [weightBusy, setWeightBusy] = useState(false);
  const [weightMsg, setWeightMsg] = useState("");
  const [weightErr, setWeightErr] = useState("");

  const fetchData = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`/api/orders/track/${token}`);
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        setOrder(null);
      } else {
        setError("");
        setOrder(data.order);
      }
    } catch {
      setError("Error al cargar el seguimiento");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchData();
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => {
        setLoggedIn(!!d.user);
        setUserRole(d.user?.role || null);
      })
      .catch(() => {});
  }, [fetchData]);

  useEffect(() => {
    if (!order) return;
    const interval = setInterval(fetchData, 15000);
    return () => clearInterval(interval);
  }, [order, fetchData]);

  useEffect(() => {
    if (!order?.estimated_minutes || order.status === "completed" || order.status === "cancelled") {
      setCountdown(null);
      return;
    }
    const tick = () => setCountdown(estimatedRemaining(order.estimated_minutes!, order.created_at));
    tick();
    const interval = setInterval(tick, 30000);
    return () => clearInterval(interval);
  }, [order?.estimated_minutes, order?.status, order?.created_at, order]);

  if (loading) {
    return (
      <main className="container mx-auto px-4 py-20 max-w-md text-center">
        <div className="text-5xl mb-4 animate-pulse">📦</div>
        <p className="text-muted-foreground">Cargando seguimiento…</p>
      </main>
    );
  }

  if (error || !order) {
    return (
      <main className="container mx-auto px-4 py-20 max-w-md text-center">
        <div className="text-5xl mb-4">🔍</div>
        <h1 className="font-display text-2xl font-semibold">Pedido no encontrado</h1>
        <p className="text-muted-foreground text-sm mt-2 mb-6">
          El enlace no es válido o el pedido ya expiró. Podés buscarlo con tu número de WhatsApp.
        </p>
        <Button asChild><a href="/mis-pedidos">Ir a Mis pedidos</a></Button>
      </main>
    );
  }

  const vendor = order.vendors;
  const isRetail = vendor?.vertical === "moda" || vendor?.vertical === "comercio";
  const isDone = order.status === "completed" || order.status === "cancelled";
  const phone = vendor?.whatsapp || vendor?.phone || "";

  // Pesables (modo confirmar): el pedido nació pendiente de peso.
  const weightEstimated = Number(order.weight_estimated_total) || 0;
  const weightConfirmed = !!order.weight_confirmed_at;
  const inWeightFlow = weightEstimated > 0 && !isDone;
  const needsApproval = (() => {
    if (!inWeightFlow || !weightConfirmed) return false;
    if (order.weight_approved_at) return false;
    const est = weightEstimated;
    const real = Number(order.total) || 0;
    const tol = Number(order.weight_tolerance_pct) > 0 ? Math.min(100, Math.floor(Number(order.weight_tolerance_pct))) : 20;
    return est > 0 && Math.abs(real - est) / est > tol / 100;
  })();
  const canPayWeight =
    inWeightFlow && weightConfirmed && order.payment_method === "mercadopago" &&
    order.payment_status !== "paid" && !needsApproval;

  async function approveWeight() {
    if (!token || weightBusy) return;
    setWeightBusy(true);
    setWeightErr("");
    setWeightMsg("");
    try {
      const res = await fetch(`/api/orders/track/${token}/approve`, { method: "POST" });
      const data = await res.json();
      if (!res.ok || data.error) {
        setWeightErr(data.error || "No se pudo aceptar el total");
        return;
      }
      setOrder((prev) => (prev ? { ...prev, weight_approved_at: new Date().toISOString() } : prev));
      setWeightMsg("¡Listo! Ya podés pagar el total real.");
    } catch {
      setWeightErr("Error de conexión. Probá de nuevo.");
    } finally {
      setWeightBusy(false);
    }
  }

  async function payWeight() {
    if (!token || weightBusy || !order) return;
    setWeightBusy(true);
    setWeightErr("");
    try {
      const res = await fetch("/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: order.id, trackToken: token }),
      });
      const data = await res.json();
      if (!res.ok || data.error || !data.initPoint) {
        setWeightErr(data.error || "No se pudo iniciar el pago");
        return;
      }
      window.location.href = data.initPoint as string;
    } catch {
      setWeightErr("Error de conexión. Probá de nuevo.");
    } finally {
      setWeightBusy(false);
    }
  }

  return (
    <main className="container mx-auto px-4 py-8 max-w-md">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-muted-foreground">Portal 659 · Seguimiento de pedido</span>
        <span className="text-[11px] text-muted-foreground/60">
          Actualización automática
        </span>
      </div>
      <h1 className="font-display text-2xl font-semibold">{vendor?.store_name || "Tu pedido"}</h1>
      <p className="text-xs text-muted-foreground mb-4">
        {order.pickup_number != null ? `Pedido Nro. ${order.pickup_number}` : `#${order.id.slice(0, 8)}`} · {timeAgo(order.created_at)}
      </p>

      {order.method === "delivery" && order.status === "sent" &&
        (order.courier_lat != null && order.courier_lng != null ? (
          <DeliveryLiveMap
            storeName={vendor?.store_name || "El local"}
            vendorLat={vendor?.lat ?? null}
            vendorLng={vendor?.lng ?? null}
            courierLat={order.courier_lat}
            courierLng={order.courier_lng}
            courierUpdatedAt={order.courier_updated_at}
          />
        ) : (
          <div className="rounded-2xl border border-border bg-card p-4 mb-4 text-center">
            <p className="text-sm">🛵 <span className="font-medium">Tu pedido va en camino</span></p>
            <p className="text-xs text-muted-foreground mt-1">
              El repartidor aún no comparte su ubicación en vivo — se muestra acá en cuanto la active.
            </p>
          </div>
        ))}

      <div className="rounded-2xl border border-border bg-card p-4 mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${ORDER_STATUS_COLORS[order.status]}`}>
            {order.status === "ready" ? orderReadyLabel({ channel: "app", method: order.method }) : statusLabel(order.status, isRetail)}
          </span>
          {countdown !== null && countdown > 0 && (
            <span className="text-xs font-medium text-primary">~{countdown} min</span>
          )}
        </div>

        {isRetail && order.method === "delivery" && order.delivery_window && !isDone && (
          <p className="rounded-xl bg-primary/5 border border-primary/15 px-3 py-2 text-xs font-medium text-primary mb-2">
            📦 Te lo llevamos {formatDeliveryWindow(order.delivery_window)}
          </p>
        )}
        {isRetail && order.method === "delivery" && !order.delivery_window && !isDone && vendor?.delivery_coordinar === true && (
          <p className="rounded-xl bg-muted/40 border border-border px-3 py-2 text-xs font-medium text-muted-foreground mb-2">
            🤝 Coordinamos por WhatsApp el horario de entrega.
          </p>
        )}

        <OrderTimeline status={order.status} method={order.method} isRetail={isRetail} />

        {(order as any).cancel_reason && (
          <p className="mt-2 rounded-xl bg-red-50 border border-red-100 px-3 py-2 text-xs text-red-600">
            🚫 Motivo de la cancelación: {(order as any).cancel_reason}
          </p>
        )}

        {/* Pesables (modo confirmar): pesando / total real / aceptar / pagar */}
        {inWeightFlow && !weightConfirmed && (
          <p className="mt-2 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800 font-medium">
            ⚖️ El comercio está pesando tu pedido. Cuando confirme el peso te avisamos con el
            total real para pagar.
          </p>
        )}
        {inWeightFlow && weightConfirmed && (
          <div className="mt-2 rounded-xl bg-blue-50 border border-blue-200 px-3 py-2.5 text-xs text-blue-900 space-y-2">
            <p className="font-semibold">
              ⚖️ Peso confirmado — Total real: ${Number(order.total).toLocaleString("es-AR")}
              {Math.abs(Number(order.total) - weightEstimated) > 0.01 && (
                <span className="font-normal"> (estimado: ${weightEstimated.toLocaleString("es-AR")})</span>
              )}
            </p>
            {needsApproval ? (
              <>
                <p className="text-blue-800">
                  El total real difiere de tu estimado. Si estás de acuerdo, aceptalo para habilitar el pago.
                </p>
                <button
                  type="button"
                  onClick={approveWeight}
                  disabled={weightBusy}
                  className="w-full rounded-lg bg-blue-600 text-white text-xs font-semibold py-2 hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  {weightBusy ? "Aceptando…" : `✅ Aceptar total ($${Number(order.total).toLocaleString("es-AR")})`}
                </button>
              </>
            ) : canPayWeight ? (
              <button
                type="button"
                onClick={payWeight}
                disabled={weightBusy}
                className="w-full rounded-lg bg-blue-600 text-white text-xs font-semibold py-2 hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {weightBusy ? "Abriendo Mercado Pago…" : `💳 Pagar $${Number(order.total).toLocaleString("es-AR")} con Mercado Pago`}
              </button>
            ) : order.payment_method === "mercadopago" && order.payment_status === "paid" ? (
              <p className="text-green-700 font-medium">✅ Pago acreditado</p>
            ) : null}
            {weightMsg && <p className="text-green-700 font-medium">{weightMsg}</p>}
            {weightErr && <p className="text-red-600 font-medium">{weightErr}</p>}
          </div>
        )}

      <div className="mt-3 space-y-1">
        {order.items.map((item, i) => (
          <div key={i} className="flex justify-between text-xs">
            <span className="text-muted-foreground">
              {(item as any).unit === "kg"
                ? `${Number(item.qty).toLocaleString("es-AR", { maximumFractionDigits: 3 })}kg ${item.name}`
                : `${item.qty}x ${item.name}`}
              {item.modifiers && item.modifiers.length > 0 && (
                <span className="text-muted-foreground/50"> ({item.modifiers.join(", ")})</span>
              )}
            </span>
            <span className="font-medium tabular-nums">${orderLineTotal(item).toLocaleString("es-AR")}</span>
          </div>
        ))}
      </div>

      {Number((order as any).giftcard_discount) > 0 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground mt-2">
          <span>🎁 Giftcard</span>
          <span className="tabular-nums">−${Number((order as any).giftcard_discount).toLocaleString("es-AR")}</span>
        </div>
      )}
      {order.payment_method === "efectivo" && Number((order as any).cash_amount) > 0 && (
        <div className="flex items-center justify-between text-xs font-medium text-green-700 mt-2">
          <span>💵 Abonás con ${Number((order as any).cash_amount).toLocaleString("es-AR")}</span>
          <span className="tabular-nums">
            vuelto ${Math.max(0, Math.round((Number((order as any).cash_amount) - Number(order.total)) * 100) / 100).toLocaleString("es-AR")}
          </span>
        </div>
      )}

      <div className="flex items-center justify-between mt-3 pt-2 border-t border-border">
        <span className="font-bold text-sm">${Number(order.total).toLocaleString("es-AR")}</span>
          {phone && !isDone && (
            <a
              href={`https://wa.me/${phone.replace(/[^0-9]/g, "")}?text=${encodeURIComponent(`Hola! Quiero consultar por mi pedido ${order.pickup_number != null ? `Nro. ${order.pickup_number}` : `#${order.id.slice(0, 8)}`}`)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] font-medium text-green-600 hover:text-green-700"
            >
              Consultar por WhatsApp →
            </a>
          )}
        </div>
      </div>

      {order.status === "completed" && vendor?.slug && (
        <a
          href={`/tienda/${vendor.slug}`}
          className="block w-full text-center rounded-xl border border-border py-3 text-sm font-medium hover:bg-muted transition-colors mb-4"
        >
          ⭐ Dejá tu reseña en {vendor.store_name}
        </a>
      )}

      {loggedIn === false && (
        <div className="rounded-2xl border border-primary/20 bg-primary/5 p-5">
          <h2 className="font-display text-lg font-semibold">¿Querés más beneficios?</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Creá tu cuenta gratis para guardar favoritos, tus datos de contacto (no los llenás más al pedir) y ver el historial de tus pedidos.
          </p>
          <div className="flex flex-col gap-2 mt-3">
            <Button asChild>
              <Link href={`/registro?next=/seguimiento/${token}`}>Crear mi cuenta</Link>
            </Button>
            <Link href={`/login?next=/seguimiento/${token}`} className="text-center text-sm text-primary underline hover:no-underline">
              Ya tengo cuenta — Iniciar sesión
            </Link>
          </div>
        </div>
      )}

      {loggedIn && userRole === "buyer" && (
        <div className="text-center">
          <Link href="/mis-pedidos" className="text-sm text-primary underline hover:no-underline">
            Ver todos mis pedidos
          </Link>
        </div>
      )}
    </main>
  );
}