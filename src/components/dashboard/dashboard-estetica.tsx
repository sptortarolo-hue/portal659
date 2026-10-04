"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ConfigSection, ConfigSections } from "@/components/dashboard/config-sections";
import { PushAlertCard } from "@/components/dashboard/push-alert-card";
import { WaRemindersCard } from "@/components/dashboard/wa-reminders-card";
import { Switch } from "@/components/ui/switch";
import { ChipToggle } from "@/components/ui/chip-toggle";
import { RadioCards } from "@/components/ui/radio-cards";
import {
  LivePreview,
  TransferConfig,
  DeliveryFeeConfig,
} from "@/components/dashboard/shared";
import { MpConnectCard } from "@/components/dashboard/mp-connect-card";
import { StripeConnectCard } from "@/components/dashboard/stripe-connect-card";
import { PrinterConfigSection } from "@/components/dashboard/printer-config-section";
import { HoursEditor } from "@/components/dashboard/hours-editor";
import { GalleryManager } from "@/components/dashboard/gallery-manager";
import { LocationPicker } from "./location-picker";
import {
  EsteticaServicesManager,
  EsteticaStaffManager,
  EsteticaCancelPolicy,
  EsteticaPacksManager,
  EsteticaCommissionsReport,
  EsteticaGiftcardsManager,
  EsteticaLocationsManager,
} from "@/components/dashboard/estetica-managers";
import { FormTemplateManager } from "@/components/dashboard/form-template-manager";
import type { Vendor, Product, ProductModifier } from "@/types/database";

const VERTICAL_OPTIONS = [
  { value: "gastronomia", label: "Gastronomía (comida, rotisería)" },
  { value: "comercio", label: "Comercio del barrio" },
  { value: "servicio", label: "Servicio u oficio" },
  { value: "moda", label: "Ropa y accesorios" },
  { value: "salud", label: "Salud y bienestar (farmacia, peluquería)" },
  { value: "estetica", label: "Estética y belleza (uñas, pestañas, cejas, masajes)" },
  { value: "otro", label: "Otro" },
] as const;

const CATEGORY_SUGGESTIONS: Record<string, string[]> = {
  estetica: ["uñas", "pestañas", "cejas", "masajes", "peluquería", "depilación", "maquillaje", "facial", "corporal", "otros"],
  otro: ["otros"],
};

const PAYMENT_OPTIONS = [
  { label: "Efectivo", value: "Efectivo", icon: "💵" },
  { label: "Débito", value: "Débito", icon: "💳" },
  { label: "Crédito", value: "Crédito", icon: "💳" },
  { label: "Mercado Pago", value: "Mercado Pago", icon: "📱" },
  { label: "Transferencia", value: "Transferencia", icon: "🏦" },
];

const DELIVERY_OPTIONS = [
  { label: "Retiro", value: "retiro", icon: "🏠", desc: "en local" },
  { label: "Domicilio", value: "domicilio", icon: "🚗", desc: "" },
  { label: "Ambos", value: "ambos", icon: "🔄", desc: "" },
];

const PREF_DAY_LABELS: Record<string, string> = {
  lun: "Lun", mar: "Mar", mie: "Mié", jue: "Jue", vie: "Vie", sab: "Sáb", dom: "Dom",
};
const PREF_DAY_IDS = ["lun", "mar", "mie", "jue", "vie", "sab", "dom"];
const PREF_SLOT_OPTIONS = ["mañana", "tarde", "noche"];

type MenuCategory = { id: string; name: string; position: number };

type Props = {
  vendor: Vendor | null;
  offers: Product[];
  categories: MenuCategory[];
  modifiers: ProductModifier[];
  msg: string;
  setMsg: (m: string) => void;
  reload: () => void;
  saveVendor: (data: Record<string, unknown>) => Promise<void>;
  uploading: boolean;
  onCrop: (target: "cover" | "logo" | "offer", src?: string) => void;
  /** Sección de Config controlada por la página (sidebar única). */
  configSectionId?: string;
  onConfigSectionId?: (id: string) => void;
};

/**
 * Configuración del centro de estética con pantallas individuales
 * (mismo patrón que gastronomía/comercio/moda). La operación diaria
 * (Hoy, Consultas, Turnos, Pedidos, Mostrador, Caja, Clientes) vive en
 * sus propias pestañas; acá solo configuración.
 */
