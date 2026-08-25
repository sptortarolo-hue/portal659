"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { Switch } from "@/components/ui/switch";
import { ChipToggle } from "@/components/ui/chip-toggle";
import { RadioCards } from "@/components/ui/radio-cards";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { OfferForm, OfferList, CategoryManager, LivePreview } from "@/components/dashboard/shared";
import type { Vendor, Product, ProductModifier, VendorGallery } from "@/types/database";

type Props = {
  vendor: Vendor | null;
  offers: Product[];
  categories: MenuCategory[];
  modifiers: ProductModifier[];
  gallery: VendorGallery[];
  msg: string;
  setMsg: (m: string) => void;
  reload: () => void;
  saveVendor: (data: Record<string, unknown>) => Promise<void>;
  uploading: boolean;
  onCrop: (target: "cover" | "logo" | "offer") => void;
};

type MenuCategory = { id: string; name: string; position: number };

type Modifier = {
  id: string;
  product_id: string;
  group_name: string;
  options: { label: string; price_mod: number }[];
  required: boolean;
  max_selections: number;
  position: number;
};

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

const PREP_TIME_OPTIONS = [30, 45, 60, 90];

export default function DashboardGastro({
  vendor,
  offers,
  categories,
  modifiers,
  gallery,
  msg,
  setMsg,
  reload,
  saveVendor,
  uploading,
  onCrop,
}: Props) {
  const [storeName, setStoreName] = useState(vendor?.store_name || "");
  const [storeCategory, setStoreCategory] = useState(vendor?.category || "otras");
  const [address, setAddress] = useState(vendor?.address || "");
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
  const [prepTimeEnabled, setPrepTimeEnabled] = useState(
    vendor?.prep_time_min !== null && vendor?.prep_time_min !== undefined
  );
  const [prepTimeMin, setPrepTimeMin] = useState(
    vendor?.prep_time_min || 30
  );

  const [storeFile, setStoreFile] = useState<File | null>(null);
  const [storePreview, setStorePreview] = useState<string | null>(vendor?.image_url || null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(vendor?.logo_url || null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [offName, setOffName] = useState("");
  const [offDesc, setOffDesc] = useState("");
  const [offPrice, setOffPrice] = useState("");
  const [offCategory, setOffCategory] = useState("empanadas");
  const [offFile, setOffFile] = useState<File | null>(null);
  const [offPreview, setOffPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showOfferForm, setShowOfferForm] = useState(false);

  const [offStock, setOffStock] = useState<number>(0);
  const [offPromoPrice, setOffPromoPrice] = useState("");
  const [offStockLowThreshold, setOffStockLowThreshold] = useState<number>(5);

  const [galleryUploading, setGalleryUploading] = useState(false);
  const galleryFileRef = useRef<HTMLInputElement>(null);

  const [newModProductId, setNewModProductId] = useState("");
  const [newModGroupName, setNewModGroupName] = useState("");
  const [newModOptionLabel, setNewModOptionLabel] = useState("");
  const [newModOptionPrice, setNewModOptionPrice] = useState("0");
  const [newModOptions, setNewModOptions] = useState<{ label: string; price_mod: number }[]>([]);
  const [modSaving, setModSaving] = useState(false);

  const [printerIp, setPrinterIp] = useState(vendor?.printer_ip || "");
  const [printerPort, setPrinterPort] = useState(String(vendor?.printer_port || 9100));

  useEffect(() => {
    setStoreName(vendor?.store_name || "");
    setStoreCategory(vendor?.category || "otras");
    setAddress(vendor?.address || "");
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
    setPrepTimeEnabled(
      vendor?.prep_time_min !== null && vendor?.prep_time_min !== undefined
    );
    setPrepTimeMin(vendor?.prep_time_min || 30);
    setStorePreview(vendor?.image_url || null);
    setLogoPreview(vendor?.logo_url || null);
    setPrinterIp(vendor?.printer_ip || "");
    setPrinterPort(String(vendor?.printer_port || 9100));
  }, [vendor]);

  const handleSave = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMsg("");

    const data: Record<string, unknown> = {
      store_name: storeName,
      category: storeCategory,
      address,
      hours,
      description,
      whatsapp,
      phone,
      instagram,
      facebook,
      payment_methods: paymentMethods.join(", "),
      delivery_options: deliveryOptions,
      prep_time_min: prepTimeEnabled ? prepTimeMin : null,
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
    storeName, storeCategory, address, hours, description,
    whatsapp, phone, instagram, facebook, paymentMethods,
    deliveryOptions, prepTimeEnabled, prepTimeMin,
    storeFile, logoFile, saveVendor, setMsg,
  ]);

  function resetOfferForm() {
    setEditingId(null);
    setOffName("");
    setOffDesc("");
    setOffPrice("");
    setOffCategory("empanadas");
    setOffFile(null);
    setOffPreview(null);
    setShowOfferForm(false);
    setOffStock(0);
    setOffPromoPrice("");
    setOffStockLowThreshold(5);
  }

  async function handleOfferSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg("");

    let imageUrl = null;
    if (offFile) {
      const fd = new FormData();
      fd.append("file", offFile);
      fd.append("folder", "offers");
      const res = await fetch("/api/vendor/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (data.url) imageUrl = data.url;
    }

    const payload = {
      name: offName,
      description: offDesc,
      price: Number(offPrice),
      category: offCategory,
      image_url: imageUrl,
      stock: offStock,
      promo_price: offPromoPrice ? Number(offPromoPrice) : null,
      stock_low_threshold: offStockLowThreshold,
    };

    let res: Response;
    if (editingId) {
      res = await fetch(`/api/vendor/offers/${editingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } else {
      res = await fetch("/api/vendor/offers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    }
    const data = await res.json();
    if (data.error) {
      setMsg(data.error);
    } else {
      resetOfferForm();
      setMsg(editingId ? "Plato actualizado" : "Plato agregado");
      reload();
    }
    setSaving(false);
  }

  function startEditOffer(offer: Offer) {
    setEditingId(offer.id);
    setOffName(offer.name);
    setOffDesc(offer.description || "");
    setOffPrice(String(offer.price));
    setOffCategory(offer.category || "otras");
    setOffFile(null);
    setOffPreview(offer.image_url || null);
    setOffStock(offer.stock ?? 0);
    setOffPromoPrice(offer.promo_price ? String(offer.promo_price) : "");
    setOffStockLowThreshold(offer.stock_low_threshold ?? 5);
    setShowOfferForm(true);
    setMsg("");
  }

  async function toggleFeatured(offer: Offer) {
    await fetch(`/api/vendor/offers/${offer.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ featured_today: !offer.featured_today }),
    });
    reload();
  }

  async function toggleAvailable(offer: Offer) {
    await fetch(`/api/vendor/offers/${offer.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ available: !offer.available }),
    });
    reload();
  }

  async function deleteOffer(offer: Offer) {
    await fetch(`/api/vendor/offers/${offer.id}`, { method: "DELETE" });
    reload();
  }

  async function addModifierOption() {
    if (!newModOptionLabel.trim()) return;
    setNewModOptions((prev) => [
      ...prev,
      { label: newModOptionLabel.trim(), price_mod: Number(newModOptionPrice) || 0 },
    ]);
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
    const res = await fetch("/api/vendor/modifiers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        product_id: newModProductId,
        group_name: newModGroupName,
        options: newModOptions,
      }),
    });
    const data = await res.json();
    if (data.error) {
      setMsg(data.error);
    } else {
      setMsg("Modificador agregado");
      setNewModProductId("");
      setNewModGroupName("");
      setNewModOptions([]);
      reload();
    }
    setModSaving(false);
  }

  async function deleteModifier(modifier: Modifier) {
    await fetch(`/api/vendor/modifiers/${modifier.id}`, { method: "DELETE" });
    setMsg("Modificador eliminado");
    reload();
  }

  function getProductName(productId: string): string {
    const offer = offers.find((o) => o.id === productId);
    return offer?.name || "Producto desconocido";
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

  const groupedModifiers: Record<string, Modifier[]> = {};
  (modifiers || []).forEach((mod: Modifier) => {
    if (!groupedModifiers[mod.product_id]) {
      groupedModifiers[mod.product_id] = [];
    }
    groupedModifiers[mod.product_id].push(mod);
  });

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

      <CollapsibleSection icon="🏪" title="Tu comercio" defaultOpen>
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
          <div>
            <Label>Horarios</Label>
            <Input
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              placeholder="Mar a Dom 12-22h"
            />
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
      </CollapsibleSection>

      <CollapsibleSection icon="📝" title="Descripción">
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Contá qué hacés..."
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
          <div>
            <Label className="mb-2 block">Entrega</Label>
            <RadioCards
              options={DELIVERY_OPTIONS}
              value={deliveryOptions}
              onChange={setDeliveryOptions}
            />
          </div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection icon="⏱️" title="Control de demora">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <Label>Mostrar tiempo estimado</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Aparece como &quot;Demora: X min&quot; en tu micrositio
              </p>
            </div>
            <Switch
              checked={prepTimeEnabled}
              onCheckedChange={setPrepTimeEnabled}
            />
          </div>
          {prepTimeEnabled && (
            <div>
              <Label>Tiempo estimado (minutos)</Label>
              <div className="flex gap-2 mt-2">
                {PREP_TIME_OPTIONS.map((min) => (
                  <button
                    key={min}
                    type="button"
                    onClick={() => setPrepTimeMin(min)}
                    className={`flex-1 rounded-lg border-2 px-3 py-2 text-sm font-medium transition-colors ${
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
                ⏱️ Demora: {prepTimeMin} min
              </p>
            </div>
          )}
        </div>
      </CollapsibleSection>

      <CollapsibleSection icon="🖨️" title="Impresora térmica">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <Label>Impresión automática</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Imprime comanda automáticamente al aceptar un pedido
              </p>
            </div>
            <Switch
              checked={vendor?.auto_print || false}
              onCheckedChange={(v) => saveVendor({ auto_print: v })}
            />
          </div>
          <div>
            <Label>IP de la impresora</Label>
            <Input
              value={printerIp}
              onChange={(e) => setPrinterIp(e.target.value)}
              onBlur={() => saveVendor({ printer_ip: printerIp || null })}
              placeholder="192.168.1.100"
              className="mt-1"
            />
            <p className="text-[10px] text-muted-foreground/50 mt-0.5">
              Impresora conectada a la red local (TCP)
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Puerto</Label>
              <Input
                type="number"
                value={printerPort}
                onChange={(e) => setPrinterPort(e.target.value)}
                onBlur={() => saveVendor({ printer_port: Number(printerPort) || 9100 })}
                className="mt-1"
              />
            </div>
            <div>
              <Label>Tamaño papel</Label>
              <div className="flex gap-2 mt-1">
                {["58mm", "80mm"].map((size) => (
                  <button
                    key={size}
                    type="button"
                    onClick={() => saveVendor({ paper_size: size })}
                    className={`flex-1 rounded-lg border-2 px-3 py-2 text-sm font-medium transition-colors ${
                      (vendor?.paper_size || "80mm") === size
                        ? "border-primary bg-primary/5 text-primary"
                        : "border-border bg-card text-muted-foreground hover:border-primary/30"
                    }`}
                  >
                    {size}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            type="button"
            onClick={async () => {
              const res = await fetch("/api/print", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ test: true }),
              });
              const data = await res.json().catch(() => ({ error: "Respuesta inválida del servidor" }));
              if (data.success) setMsg("✅ Impresión de prueba enviada");
              else setMsg(`❌ ${data.error || "Error al imprimir"}`);
            }}
          >
            🖨️ Imprimir prueba
          </Button>
        </div>
      </CollapsibleSection>

      <CollapsibleSection icon="🍽️" title="Menú" defaultOpen>
        <div className="space-y-4">
          <CategoryManager
            categories={categories}
            onAdd={async (name) => {
              await fetch("/api/vendor/categories", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name }),
              });
              reload();
            }}
            onRename={async (id, name) => {
              await fetch(`/api/vendor/categories/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name }),
              });
              reload();
            }}
            onDelete={async (cat) => {
              await fetch(`/api/vendor/categories/${cat.id}`, {
                method: "DELETE",
              });
              reload();
            }}
            onMove={async (cat, dir) => {
              const idx = categories.findIndex((c) => c.id === cat.id);
              const target = idx + dir;
              if (target < 0 || target >= categories.length) return;
              const reordered = [...categories];
              const [moved] = reordered.splice(idx, 1);
              reordered.splice(target, 0, moved);
              await Promise.all(
                reordered.map((c, i) =>
                  fetch(`/api/vendor/categories/${c.id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ position: i }),
                  })
                )
              );
              reload();
            }}
          />

          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm">
              Platos ({offers.length})
            </h3>
            <Button
              type="button"
              size="sm"
              onClick={() => {
                if (showOfferForm && !editingId) resetOfferForm();
                else setShowOfferForm(!showOfferForm);
              }}
            >
              {editingId ? "Cancelar" : "+ Plato"}
            </Button>
          </div>

          {showOfferForm && (
            <OfferForm
              categories={categories}
              editingId={editingId}
              offName={offName}
              setOffName={setOffName}
              offDesc={offDesc}
              setOffDesc={setOffDesc}
              offPrice={offPrice}
              setOffPrice={setOffPrice}
              offCategory={offCategory}
              setOffCategory={setOffCategory}
              offFile={offFile}
              setOffFile={setOffFile}
              offPreview={offPreview}
              setOffPreview={setOffPreview}
              saving={saving}
              onSubmit={handleOfferSubmit}
              onCrop={() => onCrop("offer")}
              showStock
              offStock={offStock}
              setOffStock={setOffStock}
              offPromoPrice={offPromoPrice}
              setOffPromoPrice={setOffPromoPrice}
              offStockLowThreshold={offStockLowThreshold}
              setOffStockLowThreshold={setOffStockLowThreshold}
            />
          )}

          <OfferList
            offers={offers}
            onEdit={startEditOffer}
            onToggleFeatured={toggleFeatured}
            onToggleAvailable={toggleAvailable}
            onDelete={deleteOffer}
          />
        </div>
      </CollapsibleSection>

      <CollapsibleSection icon="⚙️" title="Modificadores">
        <div className="space-y-4">
          {(modifiers || []).length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No tenés modificadores cargados. Los modificadores son extras
              como &quot;Tamaño&quot;, &quot;Extra queso&quot;, etc.
            </p>
          ) : (
            Object.entries(groupedModifiers).map(([productId, mods]) => (
              <Card key={productId} className="p-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-sm font-medium">
                    {getProductName(productId)}
                  </span>
                  <Badge variant="secondary" className="text-[10px]">
                    {mods.length} {mods.length === 1 ? "grupo" : "grupos"}
                  </Badge>
                </div>
                <div className="space-y-2">
                  {mods.map((mod) => (
                    <div
                      key={mod.id}
                      className="border border-border rounded-lg px-3 py-2"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium">
                          {mod.group_name}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-red-600 h-7 px-2"
                          onClick={() => deleteModifier(mod)}
                        >
                          🗑️
                        </Button>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {(mod.options || []).map((opt, i) => (
                          <span
                            key={i}
                            className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
                          >
                            {opt.label}
                            {opt.price_mod > 0 && (
                              <span className="text-primary">
                                +${opt.price_mod}
                              </span>
                            )}
                            {opt.price_mod < 0 && (
                              <span className="text-red-600">
                                ${opt.price_mod}
                              </span>
                            )}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            ))
          )}

          <Card className="p-4">
            <h4 className="font-medium text-sm mb-3">Agregar modificador</h4>
            <div className="space-y-3">
              <div>
                <Label>Producto</Label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={newModProductId}
                  onChange={(e) => setNewModProductId(e.target.value)}
                >
                  <option value="">Seleccionar producto...</option>
                  {offers.map((offer) => (
                    <option key={offer.id} value={offer.id}>
                      {offer.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label>Grupo (ej: Tamaño, Extras, Salsa)</Label>
                <Input
                  value={newModGroupName}
                  onChange={(e) => setNewModGroupName(e.target.value)}
                  placeholder="Tamaño"
                />
              </div>
              <div>
                <Label>Opciones</Label>
                <div className="flex gap-2 mt-1">
                  <Input
                    value={newModOptionLabel}
                    onChange={(e) => setNewModOptionLabel(e.target.value)}
                    placeholder="Etiqueta"
                    className="flex-1"
                  />
                  <Input
                    type="number"
                    step="0.01"
                    value={newModOptionPrice}
                    onChange={(e) => setNewModOptionPrice(e.target.value)}
                    placeholder="Precio"
                    className="w-24"
                  />
                  <Button
                    type="button"
                    size="sm"
                    onClick={addModifierOption}
                    disabled={!newModOptionLabel.trim()}
                  >
                    +
                  </Button>
                </div>
                {newModOptions.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {newModOptions.map((opt, i) => (
                      <span
                        key={i}
                        className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary px-2.5 py-1 text-xs font-medium"
                      >
                        {opt.label}
                        {opt.price_mod !== 0 && (
                          <span>
                            {opt.price_mod > 0 ? `+$${opt.price_mod}` : `-$${Math.abs(opt.price_mod)}`}
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => removeModifierOption(i)}
                          className="ml-0.5 hover:text-red-600"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <Button
                type="button"
                className="w-full"
                disabled={
                  modSaving ||
                  !newModProductId ||
                  !newModGroupName.trim() ||
                  newModOptions.length === 0
                }
                onClick={handleAddModifier}
              >
                {modSaving ? "Guardando..." : "Agregar modificador"}
              </Button>
            </div>
          </Card>
        </div>
      </CollapsibleSection>

      <CollapsibleSection icon="🖼️" title={`Galería (${gallery.length})`}>
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
      </CollapsibleSection>

      {msg && (
        <p className="text-sm text-red-600">{msg}</p>
      )}

      <Button type="submit" className="w-full" disabled={saving}>
        {saving ? "Guardando..." : "Guardar cambios"}
      </Button>
    </form>
  );
}
