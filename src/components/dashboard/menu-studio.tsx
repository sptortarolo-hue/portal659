"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  OfferForm,
  OfferList,
  CategoryManager,
  apiJson,
  getJson,
} from "@/components/dashboard/shared";
import { ModifierLibrary, ProductModifiersBlock } from "@/components/dashboard/modifier-editor";
import { VolumeEditor } from "@/components/dashboard/volume-editor";
import { MenuImportModal } from "@/components/dashboard/menu-import";

type MenuCategory = { id: string; name: string; position: number };

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
  stock_control?: boolean;
  promo_price: number | null;
  requires_prep?: boolean;
  cash_discount_excluded?: boolean;
};

type CostInfo = { cost: number | null; pct: number | null; status: "ok" | "warn" | "bad" | "none" };

type Props = {
  offers: Offer[];
  categories: MenuCategory[];
  reload: () => void;
  msg: string;
  setMsg: (m: string) => void;
  /** Muestra el chip de food-cost por plato (plan con recetas). */
  showCosts?: boolean;
};

type View = "productos" | "categorias" | "opciones" | "volumen";

const VIEWS: { id: View; icon: string; label: string }[] = [
  { id: "productos", icon: "🍽️", label: "Productos" },
  { id: "categorias", icon: "🗂️", label: "Categorías" },
  { id: "opciones", icon: "⚙️", label: "Opciones" },
  { id: "volumen", icon: "📦", label: "Precios por volumen" },
];

/**
 * Panel integrado del menú (gastro): productos, categorías, biblioteca de
 * opciones/modificadores, precios por volumen e importación por Excel.
 * Reemplaza lo que antes estaba duplicado entre el tab Menú y la sección
 * "Menú" de Configuración. Mismos componentes en mobile y desktop; solo
 * cambia la densidad de la barra de solapas.
 */
