"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { QuantityInput } from "@/components/ui/quantity-input";
import { Badge } from "@/components/ui/badge";
import { OfferForm, OfferList } from "@/components/dashboard/shared";
import { ProductModifiersBlock } from "@/components/dashboard/modifier-editor";
import type { ProductVariant, ProductImage } from "@/types/database";


type MenuCategory = { id: string; name: string; position: number };

type OfferRow = {
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
  stock_control?: boolean;
  promo_price: number | null;
  requires_prep?: boolean;
  cash_discount_excluded?: boolean;
  has_variants?: boolean;
};

type Props = {
  isModa?: boolean;
  showStock?: boolean;
  showPrep?: boolean;
  /** Muestra el chip de food-cost por plato (requiere plan con recetas). */
  showCosts?: boolean;
  /** Variantes de todos los productos (solo moda). */
  variants?: ProductVariant[];
  /** Galería de todos los productos (solo moda). */
  productImages?: ProductImage[];
  onCrop?: (target: "offer") => void;
  onChanged?: () => void;
};

type CostInfo = { cost: number | null; pct: number | null; status: "ok" | "warn" | "bad" | "none" };

type VariantRow = {
  color: string;
  talle: string;
  price: string;
  promo: string;
  stock: number;
};

// Galería moda: 1 portada (image_url) + hasta 7 extras (product_images).
const MAX_EXTRA_IMAGES = 7;

