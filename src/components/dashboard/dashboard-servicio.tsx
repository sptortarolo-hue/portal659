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

  return (
    <div className="space-y-4">
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
            <div className="rounded-lg bg-orange-50 border border-orange-200 p-3">
              <p className="text-sm text-orange-700 font-medium">
                🚨 Atención de emergencias activada
              </p>
              <p className="text-xs text-orange-600 mt-1">
                Los visitantes verán un botón naranja destacado en tu micrositio para contactarte por urgencias.
              </p>
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
                              {booking.products?.name && ` · ${booking.products.name}`}
                            </p>
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
    </div>
  );
}