export default function DashboardEstetica({
  vendor,
  msg,
  setMsg,
  saveVendor,
  uploading,
  onCrop,
  configSectionId,
  onConfigSectionId,
}: Props) {
  // Perfil.
  const [storeName, setStoreName] = useState(vendor?.store_name || "");
  const [storeVertical, setStoreVertical] = useState(vendor?.vertical || "estetica");
  const [storeCategory, setStoreCategory] = useState(vendor?.category || "otros");
  const [description, setDescription] = useState(vendor?.description || "");
  const [storePreview, setStorePreview] = useState<string | null>(vendor?.image_url || null);
  const [logoPreview, setLogoPreview] = useState<string | null>(vendor?.logo_url || null);
  const [storeFile, setStoreFile] = useState<File | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  // Ubicación.
  const [address, setAddress] = useState(vendor?.address || "");
  const [lat, setLat] = useState<number | null>(vendor?.lat ?? null);
  const [lng, setLng] = useState<number | null>(vendor?.lng ?? null);
  const [hours, setHours] = useState(vendor?.hours || "");
  // Contacto.
  const [whatsapp, setWhatsapp] = useState(vendor?.whatsapp || "");
  const [phone, setPhone] = useState(vendor?.phone || "");
  const [instagram, setInstagram] = useState(vendor?.instagram || "");
  const [facebook, setFacebook] = useState(vendor?.facebook || "");
  // Pagos.
  const [paymentMethods, setPaymentMethods] = useState<string[]>(
    vendor?.payment_methods
      ? vendor.payment_methods.split(",").map((s: string) => s.trim()).filter(Boolean)
      : []
  );
  const [cashDiscount, setCashDiscount] = useState(
    vendor?.cash_discount_pct != null ? String(vendor.cash_discount_pct) : ""
  );
  const [deliveryOptions, setDeliveryOptions] = useState(vendor?.delivery_options || "ambos");
  const [onlineOrders, setOnlineOrders] = useState(vendor?.accepts_online_orders !== false);
  // Turnera.
  const [bookingsEnabled, setBookingsEnabled] = useState(vendor?.bookings_enabled !== false);
  const [acceptingQuotes, setAcceptingQuotes] = useState(vendor?.accepting_quotes !== false);
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
  const [cancelPolicy, setCancelPolicy] = useState(
    typeof vendor?.cancel_policy_text === "string" ? vendor.cancel_policy_text : ""
  );
  const [cancelHours, setCancelHours] = useState(
    (vendor as any)?.cancel_hours != null ? String((vendor as any).cancel_hours) : "24"
  );
  const [googleReviewUrl, setGoogleReviewUrl] = useState(
    typeof vendor?.google_review_url === "string" ? vendor.google_review_url : ""
  );
  const [loyaltyEvery, setLoyaltyEvery] = useState(
    (vendor as any)?.loyalty_every != null ? String((vendor as any).loyalty_every) : ""
  );
  const [loyaltyPct, setLoyaltyPct] = useState(
    (vendor as any)?.loyalty_pct != null ? String((vendor as any).loyalty_pct) : ""
  );
  const [depositDefault, setDepositDefault] = useState(
    vendor?.deposit_default_pct != null ? String(vendor.deposit_default_pct) : ""
  );

  useEffect(() => {
    if (!vendor) return;
    setStoreName(vendor.store_name || "");
    setStoreVertical(vendor.vertical || "estetica");
    setStoreCategory(vendor.category || "otros");
    setDescription(vendor.description || "");
    setAddress(vendor.address || "");
    setLat(vendor.lat ?? null);
    setLng(vendor.lng ?? null);
    setHours(vendor.hours || "");
    setWhatsapp(vendor.whatsapp || "");
    setPhone(vendor.phone || "");
    setInstagram(vendor.instagram || "");
    setFacebook(vendor.facebook || "");
    setPaymentMethods(
      vendor.payment_methods
        ? vendor.payment_methods.split(",").map((s: string) => s.trim()).filter(Boolean)
        : []
    );
    setCashDiscount(vendor.cash_discount_pct != null ? String(vendor.cash_discount_pct) : "");
    setDeliveryOptions(vendor.delivery_options || "ambos");
    setOnlineOrders(vendor.accepts_online_orders !== false);
    setBookingsEnabled(vendor.bookings_enabled !== false);
    setAcceptingQuotes(vendor.accepting_quotes !== false);
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
    setGoogleReviewUrl(typeof vendor.google_review_url === "string" ? vendor.google_review_url : "");
    setLoyaltyEvery((vendor as any)?.loyalty_every != null ? String((vendor as any).loyalty_every) : "");
    setLoyaltyPct((vendor as any)?.loyalty_pct != null ? String((vendor as any).loyalty_pct) : "");
    setDepositDefault(vendor.deposit_default_pct != null ? String(vendor.deposit_default_pct) : "");
    setStorePreview(vendor.image_url || null);
    setLogoPreview(vendor.logo_url || null);
  }, [vendor]);

  async function uploadPhoto(file: File): Promise<string | null> {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("folder", "vendors");
    try {
      const res = await fetch("/api/vendor/upload", { method: "POST", body: fd });
      const uploaded = await res.json();
      return uploaded.url || null;
    } catch {
      return null;
    }
  }

  async function savePerfil() {
    let imageUrl = vendor?.image_url || null;
    let logoUrl = vendor?.logo_url || null;
    if (storeFile) {
      const url = await uploadPhoto(storeFile);
      if (!url) {
        setMsg("No se pudo subir la foto del comercio");
        return;
      }
      imageUrl = url;
      setStoreFile(null);
    }
    if (logoFile) {
      const url = await uploadPhoto(logoFile);
      if (!url) {
        setMsg("No se pudo subir el logo");
        return;
      }
      logoUrl = url;
      setLogoFile(null);
    }
    try {
      await saveVendor({
        store_name: storeName,
        vertical: storeVertical,
        category: storeCategory,
        description,
        image_url: imageUrl,
        logo_url: logoUrl,
      });
      setMsg("Perfil guardado");
    } catch {
      setMsg("Error al guardar");
    }
  }

  async function saveUbicacion() {
    try {
      await saveVendor({ address, lat, lng, hours });
      setMsg("Ubicación y horarios guardados");
    } catch {
      setMsg("Error al guardar");
    }
  }

  async function saveContacto() {
    try {
      await saveVendor({ whatsapp, phone, instagram, facebook, google_review_url: googleReviewUrl.trim() || null });
      setMsg("Contacto guardado");
    } catch {
      setMsg("Error al guardar");
    }
  }

  async function savePagos() {
    try {
      await saveVendor({
        payment_methods: paymentMethods.join(", "),
        cash_discount_pct: cashDiscount === "" ? null : Number(cashDiscount),
        delivery_options: deliveryOptions,
        accepts_online_orders: onlineOrders,
        deposit_default_pct: depositDefault === "" ? null : Number(depositDefault),
      });
      setMsg("Pagos guardados");
    } catch {
      setMsg("Error al guardar");
    }
  }

  async function saveTurnera() {
    try {
      await saveVendor({
        bookings_enabled: bookingsEnabled,
        accepting_quotes: acceptingQuotes,
        quote_pref_enabled: quotePrefEnabled,
        quote_days: quoteDays,
        quote_slots: quoteSlots,
        cancel_policy_text: cancelPolicy.trim() || null,
        cancel_hours: cancelHours === "" ? 24 : Math.max(0, Number(cancelHours) || 0),
      });
      setMsg("Turnera guardada");
    } catch {
      setMsg("Error al guardar");
    }
  }

  function handleCoverFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) {
      const src = URL.createObjectURL(f);
      setStoreFile(f);
      onCrop("cover", src);
    }
  }

  function handleLogoFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) {
      const src = URL.createObjectURL(f);
      setLogoFile(f);
      onCrop("logo", src);
    }
  }

  return (
    <div className="space-y-4">
      <LivePreview
        storeName={storeName}
        storePreview={storePreview}
        vendor={vendor}
        logoPreview={logoPreview}
        description={description}
        hours={hours}
        address={address}
        paymentMethods={paymentMethods}
        whatsapp={whatsapp}
        isService={false}
      />
      <ConfigSections storageKey="portal659-config-estetica" activeId={configSectionId} onActiveChange={onConfigSectionId}>
        <ConfigSection id="perfil" label="Perfil" icon="🏪">
          <div className="space-y-3">
            <div>
              <Label>Tipo</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={storeVertical}
                onChange={(e) => setStoreVertical(e.target.value as typeof storeVertical)}
              >
                {VERTICAL_OPTIONS.map((v) => (
                  <option key={v.value} value={v.value}>
                    {v.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label>Nombre del centro</Label>
              <Input value={storeName} onChange={(e) => setStoreName(e.target.value)} required />
            </div>
            <div>
              <Label>Categoría</Label>
              <input
                list="cat-suggestions-estetica"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={storeCategory}
                onChange={(e) => setStoreCategory(e.target.value)}
                placeholder="Ej: uñas, pestañas..."
              />
              <datalist id="cat-suggestions-estetica">
                {(CATEGORY_SUGGESTIONS[storeVertical] || CATEGORY_SUGGESTIONS.otro).map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
            <div>
              <Label>Foto del centro</Label>
              <Input type="file" accept="image/*" onChange={handleCoverFileSelect} />
              {storePreview && (
                <img src={storePreview} alt="Vista previa" className="mt-2 h-24 w-full object-cover rounded-lg" />
              )}
            </div>
            <div>
              <Label>Logo</Label>
              <Input type="file" accept="image/*" onChange={handleLogoFileSelect} />
              {logoPreview && (
                <img src={logoPreview} alt="Logo" className="mt-2 h-16 w-16 object-cover rounded-full border" />
              )}
            </div>
            <div>
              <Label>Descripción</Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Contá qué servicios ofrecés..."
              />
            </div>
            <GalleryManager
              title="Galería de trabajos"
              emptyText="Todavía no subiste fotos de tus trabajos."
              captionPlaceholder="Ej: semipermanente, lifting..."
            />
            <Button onClick={savePerfil} className="w-full" disabled={uploading}>
              {uploading ? "Guardando..." : "Guardar perfil"}
            </Button>
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
            <Button onClick={saveUbicacion} className="w-full" disabled={uploading}>
              {uploading ? "Guardando..." : "Guardar ubicación"}
            </Button>
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
              <Input value={instagram} onChange={(e) => setInstagram(e.target.value)} placeholder="@tucentro" />
            </div>
            <div>
              <Label>Facebook</Label>
              <Input value={facebook} onChange={(e) => setFacebook(e.target.value)} placeholder="https://facebook.com/tucentro" />
            </div>
            <div>
              <Label>Link a tus reseñas de Google (opcional)</Label>
              <Input value={googleReviewUrl} onChange={(e) => setGoogleReviewUrl(e.target.value)} placeholder="https://g.page/..." />
              <p className="text-xs text-muted-foreground mt-1">
                Se usa para pedir opinión automáticamente después de cada visita.
              </p>
            </div>
            <Button onClick={saveContacto} className="w-full" disabled={uploading}>
              {uploading ? "Guardando..." : "Guardar contacto"}
            </Button>
          </div>
        </ConfigSection>

        <ConfigSection id="pagos" label="Pagos y venta online" icon="💳">
          <div className="space-y-4">
            <div>
              <Label className="mb-2 block">Medios de pago</Label>
              <ChipToggle options={PAYMENT_OPTIONS} value={paymentMethods} onChange={setPaymentMethods} />
            </div>
            {paymentMethods.includes("Transferencia") && (
              <TransferConfig vendor={vendor} saveVendor={saveVendor} />
            )}
            {paymentMethods.includes("Efectivo") && (
              <div>
                <Label className="mb-2 block">Descuento en efectivo (%)</Label>
                <Input
                  type="number"
                  min={0}
                  max={99}
                  step="any"
                  value={cashDiscount}
                  onChange={(e) => setCashDiscount(e.target.value)}
                  placeholder="Ej: 10"
                  className="max-w-40"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Se muestra junto a cada precio y se descuenta solo al pagar en efectivo.
                </p>
              </div>
            )}
            <MpConnectCard
              mpUserId={vendor?.mp_user_id ?? null}
              mpConnectedAt={vendor?.mp_connected_at ?? null}
            />
            <StripeConnectCard
              stripeAccountId={vendor?.stripe_account_id ?? null}
              stripeConnectedAt={vendor?.stripe_connected_at ?? null}
            />
            <div>
              <Label className="mb-2 block">Entrega de productos</Label>
              <RadioCards options={DELIVERY_OPTIONS} value={deliveryOptions} onChange={setDeliveryOptions} />
            </div>
            {deliveryOptions !== "retiro" && (
              <DeliveryFeeConfig vendor={vendor} saveVendor={saveVendor} />
            )}
            <div className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2.5">
              <div>
                <Label className="text-sm">Aceptar pedidos online</Label>
                <p className="text-xs text-muted-foreground">
                  {onlineOrders
                    ? "Tu micrositio muestra carrito y te llegan pedidos por la app."
                    : "Apagado: solo contacto por WhatsApp, sin carrito."}
                </p>
              </div>
              <Switch
                checked={onlineOrders}
                onCheckedChange={async (v) => {
                  setOnlineOrders(v);
                  await saveVendor({ accepts_online_orders: v });
                }}
              />
            </div>
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
                Se usa al generar links de cobro (podés cambiarla caso por caso). Cobrar seña online es del plan Oficios.
              </p>
            </div>
            <Button onClick={savePagos} className="w-full" disabled={uploading}>
              {uploading ? "Guardando..." : "Guardar pagos"}
            </Button>
          </div>
        </ConfigSection>

        <ConfigSection id="turnera" label="Turnera" icon="📅">
          <div className="space-y-3">
            <EsteticaServicesManager />
            <EsteticaStaffManager />
            <EsteticaLocationsManager />
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
                <p className="text-sm font-medium">Recibir consultas</p>
                <p className="text-xs text-muted-foreground">
                  Si lo apagás, el formulario de consultas desaparece del micrositio
                </p>
              </div>
              <Switch checked={acceptingQuotes} onCheckedChange={setAcceptingQuotes} />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
              <div>
                <p className="text-sm font-medium">Preferencias en consultas</p>
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
            <EsteticaCancelPolicy
              policy={cancelPolicy}
              hours={cancelHours}
              onPolicy={setCancelPolicy}
              onHours={setCancelHours}
            />
            <Button onClick={saveTurnera} className="w-full" disabled={uploading}>
              {uploading ? "Guardando..." : "Guardar turnera"}
            </Button>
          </div>
        </ConfigSection>

        <ConfigSection id="fichas" label="Fichas" icon="📋">
          <FormTemplateManager />
        </ConfigSection>

        <ConfigSection id="packs" label="Packs y regalos" icon="🎁">
          <div className="space-y-3">
            <EsteticaPacksManager />
            <EsteticaGiftcardsManager />
            <EsteticaCommissionsReport />
            <Card className="p-4 space-y-3">
              <div>
                <p className="font-medium text-sm">⭐ Fidelización</p>
                <p className="text-xs text-muted-foreground">
                  Cada N sesiones la clienta gana % off (lo aplicás al cobrar). El panel muestra su progreso en Clientes.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Cada N sesiones</Label>
                  <Input value={loyaltyEvery} onChange={(e) => setLoyaltyEvery(e.target.value)} inputMode="numeric" placeholder="Ej: 8" className="mt-1 h-9 text-sm" />
                </div>
                <div>
                  <Label className="text-xs">% off (vacío = apagado)</Label>
                  <Input value={loyaltyPct} onChange={(e) => setLoyaltyPct(e.target.value)} inputMode="decimal" placeholder="Ej: 20" className="mt-1 h-9 text-sm" />
                </div>
              </div>
              <Button
                size="sm"
                className="w-full"
                disabled={uploading}
                onClick={async () => {
                  try {
                    await saveVendor({
                      loyalty_every: loyaltyEvery === "" ? null : Number(loyaltyEvery),
                      loyalty_pct: loyaltyPct === "" ? null : Number(loyaltyPct),
                    });
                    setMsg("Fidelización guardada");
                  } catch {
                    setMsg("Error al guardar");
                  }
                }}
              >
                Guardar fidelización
              </Button>
            </Card>
          </div>
        </ConfigSection>

        <ConfigSection id="impresora" label="Impresora" icon="🖨️" status={vendor?.printer_ip || vendor?.print_mode ? "ok" : "off"}>
          <PrinterConfigSection
            vendor={vendor}
            saveVendor={saveVendor}
            setMsg={setMsg}
            autoPrintDesc="Imprime el comprobante automáticamente cuando entra un pedido online pago"
          />
        </ConfigSection>

        <ConfigSection id="alertas" label="Alertas" icon="🔔">
          <div className="space-y-3">
            <PushAlertCard />
            <WaRemindersCard />
          </div>
        </ConfigSection>
      </ConfigSections>
      {msg && <p className="text-sm text-muted-foreground">{msg}</p>}
    </div>
  );
}