export function MenuStudio({ offers, categories, reload, msg, setMsg, showCosts = false }: Props) {
  const [view, setView] = useState<View>("productos");
  const [showImport, setShowImport] = useState(false);
  const [saving, setSaving] = useState(false);
  const [costByProduct, setCostByProduct] = useState<Record<string, CostInfo>>({});

  // Estado del formulario de plato (alta/edición inline bajo la card).
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [offName, setOffName] = useState("");
  const [offDesc, setOffDesc] = useState("");
  const [offPrice, setOffPrice] = useState("");
  const [offCategory, setOffCategory] = useState("empanadas");
  const [offFile, setOffFile] = useState<File | null>(null);
  const [offPreview, setOffPreview] = useState<string | null>(null);
  const [offStock, setOffStock] = useState<number>(0);
  const [offStockControl, setOffStockControl] = useState<boolean>(false);
  const [offPromoPrice, setOffPromoPrice] = useState("");
  const [offStockLowThreshold, setOffStockLowThreshold] = useState<number>(5);
  const [offRequiresPrep, setOffRequiresPrep] = useState<boolean>(true);
  const [offCashExcluded, setOffCashExcluded] = useState(false);

  // Food-cost por plato (módulo Recetas): 403 si el plan no lo incluye, se ignora.
  useEffect(() => {
    if (!showCosts) return;
    let cancelled = false;
    (async () => {
      const data = await getJson<{ costs: any[] }>("/api/vendor/recipes/costs");
      if (cancelled || !data?.costs) return;
      const map: Record<string, CostInfo> = {};
      for (const row of data.costs) {
        if (row.has_recipe) map[row.product_id] = { cost: row.cost, pct: row.food_cost_pct, status: row.status };
      }
      setCostByProduct(map);
    })();
    return () => { cancelled = true; };
  }, [showCosts, offers]);

  function resetForm() {
    setEditingId(null);
    setShowForm(false);
    setOffName("");
    setOffDesc("");
    setOffPrice("");
    setOffCategory("empanadas");
    setOffFile(null);
    setOffPreview(null);
    setOffStock(0);
    setOffStockControl(false);
    setOffPromoPrice("");
    setOffStockLowThreshold(5);
    setOffRequiresPrep(true);
    setOffCashExcluded(false);
  }

  function startEdit(offer: Offer) {
    setEditingId(offer.id);
    setOffName(offer.name);
    setOffDesc(offer.description || "");
    setOffPrice(String(offer.price));
    setOffCategory(offer.category || "otras");
    setOffFile(null);
    setOffPreview(offer.image_url || null);
    setOffStock(offer.stock ?? 0);
    setOffStockControl(!!offer.stock_control);
    setOffPromoPrice(offer.promo_price ? String(offer.promo_price) : "");
    setOffStockLowThreshold(offer.stock_low_threshold ?? 5);
    setOffRequiresPrep(offer.requires_prep !== false);
    setOffCashExcluded(!!offer.cash_discount_excluded);
    setShowForm(true);
    setMsg("");
  }

  async function handleOfferSubmit() {
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
      reload();
    }
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
    if (!confirm(`¿Eliminar "${offer.name}"? Esta acción no se puede deshacer.`)) return;
    await fetch(`/api/vendor/offers/${offer.id}`, { method: "DELETE" });
    if (editingId === offer.id) resetForm();
    setMsg("Plato eliminado");
    reload();
  }

  // --- Categorías (misma lógica que antes vivía en Config) ---------------
  async function addCategory(name: string) {
    const r = await apiJson("/api/vendor/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!r.ok) setMsg(r.error || "No se pudo crear la categoría");
    reload();
  }

  async function renameCategory(id: string, name: string) {
    const r = await apiJson(`/api/vendor/categories/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!r.ok) setMsg(r.error || "No se pudo renombrar");
    reload();
  }

  async function deleteCategory(cat: MenuCategory) {
    const r = await apiJson(`/api/vendor/categories/${cat.id}`, { method: "DELETE" });
    if (!r.ok) setMsg(r.error || "No se pudo eliminar");
    reload();
  }

  async function moveCategory(cat: MenuCategory, dir: -1 | 1) {
    const idx = categories.findIndex((c) => c.id === cat.id);
    const target = idx + dir;
    if (target < 0 || target >= categories.length) return;
    const reordered = [...categories];
    const [moved] = reordered.splice(idx, 1);
    reordered.splice(target, 0, moved);
    await Promise.all(
      reordered.map((c, i) =>
        apiJson(`/api/vendor/categories/${c.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ position: i }),
        })
      )
    );
    reload();
  }

  const stats = {
    total: offers.length,
    active: offers.filter((o) => o.available).length,
    noPhoto: offers.filter((o) => !o.image_url).length,
    lowStock: offers.filter(
      (o) => o.stock_control && o.stock !== null && o.stock <= (o.stock_low_threshold ?? 5)
    ).length,
  };

  const offerFormNode = (
    <div className="space-y-3">
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
        showStock
        offStock={offStock}
        setOffStock={setOffStock}
        offStockControl={offStockControl}
        setOffStockControl={setOffStockControl}
        offPromoPrice={offPromoPrice}
        setOffPromoPrice={setOffPromoPrice}
        offStockLowThreshold={offStockLowThreshold}
        setOffStockLowThreshold={setOffStockLowThreshold}
        showPrep
        offRequiresPrep={offRequiresPrep}
        setOffRequiresPrep={setOffRequiresPrep}
        offCashExcluded={offCashExcluded}
        setOffCashExcluded={setOffCashExcluded}
        onClose={resetForm}
      />
      {editingId && <ProductModifiersBlock productId={editingId} productName={offName} />}
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Header: título + contadores (desktop) + solapas */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <h2 className="font-display text-xl font-semibold flex-shrink-0">Menú</h2>
          <div className="hidden lg:flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="rounded-full border border-border px-2 py-0.5 tabular-nums">{stats.total} platos</span>
            <span className="rounded-full border border-border px-2 py-0.5 tabular-nums">{stats.active} activos</span>
            {stats.noPhoto > 0 && (
              <span className="rounded-full border border-border px-2 py-0.5 tabular-nums">{stats.noPhoto} sin foto</span>
            )}
            {stats.lowStock > 0 && (
              <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 tabular-nums text-red-700">
                {stats.lowStock} stock bajo
              </span>
            )}
          </div>
        </div>
        <div className="flex rounded-xl border border-border overflow-x-auto max-w-full text-sm font-medium">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => setView(v.id)}
              className={`px-3 sm:px-4 py-2 whitespace-nowrap text-xs sm:text-sm transition-colors ${
                view === v.id
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted/60"
              }`}
            >
              {v.icon} {v.label}
              {v.id === "productos"
                ? ` (${offers.length})`
                : v.id === "categorias"
                  ? ` (${categories.length})`
                  : ""}
            </button>
          ))}
        </div>
      </div>

      {view === "productos" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="text-sm text-muted-foreground">La carta que ven tus clientes.</p>
            <div className="flex items-center gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => setShowImport(true)}>
                📥 Importar Excel
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  if (editingId || showForm) resetForm();
                  else setShowForm(true);
                }}
              >
                {editingId || showForm ? "Cancelar" : "+ Plato"}
              </Button>
            </div>
          </div>

          {msg && <p className="text-sm text-green-700">{msg}</p>}

          {showForm && !editingId && offerFormNode}

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
        </div>
      )}

      {view === "categorias" && (
        <>
          {msg && <p className="text-sm text-green-700">{msg}</p>}
          <CategoryManager
            defaultOpen
            categories={categories}
            onAdd={addCategory}
            onRename={renameCategory}
            onDelete={deleteCategory}
            onMove={moveCategory}
          />
          <p className="text-xs text-muted-foreground">
            Las categorías ordenan la carta del micrositio. Usá ↑↓ para cambiar el orden.
          </p>
        </>
      )}

      {view === "opciones" && (
        <ModifierLibrary products={offers.map((o) => ({ id: o.id, name: o.name }))} />
      )}

      {view === "volumen" && (
        <VolumeEditor
          products={offers.map((o) => ({ id: o.id, name: o.name, category: o.category }))}
          categories={categories}
        />
      )}

      <MenuImportModal
        open={showImport}
        onClose={() => setShowImport(false)}
        onImported={(sum) => {
          setView("productos");
          reload();
          setMsg(
            `Menú importado: ${sum.imported} platos nuevos, ${sum.updated} actualizados, ${sum.createdCategories.length} categorías creadas.`
          );
        }}
      />
    </div>
  );
}
