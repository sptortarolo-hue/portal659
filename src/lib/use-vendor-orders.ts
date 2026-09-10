"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { Order } from "@/types/database";

type Options = {
  vendorId: string | null;
  enabled?: boolean;
};

type ConnectionState = "connecting" | "connected" | "disconnected";

/**
 * Hook que se conecta al SSE de pedidos del vendor.
 * Devuelve los pedidos en tiempo real + estado de conexión.
 * Fallback a polling si SSE no está disponible.
 */
export function useVendorOrders({ vendorId, enabled = true }: Options) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [connectionState, setConnectionState] = useState<ConnectionState>("disconnected");
  const eventSourceRef = useRef<EventSource | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const cleanup = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!vendorId || !enabled) {
      cleanup();
      return;
    }

    let reconnectTimeout: ReturnType<typeof setTimeout>;
    let retryCount = 0;
    const MAX_RETRY_DELAY = 30000;

    function connect() {
      setConnectionState("connecting");
      const es = new EventSource(`/api/vendor/orders/stream`);
      eventSourceRef.current = es;

      es.onopen = () => {
        setConnectionState("connected");
        retryCount = 0;
      };

      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "orders_update" && Array.isArray(data.orders)) {
            setOrders((prev) => {
              const map = new Map(prev.map((o) => [o.id, o]));
              for (const order of data.orders) {
                map.set(order.id, order);
              }
              return Array.from(map.values()).sort(
                (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
              );
            });
          }
        } catch {
          // ignore parse errors (keepalive comments)
        }
      };

      es.onerror = () => {
        setConnectionState("disconnected");
        es.close();
        eventSourceRef.current = null;

        // Exponential backoff
        const delay = Math.min(1000 * Math.pow(2, retryCount), MAX_RETRY_DELAY);
        retryCount++;
        reconnectTimeout = setTimeout(connect, delay);
      };
    }

    connect();

    // Fallback: if SSE doesn't connect within 5s, use polling
    const fallbackTimeout = setTimeout(() => {
      if (!eventSourceRef.current || eventSourceRef.current.readyState !== EventSource.OPEN) {
        cleanup();
        startPolling();
      }
    }, 5000);

    function startPolling() {
      setConnectionState("connected"); // treat polling as connected
      pollingRef.current = setInterval(async () => {
        try {
          const res = await fetch("/api/vendor/orders");
          const data = await res.json();
          if (data.orders) setOrders(data.orders);
        } catch {
          // ignore
        }
      }, 5000);
    }

    return () => {
      clearTimeout(fallbackTimeout);
      clearTimeout(reconnectTimeout);
      cleanup();
    };
  }, [vendorId, enabled, cleanup]);

  /** Force refresh orders (e.g., after an action) */
  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/vendor/orders");
      const data = await res.json();
      if (data.orders) setOrders(data.orders);
    } catch {
      // ignore
    }
  }, []);

  /** Update a single order in the local state */
  const updateOrder = useCallback((orderId: string, updates: Partial<Order>) => {
    setOrders((prev) =>
      prev.map((o) => (o.id === orderId ? { ...o, ...updates } : o))
    );
  }, []);

  return { orders, setOrders, connectionState, refresh, updateOrder };
}
