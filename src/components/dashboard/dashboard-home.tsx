"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  DollarSign,
  ClipboardList,
  Receipt,
  BellRing,
  ShoppingBag,
  ChefHat,
  LayoutGrid,
  Shirt,
  UtensilsCrossed,
  QrCode,
  ArrowRight,
  Store,
  Sparkles,
  Calculator,
  Users,
  Boxes,
  BookOpen,
} from "lucide-react";
import type { Order, Booking, Vendor } from "@/types/database";
import { StorePreviewCard } from "@/components/vendor/store-preview-card";
import {
  Badge,
  Card,
  EmptyState,
  KpiCard as KpiCardUi,
  SectionHeader,
  type BadgeTone,
} from "@/components/panel-ui";
import { statusLabel, orderNumberShort, orderCondition, CONDITION_META } from "@/lib/order-utils";
import { isStoreOpen } from "@/lib/open-hours";
import type { FeatureKey } from "@/lib/plans";

export type DashboardTab =
  | "hoy"
  | "config"
  | "menu"
  | "orders"
  | "history"
  | "comanda"
  | "analytics"
  | "pos"
  | "mesas"
  | "caja"
  | "clientes"
  | "reviews"
  | "recetas"
  | "inventario";

type Props = {
  vendor: Vendor;
  isGastro: boolean;
  isModa: boolean;
  isComercio: boolean;
  isService: boolean;
  orders: Order[];
  bookings: Booking[];
  offerCount: number;
  can: (feature: FeatureKey) => boolean;
  onNavigate: (tab: DashboardTab) => void;
  onShare: () => void;
  onOpenOrder: (order: Order) => void;
  onChanged?: () => void;
  /** Sesión de prueba (link compartido): gestiona todo salvo el token. */
  isPreview?: boolean;
  /** Empleado/encargado (login "Soy del equipo"): no ve la vista previa del
   *  micrositio — no navega el sitio público (ver src/proxy.ts). */
  isStaffMember?: boolean;
};

const STATUS_TONE: Record<Order["status"], BadgeTone> = {
  new: "info",
  confirmed: "warning",
  preparing: "warning",
  ready: "success",
  sent: "info",
  completed: "neutral",
  cancelled: "danger",
};

function isToday(d: string): boolean {
  const t = new Date(d);
  const now = new Date();
  return (
    t.getFullYear() === now.getFullYear() &&
    t.getMonth() === now.getMonth() &&
    t.getDate() === now.getDate()
  );
}

/** Icono en círculo suave (paleta Tasty del panel). */
function SoftIcon({
  icon: Icon,
  tone = "primary",
}: {
  icon: typeof ShoppingBag;
  tone?: "primary" | "success" | "warning" | "danger" | "info";
}) {
  const color = tone === "primary" ? "var(--color-primary)" : `var(--ts-${tone})`;
  return (
    <span
      className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full"
      style={{ backgroundColor: "var(--color-accent)", color }}
    >
      <Icon className="h-5 w-5" />
    </span>
  );
}

/** Atajo del home con la tarjeta activa del spec (radio 16, hover teal). */
function ShortcutCard({
  icon,
  label,
  desc,
  onClick,
}: {
  icon: typeof ShoppingBag;
  label: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="ts-card-hover flex w-full items-center gap-3 p-4 text-left"
    >
      <SoftIcon icon={icon} />
      <span className="flex-1 min-w-0">
        <span className="ts-body-strong block">{label}</span>
        <span className="ts-body block truncate text-muted-foreground">{desc}</span>
      </span>
      <ArrowRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
    </button>
  );
}

/** Atajo como link (misma tarjeta, navegación). */
function ShortcutLink({
  href,
  icon,
  label,
  desc,
}: {
  href: string;
  icon: typeof ShoppingBag;
  label: string;
  desc: string;
}) {
  return (
    <Link href={href} className="ts-card-hover flex items-center gap-3 p-4">
      <SoftIcon icon={icon} />
      <span className="flex-1 min-w-0">
        <span className="ts-body-strong block">{label}</span>
        <span className="ts-body block truncate text-muted-foreground">{desc}</span>
      </span>
      <ArrowRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
    </Link>
  );
}

