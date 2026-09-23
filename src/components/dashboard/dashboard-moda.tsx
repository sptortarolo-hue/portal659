"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { DropdownMenu } from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { QuantityInput } from "@/components/ui/quantity-input";
import { ChipToggle } from "@/components/ui/chip-toggle";
import { RadioCards } from "@/components/ui/radio-cards";
import { LivePreview, CategoryManager, apiJson, TransferConfig, DeliveryFeeConfig } from "@/components/dashboard/shared";
import { MpConnectCard } from "@/components/dashboard/mp-connect-card";
import { HoursEditor } from "@/components/dashboard/hours-editor";
import { SIZE_GUIDE_TEMPLATES, templateToText } from "@/lib/size-guides";
import { LocationPicker } from "./location-picker";
import { PrinterConfigSection } from "@/components/dashboard/printer-config-section";
import { FiscalConfigSection } from "@/components/dashboard/fiscal-config-section";
import type { Vendor, Product, ProductVariant, ProductImage } from "@/types/database";

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

const VERTICAL_OPTIONS = [
  { value: "moda", label: "Ropa y Accesorios" },
  { value: "gastronomia", label: "Gastronomía" },
  { value: "comercio", label: "Comercio del barrio" },
  { value: "servicio", label: "Servicio u oficio" },
  { value: "salud", label: "Salud y bienestar" },
  { value: "otro", label: "Otro" },
];

type Props = {
  vendor: any;
  offers: Product[];
  categories: { id: string; name: string; position: number }[];
  msg: string;
  setMsg: (m: string) => void;
  reload: () => void;
  saveVendor: (data: Record<string, unknown>) => Promise<void>;
  uploading: boolean;
  onCrop: (target: "cover" | "logo" | "offer") => void;
  variants: ProductVariant[];
  productImages: ProductImage[];
};

type VariantRow = {
  color: string;
  talle: string;
  price: string;
  promo: string;
  stock: number;
  sku: string;
};

// Galería moda: 1 portada (image_url) + hasta 7 extras (product_images).
// El cap vive también en PUT /api/vendor/product-images; acá solo UX.
const MAX_EXTRA_IMAGES = 7;

