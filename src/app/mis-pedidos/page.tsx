"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { useCart } from "@/lib/cart";
import {
  formatPhone,
  isValidPhone,
  timeAgo,
  estimatedRemaining,
  progressPercent,
  ORDER_STATUS_LABELS,
  ORDER_STATUS_COLORS,
} from "@/lib/order-utils";
import type { Order, OrderStatus } from "@/types/database";

const STEP_ORDER: OrderStatus[] = ["new", "confirmed", "preparing", "ready", "sent", "completed"];

function Timeline({ status }: { status: OrderStatus }) {
  const currentIdx = STEP_ORDER.indexOf(status);
  const isCancelled = status === "cancelled";
  const pct = progressPercent(status);

  return (
    <div className="relative mt-3 mb-2">
      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full bg-primary rounded-full transition-all duration-700 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex justify-between mt-1.5">
        {STEP_ORDER.map((step, i) => {
          const done = i <= currentIdx && !isCancelled;
          return (
            <span
              key={step}
              className={`text-[9px] font-medium transition-colors ${
                done ? "text-primary" : "text-muted-foreground/40"
              } ${i === currentIdx && !isCancelled ? "text-primary font-bold" : ""}`}
            >
              {ORDER_STATUS_LABELS[step]}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function OrderCard({ order, onReorder }: { order: Order & { vendors?: { store_name: string; slug: string; whatsapp: string; phone: string; prep_time_min: number | null } | null }; onReorder: (order: Order & { vendors?: { store_name: string; slug: string; whatsapp: string } | null }, vendorSlug: string, vendorWhatsapp: string) => void }) {
  const [countdown, setCountdown] = useState<number | null>(null);

  useEffect(() => {
    if (!order.estimated_minutes || order.status === "completed" || order.status === "cancelled") {
      setCountdown(null);
      return;
    }
    const tick = () => {
      setCountdown(estimatedRemaining(order.estimated_minutes!, order.created_at));
    };
    tick();
    const interval = setInterval(tick, 30000);
    return () => clearInterval(interval);
  }, [order.estimated_minutes, order.status, order.created_at]);

  const vendor = order.vendors;
  const isDone = order.status === "completed" || order.status === "cancelled";
  const phone = vendor?.whatsapp || vendor?.phone || "";

  return (
    <div className={`rounded-2xl border border-border bg-card p-4 transition-all ${isDone ? "opacity-70" : ""}`}>
      <div className="flex items-start justify-between mb-2">
        <div>
          <p className="font-medium text-sm">{vendor?.store_name || "Local"}</p>
          <p className="text-[11px] text-muted-foreground/60">{timeAgo(order.created_at)}</p>
        </div>
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${ORDER_STATUS_COLORS[order.status]}`}>
          {ORDER_STATUS_LABELS[order.status]}
        </span>
      </div>

      {countdown !== null && countdown > 0 && (
        <div className="flex items-center gap-1.5 mb-2 bg-primary/5 rounded-lg px-3 py-1.5">
          <span className="text-xs">⏱</span>
          <span className="text-xs font-medium text-primary">
            ~{countdown} min restantes
          </span>
        </div>
      )}

      <Timeline status={order.status} />

      <div className="mt-2 space-y-1">
        {order.items.map((item, i) => (
          <div key={i} className="flex justify-between text-xs">
            <span className="text-muted-foreground">
              {item.qty}x {item.name}
              {item.modifiers && item.modifiers.length > 0 && (
                <span className="text-muted-foreground/50"> ({item.modifiers.join(", ")})</span>
              )}
            </span>
            <span className="font-medium tabular-nums">${(item.price * item.qty).toLocaleString("es-AR")}</span>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between mt-3 pt-2 border-t border-border">
        <span className="font-bold text-sm">${Number(order.total).toLocaleString("es-AR")}</span>
        {phone && !isDone && (
          <a
            href={`https://wa.me/${phone.replace(/[^0-9]/g, "")}?text=${encodeURIComponent(`Hola! Quiero consultar por mi pedido #${order.id.slice(0, 8)}`)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] font-medium text-green-600 hover:text-green-700"
          >
            Consultar por WhatsApp →
          </a>
        )}
      </div>

      {order.notes && (
        <div className="mt-2 bg-warm/30 rounded-lg px-3 py-1.5">
          <p className="text-[10px] text-muted-foreground/70">📝 {order.notes}</p>
        </div>
      )}

      {order.status === "completed" && vendor?.slug && (
        <Button
          size="sm"
          variant="outline"
          className="w-full mt-2 text-xs"
          onClick={() => onReorder(order, vendor.slug, vendor.whatsapp)}
        >
          🔄 Volver a pedir
        </Button>
      )}
    </div>
  );
}

export default function MisPedidosPage() {
  const router = useRouter();
  const { loadOrder } = useCart();
  const [phone, setPhone] = useState("");
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [searched, setSearched] = useState(false);
  const [realtimeConnected, setRealtimeConnected] = useState(false);
  const [reorderConfirm, setReorderConfirm] = useState<{
    order: Order & { vendors?: { store_name: string; slug: string; whatsapp: string } | null };
    vendorSlug: string;
    vendorWhatsapp: string;
  } | null>(null);
  const channelRef = useRef<ReturnType<ReturnType<typeof createClient>["channel"]> | null>(null);

  const fetchOrders = useCallback(async (phoneNumber: string) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/orders/track?phone=${encodeURIComponent(phoneNumber)}`);
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        setOrders([]);
      } else {
        setOrders(data.orders || []);
      }
    } catch {
      setError("Error al buscar pedidos");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!searched || !phone) return;

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || "",
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
    );

    const channel = supabase
      .channel(`track-${phone}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "orders", filter: `customer_phone=eq.${phone}` },
        (payload) => {
          setOrders((prev) =>
            prev.map((o) => (o.id === payload.new.id ? { ...o, ...payload.new } : o))
          );
        }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "orders", filter: `customer_phone=eq.${phone}` },
        (payload) => {
          setOrders((prev) => [payload.new as Order, ...prev]);
        }
      )
      .subscribe((status) => {
        setRealtimeConnected(status === "SUBSCRIBED");
      });

    channelRef.current = channel;

    return () => {
      channel.unsubscribe();
      channelRef.current = null;
    };
  }, [searched, phone]);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const clean = formatPhone(phone);
    if (!isValidPhone(clean)) {
      setError("Ingresá un número válido (10 a 15 dígitos)");
      return;
    }
    setPhone(clean);
    setSearched(true);
    fetchOrders(clean);
  }

  function handleReorder(order: Order & { vendors?: { store_name: string; slug: string; whatsapp: string } | null }, vendorSlug: string, vendorWhatsapp: string) {
    setReorderConfirm({ order, vendorSlug, vendorWhatsapp });
  }

  async function confirmReorder() {
    if (!reorderConfirm) return;
    const { order, vendorSlug, vendorWhatsapp } = reorderConfirm;

    // Try to map items to real product IDs from the vendor's current catalog
    let vendorProducts: { id: string; name: string; price: number; promo_price: number | null }[] = [];
    try {
      const res = await fetch(`/api/vendor/offers?vendor_id=${order.vendor_id}`);
      const data = await res.json();
      vendorProducts = data.products || data.offers || [];
    } catch {}

    const cartItems = order.items.map((item) => {
      const match = vendorProducts.find(
        (p) => p.name.toLowerCase().trim() === item.name.toLowerCase().trim()
      );
      return {
        offerId: match ? match.id : `reorder-${order.id}-${item.name}`,
        name: item.name,
        price: match ? (match.promo_price ?? match.price) : item.price,
        qty: item.qty,
        modifiers: (item.modifiers || []).map((m) => ({ group: "", label: m, price_mod: 0 })),
      };
    });

    loadOrder(
      { id: order.vendor_id, slug: vendorSlug, storeName: order.vendors?.store_name || "Local", whatsapp: vendorWhatsapp },
      cartItems
    );
    setReorderConfirm(null);
    router.push(`/tienda/${vendorSlug}`);
  }

  return (
    <main className="container mx-auto px-4 py-8 max-w-md">
      <h1 className="font-display text-3xl font-semibold mb-1">Mis pedidos</h1>
      <p className="text-muted-foreground text-sm mb-6">
        Ingresá tu número de WhatsApp para ver el estado de tus pedidos.
      </p>

      <form onSubmit={handleSearch} className="space-y-3 mb-6">
        <div>
          <Label htmlFor="phone">Tu número de WhatsApp</Label>
          <div className="flex gap-2 mt-1">
            <Input
              id="phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="2215550000"
              className="flex-1"
            />
            <Button type="submit" disabled={loading}>
              {loading ? "..." : "Buscar"}
            </Button>
          </div>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </form>

      {searched && (
        <div className="flex items-center gap-2 mb-4">
          {realtimeConnected && (
            <span className="flex items-center gap-1 text-[10px] text-green-600">
              <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
              Actualización en vivo
            </span>
          )}
          <span className="text-[10px] text-muted-foreground/50">
            {orders.length} pedido{orders.length !== 1 ? "s" : ""}
          </span>
        </div>
      )}

      <div className="space-y-3">
        {orders.map((order) => (
          <OrderCard key={order.id} order={order as any} onReorder={handleReorder} />
        ))}
      </div>

      {searched && !loading && orders.length === 0 && !error && (
        <div className="text-center py-12">
          <div className="text-4xl mb-3">🔍</div>
          <p className="text-muted-foreground text-sm">
            No se encontraron pedidos para este número en los últimos 7 días.
          </p>
        </div>
      )}

      <Modal
        open={!!reorderConfirm}
        onClose={() => setReorderConfirm(null)}
        title="Volver a pedir"
        footer={
          <>
            <button
              onClick={() => setReorderConfirm(null)}
              className="flex-1 rounded-xl border border-border py-3 text-sm font-medium hover:bg-muted transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={confirmReorder}
              className="flex-1 rounded-xl bg-primary text-primary-foreground py-3 text-sm font-semibold hover:bg-primary/90 transition-colors"
            >
              Agregar al carrito
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Se reemplazará tu carrito actual con los items de este pedido.
          </p>
          {reorderConfirm && (
            <div className="space-y-1.5">
              {reorderConfirm.order.items.map((item, i) => (
                <div key={i} className="flex justify-between text-sm">
                  <span className="text-muted-foreground">
                    {item.qty}x {item.name}
                  </span>
                  <span className="font-medium tabular-nums">
                    ${(item.price * item.qty).toLocaleString("es-AR")}
                  </span>
                </div>
              ))}
            </div>
          )}
          <div className="border-t border-border pt-2 flex justify-between font-bold text-sm">
            <span>Total</span>
            <span>${reorderConfirm ? Number(reorderConfirm.order.total).toLocaleString("es-AR") : "0"}</span>
          </div>
        </div>
      </Modal>
    </main>
  );
}
