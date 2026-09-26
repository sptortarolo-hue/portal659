"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ConfigSaveBar, ConfigSection, ConfigSections } from "@/components/dashboard/config-sections";
import { Switch } from "@/components/ui/switch";
import { ChipToggle } from "@/components/ui/chip-toggle";
import { RadioCards } from "@/components/ui/radio-cards";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LivePreview, TransferConfig, DeliveryFeeConfig } from "@/components/dashboard/shared";
import { MpConnectCard } from "@/components/dashboard/mp-connect-card";
import { PrinterConfigSection } from "@/components/dashboard/printer-config-section";
import { FiscalConfigSection } from "@/components/dashboard/fiscal-config-section";
import { HoursEditor } from "@/components/dashboard/hours-editor";
import { LocationPicker } from "./location-picker";
import { StaffManager } from "@/components/vendor/staff-manager";
import type { Vendor, VendorGallery } from "@/types/database";

type Props = {
  vendor: Vendor | null;
  gallery: VendorGallery[];
  msg: string;
  setMsg: (m: string) => void;
  reload: () => void;
  saveVendor: (data: Record<string, unknown>) => Promise<void>;
  uploading: boolean;
  onCrop: (target: "cover" | "logo" | "offer") => void;
  /** Sección de Config controlada por la página (sidebar única). */
  configSectionId?: string;
  onConfigSectionId?: (id: string) => void;
};

