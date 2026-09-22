"use client";

import { useState, useRef, useEffect } from "react";
import { LivePreview } from "@/components/dashboard/shared";
import { HoursEditor } from "@/components/dashboard/hours-editor";
import { LocationPicker } from "./location-picker";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MpConnectCard } from "@/components/dashboard/mp-connect-card";
import { VendorReviews } from "@/components/vendor/vendor-reviews";
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
  onCrop: (target: "cover" | "logo" | "offer") => void;
};

const BOOKING_STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-700",
  confirmed: "bg-green-100 text-green-700",
  cancelled: "bg-red-100 text-red-700",
};

const BOOKING_STATUS_LABELS: Record<string, string> = {
  pending: "Pendiente",
  confirmed: "Confirmado",
  cancelled: "Cancelado",
};

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
}: Props) {
  const [storeName, setStoreName] = useState(vendor?.store_name || "");
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

    // Bandeja de presupuestos (Fase 0: ver + responder estado/notas).
  const [quotes, setQuotes] = useState<Record<string, unknown>[]>([]);
  const [quotesLoading, setQuotesLoading] = useState(true);
  // Tope mensual de solicitudes (Fase 1: 5 combinadas en gratuito).
  const [quota, setQuota] = useState<{ used: number; limit: number | null } | null>(null);  const [quoteFilter, setQuoteFilter] = useState<"all" | "pending" | "responded" | "accepted" | "cancelled">("all");
  const [respondingId, setRespondingId] = useState<string | null>(null);
  const [respondNotes, setRespondNotes] = useState("");
  const [respondPrice, setRespondPrice] = useState("");
  const [canQuotePrice, setCanQuotePrice] = useState(false);
  const [canDeposits, setCanDeposits] = useState(false);
  // Seña: % + link generado.
  const [depositPct, setDepositPct] = useState("");
  const [depositLink, setDepositLink] = useState<Record<string, string>>({});
  const [depositBusy, setDepositBusy] = useState<string | null>(null);

  const loadQuotes = async () => {
    try {
      const res = await fetch("/api/vendor/quotes");
      const data = await res.json();
      if (!data.error) {
        setQuotes(data.quotes || []);
        setCanQuotePrice(data.canQuotePrice === true);
        setCanDeposits(data.canDeposits === true);
      }
    } catch { /* noop */ } finally {
      setQuotesLoading(false);
    }
  };

  useEffect(() => { loadQuotes(); }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/vendor/service-quota");
        const data = await res.json();
        if (!data.error) setQuota({ used: data.used || 0, limit: data.limit ?? null });
      } catch { /* noop */ }
    })();
  }, []);

  useEffect(() => {
    if (!vendor) return;
    setStoreName(vendor.store_name || "");
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
    setStorePreview(vendor.image_url || null);
    setLogoPreview(vendor.logo_url || null);
  }, [vendor]);

  const [storePreview, setStorePreview] = useState<string | null>(vendor?.image_url || null);
  const [logoPreview, setLogoPreview] = useState<string | null>(vendor?.logo_url || null);

  const [galleryUploading, setGalleryUploading] = useState(false);
  const [galleryCaptions, setGalleryCaptions] = useState<Record<string, string>>({});
  const [bookingFilter, setBookingFilter] = useState<"all" | "pending" | "confirmed" | "cancelled">("all");

  const fileInputRef = useRef<HTMLInputElement>(null);

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
    await saveVendor({
      store_name: storeName,
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
      services_list: servicesList,
      service_area: serviceArea,
      free_estimate: freeEstimate,
      urgent_enabled: urgentEnabled,
      urgent_surcharge_pct: urgentSurcharge === "" ? null : Number(urgentSurcharge),
      deposit_default_pct: depositDefault === "" ? null : Number(depositDefault),
      accepting_quotes: acceptingQuotes,
    });
  }

  async function handleGalleryUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setGalleryUploading(true);
    setMsg("");

    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("folder", "gallery");

      const uploadRes = await fetch("/api/vendor/upload", { method: "POST", body: fd });
      const uploadData = await uploadRes.json();

      if (!uploadData.url) {
        setMsg(uploadData.error || "Error al subir imagen");
        return;
      }

      const galleryRes = await fetch("/api/vendor/gallery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_url: uploadData.url }),
      });
      const galleryData = await galleryRes.json();

      if (galleryData.error) {
        setMsg(galleryData.error);
        return;
      }

      reload();
    } catch {
      setMsg("Error de conexión");
    } finally {
      setGalleryUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleDeleteGalleryImage(id: string) {
    try {
      const res = await fetch(`/api/vendor/gallery/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (data.error) {
        setMsg(data.error);
        return;
      }
      reload();
    } catch {
      setMsg("Error de conexión");
    }
  }

  async function handleUpdateBookingStatus(id: string, status: string) {
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
      reload();
    } catch {
      setMsg("Error de conexión");
    }
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
      setMsg(status === "cancelled" ? "Presupuesto descartado" : "Respuesta enviada");
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

  const waLinkFor = (phone: unknown) => {
    const digits = String(phone || "").replace(/\D/g, "");
    return digits ? `https://wa.me/${digits}` : null;
  };

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
      {quota && quota.limit != null && (
        <div className={`rounded-xl border px-4 py-3 text-sm ${quota.used >= quota.limit ? "bg-red-50 border-red-200 text-red-700" : "bg-muted border-border text-muted-foreground"}`}>
          {quota.used >= quota.limit ? (
            <p className="font-medium">
              Llegaste al tope de {quota.limit} solicitudes online del mes. Las nuevas llegan por WhatsApp.
              El plan Oficios las hace ilimitadas.
            </p>
          ) : (
            <p>
              Solicitudes online del mes: <strong className="text-foreground">{quota.used} de {quota.limit}</strong>
              {" "}(presupuestos + turnos).
            </p>
          )}
        </div>
      )}
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

      <CollapsibleSection icon="🔧" title="Tu servicio" defaultOpen badge="Servicio">
        <div className="space-y-3">
          <div>
            <Label>Tu vertical</Label>
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={vendor?.vertical || "servicio"}
              disabled
            >
              <option value="servicio">Servicio u oficio</option>
            </select>
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
          <Button onClick={handleSaveAll} className="w-full" disabled={uploading}>
            {uploading ? "Guardando..." : "Guardar cambios"}
          </Button>
        </div>
      </CollapsibleSection>

      <CollapsibleSection icon="📍" title="Ubicación y horarios">
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
          <Button onClick={handleSaveAll} className="w-full" disabled={uploading}>
            {uploading ? "Guardando..." : "Guardar cambios"}
          </Button>
        </div>
      </CollapsibleSection>

      <CollapsibleSection icon="📸" title="Fotos">
        <div className="space-y-3">
          <div>
            <Label>Foto de portada</Label>
            <Input
              type="file"
              accept="image/*"
              onChange={(e) => {
                const f = e.target.files?.[0] || null;
                if (f) {
                  const src = URL.createObjectURL(f);
                  setStorePreview(src);
                  onCrop("cover");
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
                  setLogoPreview(src);
                  onCrop("logo");
                }
              }}
            />
            {logoPreview && (
              <img src={logoPreview} alt="Logo" className="mt-2 h-16 w-16 object-cover rounded-full border" />
            )}
          </div>
          <Button onClick={handleSaveAll} className="w-full" disabled={uploading}>
            {uploading ? "Guardando..." : "Guardar fotos"}
          </Button>
        </div>
      </CollapsibleSection>

      <CollapsibleSection icon="📝" title="Descripción">
        <div className="space-y-3">
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Contá qué hacés, tu experiencia, especialidades..."
          />
          <Button onClick={handleSaveAll} className="w-full" disabled={uploading}>
            {uploading ? "Guardando..." : "Guardar"}
          </Button>
        </div>
      </CollapsibleSection>

      <CollapsibleSection icon="📱" title="Contacto">
        <div className="space-y-3">
          <div>
            <Label>WhatsApp</Label>
            <Input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="5492215550000" />
          </div>
          <div>
            <Label>Teléfono directo</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="2215550000" />
          </div>
          <Button onClick={handleSaveAll} className="w-full" disabled={uploading}>
            {uploading ? "Guardando..." : "Guardar contacto"}
          </Button>
        </div>
      </CollapsibleSection>

      <CollapsibleSection icon="🌐" title="Redes sociales">
        <div className="space-y-3">
          <div>
            <Label>Instagram</Label>
            <Input value={instagram} onChange={(e) => setInstagram(e.target.value)} placeholder="@tuservicio" />
          </div>
          <div>
            <Label>Facebook</Label>
            <Input value={facebook} onChange={(e) => setFacebook(e.target.value)} placeholder="https://facebook.com/tuservicio" />
          </div>
          <Button onClick={handleSaveAll} className="w-full" disabled={uploading}>
            {uploading ? "Guardando..." : "Guardar redes"}
          </Button>
        </div>
      </CollapsibleSection>

      <CollapsibleSection icon="🔧" title="Servicios que ofrecés" defaultOpen>
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
          <Button onClick={handleSaveAll} className="w-full" disabled={uploading}>
            {uploading ? "Guardando..." : "Guardar servicios"}
          </Button>
        </div>
      </CollapsibleSection>

      <CollapsibleSection icon="🚨" title="Urgencia 24hs">
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
          <Button onClick={handleSaveAll} className="w-full" disabled={uploading}>
            {uploading ? "Guardando..." : "Guardar configuración"}
          </Button>
        </div>
      </CollapsibleSection>

      <CollapsibleSection icon="🖼️" title={`Galería de trabajos (${gallery.length})`}>
        <div className="space-y-3">
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleGalleryUpload}
              className="hidden"
              id="gallery-upload"
            />
            <Button
              onClick={() => fileInputRef.current?.click()}
              disabled={galleryUploading}
              className="w-full"
              variant="outline"
            >
              {galleryUploading ? "Subiendo..." : "Agregar foto"}
            </Button>
          </div>

          {gallery.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              Todavía no subiste fotos de trabajos.
            </p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {gallery.map((item: any) => (
                <div key={item.id} className="border border-border rounded-lg overflow-hidden bg-background">
                  <div className="aspect-square relative">
                    <img
                      src={item.image_url}
                      alt={item.caption || "Trabajo"}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="p-2 space-y-1">
                    <Input
                      value={galleryCaptions[item.id] ?? item.caption ?? ""}
                      onChange={(e) =>
                        setGalleryCaptions((prev) => ({
                          ...prev,
                          [item.id]: e.target.value,
                        }))
                      }
                      placeholder="Descripción..."
                      className="h-7 text-xs"
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      className="w-full h-7 text-xs text-red-600"
                      onClick={() => handleDeleteGalleryImage(item.id)}
                    >
                      Eliminar
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </CollapsibleSection>

      <CollapsibleSection icon="📅" title={`Agenda de turnos (${bookings.length})`}>
        <div className="space-y-3">
          <div className="flex gap-1 flex-wrap">
            {(["all", "pending", "confirmed", "cancelled"] as const).map((status) => (
              <Button
                key={status}
                size="sm"
                variant={bookingFilter === status ? "default" : "outline"}
                onClick={() => setBookingFilter(status)}
                className="h-7 text-xs"
              >
                {status === "all"
                  ? `Todos (${bookings.length})`
                  : `${BOOKING_STATUS_LABELS[status]} (${bookings.filter((b: any) => b.status === status).length})`}
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
                          <Badge className={`flex-shrink-0 ${BOOKING_STATUS_COLORS[booking.status] || ""}`}>
                            {BOOKING_STATUS_LABELS[booking.status] || booking.status}
                          </Badge>
                        </div>
                        {booking.notes && (
                          <p className="text-xs text-muted-foreground mb-2 italic">
                            &quot;{booking.notes}&quot;
                          </p>
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
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs text-red-600"
                              onClick={() => handleUpdateBookingStatus(booking.id, "cancelled")}
                            >
                              Cancelar
                            </Button>
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
      <CollapsibleSection icon="💬" title={`Presupuestos (${quotes.length})`}>
        <div className="space-y-3">
          {!acceptingQuotes && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              No estás recibiendo presupuestos (apagado en “Servicios que ofrecés”).
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
              Todavía no recibiste presupuestos.
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
                      <Badge className="flex-shrink-0">{QUOTE_STATUS_LABELS[q.status] || q.status}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mb-2 break-words">{q.description}</p>
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
                              <div className="flex gap-2">
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
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </CollapsibleSection>
      <CollapsibleSection icon="💰" title="Cobros y seña">
        <div className="space-y-3">
          <MpConnectCard
            mpUserId={vendor?.mp_user_id ?? null}
            mpConnectedAt={vendor?.mp_connected_at ?? null}
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

      <CollapsibleSection icon="⭐" title="Reseñas">
        <VendorReviews />
      </CollapsibleSection>

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
    </div>
  );
}
