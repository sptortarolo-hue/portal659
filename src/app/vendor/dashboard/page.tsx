"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import QRCode from "qrcode";
import {
  Menu,
  ExternalLink,
  Search,
  AlertTriangle,
  Home,
  Package,
  ChefHat,
  Monitor,
  Table,
  MoreHorizontal,
  X,
  Wrench,
  Shirt,
  Utensils,
  FileText,
  BarChart,
  History,
  Star,
  Banknote,
  MessageSquare,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ImageCropModal } from "@/components/ui/image-crop-modal";
import { DEFAULT_ZONE } from "@/lib/config";
import VendorSidebar from "@/components/vendor/vendor-sidebar";
import { NotificationBell } from "@/components/nav/notification-bell";
import { UserMenu } from "@/components/nav/user-menu";
import { DashboardHome } from "@/components/dashboard/dashboard-home";
import { OrdersKanban } from "@/components/dashboard/orders-kanban";
import { useKeyboardShortcuts } from "@/lib/use-keyboard-shortcuts";
import { buildClientWhatsAppUrl, ORDER_STATUS_COLORS, MODA_STATUS_LABELS, flowSteps, orderCondition, orderReadyLabel, orderNeedsKitchen, CONDITION_META } from "@/lib/order-utils";
import OrderDetailModal from "@/components/dashboard/order-detail-modal";
import DashboardGastro from "@/components/dashboard/dashboard-gastro";
import DashboardComercio from "@/components/dashboard/dashboard-comercio";
import DashboardServicio from "@/components/dashboard/dashboard-servicio";
import DashboardGenerico from "@/components/dashboard/dashboard-generico";
import DashboardModa from "@/components/dashboard/dashboard-moda";
import { VendorAnalytics } from "@/components/dashboard/vendor-analytics";
import { VendorReviews } from "@/components/vendor/vendor-reviews";
import { VendorOrderHistory } from "@/components/dashboard/vendor-order-history";
import { RecipeManager } from "@/components/dashboard/recipe-manager";
import { ProductManager } from "@/components/dashboard/product-manager";
import ComandaKDS from "@/components/dashboard/comanda-kds";
import { playNewOrderSound, resumeAudioContext } from "@/lib/sounds";
import { resolveVendorPlan, daysLeft } from "@/lib/plans";
import { PlanBanner } from "@/components/vendor/plan-banner";
import { PlanLock } from "@/components/vendor/plan-lock";
import { Mostrador } from "@/components/vendor/mostrador";
import { Mesas } from "@/components/vendor/mesas";
import { OpenToggle } from "@/components/vendor/open-toggle";
import { PrepTimeControl } from "@/components/vendor/prep-time-control";
import { PrinterStatus } from "@/components/vendor/printer-status";
import { DeliveryBoard } from "@/components/vendor/delivery-board";
import type { ProductModifier, VendorGallery, Booking, Vertical, Product as DBProduct, Order, ProductVariant, ProductImage, OrderItem, PlanStatus, Plan, Vendor as VendorDB } from "@/types/database";

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
  lat?: number | null;
  lng?: number | null;
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
  const [tab, setTab] = useState<"hoy" | "config" | "menu" | "orders" | "history" | "comanda" | "analytics" | "pos" | "mesas" | "reviews" | "recetas">("hoy");
  // Las pestañas pesadas (fetch propio: comanda, mostrador, mesas, analytics,
  // reviews) se montan recién cuando el usuario las abre por primera vez.
  // Así el arranque del dashboard hace ~12 requests en vez de ~20 y el pool
  // de la DB no se satura (causa del "no se pudo cargar" en Comanda/Mesas).
  const [mountedTabs, setMountedTabs] = useState<Set<string>>(new Set(["hoy", "orders", "menu", "config"]));
  useEffect(() => {
    setMountedTabs((prev) => (prev.has(tab) ? prev : new Set(prev).add(tab)));
  }, [tab]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [plans, setPlans] = useState<Plan[]>([]);
  const [orderUsage, setOrderUsage] = useState<{ ordersThisMonth: number; maxOrdersMonth: number | null }>({
    ordersThisMonth: 0,
    maxOrdersMonth: null,
  });
  const [shareOpen, setShareOpen] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [cropOpen, setCropOpen] = useState(false);
  const [cropImageSrc, setCropImageSrc] = useState<string | null>(null);
  const [cropAspect, setCropAspect] = useState(3 / 1);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [orderSearch, setOrderSearch] = useState("");
  const [orderStatusFilter, setOrderStatusFilter] = useState<string>("all");
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [cropTitle, setCropTitle] = useState("Ajustá tu foto");
  const [cropTarget, setCropTarget] = useState<"cover" | "logo" | "offer">("cover");

  // Keyboard shortcuts: Ctrl+1-9 para tabs, Escape para cerrar modales
  useKeyboardShortcuts({
    onTabChange: (t) => setTab(t),
    onEscape: () => {
      if (selectedOrder) setSelectedOrder(null);
      else if (shareOpen) setShareOpen(false);
      else if (cropOpen) setCropOpen(false);
    },
    enabled: !loading && !!vendor,
  });

  async function uploadImage(file: File, folder: string): Promise<string | null> {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("folder", folder);
    const res = await fetch("/api/vendor/upload", { method: "POST", body: fd });
    const data = await res.json();
    return data.url || null;
  }

  const [ordersLoading, setOrdersLoading] = useState(false);

  async function loadOrdersOnly() {
    setOrdersLoading(true);
    try {
      const res = await fetch("/api/vendor/orders");
      const data = await res.json();
      if (data.orders) setOrders(data.orders);
    } catch { /* noop */ }
    finally {
      setOrdersLoading(false);
    }
  }

  async function loadData() {
    try {
      const [meRes, offersRes, ordersRes, catsRes, modsRes, galRes, bkRes, variantsRes, imagesRes, plansRes, subsMeRes] = await Promise.all([
        fetch("/api/vendor/me").catch(() => null),
        fetch("/api/vendor/offers").catch(() => null),
        fetch("/api/vendor/orders").catch(() => null),
        fetch("/api/vendor/categories").catch(() => null),
        fetch("/api/vendor/modifiers").catch(() => null),
        fetch("/api/vendor/gallery").catch(() => null),
        fetch("/api/vendor/bookings").catch(() => null),
        fetch("/api/vendor/variants").catch(() => null),
        fetch("/api/vendor/product-images").catch(() => null),
        fetch("/api/subscriptions/plans").catch(() => null),
        fetch("/api/subscriptions/me").catch(() => null),
      ]);

      const me = meRes?.ok ? await meRes.json().catch(() => ({})) : (meRes?.status === 401 ? { error: "No autenticado" } : {});
      const off = offersRes?.ok ? await offersRes.json().catch(() => ({})) : {};
      const ord = ordersRes?.ok ? await ordersRes.json().catch(() => ({})) : {};
      const cats = catsRes?.ok ? await catsRes.json().catch(() => ({})) : {};
      const mods = modsRes?.ok ? await modsRes.json().catch(() => ({})) : {};
      const gal = galRes?.ok ? await galRes.json().catch(() => ({})) : {};
      const bk = bkRes?.ok ? await bkRes.json().catch(() => ({})) : {};
      const varData = variantsRes?.ok ? await variantsRes.json().catch(() => ({})) : {};
      const imagesData = imagesRes?.ok ? await imagesRes.json().catch(() => ({})) : {};
      const plansData = plansRes?.ok ? await plansRes.json().catch(() => ({})) : {};
      const subsMeData = subsMeRes?.ok ? await subsMeRes.json().catch(() => ({})) : {};

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
      if (subsMeData.usage) {
        setOrderUsage({
          ordersThisMonth: subsMeData.usage.ordersThisMonth ?? 0,
          maxOrdersMonth: subsMeData.usage.maxOrdersMonth ?? null,
        });
      }
    } catch (err) {
      console.error("[dashboard] loadData error:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (impersonatingId) {
      // Setear la cookie ANTES de cargar, para que los endpoints /api/vendor/* resuelvan el comercio impersonado.
      document.cookie = `portal659-admin-as=${impersonatingId}; path=/; max-age=7200; samesite=lax`;
    }
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [impersonatingId]);

  // Vuelta del OAuth de Mercado Pago: mostrar feedback al comercio y limpiar la URL.
  useEffect(() => {
    if (!searchParams) return;
    const mp = searchParams.get("mp");
    if (!mp) return;
    if (mp === "connected") {
      setMsg("✅ Mercado Pago conectado — los cobros online ahora entran directo a tu cuenta");
    } else if (mp === "error") {
      setMsg("❌ No se pudo conectar Mercado Pago. Probá de nuevo desde la sección de pagos.");
    }
    const url = new URL(window.location.href);
    url.searchParams.delete("mp");
    url.searchParams.delete("reason");
    window.history.replaceState({}, "", url.toString());
  }, [searchParams]);

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
  }, [vendor?.id]);

  // Ids ya vistos: para detectar pedidos nuevos que llegan por SSE y sonar.
  const seenOrderIds = useRef<Set<string>>(new Set());
  useEffect(() => {
    seenOrderIds.current = new Set(orders.map((o) => o.id));
  }, [orders]);

  // Backstop: si el SSE muere en silencio, recargar al volver a la pestaña.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") loadOrdersOnly();
    };
    const onFocus = () => loadOrdersOnly();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  // SSE: pedidos en tiempo real
  useEffect(() => {
    if (!vendor?.id) return;
    let closed = false;
    let es: EventSource | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout>;
    let retryCount = 0;

    function connect() {
      es = new EventSource("/api/vendor/orders/stream");
      es.onopen = () => { retryCount = 0; };
      es.onmessage = (event) => {
        if (closed) return;
        try {
          const data = JSON.parse(event.data);
          if (data.type === "orders_update" && Array.isArray(data.orders)) {
            const incoming = data.orders as Order[];
            const hasFreshNew = incoming.some(
              (o) => o.status === "new" && !seenOrderIds.current.has(o.id)
            );
            if (hasFreshNew) {
              resumeAudioContext();
              playNewOrderSound();
            }
            setOrders((prev) => {
              const map = new Map(prev.map((o) => [o.id, o]));
              for (const order of incoming) {
                map.set(order.id, order);
              }
              return Array.from(map.values()).sort(
                (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
              );
            });
          }
        } catch { /* keepalive comment, ignore */ }
      };
      es.onerror = () => {
        if (closed) return;
        es?.close();
        es = null;
        const delay = Math.min(1000 * Math.pow(2, retryCount), 30000);
        retryCount++;
        reconnectTimeout = setTimeout(connect, delay);
      };
    }

    connect();

    return () => {
      closed = true;
      es?.close();
      clearTimeout(reconnectTimeout);
    };
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
      // Gastronomía estima minutos de cocina desde la demora configurada (sin hardcodeo);
      // moda no maneja tiempos en minutos.
      if (status === "preparing" && !isModa) {
        payload.estimated_minutes = (vendor?.prep_time_min ?? 30) || 30;
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
      setMsg(`Pedido Nro. ${order.pickup_number ?? order.id.slice(0, 8)} → ${statusLabels[status]}`);
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
      setMsg(`Pago confirmado · Nro. ${orders.find((o) => o.id === orderId)?.pickup_number ?? orderId.slice(0, 8)}`);
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
      const total = Number(data.order?.total ?? items.reduce((sum, item) => sum + item.price * item.qty, 0));
      // El server devuelve items/total recalculados: usar esos (precios DB, no locales).
      const resolvedItems = (data.order?.items as OrderItem[] | undefined) ?? items;
      const resolvedNotes = (data.order?.modification_notes as string | null | undefined) ?? modificationNotes;
      setMsg(`Pedido ${orders.find((o) => o.id === orderId)?.pickup_number != null ? `Nro. ${orders.find((o) => o.id === orderId)?.pickup_number}` : `#${orderId.slice(0, 8)}`} modificado`);
      setOrders((prev) =>
        prev.map((o) =>
          o.id === orderId ? { ...o, items: resolvedItems, modification_notes: resolvedNotes ?? null, total } : o
        )
      );
      setSelectedOrder((prev) =>
        prev && prev.id === orderId ? { ...prev, items: resolvedItems, modification_notes: resolvedNotes ?? null, total } : prev
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
    ordersThisMonth: orderUsage.ordersThisMonth,
    maxOrdersMonth: orderUsage.maxOrdersMonth,
    ordersOverLimit:
      orderUsage.maxOrdersMonth != null && orderUsage.ordersThisMonth >= orderUsage.maxOrdersMonth,
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
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm h-4 w-4" />
      </div>

      {/* Purga de pedidos de prueba */}
      {orders.some((o) => o.is_preview) && (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2">
          <p className="text-xs font-medium text-violet-700">
            🧪 Tenés {orders.filter((o) => o.is_preview).length} pedido{orders.filter((o) => o.is_preview).length === 1 ? "" : "s"} de prueba
          </p>
          <button
            type="button"
            onClick={async () => {
              if (!window.confirm("¿Borrar todos los pedidos de prueba? Se repone el stock reservado.")) return;
              const ids = orders.filter((o) => o.is_preview).map((o) => o.id);
              for (const id of ids) {
                try {
                  await fetch(`/api/vendor/orders/${id}`, { method: "DELETE" });
                } catch { /* noop */ }
              }
              loadOrdersOnly();
            }}
            className="text-xs font-semibold text-violet-700 underline hover:text-violet-900 flex-shrink-0"
          >
            Borrar pruebas
          </button>
        </div>
      )}

      {/* Desktop: Kanban board */}
      <div className="hidden lg:block">
        <OrdersKanban
          orders={filteredOrders}
          isModa={isModa}
          selectedOrder={selectedOrder}
          onSelectOrder={setSelectedOrder}
          onRefresh={loadOrdersOnly}
          isLoading={ordersLoading}
        />
      </div>

      {/* Mobile: Grid list */}
      <div className="lg:hidden">
        {ordersLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="p-3.5 rounded-xl border border-skeleton bg-skeleton animate-pulse" />
            ))}
          </div>
        ) : filteredOrders.length === 0 && orders.length > 0 ? (
          <div className="text-center py-12">
            <Search className="text-4xl mb-3 text-muted-foreground mx-auto" />
            <p className="text-muted-foreground text-sm">No se encontraron pedidos</p>
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="text-center py-16">
            <Package className="text-4xl mb-3 text-muted-foreground mx-auto" />
            <p className="text-muted-foreground font-medium">Todavía no recibiste pedidos</p>
            <p className="text-xs text-muted-foreground mt-1">Los pedidos aparecerán cuando un cliente compre</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {filteredOrders.map((order) => {
              const statusIdx = stepOrder.indexOf(order.status as any);
              const isCancelled = order.status === "cancelled";
              const isCompleted = order.status === "completed";
              const isTerminal = isCancelled || isCompleted;
              const endMs = isTerminal && order.closed_at ? new Date(order.closed_at).getTime() : Date.now();
              const elapsed = Math.floor((endMs - new Date(order.created_at).getTime()) / 60000);
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
                        {order.is_preview && (
                          <span className="inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded-full border bg-violet-100 text-violet-700 border-violet-200">
                            🧪 PRUEBA
                          </span>
                        )}
                        {order.pickup_number != null && (
                          <span className="inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-status-new/15 text-status-new border-status-new/20">
                            Nro. {order.pickup_number}
                          </span>
                        )}
                        {order.payment_method === "transferencia" && order.channel === "app" && order.payment_status === "pending" && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-amber-100 text-amber-700 border-amber-200">
                            <AlertTriangle className="h-2.5 w-2.5" /> Pago pendiente
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
                      <p className="text-[10px] text-muted-foreground/50">+{order.items.length - 2} más</p>
                    )}
                  </div>

                  {/* Footer */}
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                    <span>
                      {order.payment_method === "efectivo" && <Banknote className="mr-1 h-3 w-3" />}
                      {order.payment_method === "transferencia" && <Banknote className="mr-1 h-3 w-3" />}
                      {order.payment_method === "whatsapp" && <MessageSquare className="mr-1 h-3 w-3" />}
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
                            <MessageSquare className="h-3.5 w-3.5" />
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
    </div>
  );

  const kitchenCount = orders.filter((o) => o.status === "new" && orderNeedsKitchen(o)).length;
  const activeOrderCount = activeOrders.length;
  const menuCount = offers.length;

  const tabTitle =
    tab === "menu" ? (isModa ? "Catálogo" : "Menú")
    : tab === "hoy" ? "Hoy"
    : tab === "orders" ? "Pedidos"
    : tab === "comanda" ? "Comanda"
    : tab === "pos" ? "Mostrador"
    : tab === "mesas" ? "Mesas"
    : tab === "recetas" ? "Recetas"
    : tab === "analytics" ? "Estadísticas"
    : tab === "history" ? "Histórico"
    : tab === "reviews" ? "Reseñas"
    : "Configuración";

  const todayLabel = new Date().toLocaleDateString("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <div className="min-h-screen bg-background flex">
      {/* Sidebar — desktop: always visible; mobile: slide-in */}
      <VendorSidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        currentTab={tab}
        onTabChange={(t) => setTab(t)}
        orderCount={activeOrderCount}
        kitchenCount={kitchenCount}
        menuCount={menuCount}
        storeName={vendor.store_name}
        storeLogo={vendor.logo_url || vendor.image_url || null}
        storeSlug={vendor.slug}
        isGastro={isGastro}
        isModa={isModa}
        planName={effectivePlan.plan?.name ?? null}
        planSlug={effectivePlan.plan?.slug ?? null}
      />

      {/* Content area */}
      <div className="flex-1 flex flex-col min-h-screen lg:ml-64">
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

        {/* Sticky header: 2 filas en mobile, 1 en desktop */}
        <div className="sticky top-0 z-30 bg-background/95 backdrop-blur-sm border-b border-border">
          <div className="px-3 sm:px-4 py-2 sm:py-2.5">
            {/* Fila 1: menú + título + compartir (+ controles en desktop) */}
            <div className="flex items-center gap-2 sm:gap-3">
              {/* Mobile hamburger */}
              <button
                onClick={() => setSidebarOpen(true)}
                className="p-2 rounded-lg hover:bg-muted transition-colors lg:hidden flex-shrink-0"
                aria-label="Abrir menú"
              >
                <Menu className="h-5 w-5" />
              </button>

              {/* Título de sección + contexto */}
              <div className="flex-1 min-w-[104px] sm:min-w-0">
                <h1 className="text-sm font-semibold truncate leading-tight">{tabTitle}</h1>
                <p className="text-[11px] text-muted-foreground leading-tight truncate">
                  {vendor.store_name} · {todayLabel}
                </p>
              </div>

              {/* Controles operativos: inline en desktop, en fila 2 en mobile */}
              <span className="hidden sm:contents">
                <OpenToggle vendor={vendor} onSaved={(v) => setVendor(v)} />
                {isGastro && (
                  <>
                    <PrepTimeControl vendor={vendor} onSaved={(v) => setVendor(v)} />
                    <PrinterStatus vendor={vendor} onOpenConfig={() => {
                      setTab("config");
                      window.dispatchEvent(new Event("portal:open-printer-config"));
                      window.setTimeout(() => {
                        document.getElementById("printer-config")?.scrollIntoView({ behavior: "smooth", block: "start" });
                      }, 120);
                    }} />
                  </>
                )}
              </span>
              {vendor.slug && (
                <a
                  href={`/tienda/${vendor.slug}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hidden xl:inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted transition-colors flex-shrink-0"
                >
                  <ExternalLink className="h-3.5 w-3.5" /> Micrositio
                </a>
              )}
              <Button size="sm" onClick={openShare} className="flex-shrink-0">Compartir</Button>
              <div className="hidden lg:flex items-center gap-1 flex-shrink-0">
                <NotificationBell />
                <UserMenu />
              </div>
            </div>

            {/* Fila 2: controles operativos — solo mobile */}
            <div className="sm:hidden flex items-center gap-2 overflow-x-auto pt-2">
              <OpenToggle vendor={vendor} onSaved={(v) => setVendor(v)} />
              {isGastro && (
                <>
                  <PrepTimeControl vendor={vendor} onSaved={(v) => setVendor(v)} />
                  <PrinterStatus vendor={vendor} onOpenConfig={() => {
                    setTab("config");
                    window.dispatchEvent(new Event("portal:open-printer-config"));
                    window.setTimeout(() => {
                      document.getElementById("printer-config")?.scrollIntoView({ behavior: "smooth", block: "start" });
                    }, 120);
                  }} />
                </>
              )}
            </div>
          </div>
        </div>

        {msg && <div className="px-4 pt-3"><p className="text-sm text-green-600 bg-green-50 rounded-lg px-3 py-2">{msg}</p></div>}

        {/* Banner de suscripción — solo en Hoy */}
        {tab === "hoy" && <PlanBanner plan={planBannerData as any} />}

        {/* Stats bar — solo en tab de pedidos */}
        {tab === "orders" && orders.length > 0 && (
          <div className="px-4 mt-4">
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

        {/* Tab content */}
        <div className={`flex-1 px-4 mt-4 ${tab === "comanda" ? "w-full max-w-none" : `mx-auto w-full ${["orders", "history", "pos", "mesas", "analytics", "recetas", "hoy"].includes(tab) ? "max-w-7xl" : "max-w-4xl"}`}`}>
          {isService ? (
            <div className="space-y-4">{configContent}</div>
          ) : (
            <>
              <div className={tab === "config" ? "" : "hidden"}>{configContent}</div>
              <div className={tab === "menu" ? "" : "hidden"}>
                <ProductManager
                  isModa={isModa}
                  showStock
                  showPrep={!isModa}
                  showCosts={isGastro}
                  onChanged={() => loadData()}
                />
              </div>
              <div className={tab === "orders" ? "" : "hidden"}>{ordersContent}</div>
              {mountedTabs.has("comanda") && (
                <div className={tab === "comanda" ? "" : "hidden"}>
                  {effectivePlan.can("kds") ? (
                    accessToken && vendor && (
                      <ComandaKDS vendorId={vendor.id} vendorName={vendor.store_name} accessToken={accessToken} prepTimeMin={vendor.prep_time_min ?? null} />
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
              {mountedTabs.has("recetas") && (
                <div className={tab === "recetas" ? "" : "hidden"}>
                  {isGastro && effectivePlan.can("recipes") ? (
                    <RecipeManager />
                  ) : (
                    <PlanLock
                      title="Recetas y costos"
                      description="Cargá insumos con su merma, armá la receta de cada plato y conocé tu costo real y food cost. Parte del plan Gestión integral."
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
              {mountedTabs.has("history") && (
                <div className={tab === "history" ? "" : "hidden"}>
                  <VendorOrderHistory isModa={isModa} />
                </div>
              )}
              {mountedTabs.has("hoy") && (
                <div className={tab === "hoy" ? "" : "hidden"}>
                  <DashboardHome
                    vendor={vendor as unknown as VendorDB}
                    isGastro={isGastro}
                    isModa={isModa}
                    isService={isService}
                    orders={orders}
                    bookings={bookings}
                    offerCount={offers.length}
                    can={effectivePlan.can}
                    onNavigate={(t) => setTab(t)}
                    onShare={openShare}
                    onOpenOrder={(o) => setSelectedOrder(o)}
                    onChanged={loadData}
                  />
                </div>
              )}
            </>
          )}
        </div>

        {/* Mobile bottom nav */}
        <nav className="lg:hidden fixed bottom-0 inset-x-0 bg-card/95 backdrop-blur-sm border-t border-border z-50" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
          <div className="flex">
            <button onClick={() => setTab("hoy")} className={`flex-1 flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-medium transition-colors relative ${tab === "hoy" ? "text-primary" : "text-muted-foreground"}`}>
              <Home className="h-5 w-5" />Hoy
            </button>
            <button onClick={() => setTab("orders")} className={`flex-1 flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-medium transition-colors relative ${tab === "orders" ? "text-primary" : "text-muted-foreground"}`}>
              <Package className="h-5 w-5" />Pedidos
              {activeOrderCount > 0 && <span className="absolute top-1 right-1/3 -translate-x-4 bg-red-500 text-white text-[9px] rounded-full h-4 w-4 flex items-center justify-center">{activeOrderCount}</span>}
            </button>
            {!isModa && (
              <button onClick={() => setTab("comanda")} className={`flex-1 flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-medium transition-colors relative ${tab === "comanda" ? "text-primary" : "text-muted-foreground"}`}>
                <ChefHat className="h-5 w-5" />Comanda
                {kitchenCount > 0 && <span className="absolute top-1 right-1/3 -translate-x-4 bg-red-500 text-white text-[9px] rounded-full h-4 w-4 flex items-center justify-center">{kitchenCount}</span>}
              </button>
            )}
            <button onClick={() => setTab("pos")} className={`flex-1 flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-medium transition-colors relative ${tab === "pos" ? "text-primary" : "text-muted-foreground"}`}>
              <Monitor className="h-5 w-5" />Mostrador
            </button>
            {!isModa && (
              <button onClick={() => setTab("mesas")} className={`flex-1 flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-medium transition-colors ${tab === "mesas" ? "text-primary" : "text-muted-foreground"}`}>
                <Table className="h-5 w-5" />Mesas
              </button>
            )}
            <button onClick={() => setMoreOpen((v) => !v)} className={`flex-1 flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-medium transition-colors ${["config", "menu", "analytics", "history", "reviews", "recetas"].includes(tab) ? "text-primary" : "text-muted-foreground"}`}>
              <span className="text-lg">{moreOpen ? <X className="h-5 w-5" /> : <MoreHorizontal className="h-5 w-5" />}</span>Más
            </button>
          </div>
        </nav>

        {moreOpen && (
          <div className="lg:hidden fixed inset-0 z-40 bg-black/50" onClick={() => setMoreOpen(false)} />
        )}
        {moreOpen && (
          <div className="lg:hidden fixed bottom-0 inset-x-0 z-50 bg-card rounded-t-2xl border-t border-border p-4 pb-[calc(env(safe-area-inset-bottom,0px)+1rem)] shadow-xl">
            <button onClick={() => setMoreOpen(false)} className="mx-auto block w-10 h-1.5 bg-muted rounded-full mb-4" aria-label="Cerrar" />
            <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wide mb-2">Administración</p>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => { setTab("menu"); setMoreOpen(false); }} className={`flex items-center gap-2 p-3 rounded-xl border text-sm font-medium ${tab === "menu" ? "border-primary text-primary bg-primary/5" : "border-border bg-background"}`}>
                {isService ? <Wrench className="h-5 w-5" /> : isModa ? <Shirt className="h-5 w-5" /> : <Utensils className="h-5 w-5" />}
                {isService ? "Servicios" : isModa ? "Catálogo" : "Menú"} ({menuCount})
              </button>
              {isGastro && (
                <button onClick={() => { setTab("recetas"); setMoreOpen(false); }} className={`flex items-center gap-2 p-3 rounded-xl border text-sm font-medium ${tab === "recetas" ? "border-primary text-primary bg-primary/5" : "border-border bg-background"}`}>
                  <FileText className="h-5 w-5" />Recetas
                </button>
              )}
              <button onClick={() => { setTab("config"); setMoreOpen(false); }} className={`flex items-center gap-2 p-3 rounded-xl border text-sm font-medium ${tab === "config" ? "border-primary text-primary bg-primary/5" : "border-border bg-background"}`}>
                <Wrench className="h-5 w-5" />Configuración
              </button>
              <button onClick={() => { setTab("analytics"); setMoreOpen(false); }} className={`flex items-center gap-2 p-3 rounded-xl border text-sm font-medium ${tab === "analytics" ? "border-primary text-primary bg-primary/5" : "border-border bg-background"}`}>
                <BarChart className="h-5 w-5" />Estadísticas
              </button>
              <button onClick={() => { setTab("history"); setMoreOpen(false); }} className={`flex items-center gap-2 p-3 rounded-xl border text-sm font-medium ${tab === "history" ? "border-primary text-primary bg-primary/5" : "border-border bg-background"}`}>
                <History className="h-5 w-5" />Histórico de pedidos
              </button>
              <button onClick={() => { setTab("reviews"); setMoreOpen(false); }} className={`flex items-center gap-2 p-3 rounded-xl border text-sm font-medium ${tab === "reviews" ? "border-primary text-primary bg-primary/5" : "border-border bg-background"}`}>
                <Star className="h-5 w-5" />Reseñas
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Modals (outside layout flow) */}
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
                  `Mirá el ${isModa ? "catálogo" : "menú"} de ${vendor.store_name} en Portal 659 🛍️\n${window.location.origin}/tienda/${vendor.slug}?menu=1\n\nPedí directo por WhatsApp — 0% comisión`
                )}`}
                target="_blank"
                rel="noopener noreferrer"
                className="block w-full rounded-xl bg-green-500 text-white text-sm font-medium py-2.5 hover:bg-green-600 transition-colors"
              >
                📲 {isModa ? "Compartir tienda" : "Compartir menú"}
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
    </div>
  );
}
