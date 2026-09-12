"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { OfferForm, OfferList } from "@/components/dashboard/shared";
import { ProductModifiersBlock } from "@/components/dashboard/modifier-editor";


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
};

type Props = {
  isModa?: boolean;
  showStock?: boolean;
  showPrep?: boolean;
  /** Muestra el chip de food-cost por plato (requiere plan con recetas). */
  showCosts?: boolean;
  onChanged?: () => void;
};

type CostInfo = { cost: number | null; pct: number | null; status: "ok" | "warn" | "bad" | "none" };

/** Gestión completa de platos/productos (listado + ficha inline + modificadores), sin ir a Configuración. */
export function ProductManager({ isModa = false, showStock = true, showPrep = false, showCosts = false, onChanged }: Props) {
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

  function resetForm() {
    setEditingId(null);
    setShowForm(false);
    setOffName("");
    setOffDesc("");
    setOffPrice("");
    setOffCategory("otras");
    setOffFile(null);
    setOffPreview(null);
    setOffStock(0);
    setOffStockControl(false);
    setOffPromoPrice("");
    setOffStockLowThreshold(5);
    setOffRequiresPrep(true);
    setOffCashExcluded(false);
  }

  function startEdit(offer: OfferRow) {
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
    setShowForm(true);
    setMsg("");
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

    const payload = {
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
    setSaving(false);
    if (data.error) {
      setMsg(data.error);
    } else {
      resetForm();
      setMsg(editingId ? "Plato actualizado" : "Plato agregado");
      load();
      onChanged?.();
    }
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
    setMsg("Plato eliminado");
    load(); onChanged?.();
  }

  const offerFormNode = (
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
