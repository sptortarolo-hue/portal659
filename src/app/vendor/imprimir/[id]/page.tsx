"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ORDER_STATUS_LABELS, CONDITION_META } from "@/lib/order-utils";
import type { Order } from "@/types/database";

type MeResponse = {
  vendor: {
    store_name: string;
    paper_size: string | null;
    printer_ip: string | null;
    printer_port: number | null;
  } | null;
};

const SEP = "--------------------------------";

function dollar(n: number | string): string {
  const v = Number(n);
  const s = v.toFixed(2).replace(/\.00$/, "");
  return `$${s}`;
}

function padRight(s: string, width: number): string {
  if (s.length >= width) return s.slice(0, width);
  return s + " ".repeat(width - s.length);
}

function leftRight(left: string, right: string, width: number): string {
  const l = padRight(left, width);
  return l.slice(0, width - right.length).trimEnd() + right;
}

/** Ítem normalizado para impresión (tolera el formato legacy de pedidos viejos). */
type PrintItem = {
  name: string;
  price: number;
  quantity?: number;
  variants?: Record<string, unknown>;
  modifiers?: { name: string }[] | string[];
};

function formatItemLine(item: PrintItem, width: number): string[] {
  const qty = item.quantity ?? 1;
  const price = dollar(item.price);
  const lines: string[] = [];
  lines.push(`${item.name}`);
  if (item.variants && Object.keys(item.variants).length > 0) {
    lines.push("  " + Object.entries(item.variants).map(([k, v]) => `${k}: ${v}`).join(" · "));
  }
  if (item.modifiers && item.modifiers.length > 0) {
    lines.push("  " + item.modifiers.map((m) => (typeof m === "string" ? m : m.name)).join(", "));
  }
  lines.push(`   ${qty} x ${price} ${"=".repeat(3)}  ${dollar((Number(item.price) || 0) * qty)}`);
  return lines;
}