/** Gestión completa de platos/productos (listado + ficha inline + modificadores), sin ir a Configuración. */
export function ProductManager({ isModa = false, showStock = true, showPrep = false, showCosts = false, variants, productImages, onCrop, onChanged }: Props) {
  const [offers, setOffers] = useState<OfferRow[]>([]);
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [costByProduct, setCostByProduct] = useState<Record<string, CostInfo>>({});
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [offName, setOffName] = useState("");
  const [offDesc, setOffDesc] = useState("");
  const [offPrice, setOffPrice] = useState("");
  const [offCategory, setOffCategory] = useState("otras");
  const [offFile, setOffFile] = useState<File | null>(null);
  const [offPreview, setOffPreview] = useState<string | null>(null);
  const [offStock, setOffStock] = useState(0);
  const [offStockControl, setOffStockControl] = useState(false);
  const [offPromoPrice, setOffPromoPrice] = useState("");
  const [offStockLowThreshold, setOffStockLowThreshold] = useState(5);
  const [offRequiresPrep, setOffRequiresPrep] = useState(true);
  const [offCashExcluded, setOffCashExcluded] = useState(false);

  // Moda: variantes (color × talle) + galería.
  const [offHasVariants, setOffHasVariants] = useState(false);
  const [variantRows, setVariantRows] = useState<VariantRow[]>([]);
  const [galleryUrls, setGalleryUrls] = useState<string[]>([]);

  const load = useCallback(async () => {
    const [o, c] = await Promise.all([
      fetch("/api/vendor/offers").then((r) => r.json()),
      fetch("/api/vendor/categories").then((r) => r.json()).catch(() => ({ categories: [] })),
    ]);
    if (o.offers) setOffers(o.offers);
    if (c.categories) setCategories(c.categories);
    if (showCosts) {
      // 403 si el plan no incluye recetas: se ignora y no se muestran chips.
      const costs = await fetch("/api/vendor/recipes/costs").then((r) => (r.ok ? r.json() : null)).catch(() => null);
      if (costs?.costs) {
        const map: Record<string, CostInfo> = {};
        for (const row of costs.costs) {
          if (row.has_recipe) map[row.product_id] = { cost: row.cost, pct: row.food_cost_pct, status: row.status };
        }
        setCostByProduct(map);
      }
    }
    setLoading(false);
  }, [showCosts]);

  useEffect(() => { load(); }, [load]);

  const variantsByProduct = useCallback(() => {
    const map: Record<string, ProductVariant[]> = {};
    for (const v of variants || []) {
      if (!map[v.product_id]) map[v.product_id] = [];
      map[v.product_id].push(v);
    }
    return map;
  }, [variants]);

  const imagesByProduct = useCallback(() => {
    const map: Record<string, string[]> = {};
    for (const pi of productImages || []) {
      if (!map[pi.product_id]) map[pi.product_id] = [];
      map[pi.product_id].push(pi.image_url);
    }
    return map;
  }, [productImages]);

  function resetForm() {
    setEditingId(null);
    setShowForm(false);
    setOffName("");
    setOffDesc("");
    setOffPrice("");
    setOffCategory(isModa ? "ropa" : "otras");
    setOffFile(null);
    setOffPreview(null);
    setOffStock(0);
    setOffStockControl(false);
    setOffPromoPrice("");
    setOffStockLowThreshold(5);
    setOffRequiresPrep(true);
    setOffCashExcluded(false);
    setOffHasVariants(false);
    setVariantRows([]);
    setGalleryUrls([]);
  }

  function startEdit(offer: OfferRow) {
    const existing = isModa ? variantsByProduct()[offer.id] || [] : [];
    const imgs = isModa ? imagesByProduct()[offer.id] || [] : [];
    setEditingId(offer.id);
    setOffName(offer.name);
    setOffDesc(offer.description || "");
    setOffPrice(String(offer.price));
    setOffCategory(offer.category || "otras");
    setOffFile(null);
    setOffPreview(offer.image_url);
    setOffStock(offer.stock ?? 0);
    setOffStockControl(!!offer.stock_control);
    setOffPromoPrice(offer.promo_price ? String(offer.promo_price) : "");
    setOffStockLowThreshold(offer.stock_low_threshold ?? 5);
    setOffRequiresPrep(offer.requires_prep !== false);
    setOffCashExcluded(!!offer.cash_discount_excluded);
    setOffHasVariants(!!offer.has_variants);
    setVariantRows(
      existing.map((v) => ({
        color: v.color,
        talle: v.talle,
        price: String(v.price),
        promo: v.promo != null ? String(v.promo) : "",
        stock: v.stock,
      }))
    );
    setGalleryUrls(imgs);
    setShowForm(true);
    setMsg("");
  }

  function addVariantRow() {
    setVariantRows((prev) => {
      const colors = prev.length ? Array.from(new Set(prev.map((r) => r.color))) : [""];
      const talles = prev.length ? Array.from(new Set(prev.map((r) => r.talle))) : [""];
      return [...prev, { color: colors[0] || "", talle: talles[0] || "", price: prev[prev.length - 1]?.price || offPrice, promo: "", stock: 0 }];
    });
  }

  function updateVariantRow(i: number, field: keyof VariantRow, value: string | number) {
    setVariantRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)));
  }

  async function handleGalleryUpload(files: FileList | null) {
    if (!files) return;
    const room = MAX_EXTRA_IMAGES - galleryUrls.length;
    if (room <= 0) {
      setMsg(`Máximo ${MAX_EXTRA_IMAGES} fotos extra (más la portada)`);
      return;
    }
    const added: string[] = [];
    for (const f of Array.from(files).slice(0, room)) {
      const fd = new FormData();
      fd.append("file", f);
      fd.append("folder", "offers");
      const res = await fetch("/api/vendor/upload", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({ url: null }));
      if (data.url) added.push(data.url);
    }
    setGalleryUrls((prev) => [...prev, ...added].slice(0, MAX_EXTRA_IMAGES));
    if (files.length > room) setMsg(`Se agregaron ${room}; máximo ${MAX_EXTRA_IMAGES} fotos extra`);
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
      const url = prev[i];
      if (!url) return prev;
      setOffPreview(url);
      setOffFile(null);
      return prev.filter((_, idx) => idx !== i);
    });
  }

  async function handleSubmit() {
    if (!offName.trim() || !offPrice) {
      setMsg("Completá nombre y precio");
      return;
    }
    setSaving(true);
    setMsg("");

    let imageUrl = editingId
      ? (offers.find((o) => o.id === editingId)?.image_url || null)
      : null;
    if (offFile) {
      const fd = new FormData();
      fd.append("file", offFile);
      fd.append("folder", "offers");
      const res = await fetch("/api/vendor/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (data.url) imageUrl = data.url;
    }

    const payload: Record<string, unknown> = isModa
      ? {
          name: offName.trim(),
          description: offDesc,
          price: Number(offPrice),
          category: offCategory,
          image_url: imageUrl,
          stock: offHasVariants ? 0 : offStock,
          stock_control: offHasVariants,
          promo_price: offPromoPrice ? Number(offPromoPrice) : null,
          stock_low_threshold: offStockLowThreshold,
          requires_prep: offRequiresPrep,
          cash_discount_excluded: offCashExcluded,
          has_variants: offHasVariants,
        }
      : {
          name: offName.trim(),
          description: offDesc,
          price: Number(offPrice),
          category: offCategory,
          image_url: imageUrl,
          stock: offStockControl ? offStock : null,
          stock_control: offStockControl,
          promo_price: offPromoPrice ? Number(offPromoPrice) : null,
          stock_low_threshold: offStockControl ? offStockLowThreshold : null,
          requires_prep: offRequiresPrep,
          cash_discount_excluded: offCashExcluded,
        };

    const res = editingId
      ? await fetch(`/api/vendor/offers/${editingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
      : await fetch("/api/vendor/offers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
    const data = await res.json();
    if (data.error) {
      setSaving(false);
      setMsg(data.error);
      return;
    }

    // Moda: guardar variantes + galería tras el producto.
    const productId = editingId ?? data.offer?.id;
    if (isModa && productId) {
      if (offHasVariants) {
        const vr = await fetch("/api/vendor/variants", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ product_id: productId, variants: variantRows.map((r) => ({ color: r.color, talle: r.talle, price: r.price, promo: r.promo || null, stock: r.stock, sku: null })) }),
        });
        const vdata = await vr.json().catch(() => ({}));
        if (!vr.ok || vdata.error) {
          setSaving(false);
          setMsg(vdata.error || "No se pudieron guardar las variantes");
          return;
        }
      }
      await fetch("/api/vendor/product-images", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product_id: productId, images: galleryUrls.slice(0, MAX_EXTRA_IMAGES) }),
      });
    }

    setSaving(false);
    resetForm();
    setMsg(editingId ? (isModa ? "Producto actualizado" : "Plato actualizado") : (isModa ? "Producto agregado" : "Plato agregado"));
    load();
    onChanged?.();
  }

  async function toggleFeatured(offer: OfferRow) {
    await fetch(`/api/vendor/offers/${offer.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ featured_today: !offer.featured_today }),
    });
    load(); onChanged?.();
  }

  async function toggleAvailable(offer: OfferRow) {
    await fetch(`/api/vendor/offers/${offer.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ available: !offer.available }),
    });
    load(); onChanged?.();
  }

  async function deleteOffer(offer: OfferRow) {
    if (!confirm(`¿Eliminar "${offer.name}"? Esta acción no se puede deshacer.`)) return;
    await fetch(`/api/vendor/offers/${offer.id}`, { method: "DELETE" });
    if (editingId === offer.id) resetForm();
    setMsg(isModa ? "Producto eliminado" : "Plato eliminado");
    load(); onChanged?.();
  }

  const modaFormNode = (
    <Card className="p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold">{editingId ? "Editar producto" : "Nuevo producto"}</h3>
        <Button type="button" variant="ghost" size="sm" onClick={resetForm}>✕</Button>
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
            <div className="hidden sm:grid sm:grid-cols-6 gap-2 text-xs font-medium text-muted-foreground px-1">
              <span>Color</span><span>Talle</span><span>Precio</span><span>Promo</span><span>Stock</span><span></span>
            </div>
            {variantRows.map((row, i) => (
              <div key={i} className="grid grid-cols-2 sm:grid-cols-6 gap-2 items-center">
                <Input className="h-8" value={row.color} onChange={(e) => updateVariantRow(i, "color", e.target.value)} placeholder="Rojo" />
                <Input className="h-8" value={row.talle} onChange={(e) => updateVariantRow(i, "talle", e.target.value)} placeholder="M" />
                <Input className="h-8" type="number" value={row.price} onChange={(e) => updateVariantRow(i, "price", e.target.value)} />
                <div className="min-w-0">
                  <Input className="h-8" type="number" value={row.promo} onChange={(e) => updateVariantRow(i, "promo", e.target.value)} placeholder="-" />
                </div>
                <div className="min-w-0">
                  <QuantityInput value={row.stock} onChange={(v) => updateVariantRow(i, "stock", v)} min={0} />
                </div>
                <Button type="button" variant="ghost" size="sm" className="text-red-600" onClick={() => setVariantRows((prev) => prev.filter((_, idx) => idx !== i))}>🗑️</Button>
              </div>
            ))}
          </div>
        )}

        <div><Label>Fotos extra ({galleryUrls.length}/{MAX_EXTRA_IMAGES}) — frente, espalda/en modelo, detalle de tela, escala</Label>
          <Input type="file" accept="image/*" multiple disabled={galleryUrls.length >= MAX_EXTRA_IMAGES} onChange={(e) => handleGalleryUpload(e.target.files)} />
          {galleryUrls.length > 0 && (
            <div className="flex gap-2 mt-2 flex-wrap">
              {galleryUrls.map((url, i) => (
                <div key={i} className="relative h-16 w-16 rounded-lg overflow-hidden group border border-border">
                  <img src={url} alt={`Foto extra ${i + 1}`} className="w-full h-full object-cover" />
                  <button type="button" onClick={() => setGalleryUrls((prev) => prev.filter((_, idx) => idx !== i))} title="Quitar" className="absolute top-0 right-0 bg-black/60 text-white text-xs h-4 w-4 rounded-full">✕</button>
                  <div className="absolute bottom-0 inset-x-0 flex justify-center gap-0.5 bg-black/50 py-0.5 sm:opacity-0 sm:group-hover:opacity-100 transition">
                    <button type="button" disabled={i === 0} onClick={() => moveGalleryUrl(i, -1)} title="Mover antes" className="text-white text-[10px] px-1 disabled:opacity-30">◀</button>
                    <button type="button" disabled={i === galleryUrls.length - 1} onClick={() => moveGalleryUrl(i, 1)} title="Mover después" className="text-white text-[10px] px-1 disabled:opacity-30">▶</button>
                    <button type="button" onClick={() => makeCoverFromGallery(i)} title="Hacer portada" className="text-amber-300 text-[10px] px-1">★</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {galleryUrls.length >= MAX_EXTRA_IMAGES && (
            <p className="text-xs text-muted-foreground mt-1">Llegaste al máximo de {MAX_EXTRA_IMAGES} fotos extra (más la portada).</p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div><Label>Foto principal (portada)</Label><Input type="file" accept="image/*" onChange={(e) => { const f = e.target.files?.[0] || null; if (f) { onCrop?.("offer"); setOffFile(f); setOffPreview(URL.createObjectURL(f)); } }} />{offPreview && <img src={offPreview} alt="Portada" className="mt-2 h-16 w-full object-cover rounded-lg" />}</div>
        </div>

        <div><Label>Descripción</Label><Textarea value={offDesc} onChange={(e) => setOffDesc(e.target.value)} /></div>
        <Button type="button" onClick={() => handleSubmit()} disabled={saving} className="w-full">{saving ? "Guardando..." : editingId ? "Guardar" : "Agregar"}</Button>
      </div>
    </Card>
  );

  const offerFormNode = isModa ? modaFormNode : (
    <div className="space-y-3">
      <OfferForm
        categories={categories}
        editingId={editingId}
        offName={offName} setOffName={setOffName}
        offDesc={offDesc} setOffDesc={setOffDesc}
        offPrice={offPrice} setOffPrice={setOffPrice}
        offCategory={offCategory} setOffCategory={setOffCategory}
        offFile={offFile} setOffFile={setOffFile}
        offPreview={offPreview} setOffPreview={setOffPreview}
        saving={saving}
        onSubmit={handleSubmit}
        onClose={resetForm}
        showStock={showStock}
        offStock={offStock} setOffStock={setOffStock}
        offStockControl={offStockControl} setOffStockControl={setOffStockControl}
        offPromoPrice={offPromoPrice} setOffPromoPrice={setOffPromoPrice}
        offStockLowThreshold={offStockLowThreshold} setOffStockLowThreshold={setOffStockLowThreshold}
        showPrep={showPrep}
        offRequiresPrep={offRequiresPrep} setOffRequiresPrep={setOffRequiresPrep}
        offCashExcluded={offCashExcluded} setOffCashExcluded={setOffCashExcluded}
      />
      {editingId && <ProductModifiersBlock productId={editingId} productName={offName} />}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-xl font-semibold">{isModa ? "Catálogo" : "Menú y catálogo"}</h2>
        <Button size="sm" onClick={() => { if (editingId || showForm) resetForm(); else setShowForm(true); }}>
          {editingId || showForm ? "Cancelar" : `+ ${isModa ? "Producto" : "Plato"}`}
        </Button>
      </div>

      {msg && <p className="text-sm text-green-600">{msg}</p>}

      {showForm && !editingId && offerFormNode}

      {loading ? (
        <div className="space-y-2">{[...Array(4)].map((_, i) => <div key={i} className="h-16 rounded-xl bg-muted animate-pulse" />)}</div>
      ) : (
        <OfferList
          offers={offers}
          onEdit={startEdit}
          onToggleFeatured={toggleFeatured}
          onToggleAvailable={toggleAvailable}
          onDelete={deleteOffer}
          editingId={editingId}
          editForm={editingId ? offerFormNode : undefined}
          onEditModifiers={(offer) => startEdit(offer)}
          costByProduct={showCosts ? costByProduct : undefined}
        />
      )}
    </div>
  );
}