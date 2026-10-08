"use client";

import { useState, useEffect } from "react";
import { LivePreview } from "@/components/dashboard/shared";
import { HoursEditor } from "@/components/dashboard/hours-editor";
import { GalleryManager } from "@/components/dashboard/gallery-manager";
import { LocationPicker } from "./location-picker";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { ConfigSaveBar, ConfigSection, ConfigSections } from "@/components/dashboard/config-sections";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MpConnectCard } from "@/components/dashboard/mp-connect-card";
import { StripeConnectCard } from "@/components/dashboard/stripe-connect-card";
import { VendorReviews } from "@/components/vendor/vendor-reviews";
import { CustomersManager } from "@/components/dashboard/customers-manager";
import { PromosSection } from "@/components/dashboard/promos-section";
import { CartaQrSection } from "@/components/dashboard/carta-qr-section";
import { PlanLock } from "@/components/vendor/plan-lock";
import { QuoteManualModal } from "@/components/dashboard/quote-manual-modal";
import { BookingManualModal } from "@/components/dashboard/booking-manual-modal";
import { EsteticaWaitlistManager, type WaitEntry } from "@/components/dashboard/estetica-managers";
import { StaffManager } from "@/components/vendor/staff-manager";
import type { Vendor, Product, ProductModifier, Booking, VendorGallery } from "@/types/database";

type Props = {
  vendor: Vendor | null;
  offers: Product[];
  categories: { id: string; name: string; position: number }[];
  modifiers: ProductModifier[];
  bookings: Booking[];
  gallery: VendorGallery[];
  msg: string;
  setMsg: (m: string) => void;
  reload: () => void;
  saveVendor: (data: Record<string, unknown>) => Promise<void>;
  uploading: boolean;
  onCrop: (target: "cover" | "logo" | "offer", src?: string) => void;
  /** Sub-vista a mostrar (el dashboard switchea por tab). Sin section = todo (legacy). */
  section?: "hoy" | "presupuestos" | "turnos" | "cobros" | "ficha" | "reviews" | "history" | "clientes" | "galeria";
  /** Navegación a otra sub-vista (botones del Hoy). */
  onNavigate?: (section: "orders" | "pos" | "caja" | "config" | "pedidos" | "clientes") => void;
  /** Pedidos de productos (solo estética los muestra en el Hoy). */
  orders?: Record<string, unknown>[];
  /** Vertical estética: el Hoy suma pedidos de productos. */
  isEstetica?: boolean;  /** Datos lifteados desde el dashboard (badges + refresco único). Si faltan, se fetchean acá. */
  quotes?: Record<string, unknown>[];
  quota?: { used: number; limit: number | null } | null;
  canQuotePrice?: boolean;
  canDeposits?: boolean;
  /** El plan permite libro de clientes (Oficios). Sin esto, tab Clientes muestra PlanLock. */
  canCrm?: boolean;
  onQuotesChanged?: () => void;
  configSectionId?: string;
  onConfigSectionId?: (id: string) => void;
};

const BOOKING_STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-700",
  confirmed: "bg-green-100 text-green-700",
  cancelled: "bg-red-100 text-red-700",
  noshow: "bg-orange-100 text-orange-700",
};

const BOOKING_STATUS_LABELS: Record<string, string> = {
  pending: "Pendiente",
  confirmed: "Confirmado",
  cancelled: "Cancelado",
  noshow: "Ausente",
};

function waLinkFor(phone: unknown): string | null {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits ? `https://wa.me/${digits}` : null;
}

