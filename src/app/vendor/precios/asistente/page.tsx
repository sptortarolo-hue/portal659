"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { getJson } from "@/components/dashboard/shared";
import { getPricingStatus } from "@/lib/pricing-status";

type Product = {
  id: string;
  name: string;
  price?: number | null;
  cost_last?: number | null;
  margin_list_id?: string | null;
  price_source?: string | null;
  pricing_skipped?: unknown;
  image_url?: string | null;
  category?: string | null;
  stock_control?: boolean | null;
  is_combo?: boolean | null;
  sku?: string | null;
};

type Task = {
  n: number;
  title: string;
  description: (count: number) => string;
  count: number;
  done: boolean;
  href: string;
  action: string;
};

/** Checklist fija estilo Shopify: 5 tareas, contadores y links a flujos existentes. */
export default function PricingWizardPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [purchases, setPurchases] = useState<number>(0);

  useEffect(() => {
    Promise.all([
      getJson<{ offers?: Product[] }>("/api/vendor/offers").catch(() => null),
      getJson<{ purchases?: unknown[] }>("/api/vendor/purchases").catch(() => null),
    ]).then(([off, pur]) => {
      setProducts(off?.offers || []);
      setPurchases(Array.isArray(pur?.purchases) ? pur!.purchases!.length : 0);
      setLoading(false);
    });
  }, []);

  const stats = useMemo(() => {
    const relevant = products.filter((p) => !p.is_combo && !(p.sku || "").startsWith("GC-"));
    const sinCosto = relevant.filter((p) => getPricingStatus(p).missing.includes("costo"));
    const sinLista = relevant.filter(
      (p) => !p.margin_list_id && !getPricingStatus(p).skipped.list && p.cost_last != null
    );
    const sinPrecio = relevant.filter(
      (p) => p.cost_last != null && (p.margin_list_id || getPricingStatus(p).skipped.list) && (!p.price || Number(p.price) <= 0)
    );
    const fromInvoice = relevant.filter((p) => p.price_source === "factura");
    return { relevant, sinCosto, sinLista, sinPrecio, fromInvoice };
  }, [products]);

  const tasks: Task[] = [
    {
      n: 1,
      title: "Cargar la factura del proveedor",
      count: purchases,
      done: purchases > 0,
      description: (c) => (c > 0 ? `Ya hay ${c} compra${c === 1 ? "" : "s"} con comprobante.` : "Todavía no cargaste ninguna factura."),
      href: "/vendor/dashboard?tab=inventario",
      action: "Ir a Compras",
    },
    {
      n: 2,
      title: "Crear los productos que faltan",
      count: stats.fromInvoice.length,
      done: stats.fromInvoice.length > 0,
      description: (c) => (c > 0 ? `Ya se crearon ${c} producto${c === 1 ? "" : "s"} desde facturas.` : "Creá los productos desde las líneas de la factura."),
      href: "/vendor/dashboard?tab=inventario",
      action: "Ver en Compras",
    },
    {
      n: 3,
      title: "Cargar el costo y el stock",
      count: stats.sinCosto.length,
      done: stats.sinCosto.length === 0 && stats.relevant.length > 0,
      description: (c) => (c > 0 ? `Faltan ${c} producto${c === 1 ? "" : "s"}.` : "Todos los productos tienen costo."),
      href: "/vendor/dashboard?tab=inventario",
      action: "Ver sin costo",
    },
    {
      n: 4,
      title: "Elegir la lista de margen",
      count: stats.sinLista.length,
      done: stats.sinLista.length === 0 && stats.relevant.length > 0,
      description: (c) => (c > 0 ? `Faltan ${c} producto${c === 1 ? "" : "s"}.` : "Todos tienen lista o precio manual declarado."),
      href: "/vendor/dashboard?tab=menu&vista=listas",
      action: "Ir a Listas",
    },
    {
      n: 5,
      title: "Calcular los precios",
      count: stats.sinPrecio.length,
      done: stats.sinPrecio.length === 0 && stats.relevant.length > 0,
      description: (c) => (c > 0 ? `Faltan ${c} producto${c === 1 ? "" : "s"}.` : "Todos los productos tienen precio de venta."),
      href: "/vendor/dashboard?tab=menu&filtro=falta_precio",
      action: "Calcular precios",
    },
  ];

  const doneCount = tasks.filter((t) => t.done).length;

  return (
    <div className="mx-auto max-w-3xl p-4 space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Prepará tus productos para vender</h1>
        <p className="text-sm text-muted-foreground">
          De la factura al precio de venta, en 5 pasos. Cada botón te lleva al lugar donde se hace.
        </p>
      </div>

      <Card className="p-4 space-y-3">
        <div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div className="h-full bg-primary transition-all" style={{ width: `${(doneCount / 5) * 100}%` }} />
          </div>
          <p className="text-xs text-muted-foreground mt-2">{doneCount} de 5 listos</p>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        ) : (
          <div className="divide-y rounded-xl border border-border">
            {tasks.map((t) => (
              <div key={t.n} className="flex items-start gap-3 p-3">
                <span
                  className={`mt-0.5 inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs ${
                    t.done ? "bg-green-600 text-white" : "border border-border text-muted-foreground"
                  }`}
                >
                  {t.done ? "✓" : t.n}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm">{t.title}</p>
                  <p className="text-xs text-muted-foreground">{t.description(t.count)}</p>
                </div>
                <Link href={t.href}>
                  <button className="whitespace-nowrap rounded-lg border border-border bg-background px-3 py-1.5 text-xs hover:bg-muted">
                    {t.action}
                  </button>
                </Link>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Link href="/vendor/dashboard">
        <button className="text-sm text-muted-foreground underline underline-offset-2">Volver al panel</button>
      </Link>
    </div>
  );
}