export default function DashboardModa({
  vendor,
  offers,
  categories,
  msg,
  setMsg,
  reload,
  saveVendor,
  uploading,
  onCrop,
  variants,
  productImages,
}: Props) {
  const [storeName, setStoreName] = useState(vendor?.store_name || "");
  const [storeVertical, setStoreVertical] = useState(vendor?.vertical || "moda");
  const [storeCategory, setStoreCategory] = useState(vendor?.category || "ropa");
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
    vendor?.payment_methods ? vendor.payment_methods.split(", ").map((s: string) => s.trim()).filter(Boolean) : []
  );
  const [deliveryOptions, setDeliveryOptions] = useState(vendor?.delivery_options || "ambos");
  const [onlineOrders, setOnlineOrders] = useState(vendor?.accepts_online_orders !== false);
  const [cashDiscount, setCashDiscount] = useState(
    vendor?.cash_discount_pct != null ? String(vendor.cash_discount_pct) : ""
  );
  const [storePreview, setStorePreview] = useState<string | null>(vendor?.image_url || null);
  const [logoPreview, setLogoPreview] = useState<string | null>(vendor?.logo_url || null);
  const [storeFile, setStoreFile] = useState<File | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg2, setMsg2] = useState("");

  useEffect(() => {
    if (!vendor) return;
    setStoreName(vendor.store_name || "");
    setStoreVertical(vendor.vertical || "moda");
    setStoreCategory(vendor.category || "ropa");
    setAddress(vendor.address || "");
    setLat(vendor.lat ?? null);
    setLng(vendor.lng ?? null);
    setHours(vendor.hours || "");
    setDescription(vendor.description || "");
    setWhatsapp(vendor.whatsapp || "");
    setPhone(vendor.phone || "");
    setInstagram(vendor.instagram || "");
    setFacebook(vendor.facebook || "");
    setPaymentMethods(
      vendor.payment_methods ? vendor.payment_methods.split(", ").map((s: string) => s.trim()).filter(Boolean) : []
    );
    setDeliveryOptions(vendor.delivery_options || "ambos");
    setOnlineOrders(vendor.accepts_online_orders !== false);
    setCashDiscount(vendor.cash_discount_pct != null ? String(vendor.cash_discount_pct) : "");
    setStorePreview(vendor.image_url || null);
    setLogoPreview(vendor.logo_url || null);
  }, [vendor]);

  // ---- Oferta ----
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [offName, setOffName] = useState("");
  const [offDesc, setOffDesc] = useState("");
  const [offPrice, setOffPrice] = useState("");
  const [offCategory, setOffCategory] = useState(categories[0]?.name || "ropa");
  const [offFile, setOffFile] = useState<File | null>(null);
  const [offPreview, setOffPreview] = useState<string | null>(null);
  const [offStock, setOffStock] = useState<number>(0);
  const [offPromoPrice, setOffPromoPrice] = useState("");
  const [offStockLowThreshold, setOffStockLowThreshold] = useState<number>(5);
  const [offHasVariants, setOffHasVariants] = useState(false);
  const [variantRows, setVariantRows] = useState<VariantRow[]>([]);
  const [galleryUrls, setGalleryUrls] = useState<{ url: string; color: string | null }[]>([]);
  // Guía de talles (texto, una línea por talle).
  const [offSizeGuide, setOffSizeGuide] = useState("");

  const [offerStocks, setOfferStocks] = useState<Record<string, number>>({});
  const [offerThresholds, setOfferThresholds] = useState<Record<string, number>>({});

  const variantsByProduct = useCallback(() => {
    const map: Record<string, ProductVariant[]> = {};
    for (const v of variants || []) {
      if (!map[v.product_id]) map[v.product_id] = [];
      map[v.product_id].push(v);
    }
    return map;
  }, [variants]);

  const imagesByProduct = useCallback(() => {
    const map: Record<string, { url: string; color: string | null }[]> = {};
    for (const pi of productImages || []) {
      if (!map[pi.product_id]) map[pi.product_id] = [];
      map[pi.product_id].push({ url: pi.image_url, color: pi.color ?? null });
    }
    return map;
  }, [productImages]);

  async function uploadImage(file: File, folder: string): Promise<string | null> {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("folder", folder);
    const res = await fetch("/api/vendor/upload", { method: "POST", body: fd });
    const data = await res.json().catch(() => ({ url: null }));
    return data.url || null;
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    let imageUrl = vendor?.image_url || null;
    let logoUrl = vendor?.logo_url || null;
    if (storeFile) { const url = await uploadImage(storeFile, "vendors"); if (url) imageUrl = url; }
    if (logoFile) { const url = await uploadImage(logoFile, "vendors"); if (url) logoUrl = url; }
    await saveVendor({
      store_name: storeName,
      vertical: storeVertical,
      category: storeCategory,
      whatsapp,
      phone,
      address,
      lat,
      lng,
      hours,
      description,
      image_url: imageUrl,
      logo_url: logoUrl,
      instagram,
      facebook,
      payment_methods: paymentMethods.join(", "),
      delivery_options: deliveryOptions,
      cash_discount_pct: cashDiscount === "" ? null : Number(cashDiscount),
    });
    setSaving(false);
  }

  function resetOfferForm() {
    setEditingId(null);
    setOffName("");
    setOffDesc("");
    setOffPrice("");
    setOffCategory(categories[0]?.name || "ropa");
    setOffFile(null);
    setOffPreview(null);
    setOffStock(0);
    setOffPromoPrice("");
    setOffStockLowThreshold(5);
    setOffHasVariants(false);
    setVariantRows([]);
    setGalleryUrls([]);
    setOffSizeGuide("");
    setShowForm(false);
  }

  function startEdit(offer: Product) {
    const existing = variantsByProduct()[offer.id] || [];
    const imgs = imagesByProduct()[offer.id] || [];
    setEditingId(offer.id);
    setOffName(offer.name);
    setOffDesc(offer.description || "");
    setOffPrice(String(offer.price));
    setOffCategory(offer.category || "ropa");
    setOffFile(null);
    setOffPreview(offer.image_url || null);
    setOffStock(offer.stock ?? 0);
    setOffPromoPrice(offer.promo_price ? String(offer.promo_price) : "");
    setOffStockLowThreshold(offer.stock_low_threshold ?? 5);
    setOffHasVariants(!!offer.has_variants);
    setVariantRows(
      existing.map((v) => ({
        color: v.color,
        talle: v.talle,
        price: String(v.price),
        promo: v.promo != null ? String(v.promo) : "",
        stock: v.stock,
        sku: v.sku ?? "",
      }))
    );
    setGalleryUrls(imgs.map((img) => ({ url: img.url, color: img.color ?? null })));
    setOffSizeGuide((offer as { size_guide?: string | null }).size_guide ?? "");
    setMsg2("");
    setShowForm(true);
  }

  function addVariantRow() {
    setVariantRows((prev) => {
      const colors = prev.length ? Array.from(new Set(prev.map((r) => r.color))) : [""];
      const talles = prev.length ? Array.from(new Set(prev.map((r) => r.talle))) : [""];
      return [...prev, { color: colors[0] || "", talle: talles[0] || "", price: prev[prev.length - 1]?.price || offPrice, promo: "", stock: 0, sku: "" }];
    });
  }

  function updateVariantRow(i: number, field: keyof VariantRow, value: string | number) {
    setVariantRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)));
  }

  async function handleGalleryUpload(files: FileList | null) {
    if (!files) return;
    const room = MAX_EXTRA_IMAGES - galleryUrls.length;
    if (room <= 0) {
      setMsg2(`Máximo ${MAX_EXTRA_IMAGES} fotos extra (más la portada)`);
      return;
    }
    const added: { url: string; color: string | null }[] = [];
    for (const f of Array.from(files).slice(0, room)) {
      const url = await uploadImage(f, "offers");
      if (url) added.push({ url, color: null });
    }
    setGalleryUrls((prev) => [...prev, ...added].slice(0, MAX_EXTRA_IMAGES));
    if (files.length > room) setMsg2(`Se agregaron ${room}; máximo ${MAX_EXTRA_IMAGES} fotos extra`);
  }

  function moveGalleryUrl(i: number, dir: -1 | 1) {
    setGalleryUrls((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  function makeCoverFromGallery(i: number) {
    setGalleryUrls((prev) => {
      const item = prev[i];
      if (!item) return prev;
      setOffPreview(item.url);
      setOffFile(null);
      return prev.filter((_, idx) => idx !== i);
    });
  }

  function setGalleryItemColor(i: number, color: string | null) {
    setGalleryUrls((prev) => prev.map((g, idx) => (idx === i ? { ...g, color } : g)));
  }

  async function handleOfferSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    setSaving(true);
    setMsg2("");

    let imageUrl = editingId ? (offers.find((o) => o.id === editingId)?.image_url || null) : null;
    if (offFile) {
      const fd = new FormData();
      fd.append("file", offFile);
      fd.append("folder", "offers");
      const res = await fetch("/api/vendor/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (data.url) imageUrl = data.url;
    }

    const payload: Record<string, unknown> = {
      name: offName,
      description: offDesc,
      price: Number(offPrice),
      category: offCategory,
      image_url: imageUrl,
      stock: offHasVariants ? 0 : offStock,
      promo_price: offPromoPrice ? Number(offPromoPrice) : null,
      stock_low_threshold: offStockLowThreshold,
      has_variants: offHasVariants,
      stock_control: offHasVariants,
      size_guide: offSizeGuide.trim() || null,
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
      setMsg2(data.error);
    } else {
      const productId = editingId ?? data.offer.id;
      if (offHasVariants) {
        const vr = await fetch("/api/vendor/variants", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ product_id: productId, variants: variantRows.map((r) => ({ color: r.color, talle: r.talle, price: r.price, promo: r.promo || null, stock: r.stock, sku: r.sku.trim() || null })) }),
        });
        const vdata = await vr.json().catch(() => ({}));
        if (!vr.ok || vdata.error) {
          setSaving(false);
          setMsg2(vdata.error || "No se pudieron guardar las variantes");
          return;
        }
      }
      await fetch("/api/vendor/product-images", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product_id: productId, images: galleryUrls.slice(0, MAX_EXTRA_IMAGES).map((g) => ({ image_url: g.url, color: g.color || null })) }),
      });
      resetOfferForm();
      setMsg2(editingId ? "Producto actualizado" : "Producto agregado");
      reload();
    }
    setSaving(false);
  }

  async function toggleFeatured(offer: any) {
    await fetch(`/api/vendor/offers/${offer.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ featured_today: !offer.featured_today }) });
    reload();
  }

  async function toggleAvailable(offer: any) {
    await fetch(`/api/vendor/offers/${offer.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ available: !offer.available }) });
    reload();
  }

  async function deleteOffer(offer: any) {
    await fetch(`/api/vendor/offers/${offer.id}`, { method: "DELETE" });
    reload();
  }

  async function updateOfferStock(offer: any, newStock: number) {
    setOfferStocks((prev) => ({ ...prev, [offer.id]: newStock }));
    await fetch(`/api/vendor/offers/${offer.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stock: newStock }) });
    reload();
  }

  async function updateOfferThreshold(offer: any, threshold: number) {
    setOfferThresholds((prev) => ({ ...prev, [offer.id]: threshold }));
    await fetch(`/api/vendor/offers/${offer.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stock_low_threshold: threshold }) });
    reload();
  }

  function handleOfferFileSelect(file: File | null) {
    if (file) {
      onCrop("offer");
      setOffFile(file);
      setOffPreview(URL.createObjectURL(file));
    }
  }

  const editAnchorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!editingId || !showForm) return;
    const t = setTimeout(() => {
      editAnchorRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 60);
    return () => clearTimeout(t);
  }, [editingId, showForm]);

  const offerFormNode = (
    <Card className="p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold">{editingId ? "Editar producto" : "Nuevo producto"}</h3>
        <Button variant="ghost" size="sm" onClick={() => { resetOfferForm(); setShowForm(false); }}>✕</Button>
      </div>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Nombre</Label><Input value={offName} onChange={(e) => setOffName(e.target.value)} required /></div>
          <div><Label>Precio ($)</Label><Input type="number" step="0.01" value={offPrice} onChange={(e) => setOffPrice(e.target.value)} required /></div>
        </div>
        <div><Label>Precio promo ($)</Label><Input type="number" step="0.01" value={offPromoPrice} onChange={(e) => setOffPromoPrice(e.target.value)} placeholder="Vacío si no está en oferta" /></div>
        <div><Label>Categoría</Label><select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={offCategory} onChange={(e) => setOffCategory(e.target.value)}>{categories.length === 0 && <option value="ropa">ropa</option>}{categories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}</select></div>
        <div className="flex items-center gap-2">
          <Switch checked={offHasVariants} onCheckedChange={setOffHasVariants} />
          <span className="text-sm text-muted-foreground">Usar variantes (color × talle)</span>
        </div>
        {!offHasVariants && (
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Stock</Label><QuantityInput value={offStock} onChange={setOffStock} min={0} /></div>
            <div><Label>Umbral bajo stock</Label><Input type="number" min={0} value={offStockLowThreshold} onChange={(e) => { const v = parseInt(e.target.value, 10); if (!isNaN(v) && v >= 0) setOffStockLowThreshold(v); }} /></div>
          </div>
        )}

        {offHasVariants && (
          <div className="border border-border rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm">Variantes (color × talle)</Label>
              <Button type="button" size="sm" variant="outline" onClick={addVariantRow}>+ Fila</Button>
            </div>
            <div className="hidden sm:grid sm:grid-cols-7 gap-2 text-xs font-medium text-muted-foreground px-1">
              <span>Color</span><span>Talle</span><span>Precio</span><span>Promo</span><span>Stock</span><span>SKU</span><span></span>
            </div>
            {variantRows.map((row, i) => (
              <div key={i} className="grid grid-cols-2 sm:grid-cols-7 gap-2 items-center">
                <Input className="h-8" value={row.color} onChange={(e) => updateVariantRow(i, "color", e.target.value)} placeholder="Rojo" />
                <Input className="h-8" value={row.talle} onChange={(e) => updateVariantRow(i, "talle", e.target.value)} placeholder="M" />
                <Input className="h-8" type="number" value={row.price} onChange={(e) => updateVariantRow(i, "price", e.target.value)} />
                <div className="min-w-0">
                  <Input className="h-8" type="number" value={row.promo} onChange={(e) => updateVariantRow(i, "promo", e.target.value)} placeholder="-" />
                </div>
                <div className="min-w-0">
                  <QuantityInput value={row.stock} onChange={(v) => updateVariantRow(i, "stock", v)} min={0} />
                </div>
                <div className="min-w-0">
                  <Input className="h-8" value={row.sku} onChange={(e) => updateVariantRow(i, "sku", e.target.value)} placeholder="Código" />
                </div>
                <Button type="button" variant="ghost" size="sm" className="text-red-600" onClick={() => setVariantRows((prev) => prev.filter((_, idx) => idx !== i))}>🗑️</Button>
              </div>
            ))}
          </div>
        )}

        <div><Label>Guía de talles (opcional)</Label>
          <Textarea value={offSizeGuide} onChange={(e) => setOffSizeGuide(e.target.value)} placeholder={"Una línea por talle:\nM: Pecho 96 cm · Largo 69 cm"} className="h-20" />
          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs text-muted-foreground">Plantilla:</span>
            <select
              className="h-8 rounded-md border border-input bg-background px-2 text-xs"
              value=""
              onChange={(e) => { if (e.target.value) setOffSizeGuide(templateToText(e.target.value)); }}
              aria-label="Copiar plantilla de guía de talles"
            >
              <option value="">Copiar de…</option>
              {SIZE_GUIDE_TEMPLATES.map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">Se muestra en la ficha del producto con el selector de talles.</p>
        </div>

        <div><Label>Fotos extra ({galleryUrls.length}/{MAX_EXTRA_IMAGES}) — frente, espalda/en modelo, detalle de tela, escala</Label>
          <Input type="file" accept="image/*" multiple disabled={galleryUrls.length >= MAX_EXTRA_IMAGES} onChange={(e) => handleGalleryUpload(e.target.files)} />
          {galleryUrls.length > 0 && (
            <div className="flex gap-2 mt-2 flex-wrap">
              {galleryUrls.map((g, i) => {
                const colorOptions = Array.from(new Set(variantRows.map((r) => r.color).filter(Boolean)));
                return (
                <div key={i} className="relative h-16 w-16 rounded-lg overflow-hidden group border border-border">
                  <img src={g.url} alt={`Foto extra ${i + 1}`} className="w-full h-full object-cover" />
                  <button type="button" onClick={() => setGalleryUrls((prev) => prev.filter((_, idx) => idx !== i))} title="Quitar" className="absolute top-0 right-0 bg-black/60 text-white text-xs h-4 w-4 rounded-full">✕</button>
                  <div className="absolute bottom-0 inset-x-0 flex justify-center gap-0.5 bg-black/50 py-0.5 sm:opacity-0 sm:group-hover:opacity-100 transition">
                    <button type="button" disabled={i === 0} onClick={() => moveGalleryUrl(i, -1)} title="Mover antes" className="text-white text-[10px] px-1 disabled:opacity-30">◀</button>
                    <button type="button" disabled={i === galleryUrls.length - 1} onClick={() => moveGalleryUrl(i, 1)} title="Mover después" className="text-white text-[10px] px-1 disabled:opacity-30">▶</button>
                    <button type="button" onClick={() => makeCoverFromGallery(i)} title="Hacer portada" className="text-amber-300 text-[10px] px-1">★</button>
                  </div>
                  {colorOptions.length > 0 && (
                    <select
                      value={g.color ?? ""}
                      onChange={(e) => setGalleryItemColor(i, e.target.value || null)}
                      className="absolute top-0 left-0 h-4 w-full text-[8px] bg-black/60 text-white border-0 px-0.5"
                      title="Color de la foto (la ficha la muestra al elegir ese color)"
                      aria-label={`Color de la foto ${i + 1}`}
                    >
                      <option value="">General</option>
                      {colorOptions.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  )}
                </div>
                );
              })}
            </div>
          )}
          {galleryUrls.length >= MAX_EXTRA_IMAGES && (
            <p className="text-xs text-muted-foreground mt-1">Llegaste al máximo de {MAX_EXTRA_IMAGES} fotos extra (más la portada).</p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div><Label>Foto principal (portada)</Label><Input type="file" accept="image/*" onChange={(e) => handleOfferFileSelect(e.target.files?.[0] || null)} />{offPreview && <img src={offPreview} alt="Portada" className="mt-2 h-16 w-full object-cover rounded-lg" />}</div>
        </div>

        <div><Label>Descripción</Label><Textarea value={offDesc} onChange={(e) => setOffDesc(e.target.value)} /></div>
        <Button type="button" onClick={() => handleOfferSubmit()} disabled={saving} className="w-full">{saving ? "Guardando..." : editingId ? "Guardar" : "Agregar"}</Button>
      </div>
    </Card>
  );

  return (
    <>
    <form onSubmit={handleSave} className="space-y-4">
      <LivePreview storeName={storeName} storePreview={storePreview} vendor={vendor} logoPreview={logoPreview} description={description} hours={hours} address={address} paymentMethods={paymentMethods} whatsapp={whatsapp} isService={false} />

      <CollapsibleSection icon="🏪" title="Tu comercio" defaultOpen>
        <div className="space-y-3">
          <div><Label>Tipo de comercio</Label><select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={storeVertical} onChange={(e) => setStoreVertical(e.target.value)}>{VERTICAL_OPTIONS.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}</select></div>
          <div><Label>Nombre</Label><Input value={storeName} onChange={(e) => setStoreName(e.target.value)} required /></div>
          <div><Label>Categoría</Label><Input value={storeCategory} onChange={(e) => setStoreCategory(e.target.value)} placeholder="Ej: ropa, calzado, accesorios..." /></div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection icon="📍" title="Ubicación y horarios">
        <div className="space-y-3">
          <div><Label>Dirección</Label><Input value={address} onChange={(e) => setAddress(e.target.value)} /></div>
          <LocationPicker lat={lat} lng={lng} onChange={(newLat, newLng) => { setLat(newLat); setLng(newLng); }} neighborhood={vendor?.neighborhood} />
          <div><Label>Horarios</Label><HoursEditor value={hours} onChange={setHours} /></div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection icon="📸" title="Fotos del local">
        <div className="space-y-3">
          <div><Label>Foto del comercio</Label><Input type="file" accept="image/*" onChange={(e) => { const f = e.target.files?.[0] || null; if (f) { setStoreFile(f); setStorePreview(URL.createObjectURL(f)); } }} />{storePreview && <img src={storePreview} alt="" className="mt-2 h-24 w-full object-cover rounded-lg" />}</div>
          <div><Label>Logo</Label><Input type="file" accept="image/*" onChange={(e) => { const f = e.target.files?.[0] || null; if (f) { setLogoFile(f); setLogoPreview(URL.createObjectURL(f)); } }} />{logoPreview && <img src={logoPreview} alt="" className="mt-2 h-16 w-16 object-cover rounded-full border" />}</div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection icon="📝" title="Descripción">
        <Textarea value={description} onChange={(e) => setDescription(e.target.value)} />
      </CollapsibleSection>

      <CollapsibleSection icon="📱" title="Contacto">
        <div className="space-y-3">
          <div><Label>WhatsApp</Label><Input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} /></div>
          <div><Label>Teléfono</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="2215550000" /></div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection icon="🌐" title="Redes sociales">
        <div className="space-y-3">
          <div><Label>Instagram</Label><Input value={instagram} onChange={(e) => setInstagram(e.target.value)} placeholder="@tulocal" /></div>
          <div><Label>Facebook</Label><Input value={facebook} onChange={(e) => setFacebook(e.target.value)} placeholder="https://facebook.com/tulocal" /></div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection icon="💳" title="Pago y entrega">
        <div className="space-y-4">
          <div><Label className="mb-2 block">Medios de pago</Label><ChipToggle options={PAYMENT_OPTIONS} value={paymentMethods} onChange={setPaymentMethods} /></div>
          {paymentMethods.includes("Transferencia") && (
            <TransferConfig vendor={vendor} saveVendor={saveVendor} />
          )}
          <MpConnectCard
            mpUserId={vendor?.mp_user_id ?? null}
            mpConnectedAt={vendor?.mp_connected_at ?? null}
          />
          <div><Label className="mb-2 block">Entrega</Label><RadioCards options={DELIVERY_OPTIONS} value={deliveryOptions} onChange={setDeliveryOptions} /></div>
          {deliveryOptions !== "retiro" && (
            <DeliveryFeeConfig vendor={vendor} saveVendor={saveVendor} />
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
      </CollapsibleSection>

      <PrinterConfigSection
        vendor={vendor}
        saveVendor={saveVendor}
        setMsg={setMsg}
        autoPrintDesc="Imprime el ticket automáticamente cuando entra un pedido online pago"
      />

      <FiscalConfigSection />

      <Button type="submit" className="w-full" disabled={saving || uploading}>{saving ? "Guardando..." : "Guardar cambios"}</Button>
    </form>

    <div className="space-y-4">
      <CollapsibleSection icon="👗" title={`Catálogo de indumentaria (${offers.length})`} defaultOpen>
        <CategoryManager
          categories={categories}
onAdd={async (name) => { const r = await apiJson("/api/vendor/categories", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }); if (!r.ok) setMsg(r.error || "No se pudo crear la categoría"); reload(); }}
          onRename={async (id, name) => { const r = await apiJson(`/api/vendor/categories/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }); if (!r.ok) setMsg(r.error || "No se pudo renombrar"); reload(); }}
          onDelete={async (cat) => { if (window.confirm(`¿Eliminar "${cat.name}"?`)) { const r = await apiJson(`/api/vendor/categories/${cat.id}`, { method: "DELETE" }); if (!r.ok) setMsg(r.error || "No se pudo eliminar"); reload(); } }}
          onMove={async (cat, dir) => {
            const idx = categories.findIndex((c: any) => c.id === cat.id);
            const target = idx + dir;
            if (target < 0 || target >= categories.length) return;
            const reordered = [...categories];
            const [moved] = reordered.splice(idx, 1);
            reordered.splice(target, 0, moved);
            await Promise.all(reordered.map((c: any, i: number) => apiJson(`/api/vendor/categories/${c.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ position: i }) })));
            reload();
          }}
        />

        <div className="flex items-center justify-between mt-2 mb-4">
          <h3 className="font-semibold text-sm">Productos</h3>
          <Button size="sm" onClick={() => { resetOfferForm(); setShowForm(true); }}>+ Producto</Button>
        </div>

        {showForm && !editingId && offerFormNode}

        <div className="space-y-3">
          {offers.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">Todavía no cargaste productos.</p>
          ) : (
            offers.map((offer) => {
              const prodVariants = variantsByProduct()[offer.id] || [];
              const prodImages = imagesByProduct()[offer.id] || [];
              return (
                <div key={offer.id}>
                <Card className="p-3">
                  <div className="flex items-center gap-3">
                    {offer.image_url || prodImages[0]?.url ? (
                      <img src={offer.image_url || prodImages[0]?.url || ""} alt={offer.name} className="h-12 w-12 rounded-lg object-cover flex-shrink-0" />
                    ) : (
                      <div className="h-12 w-12 rounded-lg bg-accent flex items-center justify-center flex-shrink-0"><span className="font-bold text-primary/60">{offer.name.charAt(0)}</span></div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium text-sm truncate">{offer.name}</span>
                        {offer.has_variants && <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Variantes</Badge>}
                        {offer.featured_today && <Badge className="bg-sun/20 text-ink text-[10px] px-1.5 py-0">Hoy</Badge>}
                        {!offer.available && <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Pausado</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {offer.promo_price ? (
                          <><span className="line-through">${Number(offer.price).toLocaleString("es-AR")}</span> <span className="text-primary font-medium">${Number(offer.promo_price).toLocaleString("es-AR")}</span></>
                        ) : (
                          <>{offHasVariants && prodVariants.length > 0 ? `Desde $${Math.min(...prodVariants.map((v) => v.promo != null ? v.promo : v.price)).toLocaleString("es-AR")}` : `$${Number(offer.price).toLocaleString("es-AR")}`}</>
                        )}
                        {offer.category && ` · ${offer.category}`}
                      </p>
                      {prodVariants.length > 0 && <p className="text-[10px] text-muted-foreground truncate">{prodVariants.map((v) => `${v.color} ${v.talle}${prodVariants.length > 1 ? ", " : ""}`).join("").replace(/, $/, "")} · {prodVariants.length} variantes</p>}
                      {prodImages.length > 0 && <p className="text-[10px] text-muted-foreground">📷 {prodImages.length} foto{prodImages.length > 1 ? "s" : ""}</p>}
                    </div>
                    <div className="hidden sm:flex items-center gap-1 flex-shrink-0">
                      <Button variant="outline" size="sm" onClick={() => startEdit(offer)}>Editar</Button>
                      <Button variant="outline" size="sm" onClick={() => toggleFeatured(offer)}>{offer.featured_today ? "Quitar" : "Destacar"}</Button>
                      <Button variant="outline" size="sm" onClick={() => toggleAvailable(offer)}>{offer.available ? "Pausar" : "Activar"}</Button>
                      <Button variant="ghost" size="sm" className="text-red-600" onClick={() => deleteOffer(offer)}>Eliminar</Button>
                    </div>
                    <div className="sm:hidden flex-shrink-0">
                      <DropdownMenu
                        trigger={<span className="text-xl">⋯</span>}
                        items={[
                          { label: "Editar", icon: "✏️", onClick: () => startEdit(offer) },
                          { label: offer.featured_today ? "Quitar de Hoy" : "Destacar Hoy", icon: "⭐", onClick: () => toggleFeatured(offer) },
                          { label: offer.available ? "Pausar" : "Activar", icon: offer.available ? "⏸️" : "▶️", onClick: () => toggleAvailable(offer) },
                          { label: "Eliminar", icon: "🗑️", onClick: () => deleteOffer(offer), destructive: true },
                        ]}
                      />
                    </div>
                  </div>
                </Card>
                {editingId === offer.id && showForm && offerFormNode && (
                  <div ref={editAnchorRef} className="mt-2">
                    {offerFormNode}
                  </div>
                )}
              </div>
              );
            })
          )}
        </div>
      </CollapsibleSection>
    </div>
    </>
  );
}