const CATEGORY_SUGGESTIONS: Record<string, string[]> = {
  gastronomia: [
    "empanadas",
    "pizzas",
    "pastas",
    "asado",
    "postres",
    "regional",
    "rotisería",
    "comida casera",
    "sushi",
    "hamburguesas",
    "sándwiches",
    "ensaladas",
    "repostería",
    "helados",
    "bebidas",
    "otras",
  ],
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

const PREP_TIME_OPTIONS = [15, 20, 25, 30, 40, 50, 60];

export default function DashboardGastro({
  vendor,
  gallery,
  msg,
  setMsg,
  reload,
  saveVendor,
  uploading,
  onCrop,
  configSectionId,
  onConfigSectionId,
}: Props) {
  const [storeName, setStoreName] = useState(vendor?.store_name || "");
  const [storeCategory, setStoreCategory] = useState(vendor?.category || "otras");
  const [address, setAddress] = useState(vendor?.address || "");
  const [lat, setLat] = useState<number | null>(vendor?.lat ?? null);
  const [lng, setLng] = useState<number | null>(vendor?.lng ?? null);
  const [hours, setHours] = useState(vendor?.hours || "");
  const [description, setDescription] = useState(vendor?.description || "");
  const [whatsapp, setWhatsapp] = useState(vendor?.whatsapp || "");
  const [phone, setPhone] = useState(vendor?.phone || "");
  const [instagram, setInstagram] = useState(vendor?.instagram || "");
  const [facebook, setFacebook] = useState(vendor?.facebook || "");
  const [paymentMethods, setPaymentMethods] = useState<string[]>(
    vendor?.payment_methods
      ? vendor.payment_methods.split(", ").map((s: string) => s.trim()).filter(Boolean)
      : []
  );
  const [deliveryOptions, setDeliveryOptions] = useState(vendor?.delivery_options || "ambos");
  const [onlineOrders, setOnlineOrders] = useState(vendor?.accepts_online_orders !== false);
  const [cashDiscount, setCashDiscount] = useState(
    vendor?.cash_discount_pct != null ? String(vendor.cash_discount_pct) : ""
  );
  const [prepTimeMin, setPrepTimeMin] = useState(
    vendor?.prep_time_min || 30
  );

  const [storeFile, setStoreFile] = useState<File | null>(null);
  const [storePreview, setStorePreview] = useState<string | null>(vendor?.image_url || null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(vendor?.logo_url || null);

  const [saving, setSaving] = useState(false);

  const [galleryUploading, setGalleryUploading] = useState(false);
  const galleryFileRef = useRef<HTMLInputElement>(null);

  // La sección de impresora vive en PrinterConfigSection (compartida con el
  // dashboard de comercio): tiene su propio estado cola/token/modo y escucha
  // el evento "portal:open-printer-config" para abrirse sola.

  useEffect(() => {
    setStoreName(vendor?.store_name || "");
    setStoreCategory(vendor?.category || "otras");
    setAddress(vendor?.address || "");
    setLat(vendor?.lat ?? null);
    setLng(vendor?.lng ?? null);
    setHours(vendor?.hours || "");
    setDescription(vendor?.description || "");
    setWhatsapp(vendor?.whatsapp || "");
    setPhone(vendor?.phone || "");
    setInstagram(vendor?.instagram || "");
    setFacebook(vendor?.facebook || "");
    setPaymentMethods(
      vendor?.payment_methods
        ? vendor.payment_methods.split(", ").map((s: string) => s.trim()).filter(Boolean)
        : []
    );
    setDeliveryOptions(vendor?.delivery_options || "ambos");
    setOnlineOrders(vendor?.accepts_online_orders !== false);
    setCashDiscount(vendor?.cash_discount_pct != null ? String(vendor.cash_discount_pct) : "");
    setPrepTimeMin(vendor?.prep_time_min || 30);
    setStorePreview(vendor?.image_url || null);
    setLogoPreview(vendor?.logo_url || null);
  }, [vendor]);

  const handleSave = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMsg("");

    const data: Record<string, unknown> = {
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
      payment_methods: paymentMethods.join(", "),
      delivery_options: deliveryOptions,
      prep_time_min: prepTimeMin,
      cash_discount_pct: cashDiscount === "" ? null : Number(cashDiscount),
    };

    if (storeFile) {
      const fd = new FormData();
      fd.append("file", storeFile);
      fd.append("folder", "vendors");
      try {
        const res = await fetch("/api/vendor/upload", { method: "POST", body: fd });
        const uploaded = await res.json();
        if (uploaded.url) {
          data.image_url = uploaded.url;
        } else {
          setMsg("No se pudo subir la foto del comercio");
          setSaving(false);
          return;
        }
      } catch {
        setMsg("Error al subir la foto del comercio");
        setSaving(false);
        return;
      }
    }

    if (logoFile) {
      const fd = new FormData();
      fd.append("file", logoFile);
      fd.append("folder", "vendors");
      try {
        const res = await fetch("/api/vendor/upload", { method: "POST", body: fd });
        const uploaded = await res.json();
        if (uploaded.url) {
          data.logo_url = uploaded.url;
        } else {
          setMsg("No se pudo subir el logo");
          setSaving(false);
          return;
        }
      } catch {
        setMsg("Error al subir el logo");
        setSaving(false);
        return;
      }
    }

    await saveVendor(data);
    setStoreFile(null);
    setLogoFile(null);
    setSaving(false);
  }, [
    storeName, storeCategory, address, lat, lng, hours, description,
    whatsapp, phone, instagram, facebook, paymentMethods,
    deliveryOptions, prepTimeMin, cashDiscount,
    storeFile, logoFile, saveVendor, setMsg,
  ]);

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
      if (!uploadData.url) { setMsg(uploadData.error || "Error al subir imagen"); return; }
      const galleryRes = await fetch("/api/vendor/gallery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_url: uploadData.url }),
      });
      const galleryData = await galleryRes.json();
      if (galleryData.error) { setMsg(galleryData.error); return; }
      reload();
    } catch { setMsg("Error de conexión"); }
    finally { setGalleryUploading(false); if (galleryFileRef.current) galleryFileRef.current.value = ""; }
  }

  async function handleDeleteGalleryImage(id: string) {
    try {
      const res = await fetch(`/api/vendor/gallery/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (data.error) { setMsg(data.error); return; }
      reload();
    } catch { setMsg("Error de conexión"); }
  }

  return (
    <form onSubmit={handleSave} className="space-y-4">
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

      <ConfigSections storageKey="portal659-config-gastro" openEvents={[{ event: "portal:open-printer-config", sectionId: "impresora" }]} activeId={configSectionId} onActiveChange={onConfigSectionId}>
      <ConfigSection id="perfil" label="Perfil" icon="🏪">
        <div className="space-y-3">
          <div>
            <Label>Nombre</Label>
            <Input
              value={storeName}
              onChange={(e) => setStoreName(e.target.value)}
              required
            />
          </div>
          <div>
            <Label>Categoría</Label>
            <input
              list="cat-suggestions-gastro"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={storeCategory}
              onChange={(e) => setStoreCategory(e.target.value)}
              placeholder="Ej: empanadas, pizzas..."
            />
            <datalist id="cat-suggestions-gastro">
              {(CATEGORY_SUGGESTIONS.gastronomia || []).map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
        </div>
      </ConfigSection>

      <ConfigSection id="ubicacion" label="Ubicación y horarios" icon="📍">
        <div className="space-y-3">
          <div>
            <Label>Dirección</Label>
            <Input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Calle y número"
            />
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

      <ConfigSection id="perfil" label="Perfil" icon="🏪">
        <div className="space-y-3">
          <div>
            <Label>Foto del comercio</Label>
            <Input
              type="file"
              accept="image/*"
              onChange={(e) => {
                const f = e.target.files?.[0] || null;
                if (f) {
                  setStoreFile(f);
                  setStorePreview(URL.createObjectURL(f));
                  onCrop("cover");
                }
              }}
            />
            {storePreview && (
              <img
                src={storePreview}
                alt="Vista previa"
                className="mt-2 h-24 w-full object-cover rounded-lg"
              />
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
                  setLogoFile(f);
                  setLogoPreview(URL.createObjectURL(f));
                  onCrop("logo");
                }
              }}
            />
            {logoPreview && (
              <img
                src={logoPreview}
                alt="Logo"
                className="mt-2 h-16 w-16 object-cover rounded-full border"
              />
            )}
          </div>
        </div>
      </ConfigSection>

      <ConfigSection id="perfil" label="Perfil" icon="🏪">
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Contá qué hacés..."
        />
      </ConfigSection>

      <ConfigSection id="contacto" label="Contacto y redes" icon="📱">
        <div className="space-y-3">
          <div>
            <Label>WhatsApp</Label>
            <Input
              value={whatsapp}
              onChange={(e) => setWhatsapp(e.target.value)}
              placeholder="5492215550000"
            />
          </div>
          <div>
            <Label>Teléfono directo</Label>
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="2215550000"
            />
          </div>
        </div>
      </ConfigSection>

      <ConfigSection id="contacto" label="Contacto y redes" icon="📱">
        <div className="space-y-3">
          <div>
            <Label>Instagram</Label>
            <Input
              value={instagram}
              onChange={(e) => setInstagram(e.target.value)}
              placeholder="@tulocal"
            />
          </div>
          <div>
            <Label>Facebook</Label>
            <Input
              value={facebook}
              onChange={(e) => setFacebook(e.target.value)}
              placeholder="https://facebook.com/tulocal"
            />
          </div>
        </div>
      </ConfigSection>

      <ConfigSection id="pagos" label="Pagos y entrega" icon="💳">
        <div className="space-y-4">
          <div>
            <Label className="mb-2 block">Medios de pago</Label>
            <ChipToggle
              options={PAYMENT_OPTIONS}
              value={paymentMethods}
              onChange={setPaymentMethods}
            />
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
          <div>
            <Label className="mb-2 block">Entrega</Label>
            <RadioCards
              options={DELIVERY_OPTIONS}
              value={deliveryOptions}
              onChange={setDeliveryOptions}
            />
          </div>
          {deliveryOptions !== "retiro" && (
            <DeliveryFeeConfig vendor={vendor} saveVendor={saveVendor} />
          )}
          <div className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2.5">
            <div>
              <Label className="text-sm">Aceptar pedidos online</Label>
              <p className="text-xs text-muted-foreground">
                {onlineOrders
                  ? "Tu micrositio muestra carrito y toman pedidos por la app."
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
        </div>
      </ConfigSection>

      <ConfigSection id="equipo" label="Equipo y preparación" icon="⏱️">
        <div className="space-y-3">
            <div>
              <Label>Tiempo de preparación</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Aparece como &quot;⏱️ X min&quot; en tu micrositio y cuenta como referencia del pedido.
              </p>
              <div className="flex flex-wrap gap-2 mt-2">
                {PREP_TIME_OPTIONS.map((min) => (
                  <button
                    key={min}
                    type="button"
                    onClick={() => setPrepTimeMin(min)}
                    className={`flex-1 min-w-0 rounded-lg border-2 px-3 py-2 text-sm font-medium transition-colors ${
                      prepTimeMin === min
                        ? "border-primary bg-primary/5 text-primary"
                        : "border-border bg-card text-muted-foreground hover:border-primary/30"
                    }`}
                  >
                    {min} min
                  </button>
                ))}
              </div>
              <div className="mt-2">
                <Input
                  type="number"
                  min={10}
                  max={180}
                  value={prepTimeMin}
                  onChange={(e) => setPrepTimeMin(Number(e.target.value) || 30)}
                />
              </div>
              <p className="text-xs text-muted-foreground mt-1 text-center">
                ⏱️ {prepTimeMin} min
              </p>
            </div>
        </div>
      </ConfigSection>

      <ConfigSection id="equipo" label="Equipo y preparación" icon="⏱️">
        <StaffManager storeName={vendor?.store_name} />
      </ConfigSection>

      <ConfigSection id="impresora" label="Impresora" icon="🖨️" status={vendor?.printer_ip || vendor?.print_mode ? "ok" : "off"}>
      <PrinterConfigSection vendor={vendor} saveVendor={saveVendor} setMsg={setMsg} />
      </ConfigSection>

      <ConfigSection id="fiscal" label="Facturación" icon="🧾" status={vendor?.fiscal_cert ? "ok" : vendor?.cuit ? "warn" : "off"}>
      <FiscalConfigSection defaultOpen />
      </ConfigSection>

      <ConfigSection id="menu" label="Menú" icon="🍽️">
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Platos, categorías, opciones, precios por volumen e importación de Excel ahora se
            gestionan desde la pestaña <strong>Menú</strong>, en un panel integrado.
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={() => window.dispatchEvent(new CustomEvent("portal:go-menu"))}
          >
            🍽️ Ir al Menú
          </Button>
        </div>
      </ConfigSection>

      <ConfigSection id="perfil" label="Perfil" icon="🏪" badge={gallery.length > 0 ? String(gallery.length) : undefined}>
        <div className="space-y-3">
          <input ref={galleryFileRef} type="file" accept="image/*" onChange={handleGalleryUpload} className="hidden" />
          <Button type="button" onClick={() => galleryFileRef.current?.click()} disabled={galleryUploading} className="w-full" variant="outline">
            {galleryUploading ? "Subiendo..." : "Agregar foto"}
          </Button>
          {gallery.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">Todavía no subiste fotos.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {gallery.map((item: any) => (
                <div key={item.id} className="border border-border rounded-lg overflow-hidden bg-background">
                  <div className="aspect-square relative">
                    <img src={item.image_url} alt={item.caption || "Foto"} className="w-full h-full object-cover" />
                  </div>
                  <Button type="button" size="sm" variant="ghost" className="w-full h-7 text-xs text-red-600" onClick={() => handleDeleteGalleryImage(item.id)}>
                    Eliminar
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </ConfigSection>
      </ConfigSections>

      {msg && (
        <p className="text-sm text-red-600">{msg}</p>
      )}

      <ConfigSaveBar saving={saving} onDiscard={() => { setMsg(""); reload(); }} />
    </form>
  );
}