export function DashboardHome({
  vendor,
  isGastro,
  isModa,
  isComercio,
  isService,
  orders,
  bookings,
  offerCount,
  can,
  onNavigate,
  onShare,
  onOpenOrder,
  onChanged,
  isPreview = false,
  isStaffMember = false,
}: Props) {
  const sellsOrders = isGastro || isModa || isComercio;
  // Retail (moda/comercio): flow con aceptación + empaque ("Por aceptar", "Empaquetando").
  const isRetail = isModa || isComercio;
  const canInventory = can("inventory");
  const [expiryAlerts, setExpiryAlerts] = useState({ expired: 0, soon: 0 });

  useEffect(() => {
    if (!canInventory) return;
    let alive = true;
    const load = () => {
      fetch("/api/vendor/expirations", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (alive && d?.counts) {
            setExpiryAlerts({
              expired: Number(d.counts.expired) || 0,
              soon: Number(d.counts.soon) || 0,
            });
          }
        })
        .catch(() => {});
    };
    load();
    window.addEventListener("portal:expiry-updated", load);
    return () => {
      alive = false;
      window.removeEventListener("portal:expiry-updated", load);
    };
  }, [canInventory]);
  // Deep-link al manual de su vertical (default: índice de manuales).
  const manualUrl = isGastro
    ? "/manuales/gastronomia"
    : isComercio
      ? "/manuales/comercio"
      : "/manuales";

  // KPIs de venta (gastro + moda)
  const notCancelled = orders.filter((o) => o.status !== "cancelled");
  const todayOrders = notCancelled.filter((o) => isToday(o.created_at));
  const ventasHoy = todayOrders.reduce((s, o) => s + Number(o.total || 0), 0);
  const activos = orders.filter((o) => o.status !== "completed" && o.status !== "cancelled");
  const nuevos = orders.filter((o) => o.status === "new").length;
  const ticketProm = todayOrders.length ? ventasHoy / todayOrders.length : 0;

  const openResolved = isStoreOpen({
    hours: vendor.hours,
    open_override: vendor.open_override ?? null,
  });

  const shortcuts: { tab: DashboardTab; label: string; desc: string; icon: typeof ShoppingBag; show: boolean }[] = [
    {
      tab: "pos",
      label: "Mostrador",
      desc: "Arma una venta y cobrá en el local",
      icon: ShoppingBag,
      show: can("pos"),
    },
    {
      tab: "comanda",
      label: "Comanda",
      desc: "Cocina organizada por estado",
      icon: ChefHat,
      show: isGastro && can("kds"),
    },
    {
      tab: "mesas",
      label: "Mesas",
      desc: "Abrí y cobrá tus mesas",
      icon: LayoutGrid,
      show: isGastro && can("mesas"),
    },
    {
      tab: "caja",
      label: "Caja",
      desc: "Cobros del día y cierre (Z)",
      icon: DollarSign,
      show: can("pos"),
    },
    {
      tab: "clientes",
      label: "Clientes",
      desc: "Tu libro de clientes",
      icon: Users,
      show: can("crm"),
    },
    {
      tab: "recetas",
      label: "Preparación y Costo",
      desc: "Costos y food cost de tus platos",
      icon: Calculator,
      show: isGastro && can("recipes"),
    },
    {
      tab: "inventario",
      label: expiryAlerts.expired > 0 ? "Vencimientos" : "Por vencer",
      desc:
        `${expiryAlerts.expired + expiryAlerts.soon} producto(s) para revisar` +
        (expiryAlerts.expired > 0 ? ` · ${expiryAlerts.expired} vencido(s)` : ""),
      icon: Boxes,
      show: canInventory && expiryAlerts.expired + expiryAlerts.soon > 0,
    },
    {
      tab: "menu",
      label: isRetail ? "Catálogo" : "Menú",
      desc: `${offerCount} ${offerCount === 1 ? "producto" : "productos"} publicados`,
      icon: isModa ? Shirt : isComercio ? ShoppingBag : UtensilsCrossed,
      show: true,
    },
  ];

  const activeList = [...activos].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  return (
    <div className="space-y-5">
      {!isStaffMember && (
        <StorePreviewCard vendor={vendor} onChanged={onChanged} canManageTokens={!isPreview} />
      )}
      {sellsOrders ? (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCardUi
              label="Ventas de hoy"
              value={`$${ventasHoy.toLocaleString("es-AR")}`}
              sub={`${todayOrders.length} pedido${todayOrders.length === 1 ? "" : "s"} hoy`}
              icon={DollarSign}
              accent="success"
            />
            <KpiCardUi
              label="Pedidos activos"
              value={String(activos.length)}
              sub="en curso ahora"
              icon={ClipboardList}
              accent="info"
            />
            <KpiCardUi
              label="Ticket promedio"
              value={`$${ticketProm.toLocaleString("es-AR", { maximumFractionDigits: 0 })}`}
              sub="de los pedidos de hoy"
              icon={Receipt}
            />
            <KpiCardUi
              label={isRetail ? "Por aceptar" : "Nuevos"}
              value={String(nuevos)}
              sub={isRetail ? "aceptalos para empacar" : "esperando tu respuesta"}
              icon={BellRing}
              accent="warning"
            />
          </div>

          {/* Pedidos activos recientes */}
          <Card>
            <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
              <SectionHeader title="Pedidos activos" />
              <button
                onClick={() => onNavigate("orders")}
                className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
              >
                Ver todos <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
            {activeList.length === 0 ? (
              <EmptyState
                icon={ClipboardList}
                title="No tenés pedidos activos"
                hint="Cuando alguien compre, aparece acá con su detalle y acciones."
              />
            ) : (
              <div className="divide-y divide-border">
                {activeList.slice(0, 5).map((o) => (
                  <button
                    key={o.id}
                    onClick={() => onOpenOrder(o)}
                    className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-muted/50"
                  >
                    <span className="ts-caption inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-muted tabular-nums text-muted-foreground">
                      {orderNumberShort(o).replace("Nro. ", "#")}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="ts-body-strong block truncate">{o.customer_name}</span>
                      <span className="mt-1 flex items-center gap-1.5">
                        <Badge tone={STATUS_TONE[o.status]}>{statusLabel(o.status, isRetail)}</Badge>
                        <Badge tone="neutral" className="hidden sm:inline-flex">
                          {CONDITION_META[orderCondition(o)].label}
                        </Badge>
                      </span>
                    </span>
                    <span className="ts-title tabular-nums flex-shrink-0">
                      ${Number(o.total).toLocaleString("es-AR")}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </Card>

          {/* Atajos */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {shortcuts
              .filter((s) => s.show)
              .map((s) => (
                <ShortcutCard
                  key={s.tab}
                  icon={s.icon}
                  label={s.label}
                  desc={s.desc}
                  onClick={() => onNavigate(s.tab)}
                />
              ))}
            <ShortcutLink
              href={manualUrl}
              icon={BookOpen}
              label="Manuales"
              desc="Guías paso a paso de tu rubro"
            />
          </div>
        </>
      ) : (
        <>
          {/* Perfil ficha/contacto (comercio, servicio, salud, genérico) */}
          <div className="rounded-2xl border border-border bg-card overflow-hidden">
            <div className="bg-gradient-to-br from-primary to-primary/80 p-5 text-white relative overflow-hidden">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_20%,rgba(163,230,53,0.25),transparent_50%)]" />
              <div className="relative z-10">
                <div className="flex items-center gap-2 mb-1">
                  <Store className="h-4 w-4" />
                  <span className="text-xs font-semibold uppercase tracking-wider">Tu vidriera</span>
                </div>
                <h2 className="font-display text-xl font-semibold">{vendor.store_name}</h2>
                <p className="text-sm text-white/80 mt-1 max-w-md">
                  {openResolved
                    ? "Estás abierto — los vecinos te encuentran y te escriben por WhatsApp."
                    : "Estás cerrado ahora. Los vecinos igual te encuentran y te dejan su consulta."}
                </p>
              </div>
              <div className="relative z-10 mt-4 flex flex-wrap gap-2">
                {bookings.length > 0 && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 border border-white/20 px-3 py-1 text-xs font-semibold">
                    <BellRing className="h-3.5 w-3.5" />
                    {bookings.length} turno{bookings.length === 1 ? "" : "s"} totales
                  </span>
                )}
                <button
                  onClick={onShare}
                  className="inline-flex items-center gap-1.5 rounded-full bg-sun text-ink px-3 py-1 text-xs font-bold hover:bg-sun/90 transition-colors"
                >
                  <QrCode className="h-3.5 w-3.5" />
                  Compartí tu vidriera
                </button>
              </div>
            </div>
          </div>

          {/* Atajos */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {!isService && (
              <ShortcutCard
                icon={UtensilsCrossed}
                label="Publicaciones"
                desc={`${offerCount} ${offerCount === 1 ? "producto" : "productos"} en tu vidriera`}
                onClick={() => onNavigate("menu")}
              />
            )}
            <ShortcutCard
              icon={QrCode}
              label="Compartir"
              desc="QR y link para difundir tu negocio"
              onClick={onShare}
            />
            <ShortcutCard
              icon={Sparkles}
              label="Completá tu ficha"
              desc="Descripción, fotos y horarios para que te elijan"
              onClick={() => onNavigate("config")}
            />
            <ShortcutLink
              href="/planes"
              icon={DollarSign}
              label="Ver planes"
              desc="Sumá venta online cuando crezcas"
            />
            <ShortcutLink
              href={manualUrl}
              icon={BookOpen}
              label="Manuales"
              desc="Guías paso a paso de tu rubro"
            />
          </div>
        </>
      )}
    </div>
  );
}