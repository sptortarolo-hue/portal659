"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { OrderTimeline } from "@/components/orders/order-timeline";
import { Button } from "@/components/ui/button";
import {
  statusLabel,
  ORDER_STATUS_COLORS,
  orderReadyLabel,
  estimatedRemaining,
  timeAgo,
} from "@/lib/order-utils";
import { orderLineTotal } from "@/lib/order-line";
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
  created_at: string;
  timeline: { status: string; created_at: string }[];
  vendors: {
    store_name: string;
    slug: string;
    whatsapp: string;
    phone: string;
    vertical: string;
    prep_time_min: number | null;
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

      <div className="rounded-2xl border border-border bg-card p-4 mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${ORDER_STATUS_COLORS[order.status]}`}>
            {order.status === "ready" ? orderReadyLabel({ channel: "app", method: order.method }) : statusLabel(order.status, isRetail)}
          </span>
          {countdown !== null && countdown > 0 && (
            <span className="text-xs font-medium text-primary">~{countdown} min</span>
          )}
        </div>

        <OrderTimeline status={order.status} method={order.method} isRetail={isRetail} />

        <div className="mt-3 space-y-1">
          {order.items.map((item, i) => (
            <div key={i} className="flex justify-between text-xs">
              <span className="text-muted-foreground">
                {item.qty}x {item.name}
                {item.modifiers && item.modifiers.length > 0 && (
                  <span className="text-muted-foreground/50"> ({item.modifiers.join(", ")})</span>
                )}
              </span>
              <span className="font-medium tabular-nums">${orderLineTotal(item).toLocaleString("es-AR")}</span>
            </div>
          ))}
        </div>

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