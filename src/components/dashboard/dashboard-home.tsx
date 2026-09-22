"use client";

import Link from "next/link";
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
} from "lucide-react";
import type { Order, Booking, Vendor } from "@/types/database";
import { StorePreviewCard } from "@/components/vendor/store-preview-card";
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
  | "recetas";

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
};

const STATUS_CHIP: Record<Order["status"], string> = {
  new: "bg-blue-100 text-blue-700",
  confirmed: "bg-amber-100 text-amber-700",
  preparing: "bg-orange-100 text-orange-700",
  ready: "bg-green-100 text-green-700",
  sent: "bg-purple-100 text-purple-700",
  completed: "bg-gray-100 text-gray-500",
  cancelled: "bg-red-100 text-red-600",
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

function KpiCard({
  label,
  value,
  sub,
  icon: Icon,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: typeof DollarSign;
  accent: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <span className={`inline-flex items-center justify-center h-8 w-8 rounded-lg ${accent}`}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <p className="text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

function ShortcutCard({
  icon: Icon,
  label,
  desc,
  onClick,
  accent,
}: {
  icon: typeof ShoppingBag;
  label: string;
  desc: string;
  onClick: () => void;
  accent: string;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3.5 text-left hover:border-primary/30 hover:shadow-sm transition-all"
    >
      <span className={`inline-flex items-center justify-center h-10 w-10 rounded-xl flex-shrink-0 ${accent}`}>
        <Icon className="h-5 w-5" />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-semibold">{label}</span>
        <span className="block text-xs text-muted-foreground truncate">{desc}</span>
      </span>
      <ArrowRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
    </button>
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
}: Props) {
  const sellsOrders = isGastro || isModa || isComercio;
  // Retail (moda/comercio): flow con aceptación + empaque ("Por aceptar", "Empaquetando").
  const isRetail = isModa || isComercio;

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

  const shortcuts: { tab: DashboardTab; label: string; desc: string; icon: typeof ShoppingBag; accent: string; show: boolean }[] = [
    {
      tab: "pos",
      label: "Mostrador",
      desc: "Arma una venta y cobrá en el local",
      icon: ShoppingBag,
      accent: "bg-blue-100 text-blue-700",
      show: can("pos"),
    },
    {
      tab: "comanda",
      label: "Comanda",
      desc: "Cocina organizada por estado",
      icon: ChefHat,
      accent: "bg-orange-100 text-orange-700",
      show: isGastro && can("kds"),
    },
    {
      tab: "mesas",
      label: "Mesas",
      desc: "Abrí y cobrá tus mesas",
      icon: LayoutGrid,
      accent: "bg-amber-100 text-amber-700",
      show: isGastro && can("mesas"),
    },
    {
      tab: "caja",
      label: "Caja",
      desc: "Cobros del día y cierre (Z)",
      icon: DollarSign,
      accent: "bg-emerald-100 text-emerald-700",
      show: can("pos") && !isModa,
    },
    {
      tab: "clientes",
      label: "Clientes",
      desc: "Tu libro de clientes",
      icon: Users,
      accent: "bg-cyan-100 text-cyan-700",
      show: can("crm") && !isModa,
    },
    {
      tab: "recetas",
      label: "Recetas",
      desc: "Costos y food cost de tus platos",
      icon: Calculator,
      accent: "bg-green-100 text-green-700",
      show: isGastro && can("recipes"),
    },
    {
      tab: "menu",
      label: isRetail ? "Catálogo" : "Menú",
      desc: `${offerCount} ${offerCount === 1 ? "producto" : "productos"} publicados`,
      icon: isModa ? Shirt : isComercio ? ShoppingBag : UtensilsCrossed,
      accent: "bg-violet-100 text-violet-700",
      show: true,
    },
  ];

  const activeList = [...activos].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  return (
    <div className="space-y-5">
      <StorePreviewCard vendor={vendor} onChanged={onChanged} canManageTokens={!isPreview} />
      {sellsOrders ? (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard
              label="Ventas de hoy"
              value={`$${ventasHoy.toLocaleString("es-AR")}`}
              sub={`${todayOrders.length} pedido${todayOrders.length === 1 ? "" : "s"} hoy`}
              icon={DollarSign}
              accent="bg-green-100 text-green-700"
            />
            <KpiCard
              label="Pedidos activos"
              value={String(activos.length)}
              sub="en curso ahora"
              icon={ClipboardList}
              accent="bg-blue-100 text-blue-700"
            />
            <KpiCard
              label="Ticket promedio"
              value={`$${ticketProm.toLocaleString("es-AR", { maximumFractionDigits: 0 })}`}
              sub="de los pedidos de hoy"
              icon={Receipt}
              accent="bg-violet-100 text-violet-700"
            />
            <KpiCard
              label={isRetail ? "Por aceptar" : "Nuevos"}
              value={String(nuevos)}
              sub={isRetail ? "aceptalos para empacar" : "esperando tu respuesta"}
              icon={BellRing}
              accent="bg-orange-100 text-orange-700"
            />
          </div>

          {/* Pedidos activos recientes */}
          <div className="rounded-2xl border border-border bg-card">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h2 className="text-sm font-semibold">Pedidos activos</h2>
              <button
                onClick={() => onNavigate("orders")}
                className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
              >
                Ver todos <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
            {activeList.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <p className="text-sm text-muted-foreground">
                  No tenés pedidos activos. Cuando alguien compre, aparece acá.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {activeList.slice(0, 5).map((o) => (
                  <button
                    key={o.id}
                    onClick={() => onOpenOrder(o)}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/50 transition-colors"
                  >
                    <span className="inline-flex items-center justify-center h-9 w-9 rounded-lg bg-muted text-xs font-bold text-muted-foreground flex-shrink-0">
                      {orderNumberShort(o).replace("Nro. ", "#")}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-medium truncate">{o.customer_name}</span>
                      <span className="flex items-center gap-1.5 mt-0.5">
                        <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${STATUS_CHIP[o.status]}`}>
                          <span className="inline-block w-1 h-1 rounded-full bg-current" />
                          {statusLabel(o.status, isRetail)}
                        </span>
                        <span className={`hidden sm:inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${CONDITION_META[orderCondition(o)].pillClass}`}>
                          {CONDITION_META[orderCondition(o)].label}
                        </span>
                      </span>
                    </span>
                    <span className="text-sm font-bold tabular-nums flex-shrink-0">
                      ${Number(o.total).toLocaleString("es-AR")}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Atajos */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {shortcuts
              .filter((s) => s.show)
              .map((s) => (
                <ShortcutCard
                  key={s.tab}
                  icon={s.icon}
                  label={s.label}
                  desc={s.desc}
                  accent={s.accent}
                  onClick={() => onNavigate(s.tab)}
                />
              ))}
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {!isService && (
              <ShortcutCard
                icon={UtensilsCrossed}
                label="Publicaciones"
                desc={`${offerCount} ${offerCount === 1 ? "producto" : "productos"} en tu vidriera`}
                accent="bg-violet-100 text-violet-700"
                onClick={() => onNavigate("menu")}
              />
            )}
            <ShortcutCard
              icon={QrCode}
              label="Compartir"
              desc="QR y link para difundir tu negocio"
              accent="bg-green-100 text-green-700"
              onClick={onShare}
            />
            <ShortcutCard
              icon={Sparkles}
              label="Completá tu ficha"
              desc="Descripción, fotos y horarios para que te elijan"
              accent="bg-amber-100 text-amber-700"
              onClick={() => onNavigate("config")}
            />
            <Link
              href="/planes"
              className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3.5 hover:border-primary/30 hover:shadow-sm transition-all"
            >
              <span className="inline-flex items-center justify-center h-10 w-10 rounded-xl bg-blue-100 text-blue-700 flex-shrink-0">
                <DollarSign className="h-5 w-5" />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-semibold">Ver planes</span>
                <span className="block text-xs text-muted-foreground truncate">Sumá venta online cuando crezcas</span>
              </span>
              <ArrowRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            </Link>
          </div>
        </>
      )}
    </div>
  );
}