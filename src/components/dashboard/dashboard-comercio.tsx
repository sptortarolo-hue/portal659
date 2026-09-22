"use client";

import { useState, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { Switch } from "@/components/ui/switch";
import { QuantityInput } from "@/components/ui/quantity-input";
import { ChipToggle } from "@/components/ui/chip-toggle";
import { RadioCards } from "@/components/ui/radio-cards";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  CategoryManager,
  LivePreview,
  apiJson,
  TransferConfig,
  DeliveryFeeConfig,
} from "@/components/dashboard/shared";
import { MpConnectCard } from "@/components/dashboard/mp-connect-card";
import { PrinterConfigSection } from "@/components/dashboard/printer-config-section";
import { HoursEditor } from "@/components/dashboard/hours-editor";
import { LocationPicker } from "./location-picker";
import { ModifierLibrary } from "@/components/dashboard/modifier-editor";
import type { Vendor, Product, ProductModifier } from "@/types/database";

type Offer = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  category: string | null;
  available: boolean;
  featured_today: boolean;
  image_url: string | null;
  stock: number | null;
  stock_low_threshold: number | null;
  promo_price: number | null;
};

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
  onCrop: (target: "cover" | "logo" | "offer") => void;
};

const VERTICAL_OPTIONS = [
  { value: "gastronomia", label: "Gastronomía (comida, rotisería)" },
  { value: "comercio", label: "Comercio del barrio (almacén, verdulería, carnicería, kiosco, librería, ferretería, floristería, pet shop, veterinaria)" },
  { value: "servicio", label: "Servicio u oficio (sin menú)" },
  { value: "moda", label: "Ropa y accesorios" },
  { value: "salud", label: "Salud y bienestar (farmacia, peluquería)" },
  { value: "otro", label: "Otro" },
] as const;

