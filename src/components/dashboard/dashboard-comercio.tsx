"use client";

import { useState, useCallback, useEffect, useRef } from "react";
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
  OfferForm,
  OfferList,
  CategoryManager,
  LivePreview,
  apiJson,
  TransferConfig,
  DeliveryFeeConfig,
} from "@/components/dashboard/shared";
import { HoursEditor } from "@/components/dashboard/hours-editor";
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

  const [offName, setOffName] = useState("");
  const [offDesc, setOffDesc] = useState("");
  const [offPrice, setOffPrice] = useState("");
  const [offCategory, setOffCategory] = useState(categories[0]?.name || "otros");
  const [offFile, setOffFile] = useState<File | null>(null);
  const [offPreview, setOffPreview] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const [offStock, setOffStock] = useState<number>(0);
  const [offPromoPrice, setOffPromoPrice] = useState("");
  const [offStockLowThreshold, setOffStockLowThreshold] = useState<number>(5);

  const [offerStocks, setOfferStocks] = useState<Record<string, number>>({});
  const [offerThresholds, setOfferThresholds] = useState<Record<string, number>>({});

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
          hours,
          description,
          whatsapp,
          phone,
          instagram,
          facebook,
          payment_methods: paymentMethods.join(", "),
          delivery_options: deliveryOptions,
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
      hours,
      description,
      whatsapp,
      phone,
      instagram,
      facebook,
      paymentMethods,
      deliveryOptions,
      saveVendor,
      setMsg,
    ]
  );

  function resetOfferForm() {
    setEditingId(null);
    setOffName("");
    setOffDesc("");
    setOffPrice("");
    setOffCategory(categories[0]?.name || "otros");
    setOffFile(null);
    setOffPreview(null);
    setOffStock(0);
    setOffPromoPrice("");
    setOffStockLowThreshold(5);
    setShowForm(false);
  }

  function startEdit(offer: any) {
    setEditingId(offer.id);
    setOffName(offer.name);
    setOffDesc(offer.description || "");
    setOffPrice(String(offer.price));
    setOffCategory(offer.category || "otros");
    setOffFile(null);
    setOffPreview(offer.image_url || null);
    setOffStock(offer.stock ?? 0);
    setOffPromoPrice(offer.promo_price ? String(offer.promo_price) : "");
    setOffStockLowThreshold(offer.stock_low_threshold ?? 5);
    setShowForm(true);
    setMsg("");
  }

  async function handleOfferSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    setSaving(true);
    setMsg("");

    let imageUrl = editingId ? (offers.find((o: any) => o.id === editingId)?.image_url || null) : null;
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
      setShowForm(false);
      resetOfferForm();
      setMsg(editingId ? "Producto actualizado" : "Producto agregado");
      reload();
    }
    setSaving(false);
  }

  async function toggleFeatured(offer: any) {
    await fetch(`/api/vendor/offers/${offer.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ featured_today: !offer.featured_today }),
    });
    reload();
  }

  async function toggleAvailable(offer: any) {
    await fetch(`/api/vendor/offers/${offer.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ available: !offer.available }),
    });
    reload();
  }

  async function deleteOffer(offer: any) {
    await fetch(`/api/vendor/offers/${offer.id}`, { method: "DELETE" });
    reload();
  }

  async function updateOfferStock(offer: any, newStock: number) {
    setOfferStocks((prev) => ({ ...prev, [offer.id]: newStock }));
    await fetch(`/api/vendor/offers/${offer.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stock: newStock }),
    });
    reload();
  }

  async function updateOfferThreshold(offer: any, threshold: number) {
    setOfferThresholds((prev) => ({ ...prev, [offer.id]: threshold }));
    await fetch(`/api/vendor/offers/${offer.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stock_low_threshold: threshold }),
    });
  }

  function handleOfferFileSelect(file: File | null) {
    if (file) {
      onCrop("offer");
      setOffFile(file);
      setOffPreview(URL.createObjectURL(file));
    }
  }

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

  const offerListContent = (
    <div className="space-y-3">
      {offers.length === 0 ? (
        <p className="text-muted-foreground text-sm text-center py-8">
          Todavía no cargaste productos.
        </p>
      ) : (
        offers.map((offer: any) => {
          const currentStock = offerStocks[offer.id] ?? offer.stock ?? 0;
          const currentThreshold =
            offerThresholds[offer.id] ?? offer.stock_low_threshold ?? 5;

          return (
            <div key={offer.id}>
            <Card className="p-3">
              <div className="flex items-center gap-3">
                {offer.image_url ? (
                  <img
                    src={offer.image_url}
                    alt={offer.name}
                    className="h-12 w-12 rounded-lg object-cover flex-shrink-0"
                  />
                ) : (
                  <div className="h-12 w-12 rounded-lg bg-accent flex items-center justify-center flex-shrink-0">
                    <span className="font-bold text-primary/60">
                      {offer.name.charAt(0)}
                    </span>
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-medium text-sm truncate">
                      {offer.name}
                    </span>
                    {offer.featured_today && (
                      <Badge className="bg-sun/20 text-ink text-[10px] px-1.5 py-0">
                        Hoy
                      </Badge>
                    )}
                    {!offer.available && (
                      <Badge
                        variant="secondary"
                        className="text-[10px] px-1.5 py-0"
                      >
                        Pausado
                      </Badge>
                    )}
                    {offer.stock !== null && offer.stock === 0 && (
                      <Badge
                        variant="destructive"
                        className="text-[10px] px-1.5 py-0"
                      >
                        Sin stock
                      </Badge>
                    )}
                    {offer.stock !== null &&
                      offer.stock > 0 &&
                      offer.stock <= (offer.stock_low_threshold || 5) && (
                        <Badge className="bg-yellow-100 text-yellow-700 text-[10px] px-1.5 py-0 border border-yellow-200">
                          Stock: {offer.stock}
                        </Badge>
                      )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {offer.promo_price ? (
                      <>
                        <span className="line-through">
                          ${Number(offer.price).toLocaleString("es-AR")}
                        </span>{" "}
                        <span className="text-primary font-medium">
                          ${Number(offer.promo_price).toLocaleString("es-AR")}
                        </span>
                      </>
                    ) : (
                      <>${Number(offer.price).toLocaleString("es-AR")}</>
                    )}
                    {offer.category && ` · ${offer.category}`}
                  </p>
                </div>
                <div className="hidden sm:flex items-center gap-1 flex-shrink-0">
                  <Button
                    variant="outline"
                    size="sm"
                    type="button"
                    onClick={() => startEdit(offer)}
                  >
                    Editar
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    type="button"
                    onClick={() => toggleFeatured(offer)}
                  >
                    {offer.featured_today ? "Quitar" : "Destacar"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    type="button"
                    onClick={() => toggleAvailable(offer)}
                  >
                    {offer.available ? "Pausar" : "Activar"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    className="text-red-600"
                    onClick={() => deleteOffer(offer)}
                  >
                    Eliminar
                  </Button>
                </div>
              </div>

              <div className="mt-3 pt-3 border-t border-border">
                <div className="flex items-center gap-4 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Label className="text-xs text-muted-foreground whitespace-nowrap">
                      Stock:
                    </Label>
                    <QuantityInput
                      value={
                        offerStocks[offer.id] ??
                        offer.stock ??
                        0
                      }
                      onChange={(val) => updateOfferStock(offer, val)}
                      min={0}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Label className="text-xs text-muted-foreground whitespace-nowrap">
                      Umbral bajo:
                    </Label>
                    <Input
                      type="number"
                      min={0}
                      className="h-8 w-20 text-center text-sm"
                      value={
                        offerThresholds[offer.id] ??
                        offer.stock_low_threshold ??
                        5
                      }
                      onChange={(e) => {
                        const v = parseInt(e.target.value, 10);
                        if (!isNaN(v) && v >= 0)
                          updateOfferThreshold(offer, v);
                      }}
                    />
                  </div>
                </div>
              </div>
            </Card>
              {editingId === offer.id && offerFormNode && (
                <div ref={editAnchorRef} className="mt-2">
                  {offerFormNode}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );

  const editAnchorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!editingId || !showForm) return;
    const t = setTimeout(() => {
      editAnchorRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 60);
    return () => clearTimeout(t);
  }, [editingId, showForm]);

  const offerFormNode = (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold">
          {editingId ? "Editar producto" : "Nuevo producto"}
        </h3>
        <Button type="button" variant="ghost" size="sm" onClick={() => resetOfferForm()}>
          ✕
        </Button>
      </div>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Nombre</Label>
            <Input
              value={offName}
              onChange={(e) => setOffName(e.target.value)}
              required
            />
          </div>
          <div>
            <Label>Precio ($)</Label>
            <Input
              type="number"
              step="0.01"
              value={offPrice}
              onChange={(e) => setOffPrice(e.target.value)}
              required
            />
          </div>
        </div>
        <div>
          <Label>Precio promo ($)</Label>
          <Input
            type="number"
            step="0.01"
            value={offPromoPrice}
            onChange={(e) => setOffPromoPrice(e.target.value)}
            placeholder="Precio de oferta del día"
          />
        </div>
        <div>
          <Label>Categoría</Label>
          <select
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={offCategory}
            onChange={(e) => setOffCategory(e.target.value)}
          >
            {categories.length === 0 && (
              <option value="otros">otros</option>
            )}
            {categories.map((c: any) => (
              <option key={c.id} value={c.name}>
                {c.name}
              </option>
            ))}
            {offCategory &&
              !categories.some((c: any) => c.name === offCategory) &&
              offCategory !== "otros" && (
                <option value={offCategory}>{offCategory}</option>
              )}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Stock</Label>
            <QuantityInput
              value={offStock}
              onChange={setOffStock}
              min={0}
            />
          </div>
          <div>
            <Label>Umbral bajo stock</Label>
            <Input
              type="number"
              min={0}
              value={offStockLowThreshold}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                if (!isNaN(v) && v >= 0) setOffStockLowThreshold(v);
              }}
            />
          </div>
        </div>
        <div>
          <Label>Foto</Label>
          <Input
            type="file"
            accept="image/*"
            onChange={(e) =>
              handleOfferFileSelect(
                e.target.files?.[0] || null
              )
            }
          />
          {offPreview && (
            <img
              src={offPreview}
              alt="Preview"
              className="mt-2 h-20 w-full object-cover rounded-lg"
            />
          )}
        </div>
        <div>
          <Label>Descripción</Label>
          <Textarea
            value={offDesc}
            onChange={(e) => setOffDesc(e.target.value)}
          />
        </div>
        <Button
          type="button"
          onClick={() => handleOfferSubmit()}
          disabled={saving}
          className="w-full"
        >
          {saving
            ? "Guardando..."
            : editingId
              ? "Guardar"
              : "Agregar"}
        </Button>
      </div>
    </Card>
  );

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
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        icon="📦"
        title="Menú / Catálogo"
        badge={`${offers.length}`}
      >
        <div className="space-y-4">
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

          <div className="flex items-center justify-between mt-2">
            <h3 className="font-semibold text-sm">
              Productos ({offers.length})
            </h3>
            <Button
              type="button"
              size="sm"
              onClick={() => {
                if (editingId || showForm) resetOfferForm();
                else setShowForm(true);
              }}
            >
              {editingId || showForm ? "Cancelar" : "+ Producto"}
            </Button>
          </div>

          {showForm && !editingId && offerFormNode}

          {offerListContent}
        </div>
      </CollapsibleSection>

      <CollapsibleSection icon="⚙️" title="Modificadores">
        <div className="space-y-4">
          {(modifiers || []).length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No tenés modificadores cargados. Los modificadores son extras como &quot;Tamaño&quot;, &quot;Extra queso&quot;, etc.
            </p>
          ) : (
            Object.entries(groupedModifiers).map(([productId, mods]) => (
              <Card key={productId} className="p-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-sm font-medium">{getProductName(productId)}</span>
                  <Badge variant="secondary" className="text-[10px]">{mods.length} {mods.length === 1 ? "grupo" : "grupos"}</Badge>
                </div>
                <div className="space-y-2">
                  {mods.map((mod: any) => (
                    <div key={mod.id} className="border border-border rounded-lg px-3 py-2">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium">{mod.group_name}</span>
                        <Button type="button" variant="ghost" size="sm" className="text-red-600 h-7 px-2" onClick={() => deleteModifier(mod)}>🗑️</Button>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {(mod.options || []).map((opt: any, i: number) => (
                          <span key={i} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                            {opt.label}
                            {opt.price_mod > 0 && <span className="text-primary">+${opt.price_mod}</span>}
                            {opt.price_mod < 0 && <span className="text-red-600">${opt.price_mod}</span>}
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
                <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={newModProductId} onChange={(e) => setNewModProductId(e.target.value)}>
                  <option value="">Seleccionar producto...</option>
                  {offers.map((offer) => <option key={offer.id} value={offer.id}>{offer.name}</option>)}
                </select>
              </div>
              <div>
                <Label>Grupo (ej: Tamaño, Extras)</Label>
                <Input value={newModGroupName} onChange={(e) => setNewModGroupName(e.target.value)} placeholder="Tamaño" />
              </div>
              <div>
                <Label>Opciones</Label>
                <div className="flex gap-2 mt-1">
                  <Input value={newModOptionLabel} onChange={(e) => setNewModOptionLabel(e.target.value)} placeholder="Etiqueta" className="flex-1" />
                  <Input type="number" step="0.01" value={newModOptionPrice} onChange={(e) => setNewModOptionPrice(e.target.value)} placeholder="Precio" className="w-24" />
                  <Button type="button" size="sm" onClick={addModifierOption} disabled={!newModOptionLabel.trim()}>+</Button>
                </div>
                {newModOptions.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {newModOptions.map((opt, i) => (
                      <span key={i} className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary px-2.5 py-1 text-xs font-medium">
                        {opt.label}
                        {opt.price_mod !== 0 && <span>{opt.price_mod > 0 ? `+$${opt.price_mod}` : `-$${Math.abs(opt.price_mod)}`}</span>}
                        <button type="button" onClick={() => removeModifierOption(i)} className="ml-0.5 hover:text-red-600">×</button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <Button type="button" className="w-full" disabled={modSaving || !newModProductId || !newModGroupName.trim() || newModOptions.length === 0} onClick={handleAddModifier}>
                {modSaving ? "Guardando..." : "Agregar modificador"}
              </Button>
            </div>
          </Card>
        </div>
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