export default function ImprimirPedidoPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();

  const [order, setOrder] = useState<Order | null>(null);
  const [storeName, setStoreName] = useState("Mi tienda");
  const [paperSize, setPaperSize] = useState<"58" | "80">("80");
  const [error, setError] = useState<string | null>(null);
  const [printed, setPrinted] = useState(false);

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const [orderRes, meRes] = await Promise.all([
          fetch(`/api/vendor/orders/${id}`, { credentials: "include" }),
          fetch(`/api/vendor/me`, { credentials: "include" }),
        ]);
        if (!orderRes.ok) {
          setError("No autorizado o pedido no encontrado");
          return;
        }
        const { order } = await orderRes.json();
        setOrder(order);
        try {
          const me = (await meRes.json()) as MeResponse;
          if (me.vendor?.store_name) setStoreName(me.vendor.store_name);
          const ps = me.vendor?.paper_size || "80";
          setPaperSize(ps.includes("58") ? "58" : "80");
        } catch {
          // vendor data best-effort
        }
      } catch {
        setError("Error de red al cargar el pedido");
      }
    })();
  }, [id]);

  useEffect(() => {
    if (order && !printed) {
      setPrinted(true);
      const t = setTimeout(() => window.print(), 350);
      return () => clearTimeout(t);
    }
  }, [order, printed]);

  if (error) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-4 p-6">
        <p className="text-muted-foreground">{error}</p>
        <Button onClick={() => router.back()}>Volver</Button>
      </main>
    );
  }

  if (!order) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">Cargando pedido…</p>
      </main>
    );
  }

  const width = paperSize === "58" ? 32 : 44;

  const cond = orderConditionFallback(order);
  const condLabel = CONDITION_META[cond].label;
  const statusRaw = (order.status as string) || "";
  const statusLabel = ORDER_STATUS_LABELS[order.status] ?? statusRaw;

  const titleLines: string[] = [];
  titleLines.push("                 PORTAL 659");
  titleLines.push(`\n👉 ${storeName}`);

  const orderNumber = order.order_number || order.id.slice(0, 8).toUpperCase();

  const headerLines: string[] = [];
  headerLines.push("");
  headerLines.push(`📋 ${condLabel}`);
  headerLines.push(`# ${orderNumber}`);
  headerLines.push(`   ${order.created_at ? new Date(order.created_at).toLocaleString("es-AR") : ""}`.trim());
  if (order.customer_name) headerLines.push(`Cliente: ${order.customer_name}`);
  if (order.customer_phone) headerLines.push(`Tel: ${order.customer_phone}`);
  if (order.customer_address) headerLines.push(`Dirección: ${order.customer_address}`);
  if (order.payment_method) headerLines.push(`Pago: ${order.payment_method}`);
  headerLines.push(SEP.slice(0, width));

  const items: string[] = [];
  const rawItems = Array.isArray(order.items) ? order.items : [];
  rawItems.forEach((it) => {
    items.push(...formatItemLine(it as PrintItem, width));
  });
  items.push(SEP.slice(0, width));

  const deliveryCost = order.delivery_cost ? Number(order.delivery_cost) : 0;
  const totals: string[] = [];
  if (deliveryCost > 0) totals.push(leftRight("Envío:", dollar(deliveryCost), width));
  totals.push(leftRight("TOTAL:", dollar(order.total ?? 0), width));

  const footer: string[] = [];
  if (order.notes) {
    footer.push("");
    footer.push(`📝 ${order.notes}`);
  }
  footer.push(`Estado: ${statusLabel}`);
  footer.push("");
  footer.push("Gracias por confiar en " + storeName);
  footer.push("Portal 659 · El centro comercial de tu barrio");

  return (
    <main style={{ padding: 16 }}>
      <div style={{ maxWidth: 440, margin: "0 auto" }}>
        <div style={{ display: "flex", gap: 8, justifyContent: "center", marginBottom: 12 }}>
          <Button onClick={() => window.print()}>Imprimir</Button>
          <Button variant="outline" onClick={() => router.push("/vendor/dashboard")}>
            Volver al panel
          </Button>
        </div>

        <div className="receipt-wrap">
          <div className="receipt">
            <pre>{["", ...titleLines, ...headerLines, ...items, ...totals, ...footer, ""].join("\n")}</pre>
            <p style={{ textAlign: "center" }}>
              ⚠ Usá la opción "CM2 TICKET 58/80" de tu impresora para recortar bien el ancho.
            </p>
          </div>
        </div>
      </div>

      <style>{`
        @media print {
          body { margin: 0; }
          .print-hide { display: none !important; }
          .receipt-wrap { width: ${paperSize}mm; margin: 0 auto; }
          @page { size: ${paperSize}mm auto; margin: 3mm; }
        }
        @media screen {
          .receipt-wrap {
            width: ${paperSize === "58" ? 58 : 80}mm;
            margin: 0 auto;
            background: #fff;
            color: #000;
            padding: 8px;
            border: 1px dashed #ccc;
            border-radius: 8px;
          }
        }
        .receipt pre {
          font-family: ui-monospace, "Cascadia Mono", Consolas, monospace;
          font-size: ${paperSize === "58" ? 9 : 12}px;
          line-height: 1.25;
          white-space: pre;
          overflow-x: hidden;
          margin: 0;
        }
        .receipt p { font-family: system-ui, sans-serif; font-size: 8px; color: #888; margin: 4px 0 0; }
        @media print { .receipt p { display: none; } }
      `}</style>
    </main>
  );
}

function orderConditionFallback(order: Order): "delivery" | "retiro" | "mostrador" | "mesa" {
  const channel = order.channel as string | undefined;
  // El envío a domicilio gana sobre el canal (mostrador delivery se despacha).
  if (order.method === "delivery") return "delivery";
  if (channel === "mostrador") return "mostrador";
  if (channel === "mesa") return "mesa";
  return "retiro";
}