const CATEGORY_SUGGESTIONS: Record<string, string[]> = {
  gastronomia: ["empanadas", "pizzas", "pastas", "asado", "postres", "regional", "rotisería", "comida casera", "otras"],
  comercio: ["verdulería", "carnicería", "pollajería", "kiosco", "almacén", "fiambrería", "panadería", "licorería", "ferretería", "librería", "farmacia", "droguería", "floristería", "pet shop", "peluquería canina", "veterinaria", "alimentos", "accesorios", "guardería", "papelería", "óptica", "otros"],
  servicio: ["electricista", "plomero", "jardinería", "pintura", "albañilería", "mudanza", "limpieza", "seguridad", "otros"],
  moda: ["ropa", "calzado", "accesorios", "bijouterie", "bolsos", "confección", "sastrería", "otros"],
  salud: ["farmacia", "peluquería", "estética", "gimnasio", "consultorio", "otros"],
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

export default function DashboardComercio({
  vendor,
  offers,
  categories,
  modifiers,
  msg,
  setMsg,
  reload,
  saveVendor,
  uploading,
  onCrop,
}: Props) {
  const [storeName, setStoreName] = useState(vendor?.store_name || "");
  const [storeVertical, setStoreVertical] = useState(vendor?.vertical || "comercio");
  const [storeCategory, setStoreCategory] = useState(vendor?.category || "otros");
  const [address, setAddress] = useState(vendor?.address || "");
  const [lat, setLat] = useState<number | null>(vendor?.lat ?? null);
  const [lng, setLng] = useState<number | null>(vendor?.lng ?? null);
  const [hours, setHours] = useState(vendor?.hours || "");
  const [storePreview, setStorePreview] = useState<string | null>(vendor?.image_url || null);
  const [logoPreview, setLogoPreview] = useState<string | null>(vendor?.logo_url || null);
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

  useEffect(() => {
    if (!vendor) return;
    setStoreName(vendor.store_name || "");
    setStoreVertical(vendor.vertical || "comercio");
    setStoreCategory(vendor.category || "otros");
    setAddress(vendor.address || "");
    setLat(vendor.lat ?? null);
    setLng(vendor.lng ?? null);
    setHours(vendor.hours || "");
    setStorePreview(vendor.image_url || null);
    setLogoPreview(vendor.logo_url || null);
    setDescription(vendor.description || "");
    setWhatsapp(vendor.whatsapp || "");
    setPhone(vendor.phone || "");
    setInstagram(vendor.instagram || "");
    setFacebook(vendor.facebook || "");
    setPaymentMethods(
      vendor.payment_methods
        ? vendor.payment_methods.split(", ").map((s: string) => s.trim()).filter(Boolean)
        : []
    );
    setDeliveryOptions(vendor.delivery_options || "ambos");
    setOnlineOrders(vendor.accepts_online_orders !== false);
    setCashDiscount(vendor.cash_discount_pct != null ? String(vendor.cash_discount_pct) : "");
  }, [vendor]);

  // Los productos se gestionan en la pestaña "Catálogo" (ProductManager);
  // acá queda solo la config del comercio (datos, pagos, impresión).
  const [saving, setSaving] = useState(false);

  const [newModProductId, setNewModProductId] = useState("");
  const [newModGroupName, setNewModGroupName] = useState("");
  const [newModOptionLabel, setNewModOptionLabel] = useState("");
  const [newModOptionPrice, setNewModOptionPrice] = useState("0");
  const [newModOptions, setNewModOptions] = useState<{ label: string; price_mod: number }[]>([]);
  const [modSaving, setModSaving] = useState(false);

  const handleSave = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setSaving(true);
      setMsg("");
      try {
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
          payment_methods: paymentMethods.join(", "),
          delivery_options: deliveryOptions,
          cash_discount_pct: cashDiscount === "" ? null : Number(cashDiscount),
        });
        setMsg("Guardado");
      } catch {
        setMsg("Error al guardar");
      }
      setSaving(false);
    },
    [
      storeName,
      storeVertical,
      storeCategory,
      address,
      lat,
      lng,
      hours,
      description,
      whatsapp,
      phone,
      instagram,
      facebook,
      paymentMethods,
      deliveryOptions,
      cashDiscount,
      saveVendor,
      setMsg,
    ]
  );

  function handleCoverFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] || null;
    if (f) {
      onCrop("cover");
      setStorePreview(URL.createObjectURL(f));
    }
  }

  function handleLogoFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] || null;
    if (f) {
      onCrop("logo");
      setLogoPreview(URL.createObjectURL(f));
    }
  }

  async function addModifierOption() {
    if (!newModOptionLabel.trim()) return;
    setNewModOptions((prev) => [...prev, { label: newModOptionLabel.trim(), price_mod: Number(newModOptionPrice) || 0 }]);
    setNewModOptionLabel("");
    setNewModOptionPrice("0");
  }

  function removeModifierOption(index: number) {
    setNewModOptions((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleAddModifier() {
    if (!newModProductId || !newModGroupName.trim() || newModOptions.length === 0) {
      setMsg("Completá producto, nombre del grupo y al menos una opción");
      return;
    }
    setModSaving(true);
    setMsg("");
    try {
      const res = await fetch("/api/vendor/modifiers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product_id: newModProductId, group_name: newModGroupName, options: newModOptions }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        setMsg(data.error || "Error al guardar el modificador");
      } else {
        setMsg("Modificador agregado");
        setNewModProductId("");
        setNewModGroupName("");
        setNewModOptions([]);
        reload();
      }
    } catch {
      setMsg("Error al guardar el modificador");
    } finally {
      setModSaving(false);
    }
  }

  async function deleteModifier(mod: any) {
    await fetch(`/api/vendor/modifiers/${mod.id}`, { method: "DELETE" });
    setMsg("Modificador eliminado");
    reload();
  }

  function getProductName(productId: string): string {
    const offer = offers.find((o) => o.id === productId);
    return offer?.name || "Producto desconocido";
  }

  const groupedModifiers: Record<string, any[]> = {};
  (modifiers || []).forEach((mod: any) => {
    if (!groupedModifiers[mod.product_id]) groupedModifiers[mod.product_id] = [];
    groupedModifiers[mod.product_id].push(mod);
  });

  const isService = storeVertical === "servicio";

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
        isService={isService}
      />

      <CollapsibleSection
        icon="🏪"
        title="Tu comercio"
        defaultOpen
        badge={isService ? "Servicio" : undefined}
      >
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
            <Label>Nombre del comercio</Label>
            <Input
              value={storeName}
              onChange={(e) => setStoreName(e.target.value)}
              required
            />
          </div>
          <div>
            <Label>Categoría</Label>
            <input
              list="cat-suggestions-comercio"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={storeCategory}
              onChange={(e) => setStoreCategory(e.target.value)}
              placeholder="Ej: verdulería, ferretería..."
            />
            <datalist id="cat-suggestions-comercio">
              {(CATEGORY_SUGGESTIONS[storeVertical] ||
                CATEGORY_SUGGESTIONS.otro
              ).map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection icon="📍" title="Ubicación y horarios">
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
      </CollapsibleSection>

      <CollapsibleSection icon="📸" title="Fotos">
        <div className="space-y-3">
          <div>
            <Label>Foto del comercio</Label>
            <Input
              type="file"
              accept="image/*"
              onChange={handleCoverFileSelect}
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
              onChange={handleLogoFileSelect}
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
      </CollapsibleSection>

      <CollapsibleSection icon="📝" title="Descripción">
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Contá qué vendés..."
        />
      </CollapsibleSection>

      <CollapsibleSection icon="📱" title="Contacto">
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
      </CollapsibleSection>

      <CollapsibleSection icon="🌐" title="Redes sociales">
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
      </CollapsibleSection>

      <CollapsibleSection icon="💳" title="Pago y entrega">
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
        </div>
      </CollapsibleSection>

      <PrinterConfigSection
        vendor={vendor}
        saveVendor={saveVendor}
        setMsg={setMsg}
        autoPrintDesc="Imprime el ticket automáticamente cuando entra un pedido online pago"
      />

      <CollapsibleSection
        icon="🛍️"
        title="Catálogo"
        badge={`${offers.length}`}
      >
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Productos, precios, stock y fotos se gestionan con edición completa
            desde la pestaña <strong>Catálogo</strong>, en un panel integrado.
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={() => window.dispatchEvent(new CustomEvent("portal:go-menu"))}
          >
            🛍️ Ir al Catálogo
          </Button>
          <CategoryManager
            categories={categories}
            onAdd={async (name) => {
              const r = await apiJson("/api/vendor/categories", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name }),
              });
              if (!r.ok) setMsg(r.error || "No se pudo crear la categoría");
              reload();
            }}
            onRename={async (id, name) => {
              const r = await apiJson(`/api/vendor/categories/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name }),
              });
              if (!r.ok) setMsg(r.error || "No se pudo renombrar");
              reload();
            }}
            onDelete={async (cat) => {
              if (
                window.confirm(
                  `¿Eliminar "${cat.name}"? Los productos quedan sin categoría.`
                )
              ) {
                const r = await apiJson(`/api/vendor/categories/${cat.id}`, { method: "DELETE" });
                if (!r.ok) setMsg(r.error || "No se pudo eliminar");
                reload();
              }
            }}
            onMove={async (cat, dir) => {
              const idx = categories.findIndex(
                (c: any) => c.id === cat.id
              );
              const target = idx + dir;
              if (target < 0 || target >= categories.length) return;
              const reordered = [...categories];
              const [moved] = reordered.splice(idx, 1);
              reordered.splice(target, 0, moved);
              await Promise.all(
                reordered.map((c: any, i: number) =>
                  apiJson(`/api/vendor/categories/${c.id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ position: i }),
                  })
                )
              );
              reload();
            }}
          />
        </div>
      </CollapsibleSection>

      <CollapsibleSection icon="⚙️" title="Modificadores">
        <ModifierLibrary products={offers.map((o) => ({ id: o.id, name: o.name }))} />
      </CollapsibleSection>

      {msg && (
        <p
          className={`text-sm ${
            msg.includes("Error") ? "text-red-600" : "text-green-600"
          }`}
        >
          {msg}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={saving}>
        {saving ? "Guardando..." : "Guardar cambios"}
      </Button>
    </form>
  );
}