/** Vista Hoy: pendientes que necesitan respuesta + próximos turnos + accesos. */
function ServicioHoy({
  quotes,
  bookings,
  orders,
  isEstetica = false,
  onNavigate,
}: {
  quotes: Record<string, unknown>[];
  bookings: Booking[];
  /** Pedidos de productos (estética): se muestran como pendientes. */
  orders?: Record<string, unknown>[];
  isEstetica?: boolean;
  onNavigate?: (section: "orders" | "pos" | "caja" | "config" | "pedidos") => void;
}) {
  const presupuestosLow = isEstetica ? "consultas" : "presupuestos";
  const presupuestosLabel = isEstetica ? "Consultas" : "Presupuestos";
  const pendingQuotes = (quotes || []).filter((q) => q.status === "pending" || q.status === "responded");
  const pendingBookings = (bookings || []).filter((b: any) => b.status === "pending");
  const newOrders = (orders || []).filter((o: any) =>
    ["new", "preparing", "ready", "sent"].includes(String(o.status)) && String(o.channel || "app") === "app" && !o.is_preview
  );
  const upcoming = (bookings || [])
    .filter((b: any) => b.status === "confirmed" && b.booking_date)
    .sort((a: any, b: any) => String(a.booking_date).localeCompare(String(b.booking_date)) || String(a.booking_time || "").localeCompare(String(b.booking_time || "")))
    .slice(0, 3);
  const paidThisMonth = (quotes || [])
    .filter((q) => q.deposit_status === "paid" && q.deposit_amount != null)
    .reduce((s, q) => s + Number(q.deposit_amount), 0)
    // Señas de turnos pagadas (MP o Stripe).
    + (bookings || [])
      .filter((b: any) => b.deposit_status === "paid" && b.deposit_amount != null)
      .reduce((s, b: any) => s + Number(b.deposit_amount), 0);

  if (pendingQuotes.length === 0 && pendingBookings.length === 0 && upcoming.length === 0 && newOrders.length === 0) {
    return (
      <Card className="p-6 text-center">
        <p className="text-3xl mb-2">☀️</p>
        <p className="font-medium text-sm">Sin pendientes. Buen momento para compartir tu vidriera.</p>
        <p className="text-xs text-muted-foreground mt-1">Los {presupuestosLow}, turnos y pedidos nuevos aparecen acá con aviso.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {paidThisMonth > 0 && (
        <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          💰 Señas cobradas: <strong>${paidThisMonth.toLocaleString("es-AR")}</strong>
        </div>
      )}
      {newOrders.length > 0 && (
        <Card className="p-3">
          <div className="flex items-center justify-between mb-2">
            <p className="font-medium text-sm">🛍️ Pedidos de productos ({newOrders.length})</p>
            {onNavigate && (
              <button type="button" onClick={() => onNavigate("pedidos")} className="text-xs text-primary font-medium hover:underline">
                Ver todos →
              </button>
            )}
          </div>
          <div className="space-y-1.5">
            {newOrders.slice(0, 3).map((o: any) => (
              <div key={o.id} className="flex items-center gap-2 text-xs rounded-lg bg-muted px-2.5 py-2">
                <span className="flex-1 min-w-0 truncate">
                  <strong>{o.customer_name}</strong>
                  {` · $${Number(o.total || 0).toLocaleString("es-AR")}`}
                </span>
                {onNavigate && (
                  <button type="button" onClick={() => onNavigate("pedidos")} className="text-primary font-medium flex-shrink-0">Ver →</button>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}
      {pendingQuotes.length > 0 && (
        <Card className="p-3">
          <div className="flex items-center justify-between mb-2">
            <p className="font-medium text-sm">💬 {presupuestosLabel} por responder ({pendingQuotes.length})</p>
            {onNavigate && (
              <button type="button" onClick={() => onNavigate("orders")} className="text-xs text-primary font-medium hover:underline">
                Ver todos →
              </button>
            )}
          </div>
          <div className="space-y-1.5">
            {pendingQuotes.slice(0, 3).map((q: any) => (
              <div key={q.id} className="flex items-center gap-2 text-xs rounded-lg bg-muted px-2.5 py-2">
                <span className="flex-1 min-w-0 truncate">
                  <strong>{q.customer_name}</strong>
                  {q.service_name ? ` · ${q.service_name}` : ""} — <span className="text-muted-foreground">{String(q.description || "").slice(0, 60)}</span>
                </span>
                {waLinkFor(q.customer_phone) && (
                  <a href={waLinkFor(q.customer_phone)!} target="_blank" rel="noopener noreferrer" className="text-green-600 font-medium flex-shrink-0">📲</a>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}
      {pendingBookings.length > 0 && (
        <Card className="p-3">
          <div className="flex items-center justify-between mb-2">
            <p className="font-medium text-sm">📅 Turnos por confirmar ({pendingBookings.length})</p>
            {onNavigate && (
              <button type="button" onClick={() => onNavigate("pos")} className="text-xs text-primary font-medium hover:underline">
                Ver agenda →
              </button>
            )}
          </div>
          <div className="space-y-1.5">
            {pendingBookings.slice(0, 3).map((b: any) => (
              <div key={b.id} className="flex items-center gap-2 text-xs rounded-lg bg-muted px-2.5 py-2">
                <span className="flex-1 min-w-0 truncate">
                  <strong>{b.customer_name || "Sin nombre"}</strong> · {b.booking_date} {b.booking_time || ""}
                </span>
                {waLinkFor(b.customer_phone) && (
                  <a href={waLinkFor(b.customer_phone)!} target="_blank" rel="noopener noreferrer" className="text-green-600 font-medium flex-shrink-0">📲</a>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}
      {upcoming.length > 0 && (
        <Card className="p-3">
          <p className="font-medium text-sm mb-2">🗓️ Próximos turnos</p>
          <div className="space-y-1.5">
            {upcoming.map((b: any) => (
              <div key={b.id} className="flex items-center gap-2 text-xs rounded-lg border border-border px-2.5 py-2">
                <span className="flex-1 min-w-0 truncate">
                  <strong>{b.customer_name || "Sin nombre"}</strong> · {b.booking_date} {b.booking_time || ""}
                </span>
                {waLinkFor(b.customer_phone) && (
                  <a href={waLinkFor(b.customer_phone)!} target="_blank" rel="noopener noreferrer" className="text-green-600 font-medium flex-shrink-0">📲</a>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

/** Vista Historial: trabajos terminados y descartados (derivado, sin API nueva). */
function ServicioHistorial({
  quotes,
  bookings,
  isEstetica = false,
}: {
  quotes: Record<string, unknown>[];
  bookings: Booking[];
  isEstetica?: boolean;
}) {
  const doneQuotes = (quotes || []).filter((q) => q.status === "accepted" || q.status === "cancelled");
  const doneBookings = (bookings || []).filter((b: any) => {
    if (b.status === "cancelled") return true;
    if (b.status !== "confirmed" || !b.booking_date) return false;
    return b.booking_date < new Date().toISOString().slice(0, 10);
  });
  if (doneQuotes.length === 0 && doneBookings.length === 0) {
    return (
      <Card className="p-6 text-center">
        <p className="text-sm text-muted-foreground">Todavía no hay trabajos terminados. Aparecen acá cuando aceptás {isEstetica ? "una consulta" : "un presupuesto"} o pasa un turno confirmado.</p>
      </Card>
    );
  }
  return (
    <div className="space-y-2">
      {doneQuotes.map((q: any) => (
        <Card key={`q-${q.id}`} className="p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-medium text-sm truncate">💬 {q.customer_name}{q.service_name ? ` · ${q.service_name}` : ""}</p>
              <p className="text-xs text-muted-foreground truncate">{String(q.description || "").slice(0, 80)}</p>
              {q.quoted_price != null && (
                <p className="text-xs mt-0.5">💰 ${Number(q.quoted_price).toLocaleString("es-AR")}{q.deposit_status === "paid" ? " · seña pagada ✅" : ""}</p>
              )}
            </div>
            <Badge className={`flex-shrink-0 ${q.status === "accepted" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"}`}>
              {q.status === "accepted" ? "Aceptado" : "Descartado"}
            </Badge>
          </div>
        </Card>
      ))}
      {doneBookings.map((b: any) => (
        <Card key={`b-${b.id}`} className="p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-medium text-sm truncate">📅 {b.customer_name || "Sin nombre"} · {b.booking_date} {b.booking_time || ""}</p>
              {(b.product_label || b.product_name) && (
                <p className="text-xs text-muted-foreground truncate">{b.product_label || b.product_name}</p>
              )}
              {(b.service_label || b.staff_label || b.location_label) && (
                <p className="text-xs text-muted-foreground truncate">
                  {[b.service_label, b.staff_label, b.location_label].filter(Boolean).join(" · ")}
                </p>
              )}
            </div>
            <Badge className={`flex-shrink-0 ${b.status === "confirmed" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"}`}>
              {b.status === "confirmed" ? "Realizado" : "Cancelado"}
            </Badge>
          </div>
        </Card>
      ))}
    </div>
  );
}

export default function DashboardServicio({
  vendor,
  offers,
  categories,
  modifiers,
  bookings,
  gallery,
  msg,
  setMsg,
  reload,
  saveVendor,
  uploading,
  onCrop,
  section,
  onNavigate,
  quotes: quotesProp,
  quota: quotaProp,
  canQuotePrice: canQuotePriceProp,
  canDeposits: canDepositsProp,
  canCrm = false,
  onQuotesChanged,
  orders: ordersProp = [],
  configSectionId,
  onConfigSectionId,
}: Props) {
  const [saving, setSaving] = useState(false);
  // Sin section se muestra todo (legacy); con section, solo esa sub-vista.
  const sec = section ?? "all";
  // Estética opera sobre este mismo panel (turnera + consultas) y suma
  // catálogo de servicios, profesionales y política de cancelación.
  const isEstetica = vendor?.vertical === "estetica";
  // Copy: en estética los "presupuestos" son consultas/evaluaciones.
  const presupuestosLabel = isEstetica ? "Consultas" : "Presupuestos";
  const presupuestosLow = isEstetica ? "consultas" : "presupuestos";
  const presupuestoOne = isEstetica ? "consulta" : "presupuesto";
  const [storeName, setStoreName] = useState(vendor?.store_name || "");
  const [storeVertical, setStoreVertical] = useState<string>(vendor?.vertical || "servicio");
  const [storeCategory, setStoreCategory] = useState(vendor?.category || "");
  const [address, setAddress] = useState(vendor?.address || "");
  const [lat, setLat] = useState<number | null>(vendor?.lat ?? null);
  const [lng, setLng] = useState<number | null>(vendor?.lng ?? null);
  const [hours, setHours] = useState(vendor?.hours || "");
  const [description, setDescription] = useState(vendor?.description || "");
  const [whatsapp, setWhatsapp] = useState(vendor?.whatsapp || "");
  const [phone, setPhone] = useState(vendor?.phone || "");
  const [instagram, setInstagram] = useState(vendor?.instagram || "");
  const [facebook, setFacebook] = useState(vendor?.facebook || "");
  const [servicesList, setServicesList] = useState(vendor?.services_list || "");
  const [serviceArea, setServiceArea] = useState(vendor?.service_area || "");
  const [freeEstimate, setFreeEstimate] = useState(vendor?.free_estimate !== false);
  const [urgentEnabled, setUrgentEnabled] = useState(vendor?.urgent_enabled === true);
  const [urgentSurcharge, setUrgentSurcharge] = useState(
    vendor?.urgent_surcharge_pct != null ? String(vendor.urgent_surcharge_pct) : ""
  );
  const [depositDefault, setDepositDefault] = useState(
    vendor?.deposit_default_pct != null ? String(vendor.deposit_default_pct) : ""
  );
  const [acceptingQuotes, setAcceptingQuotes] = useState(vendor?.accepting_quotes !== false);
  // Solicitudes online configurables (micrositio).
  const [bookingsEnabled, setBookingsEnabled] = useState(vendor?.bookings_enabled !== false);
  const [quotePrefEnabled, setQuotePrefEnabled] = useState(vendor?.quote_pref_enabled !== false);
  const [quoteDays, setQuoteDays] = useState<string[]>(
    Array.isArray(vendor?.quote_days) && vendor.quote_days.length > 0
      ? vendor.quote_days
      : ["lun", "mar", "mie", "jue", "vie", "sab"]
  );
  const [quoteSlots, setQuoteSlots] = useState<string[]>(
    Array.isArray(vendor?.quote_slots) && vendor.quote_slots.length > 0
      ? vendor.quote_slots
      : ["mañana", "tarde"]
  );
  // Política de cancelación (estética; texto + horas límite).
  const [cancelPolicy, setCancelPolicy] = useState(
    typeof vendor?.cancel_policy_text === "string" ? vendor.cancel_policy_text : ""
  );
  const [cancelHours, setCancelHours] = useState(
    (vendor as any)?.cancel_hours != null ? String((vendor as any).cancel_hours) : "24"
  );
  // Alertas de fichas por clienta (🚨 en agenda). Mapa teléfono → avisos.
  const [formAlerts, setFormAlerts] = useState<Record<string, { template: string; session_no: number; labels: string[] }[]>>({});

  useEffect(() => {
    if (!isEstetica || bookings.length === 0) return;
    (async () => {
      try {
        const res = await fetch("/api/vendor/form-entries/alerts");
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.alerts) setFormAlerts(data.alerts);
      } catch { /* sin migración: sin alertas */ }
    })();
  }, [isEstetica, bookings.length]);
  // Catálogo para el modal de turno manual (estética): servicios + staff.
  const [catalogServices, setCatalogServices] = useState<{ id: string; name: string }[]>([]);
  const [catalogStaff, setCatalogStaff] = useState<{ id: string; name: string }[]>([]);
  const [catalogLocations, setCatalogLocations] = useState<{ id: string; name: string }[]>([]);

const PREF_DAY_LABELS: Record<string, string> = {
  lun: "Lun", mar: "Mar", mie: "Mié", jue: "Jue", vie: "Vie", sab: "Sáb", dom: "Dom",
};
const PREF_DAY_IDS = ["lun", "mar", "mie", "jue", "vie", "sab", "dom"];
const PREF_SLOT_OPTIONS = ["mañana", "tarde", "noche"];

    // Bandeja de presupuestos (lifteada al dashboard para badges; fallback local).
  const [innerQuotes, setInnerQuotes] = useState<Record<string, unknown>[]>([]);
  const [quotesLoading, setQuotesLoading] = useState(true);
  // Tope mensual de solicitudes (lifteado; fallback local).
  const [innerQuota, setInnerQuota] = useState<{ used: number; limit: number | null } | null>(null);
  const [innerCanQuotePrice, setInnerCanQuotePrice] = useState(false);
  const [innerCanDeposits, setInnerCanDeposits] = useState(false);
  const quotes = quotesProp ?? innerQuotes;
  const quota = quotaProp !== undefined ? quotaProp : innerQuota;
  const canQuotePrice = canQuotePriceProp ?? innerCanQuotePrice;
  const canDeposits = canDepositsProp ?? innerCanDeposits;
  const [quoteFilter, setQuoteFilter] = useState<"all" | "pending" | "responded" | "accepted" | "cancelled">("all");
  const [respondingId, setRespondingId] = useState<string | null>(null);
  const [respondNotes, setRespondNotes] = useState("");
  const [respondPrice, setRespondPrice] = useState("");
  // Seña: % + link generado.
  const [depositPct, setDepositPct] = useState("");
  const [depositLink, setDepositLink] = useState<Record<string, string>>({});
  const [depositBusy, setDepositBusy] = useState<string | null>(null);
  // Convertir presupuesto → turno.
  const [convertingId, setConvertingId] = useState<string | null>(null);
  const [convDate, setConvDate] = useState("");
  const [convTime, setConvTime] = useState("");
  const [convBusy, setConvBusy] = useState(false);
  // Modales manuales.
  const [quoteModalOpen, setQuoteModalOpen] = useState(false);
  const [bookingModalOpen, setBookingModalOpen] = useState(false);
  // Rebooking: prefill del turno manual con los datos de un turno anterior.
  const [rebook, setRebook] = useState<{
    customerName: string;
    customerPhone: string;
    serviceId: string;
    staffId: string;
    durationMin: number;
    date?: string;
  } | null>(null);

  async function handleConvertQuote(id: string) {
    if (!convDate || !convTime) {
      setMsg("Elegí fecha y hora del turno");
      return;
    }
    setConvBusy(true);
    try {
      const res = await fetch(`/api/vendor/quotes/${id}/convert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ booking_date: convDate, booking_time: convTime }),
      });
      const data = await res.json();
      if (data.error) {
        setMsg(data.error);
        return;
      }
      setConvertingId(null);
      setConvDate("");
      setConvTime("");
      setMsg(`Turno agendado desde la ${presupuestoOne}`);
      reload();
    } catch {
      setMsg("Error de conexión");
    } finally {
      setConvBusy(false);
    }
  }

  const loadQuotes = async () => {
    if (onQuotesChanged) {
      onQuotesChanged();
      setQuotesLoading(false);
      return;
    }
    try {
      const res = await fetch("/api/vendor/quotes");
      const data = await res.json();
      if (!data.error) {
        setInnerQuotes(data.quotes || []);
        setInnerCanQuotePrice(data.canQuotePrice === true);
        setInnerCanDeposits(data.canDeposits === true);
      }
    } catch { /* noop */ } finally {
      setQuotesLoading(false);
    }
  };

  useEffect(() => { loadQuotes(); }, []);

  useEffect(() => {
    if (quotaProp !== undefined || onQuotesChanged) return;
    (async () => {
      try {
        const res = await fetch("/api/vendor/service-quota");
        const data = await res.json();
        if (!data.error) setInnerQuota({ used: data.used || 0, limit: data.limit ?? null });
      } catch { /* noop */ }
    })();
  }, []);

  useEffect(() => {
    if (!vendor) return;
    setStoreName(vendor.store_name || "");
    setStoreVertical(vendor.vertical || "servicio");
    setStoreCategory(vendor.category || "");
    setAddress(vendor.address || "");
    setLat(vendor.lat ?? null);
    setLng(vendor.lng ?? null);
    setHours(vendor.hours || "");
    setDescription(vendor.description || "");
    setWhatsapp(vendor.whatsapp || "");
    setPhone(vendor.phone || "");
    setInstagram(vendor.instagram || "");
    setFacebook(vendor.facebook || "");
    setServicesList(vendor.services_list || "");
    setServiceArea(vendor.service_area || "");
    setFreeEstimate(vendor.free_estimate !== false);
    setUrgentEnabled(vendor.urgent_enabled === true);
    setUrgentSurcharge(vendor.urgent_surcharge_pct != null ? String(vendor.urgent_surcharge_pct) : "");
    setDepositDefault(vendor.deposit_default_pct != null ? String(vendor.deposit_default_pct) : "");
    setAcceptingQuotes(vendor.accepting_quotes !== false);
    setBookingsEnabled(vendor.bookings_enabled !== false);
    setQuotePrefEnabled(vendor.quote_pref_enabled !== false);
    setQuoteDays(
      Array.isArray(vendor.quote_days) && vendor.quote_days.length > 0
        ? vendor.quote_days
        : ["lun", "mar", "mie", "jue", "vie", "sab"]
    );
    setQuoteSlots(
      Array.isArray(vendor.quote_slots) && vendor.quote_slots.length > 0
        ? vendor.quote_slots
        : ["mañana", "tarde"]
    );
    setCancelPolicy(typeof vendor.cancel_policy_text === "string" ? vendor.cancel_policy_text : "");
    setCancelHours((vendor as any)?.cancel_hours != null ? String((vendor as any).cancel_hours) : "24");
    setStorePreview(vendor.image_url || null);
    setLogoPreview(vendor.logo_url || null);
  }, [vendor]);

  const [storePreview, setStorePreview] = useState<string | null>(vendor?.image_url || null);
  const [logoPreview, setLogoPreview] = useState<string | null>(vendor?.logo_url || null);
  // Archivos en staging (patrón gastro): se suben al guardar, no antes.
  const [storeFile, setStoreFile] = useState<File | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);

  async function uploadStagedImage(file: File): Promise<string> {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("folder", "vendors");
    const res = await fetch("/api/vendor/upload", { method: "POST", body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.url) throw new Error(data.error || "No se pudo subir la imagen");
    return data.url as string;
  }

  const [bookingFilter, setBookingFilter] = useState<"all" | "pending" | "confirmed" | "cancelled" | "noshow">("all");
  const [galleryCount, setGalleryCount] = useState(gallery.length);

  const storePreviewUrl = storePreview || vendor?.image_url || null;
  const logoPreviewUrl = logoPreview || vendor?.logo_url || null;

  const filteredBookings =
    bookingFilter === "all"
      ? bookings
      : bookings.filter((b: any) => b.status === bookingFilter);

  const groupedBookings: Record<string, any[]> = {};
  for (const b of filteredBookings) {
    const date = b.booking_date || "Sin fecha";
    if (!groupedBookings[date]) groupedBookings[date] = [];
    groupedBookings[date].push(b);
  }

  const sortedDates = Object.keys(groupedBookings).sort((a, b) => a.localeCompare(b));

  async function handleSaveAll() {
    await doSaveVendor();
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg("");
    try {
      await doSaveVendor();
    } finally {
      setSaving(false);
    }
  }

  async function doSaveVendor() {
    // Subir portada/logo en staging antes de guardar (si falla, abortar con
    // mensaje en vez de persistir URLs blob inválidas).
    const hadStoreFile = !!storeFile;
    const hadLogoFile = !!logoFile;
    let imageUrl: string | undefined;
    let logoUrl: string | undefined;
    if (storeFile) {
      try {
        imageUrl = await uploadStagedImage(storeFile);
      } catch (e) {
        setMsg(e instanceof Error ? e.message : "No se pudo subir la foto de portada");
        throw e;
      }
    }
    if (logoFile) {
      try {
        logoUrl = await uploadStagedImage(logoFile);
      } catch (e) {
        setMsg(e instanceof Error ? e.message : "No se pudo subir el logo");
        throw e;
      }
    }
    await saveVendor({
      store_name: storeName,
      vertical: storeVertical,
      category: storeCategory,
      address,
      lat,
      lng,
      hours,
      description,
      whatsapp,
      phone,
      instagram,
      facebook,
      ...(imageUrl ? { image_url: imageUrl } : {}),
      ...(logoUrl ? { logo_url: logoUrl } : {}),
      services_list: servicesList,
      service_area: serviceArea,
      free_estimate: freeEstimate,
      urgent_enabled: urgentEnabled,
      urgent_surcharge_pct: urgentSurcharge === "" ? null : Number(urgentSurcharge),
      deposit_default_pct: depositDefault === "" ? null : Number(depositDefault),
      accepting_quotes: acceptingQuotes,
      bookings_enabled: bookingsEnabled,
      quote_pref_enabled: quotePrefEnabled,
      quote_days: quoteDays,
      quote_slots: quoteSlots,
      cancel_policy_text: cancelPolicy.trim() || null,
      cancel_hours: cancelHours === "" ? 24 : Math.max(0, Number(cancelHours) || 0),
    });
    if (hadStoreFile) setStoreFile(null);
    if (hadLogoFile) setLogoFile(null);
  }

  // Cobros vive fuera del form de ficha: guarda solo la seña por defecto.
  async function handleSaveDeposit() {
    await saveVendor({
      deposit_default_pct: depositDefault === "" ? null : Number(depositDefault),
    });
  }

  // Catálogo de servicios + profesionales (estética) para el turno manual.
  useEffect(() => {
    if (!isEstetica) return;
    (async () => {
      try {
        const [sRes, tRes, lRes] = await Promise.all([
          fetch("/api/vendor/services").catch(() => null),
          fetch("/api/vendor/estetica-staff").catch(() => null),
          fetch("/api/vendor/estetica-locations").catch(() => null),
        ]);
        if (sRes?.ok) {
          const data = await sRes.json().catch(() => ({}));
          setCatalogServices((data.services || []).map((s: any) => ({ id: String(s.id), name: String(s.name ?? "") })));
        }
        if (tRes?.ok) {
          const data = await tRes.json().catch(() => ({}));
          setCatalogStaff((data.staff || []).map((s: any) => ({ id: String(s.id), name: String(s.name ?? "") })));
        }
        if (lRes?.ok) {
          const data = await lRes.json().catch(() => ({}));
          setCatalogLocations((data.locations || []).filter((l: any) => l.active !== false).map((l: any) => ({ id: String(l.id), name: String(l.name ?? "") })));
        }
      } catch { /* sin migración: listas vacías */ }
    })();
  }, [isEstetica]);

  async function handleUpdateBookingStatus(id: string, status: string) {
    // Con retención de seña, confirmar antes de marcar ausente.
    if (status === "noshow" && (vendor as any)?.noshow_policy === "forfeit") {
      if (!window.confirm("El cliente no vino. Con tu política actual la seña pagada queda retenida. ¿Confirmar?")) {
        return;
      }
    }
    try {
      const res = await fetch(`/api/vendor/bookings/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (data.error) {
        setMsg(data.error);
        return;
      }
      if (Number(data.waitlistCount) > 0) {
        setMsg(`Turno cancelado. 🔔 Hay ${data.waitlistCount} en lista de espera para ese día: contactalas desde Turnos.`);
      } else if (data.consequence) {
        setMsg(`Ausente registrado. ${data.consequence}`);
      }
      reload();
    } catch {
      setMsg("Error de conexión");
    }
  }

  // Purga de filas de prueba (turnos/consultas). Solo borra is_preview=true;
  // el endpoint rechaza las reales.
  const [purgingPreview, setPurgingPreview] = useState(false);
  async function purgePreview(kind: "bookings" | "quotes") {
    const rows: any[] = kind === "bookings" ? bookings : (quotes as any[]);
    const ids = rows.filter((r) => r?.is_preview === true).map((r) => r.id);
    if (ids.length === 0) return;
    const what = kind === "bookings" ? "turno(s)" : presupuestosLow;
    if (!window.confirm(`¿Borrar ${ids.length} ${what} de prueba?`)) return;
    setPurgingPreview(true);
    try {
      for (const id of ids) {
        await fetch(`/api/vendor/${kind}/${id}`, { method: "DELETE" });
      }
      if (kind === "bookings") reload();
      else loadQuotes();
    } finally {
      setPurgingPreview(false);
    }
  }

  async function handlePrintQuote(id: string) {
    setMsg("");
    try {
      const res = await fetch("/api/print", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "presupuesto", quoteId: id }),
      });
      const data = await res.json();
      if (data.error || data.ok === false) {
        setMsg(data.error || "No se pudo imprimir");
        return;
      }
      setMsg(data.skipped ? "Sin impresora configurada (se omitió)" : `${isEstetica ? "Consulta enviada" : "Presupuesto enviado"} a imprimir`);
    } catch {
      setMsg("Error de conexión");
    }
  }

  function quoteShareText(q: any): string {
    const lines = [
      `*${isEstetica ? "CONSULTA" : "PRESUPUESTO"} — ${vendor?.store_name || ""}*`,
      `Para: ${q.customer_name || ""}${q.customer_phone ? ` (${q.customer_phone})` : ""}`,
      q.service_name ? `Servicio: ${q.service_name}` : "",
      "",
      String(q.description || ""),
      "",
      q.quoted_price != null ? `*TOTAL: $${Number(q.quoted_price).toLocaleString("es-AR")}*` : "",
      q.deposit_amount != null && Number(q.deposit_amount) > 0
        ? `Seña (${q.deposit_pct ?? ""}%): $${Number(q.deposit_amount).toLocaleString("es-AR")}`
        : "",
      "Validez: 30 días. Sin compromiso.",
    ];
    return lines.filter((l) => l !== "").join("\n");
  }

  async function handleRespondQuote(id: string, status: string) {
    try {
      const body: Record<string, unknown> = { status, vendor_notes: respondNotes || undefined };
      if (canQuotePrice && respondPrice !== "") {
        body.quoted_price = respondPrice === "" ? null : Number(respondPrice);
      }
      const res = await fetch(`/api/vendor/quotes/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.error) {
        setMsg(data.error);
        return;
      }
      setRespondingId(null);
      setRespondNotes("");
      setRespondPrice("");
      setMsg(status === "cancelled" ? `${isEstetica ? "Consulta descartada" : "Presupuesto descartado"}` : "Respuesta enviada");
      loadQuotes();
    } catch {
      setMsg("Error de conexión");
    }
  }

  async function handleDepositLink(id: string) {
    setDepositBusy(id);
    try {
      const res = await fetch(`/api/vendor/quotes/${id}/deposit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deposit_pct: depositPct === "" ? undefined : Number(depositPct) }),
      });
      const data = await res.json();
      if (data.error) {
        setMsg(data.error);
        return;
      }
      setDepositLink((prev) => ({ ...prev, [id]: data.initPoint }));
      setMsg(`Link de seña generado: $${Number(data.amount).toLocaleString("es-AR")} (${data.pct}%). Pasáselo al cliente por WhatsApp.`);
      loadQuotes();
    } catch {
      setMsg("Error de conexión");
    } finally {
      setDepositBusy(null);
    }
  }

  // Link de seña por Stripe (misma seña, otro riel). Guarda en el mismo box.
  async function handleStripeDepositLink(id: string) {
    setDepositBusy(id);
    try {
      const res = await fetch(`/api/vendor/quotes/${id}/stripe-deposit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deposit_pct: depositPct === "" ? undefined : Number(depositPct) }),
      });
      const data = await res.json();
      if (data.error) {
        setMsg(data.error);
        return;
      }
      setDepositLink((prev) => ({ ...prev, [id]: data.initPoint }));
      setMsg(`Link de seña (Stripe) generado: $${Number(data.amount).toLocaleString("es-AR")} (${data.pct}%). Pasáselo al cliente por WhatsApp.`);
      loadQuotes();
    } catch {
      setMsg("Error de conexión");
    } finally {
      setDepositBusy(null);
    }
  }

  // Link público de confirmación (/turno/[token]) por turno.
  const [confirmLinkBusy, setConfirmLinkBusy] = useState<string | null>(null);
  // Productos utilizados por turno (ficha de la clienta).
  const [editingProductsId, setEditingProductsId] = useState<string | null>(null);
  const [productsText, setProductsText] = useState("");
  const [productsBusy, setProductsBusy] = useState(false);

  async function handleSaveProducts(id: string) {
    setProductsBusy(true);
    try {
      const res = await fetch(`/api/vendor/bookings/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ products_used: productsText.trim() || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        setMsg(data.error || "No se pudo guardar");
        return;
      }
      setEditingProductsId(null);
      setMsg("Productos guardados en la ficha de la clienta");
      reload();
    } catch {
      setMsg("Error de conexión");
    } finally {
      setProductsBusy(false);
    }
  }

  async function handleConfirmLink(id: string, existingToken?: string | null) {
    if (existingToken) {
      try {
        await navigator.clipboard.writeText(`${window.location.origin}/turno/${existingToken}`);
        setMsg("Link de confirmación copiado. Pasáselo a la clienta por WhatsApp.");
      } catch {
        setMsg(`Link: ${window.location.origin}/turno/${existingToken}`);
      }
      return;
    }
    setConfirmLinkBusy(id);
    try {
      const res = await fetch(`/api/vendor/bookings/${id}/token`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (data.error || !data.url) {
        setMsg(data.error || "No se pudo generar el link");
        return;
      }
      try {
        await navigator.clipboard.writeText(`${window.location.origin}${data.url}`);
        setMsg("Link de confirmación copiado. Pasáselo a la clienta por WhatsApp.");
      } catch {
        setMsg(`Link: ${data.url}`);
      }
      reload();
    } catch {
      setMsg("Error de conexión");
    } finally {
      setConfirmLinkBusy(null);
    }
  }
  const [stripeBookingLink, setStripeBookingLink] = useState<Record<string, string>>({});
  const [stripeBookingBusy, setStripeBookingBusy] = useState<string | null>(null);
  // Link de seña por MP para un TURNO (misma seña, otro riel).
  const [mpBookingLink, setMpBookingLink] = useState<Record<string, string>>({});
  const [mpBookingBusy, setMpBookingBusy] = useState<string | null>(null);

  async function handleBookingStripeDepositLink(id: string) {
    setStripeBookingBusy(id);
    try {
      const res = await fetch(`/api/vendor/bookings/${id}/stripe-deposit`, { method: "POST" });
      const data = await res.json();
      if (data.error) {
        setMsg(data.error);
        return;
      }
      setStripeBookingLink((prev) => ({ ...prev, [id]: data.initPoint }));
      setMsg(`Link de seña del turno (Stripe): $${Number(data.amount).toLocaleString("es-AR")}. Pasáselo al cliente por WhatsApp.`);
      reload();
    } catch {
      setMsg("Error de conexión");
    } finally {
      setStripeBookingBusy(null);
    }
  }

  async function handleBookingMpDepositLink(id: string) {
    setMpBookingBusy(id);
    try {
      const res = await fetch(`/api/vendor/bookings/${id}/deposit`, { method: "POST" });
      const data = await res.json();
      if (data.error) {
        setMsg(data.error);
        return;
      }
      setMpBookingLink((prev) => ({ ...prev, [id]: data.initPoint }));
      setMsg(`Link de seña del turno (MP): $${Number(data.amount).toLocaleString("es-AR")}. Pasáselo al cliente por WhatsApp.`);
      reload();
    } catch {
      setMsg("Error de conexión");
    } finally {
      setMpBookingBusy(null);
    }
  }

  const QUOTE_STATUS_LABELS: Record<string, string> = {
    pending: "Pendiente",
    responded: "Respondido",
    accepted: "Aceptado",
    cancelled: "Descartado",
  };

  const filteredQuotes =
    quoteFilter === "all" ? quotes : quotes.filter((q) => q.status === quoteFilter);

  return (
    <div className="space-y-4">
      {(sec === "all" || sec === "hoy") && quota && quota.limit != null && (
        <div className={`rounded-xl border px-4 py-3 text-sm ${quota.used >= quota.limit ? "bg-red-50 border-red-200 text-red-700" : "bg-muted border-border text-muted-foreground"}`}>
          {quota.used >= quota.limit ? (
            <p className="font-medium">
              Llegaste al tope de {quota.limit} solicitudes online del mes. Las nuevas llegan por WhatsApp.
              El plan Oficios las hace ilimitadas.
            </p>
          ) : (
            <p>
              Solicitudes online del mes: <strong className="text-foreground">{quota.used} de {quota.limit}</strong>
              {" "}({presupuestosLow} + turnos. Lo que cargás a mano no cuenta).
            </p>
          )}
        </div>
      )}
      {(sec === "all" || sec === "ficha") && (
      <>
      <LivePreview
        storeName={storeName}
        storePreview={storePreviewUrl}
        vendor={vendor}
        logoPreview={logoPreviewUrl}
        description={description}
        hours=""
        address={address}
        paymentMethods={[]}
        whatsapp={whatsapp}
        isService
      />

      <form onSubmit={handleSave}>
      <ConfigSections storageKey="portal659-config-servicio" activeId={configSectionId} onActiveChange={onConfigSectionId}>
      <ConfigSection id="perfil" label="Perfil" icon="🏪" badge="Servicio">
        <div className="space-y-3">
          <div>
            <Label>Tu vertical</Label>
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={storeVertical}
              onChange={(e) => setStoreVertical(e.target.value)}
            >
              <option value="servicio">Servicio u oficio</option>
              <option value="estetica">Estética y belleza</option>
              <option value="gastronomia">Gastronomía</option>
              <option value="comercio">Comercio del barrio</option>
              <option value="moda">Ropa y accesorios</option>
              <option value="otro">Otro</option>
            </select>
            {storeVertical !== (vendor?.vertical || "servicio") && (
              <p className="text-xs text-amber-700 mt-1">
                Al guardar, el panel cambia al formato de ese rubro.
              </p>
            )}
          </div>
          <div>
            <Label>Nombre del comercio</Label>
            <Input value={storeName} onChange={(e) => setStoreName(e.target.value)} />
          </div>
          <div>
            <Label>Categoría</Label>
            <input
              list="cat-suggestions-service"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={storeCategory}
              onChange={(e) => setStoreCategory(e.target.value)}
              placeholder="Ej: electricista, plomero..."
            />
            <datalist id="cat-suggestions-service">
              <option value="electricista" />
              <option value="plomero" />
              <option value="jardinería" />
              <option value="pintura" />
              <option value="albañilería" />
              <option value="mudanza" />
              <option value="limpieza" />
              <option value="seguridad" />
              <option value="otros" />
            </datalist>
          </div>
          <div>
            <Label>Foto de portada</Label>
            <Input
              type="file"
              accept="image/*"
              onChange={(e) => {
                const f = e.target.files?.[0] || null;
                if (f) {
                  const src = URL.createObjectURL(f);
                  setStoreFile(f);
                  setStorePreview(src);
                  onCrop("cover", src);
                }
              }}
            />
            {storePreview && (
              <img src={storePreview} alt="Vista previa" className="mt-2 h-24 w-full object-cover rounded-lg" />
            )}
          </div>
          <div>
            <Label>Logo</Label>
            <Input
              type="file"
              accept="image/*"
              onChange={(e) => {
                const f = e.target.files?.[0] || null;
                if (f) {
                  const src = URL.createObjectURL(f);
                  setLogoFile(f);
                  setLogoPreview(src);
                  onCrop("logo", src);
                }
              }}
            />
            {logoPreview && (
              <img src={logoPreview} alt="Logo" className="mt-2 h-16 w-16 object-cover rounded-full border" />
            )}
          </div>
          <div>
            <Label>Descripción</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Contá qué hacés, tu experiencia, especialidades..."
            />
          </div>
        </div>
      </ConfigSection>

      <ConfigSection id="ubicacion" label="Ubicación y horarios" icon="📍">
        <div className="space-y-3">
          <div>
            <Label>Dirección</Label>
            <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Calle y número" />
          </div>
          <LocationPicker
            lat={lat}
            lng={lng}
            onChange={(newLat, newLng) => {
              setLat(newLat);
              setLng(newLng);
            }}
            neighborhood={vendor?.neighborhood}
          />
          <div>
            <Label>Horarios</Label>
            <HoursEditor value={hours} onChange={setHours} />
          </div>
        </div>
      </ConfigSection>

      <ConfigSection id="contacto" label="Contacto y redes" icon="📱">
        <div className="space-y-3">
          <div>
            <Label>WhatsApp</Label>
            <Input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="5492215550000" />
          </div>
          <div>
            <Label>Teléfono directo</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="2215550000" />
          </div>
          <div>
            <Label>Instagram</Label>
            <Input value={instagram} onChange={(e) => setInstagram(e.target.value)} placeholder="@tuservicio" />
          </div>
          <div>
            <Label>Facebook</Label>
            <Input value={facebook} onChange={(e) => setFacebook(e.target.value)} placeholder="https://facebook.com/tuservicio" />
          </div>
        </div>
      </ConfigSection>

      <ConfigSection id="servicios" label="Servicios" icon="🔧">
        <div className="space-y-3">
          <div>
            <Label>Servicios</Label>
            <Input
              value={servicesList}
              onChange={(e) => setServicesList(e.target.value)}
              placeholder="Instalaciones, reparaciones, urgencias"
            />
            <p className="text-xs text-muted-foreground mt-1">Separá con coma</p>
          </div>
          <div>
            <Label>Zona de cobertura</Label>
            <Input
              value={serviceArea}
              onChange={(e) => setServiceArea(e.target.value)}
              placeholder="Sicardi, Garibaldi, centro"
            />
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={freeEstimate}
              onChange={(e) => setFreeEstimate(e.target.checked)}
              className="h-4 w-4 rounded border-border"
            />
            <span className="text-sm">Presupuesto sin compromiso</span>
          </label>
          <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
            <div>
              <p className="text-sm font-medium">Recibir presupuestos</p>
              <p className="text-xs text-muted-foreground">
                Si lo apagás, el formulario desaparece de tu micrositio
              </p>
            </div>
            <Switch checked={acceptingQuotes} onCheckedChange={setAcceptingQuotes} />
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
            <div>
              <p className="text-sm font-medium">Turnera pública</p>
              <p className="text-xs text-muted-foreground">
                Si la apagás, el formulario de turnos desaparece del micrositio
              </p>
            </div>
            <Switch checked={bookingsEnabled} onCheckedChange={setBookingsEnabled} />
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
            <div>
              <p className="text-sm font-medium">Preferencias en presupuestos</p>
              <p className="text-xs text-muted-foreground">
                Bloque de días y horario preferidos en el formulario
              </p>
            </div>
            <Switch checked={quotePrefEnabled} onCheckedChange={setQuotePrefEnabled} />
          </div>
          {quotePrefEnabled && (
            <>
              <div>
                <Label>Días que ofrecés</Label>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {PREF_DAY_IDS.map((d) => {
                    const active = quoteDays.includes(d);
                    return (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setQuoteDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]))}
                        className={`px-3 py-1.5 rounded-full border text-sm transition-colors ${active ? "border-primary bg-primary/10 text-primary font-medium" : "border-border text-muted-foreground"}`}
                      >
                        {PREF_DAY_LABELS[d]}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <Label>Franjas horarias</Label>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {PREF_SLOT_OPTIONS.map((s) => {
                    const active = quoteSlots.includes(s);
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setQuoteSlots((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]))}
                        className={`px-3 py-1.5 rounded-full border text-sm capitalize transition-colors ${active ? "border-primary bg-primary/10 text-primary font-medium" : "border-border text-muted-foreground"}`}
                      >
                        {s}
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>
      </ConfigSection>

      <ConfigSection id="urgencia" label="Urgencia 24hs" icon="🚨">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Atención de emergencias</p>
              <p className="text-xs text-muted-foreground">
                Cuando está activado, el micrositio muestra un botón naranja prominente
              </p>
            </div>
            <Switch checked={urgentEnabled} onCheckedChange={setUrgentEnabled} />
          </div>
          {urgentEnabled && (
            <div className="rounded-lg bg-orange-50 border border-orange-200 p-3 space-y-2">
              <p className="text-sm text-orange-700 font-medium">
                🚨 Atención de emergencias activada
              </p>
              <p className="text-xs text-orange-600">
                Los visitantes verán un botón naranja destacado en tu micrositio para contactarte por urgencias.
              </p>
              <div>
                <Label className="text-xs text-orange-700">Recargo por urgencia (%)</Label>
                <Input
                  type="number"
                  min={0}
                  max={99}
                  value={urgentSurcharge}
                  onChange={(e) => setUrgentSurcharge(e.target.value)}
                  placeholder="Ej: 20"
                  className="mt-1 max-w-40 bg-white"
                />
                <p className="text-[11px] text-orange-600 mt-1">
                  Se muestra junto al botón de urgencia (visible con el plan Oficios).
                </p>
              </div>
            </div>
          )}
        </div>
      </ConfigSection>

      <ConfigSection id="equipo" label="Equipo y usuarios" icon="👥">
        <StaffManager storeName={vendor?.store_name} showCouriers={false} />
      </ConfigSection>

      <ConfigSection id="carta" label="Catálogo QR" icon="📱" status={vendor?.carta_visibility === "public" ? "ok" : undefined}>
        <CartaQrSection vendor={vendor} saveVendor={saveVendor} setMsg={setMsg} catalog />
      </ConfigSection>

      <ConfigSection id="promos" label="Promos" icon="🔗">
        {vendor && vendor.slug && (
          <PromosSection
            vendorId={vendor.id}
            storeName={vendor.store_name}
            slug={vendor.slug}
            vertical={vendor.vertical}
          />
        )}
      </ConfigSection>
      </ConfigSections>
      <ConfigSaveBar saving={saving || uploading} onDiscard={() => { setMsg(""); reload(); }} />
      </form>
      </>
      )}

      {(sec === "all" || sec === "galeria") && (
      <>
      <CollapsibleSection icon="🖼️" title={`Galería de trabajos (${galleryCount})`} defaultOpen>
        <GalleryManager
          title="Fotos de trabajos realizados"
          emptyText="Todavía no subiste fotos de trabajos."
          captionPlaceholder="Ej: instalación, antes/después..."
          onCount={setGalleryCount}
          onChanged={reload}
        />
      </CollapsibleSection>
      </>
      )}

      {(sec === "all" || sec === "turnos") && (
      <>
      <CollapsibleSection icon="📅" title={`Agenda de turnos (${bookings.length})`} defaultOpen>
        <div className="space-y-3">
          {bookings.some((b: any) => b?.is_preview === true) && (
            <div className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 flex items-center gap-2 flex-wrap">
              <p className="text-xs text-violet-800 flex-1 min-w-0">
                🧪 Tenés {bookings.filter((b: any) => b?.is_preview === true).length} turno(s) de prueba
              </p>
              <Button size="sm" variant="outline" className="h-7 text-xs" disabled={purgingPreview} onClick={() => purgePreview("bookings")}>
                {purgingPreview ? "Borrando..." : "Borrar pruebas"}
              </Button>
            </div>
          )}
          <Button size="sm" className="w-full h-8 text-xs" onClick={() => setBookingModalOpen(true)}>
            ＋ Nuevo turno
          </Button>
          {isEstetica && (
            <EsteticaWaitlistManager
              onSchedule={(w: WaitEntry) => {
                setRebook({
                  customerName: w.customer_name,
                  customerPhone: w.customer_phone,
                  serviceId: w.service_id || "",
                  staffId: w.staff_id || "",
                  durationMin: 60,
                  date: w.booking_date,
                });
                setBookingModalOpen(true);
              }}
            />
          )}
          <div className="flex gap-1 flex-wrap">
            {(["all", "pending", "confirmed", "cancelled", "noshow"] as const).map((status) => (
              <Button
                key={status}
                size="sm"
                variant={bookingFilter === status ? "default" : "outline"}
                onClick={() => setBookingFilter(status)}
                className="h-7 text-xs"
              >
                {status === "all"
                  ? `Todos (${bookings.length})`
                  : `${status === "noshow" ? "Ausentes" : BOOKING_STATUS_LABELS[status]} (${bookings.filter((b: any) => b.status === status).length})`}
              </Button>
            ))}
          </div>

          {filteredBookings.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              {bookingFilter === "all"
                ? "Todavía no recibiste turnos."
                : `No hay turnos ${BOOKING_STATUS_LABELS[bookingFilter]?.toLowerCase()}.`}
            </p>
          ) : (
            <div className="space-y-4">
              {sortedDates.map((date) => (
                <div key={date}>
                  <p className="text-xs font-medium text-muted-foreground mb-2">
                    {date === "Sin fecha"
                      ? "Sin fecha"
                      : new Date(date + "T12:00:00").toLocaleDateString("es-AR", {
                          weekday: "long",
                          year: "numeric",
                          month: "long",
                          day: "numeric",
                        })}
                  </p>
                  <div className="space-y-2">
                    {groupedBookings[date].map((booking: any) => (
                      <Card key={booking.id} className="p-3">
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div className="min-w-0">
                            <p className="font-medium text-sm truncate">
                              {booking.customer_name || "Sin nombre"}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {booking.booking_time || "Sin horario"}
                              {(booking.product_label || booking.product_name) && ` · ${booking.product_label || booking.product_name}`}
                              {(booking.service_label || booking.staff_label) && ` · ${[booking.service_label, booking.staff_label].filter(Boolean).join(" · ")}`}
                              {booking.location_label && ` · 📍 ${booking.location_label}`}
                              {(booking as any).deposit_status === "paid" ? " · seña pagada ✅" : ""}
                            </p>
                            {booking.customer_phone && (
                              <a
                                href={waLinkFor(booking.customer_phone) || undefined}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-green-600 font-medium hover:underline"
                              >
                                📲 {booking.customer_phone}
                              </a>
                            )}
                          </div>
                          {(booking as any).is_preview && (
                            <span className="flex-shrink-0 rounded-full bg-violet-100 text-violet-700 px-1.5 py-0.5 text-[10px] font-semibold">
                              🧪 PRUEBA
                            </span>
                          )}
                          <Badge className={`flex-shrink-0 ${BOOKING_STATUS_COLORS[booking.status] || ""}`}>
                            {BOOKING_STATUS_LABELS[booking.status] || booking.status}
                          </Badge>
                        </div>
                        {booking.notes && (
                          <p className="text-xs text-muted-foreground mb-2 italic">
                            &quot;{booking.notes}&quot;
                          </p>
                        )}
                        {(() => {
                          const alerts = (booking.customer_phone && formAlerts[String(booking.customer_phone)]) || [];
                          if (alerts.length === 0) return null;
                          const labels = [...new Set(alerts.flatMap((a: { labels: string[] }) => a.labels))];
                          return (
                            <button
                              type="button"
                              onClick={() => onNavigate?.("clientes")}
                              title="Ver ficha de la clienta"
                              className="block w-full text-left text-xs mb-2 rounded-lg bg-red-50 border border-red-200 px-2.5 py-1.5 text-red-800 hover:bg-red-100"
                            >
                              🚨 {labels.join(" · ")} — ver ficha →
                            </button>
                          );
                        })()}
                        {(booking as any).products_used && editingProductsId !== booking.id && (
                          <p className="text-xs text-muted-foreground mb-2">
                            🧴 <span className="italic">{String((booking as any).products_used)}</span>
                          </p>
                        )}
                        {editingProductsId === booking.id ? (
                          <div className="mb-2 space-y-1.5">
                            <Label className="text-[11px] text-muted-foreground">🧴 Productos utilizados (quedan en la ficha)</Label>
                            <Textarea
                              value={productsText}
                              onChange={(e) => setProductsText(e.target.value)}
                              placeholder="Ej: Tinte Koleston 7/0 + oxidante 20v"
                              rows={2}
                              className="text-xs"
                            />
                            <div className="flex gap-2">
                              <Button size="sm" className="h-7 text-xs" disabled={productsBusy} onClick={() => handleSaveProducts(booking.id)}>
                                {productsBusy ? "Guardando..." : "Guardar"}
                              </Button>
                              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setEditingProductsId(null)}>
                                Cerrar
                              </Button>
                            </div>
                          </div>
                        ) : (
                          booking.status === "confirmed" && (
                            <button
                              type="button"
                              onClick={() => { setEditingProductsId(booking.id); setProductsText(String((booking as any).products_used || "")); }}
                              className="text-[11px] text-muted-foreground hover:text-foreground hover:underline mb-2"
                            >
                              {(booking as any).products_used ? "✏️ Editar productos" : "＋ Anotar productos usados"}
                            </button>
                          )
                        )}
                        <div className="flex gap-2">
                          {booking.status === "pending" && (
                            <>
                              <Button
                                size="sm"
                                className="h-7 text-xs"
                                onClick={() => handleUpdateBookingStatus(booking.id, "confirmed")}
                              >
                                Confirmar
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs text-red-600"
                                onClick={() => handleUpdateBookingStatus(booking.id, "cancelled")}
                              >
                                Cancelar
                              </Button>
                            </>
                          )}
                          {booking.status === "confirmed" && (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs text-red-600"
                                onClick={() => handleUpdateBookingStatus(booking.id, "cancelled")}
                              >
                                Cancelar
                              </Button>
                              {booking.booking_date <= new Date().toISOString().slice(0, 10) && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-xs text-amber-600"
                                  title="El cliente no vino (queda en su historial)"
                                  onClick={() => handleUpdateBookingStatus(booking.id, "noshow")}
                                >
                                  No vino
                                </Button>
                              )}
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs"
                                title="Agendar el próximo turno con los mismos datos"
                                onClick={() => {
                                  setRebook({
                                    customerName: String(booking.customer_name || ""),
                                    customerPhone: String(booking.customer_phone || ""),
                                    serviceId: typeof booking.service_id === "string" ? booking.service_id : "",
                                    staffId: typeof booking.staff_id === "string" ? booking.staff_id : "",
                                    durationMin: Number(booking.duration_min) || 60,
                                  });
                                  setBookingModalOpen(true);
                                }}
                              >
                                🔁 Repetir
                              </Button>
                            </>
                          )}
                          {(booking.status === "pending" || booking.status === "confirmed") && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs"
                              title="Abrir la ficha de la clienta"
                              onClick={() => onNavigate?.("clientes")}
                            >
                              📋 Ficha
                            </Button>
                          )}
                          {(booking.status === "pending" || booking.status === "confirmed") && (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs"
                                title="Link para que la clienta confirme o cancele sola"
                                disabled={confirmLinkBusy === booking.id}
                                onClick={() => handleConfirmLink(booking.id, typeof (booking as any).confirm_token === "string" ? (booking as any).confirm_token : null)}
                              >
                                {confirmLinkBusy === booking.id ? "Generando..." : "🔗 Link"}
                              </Button>
                              {typeof (booking as any).confirm_token === "string" && (booking as any).confirm_token && booking.customer_phone && (
                                <a
                                  href={`https://wa.me/${String(booking.customer_phone).replace(/[^0-9]/g, "")}?text=${encodeURIComponent(`Hola! Te paso el link de tu turno del ${booking.booking_date} ${String(booking.booking_time).slice(0, 5)}: ${typeof window !== "undefined" ? window.location.origin : ""}/turno/${(booking as any).confirm_token} — confirmalo cuando puedas 👆`)}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center h-7 px-2 rounded-md border border-input text-xs font-medium text-green-600 hover:bg-muted"
                                >
                                  📲 Enviar
                                </a>
                              )}
                            </>
                          )}
                          {canDeposits && vendor?.stripe_account_id && Number((booking as any).deposit_amount) > 0 && (booking as any).deposit_status !== "paid" && (booking.status === "pending" || booking.status === "confirmed") && (
                            <div className="w-full">
                              {(booking as any).deposit_status === "paid" ? null : stripeBookingLink[booking.id] ? (
                                <div className="flex items-center gap-2">
                                  <Input value={stripeBookingLink[booking.id]} readOnly className="h-7 text-[11px] flex-1" onFocus={(e) => e.target.select()} />
                                  <a
                                    href={`https://wa.me/?text=${encodeURIComponent(`Hola, te paso el link para la seña del turno ($${Number((booking as any).deposit_amount).toLocaleString("es-AR")}): ${stripeBookingLink[booking.id]}`)}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-xs font-medium text-green-600 hover:underline whitespace-nowrap"
                                  >
                                    📲 Enviar
                                  </a>
                                </div>
                              ) : (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-xs"
                                  disabled={stripeBookingBusy === booking.id}
                                  onClick={() => handleBookingStripeDepositLink(booking.id)}
                                >
                                  {stripeBookingBusy === booking.id ? "Generando..." : `💳 Link seña $${Number((booking as any).deposit_amount).toLocaleString("es-AR")}`}
                                </Button>
                              )}
                            </div>
                          )}
                          {canDeposits && vendor?.mp_user_id && Number((booking as any).deposit_amount) > 0 && (booking as any).deposit_status !== "paid" && (booking.status === "pending" || booking.status === "confirmed") && (
                            <div className="w-full">
                              {mpBookingLink[booking.id] ? (
                                <div className="flex items-center gap-2">
                                  <Input value={mpBookingLink[booking.id]} readOnly className="h-7 text-[11px] flex-1" onFocus={(e) => e.target.select()} />
                                  <a
                                    href={`https://wa.me/?text=${encodeURIComponent(`Hola, te paso el link para la seña del turno ($${Number((booking as any).deposit_amount).toLocaleString("es-AR")}): ${mpBookingLink[booking.id]}`)}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-xs font-medium text-green-600 hover:underline whitespace-nowrap"
                                  >
                                    📲 Enviar
                                  </a>
                                </div>
                              ) : (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-xs"
                                  disabled={mpBookingBusy === booking.id}
                                  onClick={() => handleBookingMpDepositLink(booking.id)}
                                >
                                  {mpBookingBusy === booking.id ? "Generando..." : `🔗 Link MP $${Number((booking as any).deposit_amount).toLocaleString("es-AR")}`}
                                </Button>
                              )}
                            </div>
                          )}
                        </div>
                      </Card>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </CollapsibleSection>
      </>
      )}

      {(sec === "all" || sec === "presupuestos") && (
      <>
      <CollapsibleSection icon="💬" title={`${presupuestosLabel} (${quotes.length})`} defaultOpen>
        <div className="space-y-3">
          {(quotes as any[]).some((q: any) => q?.is_preview === true) && (
            <div className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 flex items-center gap-2 flex-wrap">
              <p className="text-xs text-violet-800 flex-1 min-w-0">
                🧪 Tenés {(quotes as any[]).filter((q: any) => q?.is_preview === true).length} {presupuestosLow} de prueba
              </p>
              <Button size="sm" variant="outline" className="h-7 text-xs" disabled={purgingPreview} onClick={() => purgePreview("quotes")}>
                {purgingPreview ? "Borrando..." : "Borrar pruebas"}
              </Button>
            </div>
          )}
          <Button size="sm" className="w-full h-8 text-xs" onClick={() => setQuoteModalOpen(true)}>
            {isEstetica ? "＋ Nueva consulta" : "＋ Nuevo presupuesto"}
          </Button>
          {!acceptingQuotes && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              No estás recibiendo {presupuestosLow} (apagado en Configuración → Turnera).
            </p>
          )}
          <div className="flex gap-1 flex-wrap">
            {(["all", "pending", "responded", "accepted", "cancelled"] as const).map((status) => (
              <Button
                key={status}
                size="sm"
                variant={quoteFilter === status ? "default" : "outline"}
                onClick={() => setQuoteFilter(status)}
                className="h-7 text-xs"
              >
                {status === "all"
                  ? `Todos (${quotes.length})`
                  : `${QUOTE_STATUS_LABELS[status]} (${quotes.filter((q) => q.status === status).length})`}
              </Button>
            ))}
          </div>

          {quotesLoading ? (
            <div className="h-10 rounded-lg bg-muted animate-pulse" />
          ) : filteredQuotes.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              Todavía no recibiste {presupuestosLow}.
            </p>
          ) : (
            <div className="space-y-2">
              {filteredQuotes.map((q: any) => {
                const wa = waLinkFor(q.customer_phone);
                return (
                  <Card key={q.id} className="p-3">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate">
                          {q.customer_name || "Sin nombre"}
                          {q.service_name ? ` · ${q.service_name}` : ""}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {q.preferred_date || "Sin fecha"}{q.preferred_time ? ` ${q.preferred_time}` : ""}
                        </p>
                      </div>
                      {(q as any).is_preview && (
                        <span className="flex-shrink-0 rounded-full bg-violet-100 text-violet-700 px-1.5 py-0.5 text-[10px] font-semibold">
                          🧪 PRUEBA
                        </span>
                      )}
                      <Badge className="flex-shrink-0">{QUOTE_STATUS_LABELS[q.status] || q.status}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mb-2 break-words">{q.description}</p>
                    {Array.isArray(q.photo_urls) && q.photo_urls.length > 0 && (
                      <div className="flex gap-1.5 mb-2 flex-wrap">
                        {q.photo_urls.slice(0, 3).map((url: string, idx: number) => (
                          <a key={idx} href={url} target="_blank" rel="noopener noreferrer">
                            <img src={url} alt={`Foto ${idx + 1}`} className="h-16 w-16 rounded-lg object-cover border border-border hover:opacity-80 transition-opacity" />
                          </a>
                        ))}
                      </div>
                    )}
                    {q.vendor_notes && (
                      <p className="text-xs mb-2 break-words">📝 Tu respuesta: {q.vendor_notes}</p>
                    )}
                    {q.quoted_price != null && (
                      <p className="text-xs mb-1">
                        💰 Cotizado: <strong>${Number(q.quoted_price).toLocaleString("es-AR")}</strong>
                        {q.deposit_status === "paid" ? (
                          <span className="ml-1.5 rounded-full bg-green-100 text-green-700 px-1.5 py-0.5 text-[10px] font-semibold">
                            Seña pagada{q.deposit_amount != null ? ` $${Number(q.deposit_amount).toLocaleString("es-AR")}` : ""}
                          </span>
                        ) : q.deposit_status === "pending" ? (
                          <span className="ml-1.5 rounded-full bg-yellow-100 text-yellow-700 px-1.5 py-0.5 text-[10px] font-semibold">
                            Seña pendiente{q.deposit_amount != null ? ` $${Number(q.deposit_amount).toLocaleString("es-AR")}` : ""}
                          </span>
                        ) : null}
                      </p>
                    )}
                    <div className="flex gap-2 flex-wrap">
                      {wa && (
                        <a
                          href={wa}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-medium text-green-600 hover:underline self-center"
                        >
                          📲 {q.customer_phone}
                        </a>
                      )}
                      {(q.status === "pending" || q.status === "responded") && (
                        <>
                          {respondingId === q.id ? (
                            <div className="w-full space-y-2 mt-1">
                              <Textarea
                                value={respondNotes}
                                onChange={(e) => setRespondNotes(e.target.value)}
                                placeholder="Tu respuesta (precio orientativo, disponibilidad...)."
                                className="text-xs min-h-16"
                              />
                              {canQuotePrice ? (
                                <div className="flex items-center gap-2">
                                  <Label className="text-[11px] text-muted-foreground">Precio $</Label>
                                  <Input
                                    type="number"
                                    min={0}
                                    step="0.01"
                                    value={respondPrice}
                                    onChange={(e) => setRespondPrice(e.target.value)}
                                    placeholder={q.quoted_price != null ? String(q.quoted_price) : "Cotización formal"}
                                    className="h-8 text-xs w-36"
                                  />
                                </div>
                              ) : (
                                <p className="text-[11px] text-muted-foreground">
                                  La cotización con precio formal es del plan Oficios.
                                </p>
                              )}
                        <div className="flex gap-2 flex-wrap">
                                <Button size="sm" className="h-7 text-xs" onClick={() => handleRespondQuote(q.id, "responded")}>
                                  Enviar respuesta
                                </Button>
                                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setRespondingId(null); setRespondNotes(""); setRespondPrice(""); }}>
                                  Cancelar
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <Button size="sm" className="h-7 text-xs" onClick={() => { setRespondingId(q.id); setRespondNotes(String(q.vendor_notes || "")); setRespondPrice(q.quoted_price != null ? String(q.quoted_price) : ""); }}>
                                Responder
                              </Button>
                              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => handleRespondQuote(q.id, "accepted")}>
                                Aceptar
                              </Button>
                              <Button size="sm" variant="outline" className="h-7 text-xs text-red-600" onClick={() => handleRespondQuote(q.id, "cancelled")}>
                                Descartar
                              </Button>
                            </>
                          )}
                        </>
                      )}
                      {canDeposits && q.quoted_price != null && q.deposit_status !== "paid" && (q.status === "responded" || q.status === "accepted") && (
                        <div className="w-full rounded-lg border border-border p-2 mt-1 space-y-2">
                          <div className="flex items-center gap-2">
                            <Label className="text-[11px] text-muted-foreground">Seña %</Label>
                            <Input
                              type="number"
                              min={1}
                              max={100}
                              value={depositPct}
                              onChange={(e) => setDepositPct(e.target.value)}
                              placeholder={vendor?.deposit_default_pct != null ? String(vendor.deposit_default_pct) : "30"}
                              className="h-8 text-xs w-24"
                            />
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 text-xs"
                              disabled={depositBusy === q.id}
                              onClick={() => handleDepositLink(q.id)}
                            >
                              {depositBusy === q.id ? "Generando..." : "Generar link de cobro"}
                            </Button>
                            {vendor?.stripe_account_id && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8 text-xs"
                                disabled={depositBusy === q.id}
                                onClick={() => handleStripeDepositLink(q.id)}
                              >
                                {depositBusy === q.id ? "Generando..." : "💳 Link Stripe"}
                              </Button>
                            )}
                          </div>
                          {depositLink[q.id] && (
                            <div className="flex items-center gap-2">
                              <Input value={depositLink[q.id]} readOnly className="h-8 text-[11px] flex-1" onFocus={(e) => e.target.select()} />
                              <a
                                href={`https://wa.me/?text=${encodeURIComponent(`Hola, te paso el link para la seña: ${depositLink[q.id]}`)}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs font-medium text-green-600 hover:underline whitespace-nowrap"
                              >
                                📲 Enviar
                              </a>
                            </div>
                          )}
                        </div>
                      )}
                      {(q.status === "responded" || q.status === "accepted") && (
                        <div className="w-full flex gap-2 flex-wrap mt-1">
                          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => handlePrintQuote(q.id)}>
                            🖨️ Imprimir
                          </Button>
                          <a href={`/vendor/presupuesto/${q.id}`} target="_blank" rel="noopener noreferrer">
                            <Button size="sm" variant="outline" className="h-7 text-xs">📄 A4 / PDF</Button>
                          </a>
                          <a
                            href={`https://wa.me/?text=${encodeURIComponent(quoteShareText(q))}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center h-7 px-3 text-xs font-medium rounded-lg border border-border hover:bg-muted text-green-600"
                          >
                            📲 Enviar por WA
                          </a>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            onClick={() => {
                              if (convertingId === q.id) return setConvertingId(null);
                              setConvertingId(q.id);
                              setConvDate(String(q.preferred_date || ""));
                              setConvTime(String(q.preferred_time || "").slice(0, 5));
                            }}
                          >
                            📅 Agendar turno
                          </Button>
                        </div>
                      )}
                      {convertingId === q.id && (
                        <div className="w-full rounded-lg border border-border p-2 mt-1 space-y-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Input
                              type="date"
                              value={convDate}
                              onChange={(e) => setConvDate(e.target.value)}
                              className="h-8 text-xs w-40"
                            />
                            <Input
                              type="time"
                              value={convTime}
                              onChange={(e) => setConvTime(e.target.value)}
                              className="h-8 text-xs w-28"
                            />
                            <Button size="sm" className="h-8 text-xs" disabled={convBusy} onClick={() => handleConvertQuote(q.id)}>
                              {convBusy ? "Agendando..." : "Confirmar turno"}
                            </Button>
                          </div>
                          <p className="text-[11px] text-muted-foreground">
                            Marca la {presupuestoOne} como aceptada y crea el turno confirmado.
                          </p>
                        </div>
                      )}
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </CollapsibleSection>
      </>
      )}

      {(sec === "all" || sec === "cobros") && (
      <>
      <CollapsibleSection icon="💰" title="Cobros y seña" defaultOpen>
        <div className="space-y-3">
          <MpConnectCard
            mpUserId={vendor?.mp_user_id ?? null}
            mpConnectedAt={vendor?.mp_connected_at ?? null}
          />
          <StripeConnectCard
            stripeAccountId={vendor?.stripe_account_id ?? null}
            stripeConnectedAt={vendor?.stripe_connected_at ?? null}
          />
          <div>
            <Label className="text-xs text-muted-foreground">Seña por defecto (%)</Label>
            <Input
              type="number"
              min={1}
              max={100}
              value={depositDefault}
              onChange={(e) => setDepositDefault(e.target.value)}
              placeholder="30"
              className="mt-1 max-w-40"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Se usa al generar el link de cobro (podés cambiarlo caso por caso). Cobrar seña online es del plan Oficios.
            </p>
          </div>
          <Button onClick={handleSaveAll} className="w-full" disabled={uploading}>
            {uploading ? "Guardando..." : "Guardar cobros"}
          </Button>
        </div>
      </CollapsibleSection>
      </>
      )}

      {(sec === "all" || sec === "reviews") && (
      <>
      <CollapsibleSection icon="⭐" title="Reseñas">
        <VendorReviews />
      </CollapsibleSection>
      </>
      )}

      {(sec === "all" || sec === "hoy") && (
      <>
      <CollapsibleSection icon="📊" title="Resumen del mes">
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl border border-border p-3">
            <p className="font-display text-xl font-bold">{quotes.length + bookings.length}</p>
            <p className="text-[11px] text-muted-foreground">Solicitudes</p>
          </div>
          <div className="rounded-xl border border-border p-3">
            <p className="font-display text-xl font-bold">
              {quotes.filter((q) => q.status === "accepted").length + bookings.filter((b: any) => b.status === "confirmed").length}
            </p>
            <p className="text-[11px] text-muted-foreground">Confirmadas</p>
          </div>
          <div className="rounded-xl border border-border p-3">
            <p className="font-display text-xl font-bold">
              {(() => {
                const total = quotes.length + bookings.length;
                const ok = quotes.filter((q) => q.status === "accepted").length + bookings.filter((b: any) => b.status === "confirmed").length;
                return total > 0 ? `${Math.round((ok / total) * 100)}%` : "—";
              })()}
            </p>
            <p className="text-[11px] text-muted-foreground">Conversión</p>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground mt-2">
          Estadísticas completas de 30 días con el plan Oficios.
        </p>
      </CollapsibleSection>
      </>
      )}

      {sec === "hoy" && (
        <ServicioHoy
          quotes={quotes}
          bookings={bookings}
          orders={isEstetica ? ordersProp : undefined}
          isEstetica={isEstetica}
          onNavigate={onNavigate}
        />
      )}

      {sec === "history" && (
        <ServicioHistorial
          quotes={quotes}
          bookings={bookings}
          isEstetica={isEstetica}
        />
      )}

      {sec === "clientes" && (
        canCrm ? (
          <CustomersManager
            serviceMode
            vendorId={vendor?.id || null}
            loyaltyEvery={(vendor as any)?.loyalty_every ?? null}
            loyaltyPct={(vendor as any)?.loyalty_pct ?? null}
          />
        ) : (
          <PlanLock
            title="Libro de clientes"
            description={`Tus clientes con su historial de trabajos y ${presupuestosLow}, notas y contacto directo por WhatsApp. Parte del plan Oficios.`}
          />
        )
      )}

      {quoteModalOpen && (
        <QuoteManualModal
          estetica={isEstetica}
          onClose={() => setQuoteModalOpen(false)}
          onCreated={() => {
            setQuoteModalOpen(false);
            setMsg(isEstetica ? "Consulta creada (no cuenta para el tope mensual)" : "Presupuesto creado (no cuenta para el tope mensual)");
            onQuotesChanged?.();
            reload();
          }}
        />
      )}

      {bookingModalOpen && (
        <BookingManualModal
          key={rebook ? `rebook-${rebook.customerPhone}-${rebook.serviceId}-${rebook.staffId}-${rebook.date || ""}` : "new"}
          onClose={() => { setBookingModalOpen(false); setRebook(null); }}
          initialDate={rebook?.date}
          serviceOptions={isEstetica ? catalogServices : undefined}
          staffOptions={isEstetica ? catalogStaff : undefined}
          locationOptions={isEstetica ? catalogLocations : undefined}
          initialCustomerName={rebook?.customerName}
          initialCustomerPhone={rebook?.customerPhone}
          initialServiceId={rebook?.serviceId}
          initialStaffId={rebook?.staffId}
          initialDurationMin={rebook?.durationMin}
          onCreated={(warning) => {
            setBookingModalOpen(false);
            setRebook(null);
            setMsg(warning || "Turno agendado (no cuenta para el tope mensual)");
            onQuotesChanged?.();
            reload();
          }}
        />
      )}
    </div>
  );
}
