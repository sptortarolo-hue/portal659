"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import QRCode from "qrcode";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ImageCropModal } from "@/components/ui/image-crop-modal";
import { DEFAULT_ZONE } from "@/lib/config";
import { buildClientWhatsAppUrl, ORDER_STATUS_COLORS, MODA_STATUS_LABELS, flowSteps, orderCondition, orderReadyLabel, orderNeedsKitchen, CONDITION_META } from "@/lib/order-utils";
import OrderDetailModal from "@/components/dashboard/order-detail-modal";
import DashboardGastro from "@/components/dashboard/dashboard-gastro";
import DashboardComercio from "@/components/dashboard/dashboard-comercio";
import DashboardServicio from "@/components/dashboard/dashboard-servicio";
import DashboardGenerico from "@/components/dashboard/dashboard-generico";
import DashboardModa from "@/components/dashboard/dashboard-moda";
import { VendorAnalytics } from "@/components/dashboard/vendor-analytics";
import { VendorReviews } from "@/components/vendor/vendor-reviews";
import ComandaKDS from "@/components/dashboard/comanda-kds";
import { playNewOrderSound, resumeAudioContext } from "@/lib/sounds";
import { resolveVendorPlan, daysLeft } from "@/lib/plans";
import { PlanBanner } from "@/components/vendor/plan-banner";
import { PlanLock } from "@/components/vendor/plan-lock";
import { Mostrador } from "@/components/vendor/mostrador";
import { Mesas } from "@/components/vendor/mesas";
import { OpenToggle } from "@/components/vendor/open-toggle";
import { DeliveryBoard } from "@/components/vendor/delivery-board";
import type { ProductModifier, VendorGallery, Booking, Vertical, Product as DBProduct, Order, ProductVariant, ProductImage, OrderItem, PlanStatus, Plan } from "@/types/database";

type Vendor = {
  id: string;
  user_id: string;
  store_name: string;
  slug: string | null;
  category: string | null;
  vertical: Vertical;
  neighborhood: string | null;
  whatsapp: string | null;
  phone: string | null;
  instagram: string | null;
  facebook: string | null;
  payment_methods: string | null;
  delivery_options: string | null;
  services_list: string | null;
  service_area: string | null;
  free_estimate: boolean | null;
  accepting_quotes: boolean;
  verified: boolean;
  hours: string | null;
  location: string | null;
  address: string | null;
  description: string | null;
  image_url: string | null;
  logo_url: string | null;
  prep_time_min: number | null;
  urgent_enabled: boolean;
  is_admin: boolean;
  printer_ip: string | null;
  printer_port: number | null;
  paper_size: string | null;
  auto_print: boolean;
  plan_id: string | null;
  plan_status: PlanStatus;
  plan_expires_at: string | null;
  trial_ends_at: string | null;
  created_at: string;
};

type Offer = DBProduct;

type MenuCategory = { id: string; name: string; position: number };

const STATUS_LABELS: Record<Order["status"], string> = {
  new: "Nuevo", confirmed: "Confirmado", preparing: "Preparando", ready: "Listo", sent: "Enviado", completed: "Completado", cancelled: "Cancelado",
};

const STATUS_COLORS: Record<Order["status"], string> = {
  new: "bg-sun/20 text-ink", confirmed: "bg-amber-100 text-amber-700", preparing: "bg-orange-100 text-orange-700", ready: "bg-green-100 text-green-700", sent: "bg-purple-100 text-purple-700", completed: "bg-gray-100 text-gray-500", cancelled: "bg-red-100 text-red-700",
};

export default function VendorDashboard() {
  return (
    <Suspense fallback={<div className="container mx-auto px-4 py-8"><p className="text-muted-foreground">Cargando...</p></div>}>
      <VendorDashboardInner />
    </Suspense>
  );
}

function VendorDashboardInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const impersonatingId = searchParams.get("as");
  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [staffRole, setStaffRole] = useState<"owner" | "delivery" | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [modifiers, setModifiers] = useState<ProductModifier[]>([]);
  const [gallery, setGallery] = useState<VendorGallery[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [variants, setVariants] = useState<ProductVariant[]>([]);
  const [productImages, setProductImages] = useState<ProductImage[]>([]);
  const [tab, setTab] = useState<"config" | "menu" | "orders" | "comanda" | "analytics" | "pos" | "mesas" | "reviews">("orders");
  // Las pestañas pesadas (fetch propio: comanda, mostrador, mesas, analytics,
  // reviews) se montan recién cuando el usuario las abre por primera vez.
  // Así el arranque del dashboard hace ~12 requests en vez de ~20 y el pool
  // de la DB no se satura (causa del "no se pudo cargar" en Comanda/Mesas).
  const [mountedTabs, setMountedTabs] = useState<Set<string>>(new Set(["orders", "menu", "config"]));
  useEffect(() => {
    setMountedTabs((prev) => (prev.has(tab) ? prev : new Set(prev).add(tab)));
  }, [tab]);
  const [moreOpen, setMoreOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [plans, setPlans] = useState<Plan[]>([]);
  const [shareOpen, setShareOpen] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [cropOpen, setCropOpen] = useState(false);
  const [cropImageSrc, setCropImageSrc] = useState<string | null>(null);
  const [cropAspect, setCropAspect] = useState(3 / 1);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [orderSearch, setOrderSearch] = useState("");
  const [orderStatusFilter, setOrderStatusFilter] = useState<string>("new");
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [cropTitle, setCropTitle] = useState("Ajustá tu foto");
  const [cropTarget, setCropTarget] = useState<"cover" | "logo" | "offer">("cover");

  async function uploadImage(file: File, folder: string): Promise<string | null> {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("folder", folder);
    const res = await fetch("/api/vendor/upload", { method: "POST", body: fd });
    const data = await res.json();
    return data.url || null;
  }

  async function loadOrdersOnly() {
    try {
      const res = await fetch("/api/vendor/orders");
      const data = await res.json();
      if (data.orders) setOrders(data.orders);
    } catch { /* noop */ }
  }

  async function loadData() {
    const [meRes, offersRes, ordersRes, catsRes, modsRes, galRes, bkRes, variantsRes, imagesRes, plansRes] = await Promise.all([
      fetch("/api/vendor/me"),
      fetch("/api/vendor/offers"),
      fetch("/api/vendor/orders"),
      fetch("/api/vendor/categories"),
      fetch("/api/vendor/modifiers").catch(() => ({ json: () => ({ modifiers: [] }) })),
      fetch("/api/vendor/gallery").catch(() => ({ json: () => ({ gallery: [] }) })),
      fetch("/api/vendor/bookings").catch(() => ({ json: () => ({ bookings: [] }) })),
      fetch("/api/vendor/variants").catch(() => ({ json: () => ({ variants: [] }) })),
      fetch("/api/vendor/product-images").catch(() => ({ json: () => ({ images: [] }) })),
      fetch("/api/subscriptions/plans").catch(() => ({ json: () => ({ plans: [] }) })),
    ]);
    const me = await meRes.json();
    const off = await offersRes.json();
    const ord = await ordersRes.json();
    const cats = await catsRes.json();
    const mods = await modsRes.json();
    const gal = await galRes.json();
    const bk = await bkRes.json();
    const varData = await variantsRes.json();
    const imagesData = await imagesRes.json();
    const plansData = await plansRes.json();

    if (me.error === "No autenticado") { router.push("/login"); return; }
    if (me.vendor) setVendor(me.vendor);
    if (me.staffRole) setStaffRole(me.staffRole);
    if (me.userId) setUserId(me.userId);
    if (off.offers) setOffers(off.offers);
    if (ord.orders) setOrders(ord.orders);
    if (cats.categories) setCategories(cats.categories);
    if (mods.modifiers) setModifiers(mods.modifiers);
    if (gal.gallery) setGallery(gal.gallery);
    if (bk.bookings) setBookings(bk.bookings);
    if (varData.variants) setVariants(varData.variants);
    if (imagesData.images) setProductImages(imagesData.images);
    if (plansData.plans) setPlans(plansData.plans);
    setLoading(false);
  }

  useEffect(() => {
    if (impersonatingId) {
      // Setear la cookie ANTES de cargar, para que los endpoints /api/vendor/* resuelvan el comercio impersonado.
      document.cookie = `portal659-admin-as=${impersonatingId}; path=/; max-age=7200; samesite=lax`;
    }
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [impersonatingId]);

  function exitImpersonation() {
    document.cookie = "portal659-admin-as=; path=/; max-age=0";
    router.push("/admin/comercios");
  }

  useEffect(() => {
    const onFirstClick = () => {
      resumeAudioContext();
      if ("Notification" in window && Notification.permission === "default") {
        Notification.requestPermission().catch(() => {});
      }
      window.removeEventListener("click", onFirstClick);
    };
    window.addEventListener("click", onFirstClick);
    return () => window.removeEventListener("click", onFirstClick);
  }, []);

  useEffect(() => {
    if (!vendor?.id) return;
    // Obtener token para los endpoints protegidos (pedidos, comanda)
    (async () => {
      try {
        const { accessToken: token } = await fetch("/api/auth/token").then((r) => r.json());
        if (token) setAccessToken(token);
      } catch { /* noop */ }
    })();
    const poll = setInterval(loadOrdersOnly, 15000);
    return () => clearInterval(poll);
  }, [vendor?.id]);

  async function saveVendor(data: Record<string, unknown>) {
    setMsg("");
    const res = await fetch("/api/vendor/me", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...data, neighborhood: DEFAULT_ZONE.neighborhoods[0] }),
    });
    const result = await res.json().catch(() => ({ error: "Error de conexión" }));
    if (result.error) setMsg(result.error);
    else { setVendor(result.vendor); setMsg("Guardado"); }
  }

  async function updateOrderStatus(order: Order, status: Order["status"]) {
    try {
      const payload: Record<string, unknown> = { status };
      // Gastronomía estima minutos de cocina; moda no maneja tiempos en minutos.
      if (status === "preparing" && !isModa) {
        payload.estimated_minutes = 30;
      }
      const res = await fetch(`/api/vendor/orders/${order.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.error) {
        setMsg(`Error: ${data.error}`);
        return;
      }
      setMsg(`Pedido #${order.id.slice(0, 8)} → ${statusLabels[status]}`);
      loadOrdersOnly();
      if (status === "preparing" && effectivePlan.can("printer") && orderNeedsKitchen(order)) {
        fetch("/api/print", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId: order.id }),
        }).catch(() => {});
      }
    } catch {
      setMsg("Error al actualizar el pedido");
    }
  }

  async function markOrderPaid(orderId: string) {
    try {
      const res = await fetch(`/api/vendor/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payment_status: "paid" }),
      });
      const data = await res.json();
      if (data.error) {
        setMsg(`Error: ${data.error}`);
        return;
      }
      setMsg(`Pago del pedido #${orderId.slice(0, 8)} confirmado`);
      setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, payment_status: "paid", paid_at: new Date().toISOString() } : o)));
      setSelectedOrder((prev) => (prev && prev.id === orderId ? { ...prev, payment_status: "paid", paid_at: new Date().toISOString() } : prev));
    } catch {
      setMsg("Error al confirmar el pago");
    }
  }

  async function modifyOrder(
    orderId: string,
    items: OrderItem[],
    modificationNotes: string
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await fetch(`/api/vendor/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items, modification_notes: modificationNotes }),
      });
      const text = await res.text();
      const data = (() => {
        try {
          return text ? JSON.parse(text) : {};
        } catch {
          return {};
        }
      })();
      if (!res.ok || data.error) {
        const err = data.error || data.message || (data.error_description as string) || `HTTP ${res.status}`;
        setMsg(`Error: ${err}`);
        return { ok: false, error: String(err) };
      }
      const total = items.reduce((sum, item) => sum + item.price * item.qty, 0);
      setMsg(`Pedido #${orderId.slice(0, 8)} modificado`);
      setOrders((prev) =>
        prev.map((o) =>
          o.id === orderId ? { ...o, items, modification_notes: modificationNotes, total } : o
        )
      );
      setSelectedOrder((prev) =>
        prev && prev.id === orderId ? { ...prev, items, modification_notes: modificationNotes, total } : prev
      );
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Error al modificar el pedido";
      setMsg(`Error: ${message}`);
      return { ok: false, error: message };
    }
  }

  async function openShare() {
    if (!vendor?.slug) return;
    setCopied(false);
    setQrDataUrl(null);
    setShareOpen(true);
    try {
      const url = `${window.location.origin}/tienda/${vendor.slug}`;
      setQrDataUrl(await QRCode.toDataURL(url, { width: 480, margin: 1 }));
    } catch { /* noop */ }
  }

  async function copyLink() {
    if (!vendor?.slug) return;
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/tienda/${vendor.slug}`);
      setCopied(true);
    } catch { /* noop */ }
  }

  function openCrop(target: "cover" | "logo" | "offer") {
    setCropTarget(target);
    if (target === "cover") { setCropAspect(3 / 1); setCropTitle("Ajustá la foto del comercio"); }
    else if (target === "logo") { setCropAspect(1); setCropTitle("Ajustá el logo"); }
    else { setCropAspect(16 / 9); setCropTitle("Ajustá la foto del plato"); }
    setCropOpen(true);
  }

  function handleCropComplete(file: File, previewUrl: string) {
    if (cropTarget === "cover" || cropTarget === "logo") {
      saveVendor({ [cropTarget === "cover" ? "image_url" : "logo_url"]: previewUrl });
    }
    setCropOpen(false);
    if (cropImageSrc) URL.revokeObjectURL(cropImageSrc);
  }

  if (loading) return <main className="container mx-auto px-4 py-8"><p className="text-muted-foreground">Cargando...</p></main>;

  // Repartidor: vista acotada solo al módulo de entrega.
  if (staffRole === "delivery") {
    return (
      <main className="min-h-screen bg-background">
        <div className="sticky top-0 z-40 bg-background border-b border-border">
          <div className="container mx-auto px-4 py-3 flex items-center gap-3">
            {vendor && (vendor.logo_url || vendor.image_url) ? (
              <img src={vendor.logo_url || vendor.image_url || ""} alt={vendor.store_name} className="h-10 w-10 rounded-full object-cover flex-shrink-0" />
            ) : (
              <div className="h-10 w-10 rounded-full bg-accent flex items-center justify-center flex-shrink-0"><span className="font-bold text-primary">🛵</span></div>
            )}
            <div className="flex-1 min-w-0">
              <h1 className="font-semibold text-sm truncate">{vendor?.store_name || "Entregas"}</h1>
              <p className="text-xs text-muted-foreground">Módulo del repartidor</p>
            </div>
          </div>
        </div>
        <div className="container mx-auto px-4 py-4 pb-24">
          {vendor && <DeliveryBoard vendorId={vendor.id} userId={userId} />}
        </div>
      </main>
    );
  }

  if (!vendor) {
    return (
      <main className="container mx-auto px-4 py-8 max-w-lg">
        <h1 className="font-display text-2xl font-semibold mb-1">Tu comercio en Portal 659</h1>
        <p className="text-muted-foreground text-sm mb-6">Completá los datos para armar tu vidriera.</p>
        <DashboardGenerico vendor={null} offers={[]} categories={[]} msg={msg} setMsg={setMsg} reload={loadData} saveVendor={saveVendor} uploading={false} onCrop={openCrop} />
      </main>
    );
  }

  const isService = vendor?.vertical === "servicio";
  const isGastro = vendor?.vertical === "gastronomia";
  const isComercio = vendor?.vertical === "comercio";
  const isModa = vendor?.vertical === "moda";

  // Moda: labels y pasos del flow con aceptación explícita ("Empaquetando", etc.).
  const statusLabels: Record<Order["status"], string> = isModa ? MODA_STATUS_LABELS : STATUS_LABELS;
  const stepOrder = flowSteps(isModa);

  const effectivePlan = resolveVendorPlan(vendor, plans);
  const overLimit =
    effectivePlan.maxProducts != null && offers.length > effectivePlan.maxProducts;
  const planBannerData = {
    slug: effectivePlan.slug,
    status: effectivePlan.status,
    name: effectivePlan.plan?.name ?? null,
    eligibleForPaid: effectivePlan.eligibleForPaid,
    trialDaysLeft: effectivePlan.trialActive ? daysLeft(effectivePlan.trialEndsAt) : undefined,
    products: offers.length,
    maxProducts: effectivePlan.maxProducts,
    overLimit,
  } as const;

  const dashboardProps = { vendor, offers, categories, modifiers, gallery, bookings, msg, setMsg, reload: loadData, saveVendor, uploading: false, onCrop: openCrop };

  const configContent = isGastro ? (
    <DashboardGastro {...dashboardProps} />
  ) : isComercio ? (
    <DashboardComercio {...dashboardProps} />
  ) : isService ? (
    <DashboardServicio {...dashboardProps} />
  ) : isModa ? (
    <DashboardModa {...dashboardProps} variants={variants} productImages={productImages} />
  ) : (
    <DashboardGenerico {...dashboardProps} />
  );

  const activeOrders = orders.filter((o) => o.status !== "completed" && o.status !== "cancelled");

  const filteredOrders = orders.filter((o) => {
    if (orderStatusFilter !== "all" && o.status !== orderStatusFilter) return false;
    if (orderSearch) {
      const q = orderSearch.toLowerCase();
      const matchName = o.customer_name?.toLowerCase().includes(q);
      const matchPhone = o.customer_phone?.includes(q);
      const matchId = o.id?.slice(0, 8).includes(q);
      if (!matchName && !matchPhone && !matchId) return false;
    }
    return true;
  });

  const statusTabs = [
    { key: "new", label: "Nuevos", count: orders.filter((o) => o.status === "new").length },
    // "Confirmados" solo existe en el flow de moda (aceptación explícita).
    ...(isModa ? [{ key: "confirmed", label: "Confirmados", count: orders.filter((o) => o.status === "confirmed").length }] : []),
    { key: "preparing", label: isModa ? "Empaquetando" : "Preparando", count: orders.filter((o) => o.status === "preparing").length },
    { key: "ready", label: "Listos", count: orders.filter((o) => o.status === "ready").length },
    { key: "sent", label: "Enviados", count: orders.filter((o) => o.status === "sent").length },
    { key: "completed", label: "Completados", count: orders.filter((o) => o.status === "completed").length },
    { key: "cancelled", label: "Cancelados", count: orders.filter((o) => o.status === "cancelled").length },
    { key: "all", label: "Todos", count: orders.length },
  ];

  const ordersContent = (
    <div className="space-y-3">
      {/* Search */}
      <div className="relative">
        <input
          type="text"
          value={orderSearch}
          onChange={(e) => setOrderSearch(e.target.value)}
          placeholder="Buscar nombre, teléfono o #ID..."
          className="w-full h-10 pl-9 pr-3 text-sm rounded-xl border border-input bg-background"
        />
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">🔍</span>
      </div>

      {/* Status tabs */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-hide">
        {statusTabs.map((st) => {
          if (st.count === 0 && st.key !== "all") return null;
          return (
            <button
              key={st.key}
              onClick={() => setOrderStatusFilter(st.key)}
              className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all ${
                orderStatusFilter === st.key
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {st.label}
              {st.count > 0 && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                  orderStatusFilter === st.key ? "bg-primary-foreground/20" : "bg-foreground/10"
                }`}>{st.count}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Order list */}
      {filteredOrders.length === 0 && orders.length > 0 ? (
        <div className="text-center py-12">
          <div className="text-4xl mb-3">🔍</div>
          <p className="text-muted-foreground text-sm">No se encontraron pedidos</p>
        </div>
      ) : filteredOrders.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-4xl mb-3">📦</div>
          <p className="text-muted-foreground font-medium">Todavia no recibiste pedidos</p>
          <p className="text-xs text-muted-foreground mt-1">Los pedidos apareceran cuando un cliente compre</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {filteredOrders.map((order) => {
            const statusIdx = stepOrder.indexOf(order.status as any);
            const isCancelled = order.status === "cancelled";
            const isCompleted = order.status === "completed";
            const isTerminal = isCancelled || isCompleted;
            const elapsed = Math.floor((Date.now() - new Date(order.created_at).getTime()) / 60000);
            const remaining = order.estimated_minutes ? Math.max(0, order.estimated_minutes - elapsed) : null;
            const isOverdue = remaining !== null && remaining <= 0 && !isTerminal;

            return (
              <div
                key={order.id}
                role="button"
                tabIndex={0}
                onClick={() => setSelectedOrder(order)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedOrder(order); } }}
                className={`w-full text-left p-3.5 rounded-xl border-2 transition-all active:scale-[0.98] cursor-pointer ${
                  isOverdue ? "border-red-400 bg-red-50 dark:bg-red-950/20" : "border-border bg-card hover:border-primary/40 hover:shadow-sm"
                }`}
              >
                {/* Header row */}
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-sm truncate">{order.customer_name}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full ${
                        ORDER_STATUS_COLORS[order.status]
                      }`}>
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-current" />
                        {order.status === "ready" ? orderReadyLabel(order) : statusLabels[order.status]}
                      </span>
                      <span className={`inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full border ${CONDITION_META[orderCondition(order)].pillClass}`}>
                        {CONDITION_META[orderCondition(order)].label}
                      </span>
                      {order.pickup_number != null && (
                        <span className="inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-status-new/15 text-status-new border-status-new/20">
                          🎫 Retiro Nro. {order.pickup_number}
                        </span>
                      )}
                      {order.payment_method === "transferencia" && order.channel === "app" && order.payment_status === "pending" && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-amber-100 text-amber-700 border-amber-200">
                          🕐 Pago pendiente
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <span className="text-sm font-bold tabular-nums">${Number(order.total).toLocaleString("es-AR")}</span>
                    <p className={`text-[10px] font-medium ${isOverdue ? "text-red-500" : "text-muted-foreground"}`}>
                      {isTerminal ? (order.status === "completed" ? `Tardó ${elapsed} min` : `${elapsed} min`) : `${elapsed} min`}
                      {!isTerminal && remaining !== null && !isOverdue && ` · ~${remaining} rest`}
                    </p>
                  </div>
                </div>

                {/* Progress bar */}
                {!isCancelled && (
                  <div className="flex items-center gap-0.5 mb-2">
                    {stepOrder.map((step, idx) => (
                      <div key={step} className={`h-1.5 flex-1 rounded-full transition-all ${
                        idx <= statusIdx ? "bg-primary" : "bg-muted"
                      }`} />
                    ))}
                  </div>
                )}

                {/* Items preview */}
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

                {/* Footer */}
                <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                  <span>
                    {order.payment_method === "efectivo" && "💵 "}
                    {order.payment_method === "transferencia" && "🏦 "}
                    {order.payment_method === "whatsapp" && "📱 "}
                    {new Date(order.created_at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                  <div className="flex items-center gap-2">
                    {order.customer_phone && order.channel !== "mostrador" && order.channel !== "mesa" && (() => {
                      const digits = order.customer_phone.replace(/\D/g, "");
                      if (!digits) return null;
                      return (
                        <a
                          href={`https://wa.me/${digits}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          title="Ir a WhatsApp"
                          className="inline-flex items-center justify-center gap-1 rounded-md border border-green-200 bg-green-50 text-green-700 px-2 py-0.5 font-semibold hover:bg-green-100"
                        >
                          💬
                        </a>
                      );
                    })()}
                    <span className="text-primary font-semibold">Ver detalle →</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  return (
    <main className="min-h-screen bg-background pb-20 sm:pb-8">
      {impersonatingId && (
        <div className="bg-amber-50 border-b border-amber-200">
          <div className="container mx-auto px-4 py-2 flex items-center justify-between gap-3 text-sm text-amber-900">
            <span className="flex items-center gap-2">
              <span>🛠️</span> Estás cargando <strong>{vendor?.store_name || "este comercio"}</strong> como administrador (modo llave en mano)
            </span>
            <button onClick={exitImpersonation} className="text-xs font-semibold underline whitespace-nowrap">
              Salir del modo edición
            </button>
          </div>
        </div>
      )}
      <div className="sticky top-0 z-40 bg-background border-b border-border">
        <div className="container mx-auto px-4 py-3 flex items-center gap-3">
          {vendor.logo_url || vendor.image_url ? (
            <img src={vendor.logo_url || vendor.image_url || ""} alt={vendor.store_name} className="h-10 w-10 rounded-full object-cover flex-shrink-0" />
          ) : (
            <div className="h-10 w-10 rounded-full bg-accent flex items-center justify-center flex-shrink-0"><span className="font-bold text-primary">{vendor.store_name.charAt(0)}</span></div>
          )}
          <div className="flex-1 min-w-0">
            <h1 className="font-semibold text-sm truncate">{vendor.store_name}</h1>
            {vendor.slug && <a href={`/tienda/${vendor.slug}`} target="_blank" rel="noopener noreferrer" className="hidden sm:inline text-xs text-primary">Ver mi micrositio →</a>}
          </div>
          <OpenToggle vendor={vendor} onSaved={(v) => setVendor(v)} />
          <Button variant="outline" size="sm" onClick={openShare} className="flex-shrink-0">Compartir</Button>
        </div>
      </div>

      {msg && <div className="container mx-auto px-4 pt-3"><p className="text-sm text-green-600 bg-green-50 rounded-lg px-3 py-2">{msg}</p></div>}

      <PlanBanner plan={planBannerData as any} />

      <div className="hidden sm:block container mx-auto px-4 mt-4">
        <div className="flex flex-wrap gap-2 mb-4 items-center">
          <div className="flex flex-wrap gap-2">
            <Button variant={tab === "orders" ? "default" : "outline"} size="sm" onClick={() => setTab("orders")}>Pedidos ({orders.length})</Button>
            {/* Comanda y Mesas son de cocina/salón: solo gastronomía. Moda opera con Pedidos + Mostrador. */}
            {!isModa && (
              <Button variant={tab === "comanda" ? "default" : "outline"} size="sm" onClick={() => setTab("comanda")}>🍳 Comanda</Button>
            )}
            <Button variant={tab === "pos" ? "default" : "outline"} size="sm" onClick={() => setTab("pos")}>🛒 Mostrador</Button>
            {!isModa && (
              <Button variant={tab === "mesas" ? "default" : "outline"} size="sm" onClick={() => setTab("mesas")} disabled={!isGastro}>🍽️ Mesas</Button>
            )}
          </div>
          <div className="mx-2 h-6 w-px bg-border" />
          <div className="flex flex-wrap gap-2">
            <Button variant={tab === "menu" ? "default" : "outline"} size="sm" onClick={() => setTab("menu")}>🍽️ Menú ({offers.length})</Button>
            <Button variant={tab === "config" ? "default" : "outline"} size="sm" onClick={() => setTab("config")}>⚙️ Configuración</Button>
            <Button variant={tab === "analytics" ? "default" : "outline"} size="sm" onClick={() => setTab("analytics")}>📊 Estadísticas</Button>
            <Button variant={tab === "reviews" ? "default" : "outline"} size="sm" onClick={() => setTab("reviews")}>⭐ Reseñas</Button>
          </div>
        </div>
      </div>

      {/* Stats bar */}
      {orders.length > 0 && (
        <div className="container mx-auto px-4 mt-4">
          <div className="grid grid-cols-5 gap-1.5 mb-4">
            {[
              { status: "new", label: "Nuevos", value: orders.filter((o) => o.status === "new").length, bg: "bg-status-new/10 dark:bg-status-new/20", text: "text-status-new" },
              { status: "preparing", label: isModa ? "Empaquetando" : "Preparando", value: orders.filter((o) => o.status === "preparing").length, bg: "bg-status-preparing/10 dark:bg-status-preparing/20", text: "text-status-preparing" },
              { status: "ready", label: "Listos", value: orders.filter((o) => o.status === "ready").length, bg: "bg-status-ready/10 dark:bg-status-ready/20", text: "text-status-ready" },
              { status: "sent", label: "Enviados", value: orders.filter((o) => o.status === "sent").length, bg: "bg-status-sent/10 dark:bg-status-sent/20", text: "text-status-sent" },
              { status: "completed", label: "Entregados", value: orders.filter((o) => o.status === "completed").length, bg: "bg-muted", text: "text-muted-foreground" },
            ].map((stat) => (
              <button
                key={stat.label}
                type="button"
                onClick={() => {
                  setTab("orders");
                  setOrderStatusFilter(stat.status);
                }}
                className={`rounded-xl ${stat.bg} p-2 text-center transition-all active:scale-[0.96] ${tab === "orders" && orderStatusFilter === stat.status ? "ring-2 ring-primary/40" : ""}`}
              >
                <div className={`text-lg font-bold ${stat.text} tabular-nums animate-count-up`}>{stat.value}</div>
                <p className="text-[8px] sm:text-[9px] text-muted-foreground font-medium">{stat.label}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className={`px-4 mt-4 ${tab === "comanda" ? "w-full max-w-none" : `container mx-auto ${["orders", "pos", "mesas", "analytics"].includes(tab) ? "max-w-7xl" : "max-w-2xl"}`}`}>
        {isService ? (
          <div className="space-y-4">{configContent}</div>
        ) : (
          <>
            <div className={tab === "config" ? "" : "hidden"}>{configContent}</div>
            <div className={tab === "menu" ? "" : "hidden"}>
              <div className="space-y-4">
                <h2 className="font-display text-xl font-semibold">Menú y catálogo</h2>
                {offers.map((offer) => (
                  <Card key={offer.id} className="p-3">
                    <div className="flex items-center gap-3">
                      {offer.image_url ? (
                        <img src={offer.image_url} alt={offer.name} className="h-12 w-12 rounded-lg object-cover flex-shrink-0" />
                      ) : (
                        <div className="h-12 w-12 rounded-lg bg-accent flex items-center justify-center flex-shrink-0"><span className="font-bold text-primary/60">{offer.name.charAt(0)}</span></div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium text-sm truncate">{offer.name}</span>
                          {offer.featured_today && <Badge className="bg-sun/20 text-ink text-[10px] px-1.5 py-0">Hoy</Badge>}
                          {!offer.available && <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Pausado</Badge>}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {offer.promo_price ? (
                            <><span className="line-through">${Number(offer.price).toLocaleString("es-AR")}</span> <span className="text-primary font-medium">${Number(offer.promo_price).toLocaleString("es-AR")}</span></>
                          ) : (
                            <>${Number(offer.price).toLocaleString("es-AR")}</>
                          )}
                          {offer.category && ` · ${offer.category}`}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <Button variant="outline" size="sm" onClick={() => setTab("config")}>Editar</Button>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
            <div className={tab === "orders" ? "" : "hidden"}>{ordersContent}</div>
            {mountedTabs.has("comanda") && (
              <div className={tab === "comanda" ? "" : "hidden"}>
                {effectivePlan.can("kds") ? (
                  accessToken && vendor && (
                    <ComandaKDS vendorId={vendor.id} vendorName={vendor.store_name} accessToken={accessToken} />
                  )
                ) : (
                  <PlanLock
                    title="Comanda para tu cocina"
                    description="Vos y tu cocina ven los pedidos en orden en este plan. Forma parte del plan Gestión integral."
                  />
                )}
              </div>
            )}
            {mountedTabs.has("pos") && (
              <div className={tab === "pos" ? "" : "hidden"}>
                {effectivePlan.can("pos") ? (
                  <Mostrador />
                ) : (
                  <PlanLock
                    title="Mostrador"
                    description={isModa
                      ? "Vas a poder armar ventas y cobrarlas en el local. Lo estamos habilitando para tu rubro."
                      : "Armá pedidos y cobrá en el local con impresión de ticket. Parte del plan Gestión integral."}
                  />
                )}
              </div>
            )}
            {mountedTabs.has("mesas") && (
              <div className={tab === "mesas" ? "" : "hidden"}>
                {effectivePlan.can("mesas") ? (
                  <Mesas />
                ) : (
                  <PlanLock
                    title="Gestión de mesas"
                    description="Abrí, cargá consumiciones y cobrá tus mesas. Parte del plan Gestión integral."
                  />
                )}
              </div>
            )}
            {mountedTabs.has("analytics") && (
              <div className={tab === "analytics" ? "" : "hidden"}>
                <VendorAnalytics />
              </div>
            )}
            {mountedTabs.has("reviews") && (
              <div className={tab === "reviews" ? "" : "hidden"}>
                {effectivePlan.can("reviews_manage") ? (
                  <VendorReviews />
                ) : (
                  <PlanLock
                    title="Respondé tus reseñas"
                    description="Leé las opiniones de tus clientes y respondélas en público. Disponible en los planes de pago."
                  />
                )}
              </div>
            )}
          </>
        )}
      </div>

      <nav className="sm:hidden fixed bottom-0 inset-x-0 bg-card/95 backdrop-blur-sm border-t border-border z-50" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
          <div className="flex">
            <button onClick={() => setTab("orders")} className={`flex-1 flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-medium transition-colors relative ${tab === "orders" ? "text-primary" : "text-muted-foreground"}`}>
              <span className="text-lg">📦</span>Pedidos
              {activeOrders.length > 0 && <span className="absolute top-1 right-1/3 -translate-x-4 bg-red-500 text-white text-[9px] rounded-full h-4 w-4 flex items-center justify-center">{activeOrders.length}</span>}
            </button>
            {!isModa && (
              <button onClick={() => setTab("comanda")} className={`flex-1 flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-medium transition-colors relative ${tab === "comanda" ? "text-primary" : "text-muted-foreground"}`}>
                <span className="text-lg">🍳</span>Comanda
                {orders.filter((o) => o.status === "new" && orderNeedsKitchen(o)).length > 0 && <span className="absolute top-1 right-1/3 -translate-x-4 bg-red-500 text-white text-[9px] rounded-full h-4 w-4 flex items-center justify-center">{orders.filter((o) => o.status === "new" && orderNeedsKitchen(o)).length}</span>}
              </button>
            )}
            <button onClick={() => setTab("pos")} className={`flex-1 flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-medium transition-colors relative ${tab === "pos" ? "text-primary" : "text-muted-foreground"}`}>
              <span className="text-lg">🖥️</span>Mostrador
            </button>
            {!isModa && (
              <button onClick={() => setTab("mesas")} className={`flex-1 flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-medium transition-colors ${tab === "mesas" ? "text-primary" : "text-muted-foreground"}`}>
                <span className="text-lg">🍽️</span>Mesas
              </button>
            )}
            <button onClick={() => setMoreOpen((v) => !v)} className={`flex-1 flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-medium transition-colors ${["config", "menu", "analytics", "reviews"].includes(tab) ? "text-primary" : "text-muted-foreground"}`}>
              <span className="text-lg">{moreOpen ? "✕" : "⋮"}</span>Más
            </button>
          </div>
        </nav>

        {moreOpen && (
          <div className="sm:hidden fixed inset-0 z-40 bg-black/50" onClick={() => setMoreOpen(false)} />
        )}
        {moreOpen && (
          <div className="sm:hidden fixed bottom-0 inset-x-0 z-50 bg-card rounded-t-2xl border-t border-border p-4 pb-[calc(env(safe-area-inset-bottom,0px)+1rem)] shadow-xl">
            <button onClick={() => setMoreOpen(false)} className="mx-auto block w-10 h-1.5 bg-muted rounded-full mb-4" aria-label="Cerrar" />
            <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wide mb-2">Administración</p>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => { setTab("menu"); setMoreOpen(false); }} className={`flex items-center gap-2 p-3 rounded-xl border text-sm font-medium ${tab === "menu" ? "border-primary text-primary bg-primary/5" : "border-border bg-background"}`}>
                <span className="text-lg">{isService ? "🔧" : "🍽️"}</span>{isService ? "Servicios" : "Menú"} ({offers.length})
              </button>
              <button onClick={() => { setTab("config"); setMoreOpen(false); }} className={`flex items-center gap-2 p-3 rounded-xl border text-sm font-medium ${tab === "config" ? "border-primary text-primary bg-primary/5" : "border-border bg-background"}`}>
                <span className="text-lg">⚙️</span>Configuración
              </button>
              <button onClick={() => { setTab("analytics"); setMoreOpen(false); }} className={`flex items-center gap-2 p-3 rounded-xl border text-sm font-medium ${tab === "analytics" ? "border-primary text-primary bg-primary/5" : "border-border bg-background"}`}>
                <span className="text-lg">📊</span>Estadísticas
              </button>
              <button onClick={() => { setTab("reviews"); setMoreOpen(false); }} className={`flex items-center gap-2 p-3 rounded-xl border text-sm font-medium ${tab === "reviews" ? "border-primary text-primary bg-primary/5" : "border-border bg-background"}`}>
                <span className="text-lg">⭐</span>Reseñas
              </button>
            </div>
          </div>
        )}

      {shareOpen && vendor.slug && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setShareOpen(false)}>
          <div className="bg-card rounded-2xl p-6 max-w-sm w-full text-center" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-display text-xl font-semibold mb-1">Compartí tu vidriera</h3>
            <p className="text-sm text-muted-foreground mb-4">El QR lleva directo a tu micrositio.</p>
            {qrDataUrl ? <img src={qrDataUrl} alt="QR" className="mx-auto w-48 h-48 mb-4" /> : <div className="mx-auto w-48 h-48 mb-4 bg-skeleton rounded-lg" />}
            <p className="text-xs text-muted-foreground break-all mb-4">{window.location.origin}/tienda/{vendor.slug}</p>
            <div className="space-y-2">
              <a
                href={`https://wa.me/?text=${encodeURIComponent(
                  `Mirá el menú de ${vendor.store_name} en Portal 659 🛍️\n${window.location.origin}/tienda/${vendor.slug}?menu=1\n\nPedí directo por WhatsApp — 0% comisión`
                )}`}
                target="_blank"
                rel="noopener noreferrer"
                className="block w-full rounded-xl bg-green-500 text-white text-sm font-medium py-2.5 hover:bg-green-600 transition-colors"
              >
                📲 Compartir menú por WhatsApp
              </a>
              <div className="flex gap-2">
                <Button className="flex-1" onClick={copyLink}>{copied ? "¡Copiado!" : "Copiar link"}</Button>
                <Button variant="outline" className="flex-1" onClick={() => setShareOpen(false)}>Cerrar</Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {cropOpen && cropImageSrc && (
        <ImageCropModal imageSrc={cropImageSrc} aspect={cropAspect} title={cropTitle} onCropComplete={handleCropComplete} onCancel={() => { setCropOpen(false); if (cropImageSrc) URL.revokeObjectURL(cropImageSrc); }} />
      )}

      {selectedOrder && (
        <OrderDetailModal
          order={selectedOrder}
          vendorName={vendor?.store_name || ""}
          isModa={isModa}
          onClose={() => setSelectedOrder(null)}
          onAction={(order, status) => updateOrderStatus(order, status)}
          onModify={modifyOrder}
          offers={offers}
          canPrint={effectivePlan.can("printer")}
          transfer={{
            alias: (vendor as any)?.transfer_alias || null,
            cbu: (vendor as any)?.transfer_cbu || null,
            holder: (vendor as any)?.transfer_holder || null,
          }}
          blockUnpaid={!!(vendor as any)?.block_unpaid_orders}
          onMarkPaid={markOrderPaid}
        />
      )}
    </main>
  );
}
