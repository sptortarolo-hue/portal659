"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type DeliveryOrder = {
  id: string;
  status: string;
  method: string;
  customer_name: string;
  customer_phone: string | null;
  customer_address: string | null;
  total: number;
  items: { name: string; qty: number }[];
  created_at: string;
  assigned_to: string | null;
  delivery_zone_name?: string | null;
  delivery_out_of_area?: boolean | null;
};

/**
 * Módulo exclusivo del repartidor (vendor_staff.role='delivery').
 * Vista multi-repartidor:
 *  - "Disponibles": pedidos delivery en ready/sent sin asignar → botón "Tomar".
 *  - "Mis entregas": pedidos asignados a este repartidor → botón "Entregado".
 * Cada repartidor ve el pool común y se asigna el que va a entregar.
 */
export function DeliveryBoard({ vendorId, userId }: { vendorId: string; userId: string | null }) {
  const [orders, setOrders] = useState<DeliveryOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");

  async function load() {
    try {
      const res = await fetch("/api/vendor/orders");
      const data = await res.json();
      if (data.orders) {
        setOrders(
          (data.orders as DeliveryOrder[])
            .filter((o) => o.method === "delivery" && (o.status === "ready" || o.status === "sent"))
            .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
        );
      }
    } catch {
      /* noop */
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 15000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendorId]);

  async function claim(orderId: string) {
    setMsg("");
    const res = await fetch(`/api/vendor/orders/${orderId}/assign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "claim" }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.ok) setMsg("✅ Pedido tomado — ahora es tu entrega");
    else setMsg(`❌ ${data.error || "No se pudo tomar el pedido"}`);
    setTimeout(() => setMsg(""), 3000);
    load();
  }

  async function release(orderId: string) {
    await fetch(`/api/vendor/orders/${orderId}/assign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "release" }),
    });
    load();
  }

  async function markDelivered(orderId: string) {
    setMsg("");
    const res = await fetch(`/api/vendor/orders/${orderId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "completed" }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.error) setMsg(`❌ ${data.error}`);
    else {
      setMsg("✅ Pedido entregado");
      setOrders((prev) => prev.filter((o) => o.id !== orderId));
    }
    setTimeout(() => setMsg(""), 3000);
  }

  function mapsUrl(o: DeliveryOrder) {
    const addr = o.customer_address;
    if (!addr) return null;
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(addr)}`;
  }

  if (loading) return <p className="text-sm text-muted-foreground">Cargando pedidos a entregar...</p>;

  // Disponibles = sin asignar (los tomó nadie). Míos = asignados a este repartidor.
  const disponibles = orders.filter((o) => !o.assigned_to);
  const mios = orders.filter((o) => o.assigned_to === userId);

  return (
    <div className="space-y-4">
      {msg && <p className="text-sm text-green-600 bg-green-50 rounded-lg px-3 py-2">{msg}</p>}

      <div className="rounded-2xl border border-border bg-card p-4">
        <h2 className="font-display text-lg font-semibold">🛵 Reparto</h2>
        <p className="text-xs text-muted-foreground mt-1">
          {disponibles.length} disponible{disponibles.length !== 1 ? "s" : ""} ·{" "}
          {mios.length} asignado{mios.length !== 1 ? "s" : ""} a vos.
        </p>
      </div>

      {orders.length === 0 && (
        <div className="text-center py-12">
          <div className="text-4xl mb-3">🛵</div>
          <p className="text-muted-foreground text-sm">No hay pedidos para entregar ahora.</p>
        </div>
      )}

      {/* Disponibles (pool común) */}
      {disponibles.length > 0 && (
        <div>
          <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
            <span className="text-base">🟡</span> Disponibles para tomar
          </h3>
          <div className="space-y-2">
            {disponibles.map((o) => (
              <DeliveryCard
                key={o.id}
                o={o}
                mapsUrl={mapsUrl(o)}
                action={
                  <Button size="sm" className="flex-1" onClick={() => claim(o.id)}>
                    🙋 Tomar pedido
                  </Button>
                }
              />
            ))}
          </div>
        </div>
      )}

      {/* Mis entregas */}
      {mios.length > 0 && (
        <div>
          <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
            <span className="text-base">🟢</span> Mis entregas
          </h3>
          <div className="space-y-2">
            {mios.map((o) => (
              <DeliveryCard
                key={o.id}
                o={o}
                mapsUrl={mapsUrl(o)}
                action={
                  <div className="flex flex-1 gap-2">
                    <Button size="sm" className="flex-1" onClick={() => markDelivered(o.id)}>
                      ✅ Entregado
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => release(o.id)} title="Devolver al pool">
                      ↩︎
                    </Button>
                  </div>
                }
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function DeliveryCard({
  o,
  mapsUrl,
  action,
}: {
  o: DeliveryOrder;
  mapsUrl: string | null;
  action: React.ReactNode;
}) {
  return (
    <div className="border border-border rounded-xl p-3 bg-card">
      <div className="flex items-center justify-between mb-2">
        <div>
          <p className="font-medium text-sm">{o.customer_name}</p>
          <p className="text-xs text-muted-foreground">
            {new Date(o.created_at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}
            {o.customer_phone && <> · {o.customer_phone}</>}
          </p>
        </div>
        <Badge variant="secondary" className="text-xs font-bold">
          ${Number(o.total).toLocaleString("es-AR")}
        </Badge>
      </div>

      <p className="text-xs text-muted-foreground mb-1">
        {(o.items || []).map((i) => `${i.qty}x ${i.name}`).join(", ")}
      </p>

      {o.customer_address && <p className="text-xs mb-2">📍 {o.customer_address}</p>}
      {(o.delivery_zone_name || o.delivery_out_of_area) && (
        <p className="text-xs mb-2 font-semibold">
          {o.delivery_out_of_area ? (
            <span className="text-amber-700">⚠️ Otra zona — envío a convenir</span>
          ) : (
            <span className="text-blue-700">🗺️ {o.delivery_zone_name}</span>
          )}
        </p>
      )}

      <div className="flex gap-2">
        {o.customer_phone && (
          <a
            href={`https://wa.me/${o.customer_phone.replace(/\D/g, "")}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 text-center rounded-lg border border-green-200 bg-green-50 text-green-700 px-2 py-1.5 text-xs font-medium"
          >
            💬 WhatsApp
          </a>
        )}
        {mapsUrl && (
          <a
            href={mapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 text-center rounded-lg border border-blue-200 bg-blue-50 text-blue-700 px-2 py-1.5 text-xs font-medium"
          >
            🗺️ Mapa
          </a>
        )}
        {action}
      </div>
    </div>
  );
}