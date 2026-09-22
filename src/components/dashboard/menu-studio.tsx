"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
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
import { ProductsTable } from "@/components/dashboard/products-table";
import { ProductDrawer } from "@/components/dashboard/product-drawer";
import { RecipeEditor, type RecipeLinkInfo } from "@/components/dashboard/recipe-editor";
import { PlanLock } from "@/components/vendor/plan-lock";
import type { Ingredient, Recipe, RecipeItem } from "@/types/database";

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
  /** Venta en packs (ej: 6). El precio es del paquete. */
  pack_size?: number | null;
};

type CostInfo = { cost: number | null; pct: number | null; status: "ok" | "warn" | "bad" | "none" };

type RecipeCtx = {
  ingredients: Ingredient[];
  recipes: Recipe[];
  allItems: RecipeItem[];
  links: RecipeLinkInfo[];
  thresholds: { warn: number; bad: number };
};

type Props = {
  offers: Offer[];
  categories: MenuCategory[];
  reload: () => void;
  msg: string;
  setMsg: (m: string) => void;
  /** Muestra el chip de food-cost por plato y habilita la receta en el drawer. */
  showCosts?: boolean;
  isComercio?: boolean;
  /** Plan del comercio: si no tiene recetas, la solapa Receta muestra PlanLock. */
  hasRecipes?: boolean;
};

type View = "productos" | "categorias" | "opciones" | "volumen";

const VIEWS: { id: View; icon: string; label: string }[] = [
  { id: "productos", icon: "🍽️", label: "Productos" },
  { id: "categorias", icon: "🗂️", label: "Categorías" },
  { id: "opciones", icon: "⚙️", label: "Opciones" },
  { id: "volumen", icon: "📦", label: "Precios por volumen" },
];

type BulkOp = "pct_up" | "pct_down" | "add" | "set";

const BULK_OPS: { id: BulkOp; label: string }[] = [
  { id: "pct_up", label: "Subir %" },
  { id: "pct_down", label: "Bajar %" },
  { id: "add", label: "Sumar $" },
  { id: "set", label: "Precio fijo $" },
];

function applyOp(price: number, op: BulkOp, value: number): number {
  const n =
    op === "pct_up"
      ? Math.round((price * (100 + value)) / 100)
      : op === "pct_down"
        ? Math.round((price * (100 - value)) / 100)
        : op === "add"
          ? price + value
          : value;
  return Math.max(0, n);
}

/**
 * Panel integrado del menú (gastro): productos, categorías, biblioteca de
 * opciones/modificadores, precios por volumen e importación por Excel.
 * Desktop (≥lg): tabla densa + drawer lateral con Datos/Opciones/Receta y
 * acción masiva de precios. Mobile (<lg): mismas cards + edición inline de
 * siempre (OfferList).
 */
export function MenuStudio({
  offers,
  categories,
  reload,
  msg,
  setMsg,
  showCosts = false,
  hasRecipes = false,
  isComercio = false,
}: Props) {
  const [view, setView] = useState<View>("productos");
  const [showImport, setShowImport] = useState(false);
  const [saving, setSaving] = useState(false);
  const [costByProduct, setCostByProduct] = useState<Record<string, CostInfo>>({});
  const [costsNonce, setCostsNonce] = useState(0);
  const itemLabel = isComercio ? "producto" : "plato";
  const itemLabelPlural = isComercio ? "productos" : "platos";

  // Estado del formulario de plato (alta/edición; lo comparten el inline de
  // mobile y el drawer de desktop).
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [offName, setOffName] = useState("");
  const [offDesc, setOffDesc] = useState("");
  const [offPrice, setOffPrice] = useState("");
  const [offCategory, setOffCategory] = useState(isComercio ? "otros" : "empanadas");
  const [offFile, setOffFile] = useState<File | null>(null);
  const [offPreview, setOffPreview] = useState<string | null>(null);
  const [offStock, setOffStock] = useState<number>(0);
  const [offStockControl, setOffStockControl] = useState<boolean>(false);
  const [offPromoPrice, setOffPromoPrice] = useState("");
  const [offStockLowThreshold, setOffStockLowThreshold] = useState<number>(5);
  const [offRequiresPrep, setOffRequiresPrep] = useState<boolean>(!isComercio);
  const [offCashExcluded, setOffCashExcluded] = useState(false);
  // "Se vende de a N" (pack). Vacío = se vende por unidad.
  const [offPackSize, setOffPackSize] = useState("");

  // Drawer (desktop).
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Toolbar desktop: búsqueda + filtros + selección.
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "paused" | "nostock">("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Precios masivos.
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkOp, setBulkOp] = useState<BulkOp>("pct_up");
  const [bulkValue, setBulkValue] = useState("");
  const [bulkSaving, setBulkSaving] = useState(false);

  // Contexto de recetas: se carga lazy la primera vez que se abre el drawer.
  const [recipeCtx, setRecipeCtx] = useState<RecipeCtx | null>(null);
  const recipeCtxLoadingRef = useRef(false);
  const [recipeCtxLoading, setRecipeCtxLoading] = useState(false);

  const refreshRecipeCtx = useCallback(async () => {
    const [ing, r, c] = await Promise.all([
      getJson<{ ingredients: Ingredient[] }>("/api/vendor/ingredients"),
      getJson<{ recipes: Recipe[]; items: RecipeItem[] }>("/api/vendor/recipes"),
      getJson<{ links: RecipeLinkInfo[]; thresholds: { warn: number; bad: number } }>(
        "/api/vendor/recipes/costs"
      ),
    ]);
    setRecipeCtx({
      ingredients: ing?.ingredients || [],
      recipes: r?.recipes || [],
      allItems: r?.items || [],
      links: c?.links || [],
      thresholds: c?.thresholds || { warn: 30, bad: 35 },
    });
    setCostsNonce((n) => n + 1);
  }, []);

  const ensureRecipeCtx = useCallback(async () => {
    // Se llama al abrir el drawer: recarga fresca por si el usuario tocó
    // el tab Recetas entre aperturas. El ref evita requests duplicados.
    if (recipeCtxLoadingRef.current) return;
    recipeCtxLoadingRef.current = true;
    setRecipeCtxLoading(true);
    try {
      await refreshRecipeCtx();
    } finally {
      recipeCtxLoadingRef.current = false;
      setRecipeCtxLoading(false);
    }
  }, [refreshRecipeCtx]);

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
    return () => {
      cancelled = true;
    };
  }, [showCosts, offers, costsNonce]);

  const isDesktop = () =>
    typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches;

  function resetForm() {
    setEditingId(null);
    setShowForm(false);
    setOffName("");
    setOffDesc("");
    setOffPrice("");
    setOffCategory(isComercio ? "otros" : "empanadas");
    setOffFile(null);
    setOffPreview(null);
    setOffStock(0);
    setOffStockControl(false);
    setOffPromoPrice("");
    setOffStockLowThreshold(5);
    setOffRequiresPrep(!isComercio);
    setOffCashExcluded(false);
    setOffPackSize("");
  }

  function startEdit(offer: Offer) {
    setEditingId(offer.id);
    setOffName(offer.name);
    setOffDesc(offer.description || "");
    setOffPrice(String(offer.price));
    setOffCategory(offer.category || (isComercio ? "otros" : "otras"));
    setOffFile(null);
    setOffPreview(offer.image_url || null);
    setOffStock(offer.stock ?? 0);
    setOffStockControl(!!offer.stock_control);
    setOffPromoPrice(offer.promo_price ? String(offer.promo_price) : "");
    setOffStockLowThreshold(offer.stock_low_threshold ?? 5);
    setOffRequiresPrep(isComercio ? false : offer.requires_prep !== false);
    setOffCashExcluded(!!offer.cash_discount_excluded);
    setOffPackSize(offer.pack_size ? String(offer.pack_size) : "");
    setShowForm(true);
    setMsg("");
  }

  /** Edición desde la tabla desktop: abre el drawer lateral. */
  function openEdit(offer: Offer) {
    startEdit(offer);
    setDrawerOpen(true);
    if (hasRecipes) ensureRecipeCtx();
  }

  /** Nuevo ítem: drawer en desktop, form inline en mobile. */
  function openNewForm() {
    resetForm();
    setShowForm(true);
    if (isDesktop()) setDrawerOpen(true);
  }

  function closeEditor() {
    setDrawerOpen(false);
    resetForm();
  }

  async function handleOfferSubmit() {
    if (!offName.trim() || !offPrice) {
      setMsg("Completá nombre y precio");
      return;
    }
    setSaving(true);
    setMsg("");

    let imageUrl = editingId
      ? offers.find((o) => o.id === editingId)?.image_url || null
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
      requires_prep: isComercio ? false : offRequiresPrep,
      cash_discount_excluded: offCashExcluded,
      pack_size: offPackSize ? Math.floor(Number(offPackSize)) : null,
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
      setMsg(editingId ? `${itemLabel} actualizado` : `${itemLabel} agregado`);
      if (!editingId && drawerOpen && data.offer?.id) {
        // Alta desde el drawer desktop: queda abierto en modo edición para
        // cargar opciones/receta sin reabrir.
        setEditingId(data.offer.id);
        if (hasRecipes) ensureRecipeCtx();
      } else {
        closeEditor();
      }
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
    if (editingId === offer.id) closeEditor();
    setSelected((prev) => {
      if (!prev.has(offer.id)) return prev;
      const next = new Set(prev);
      next.delete(offer.id);
      return next;
    });
    setMsg(`${itemLabel} eliminado`);
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

  // --- Toolbar: filtrado ---------------------------------------------------
  const filteredOffers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return offers.filter((o) => {
      if (q && !o.name.toLowerCase().includes(q)) return false;
      if (catFilter !== "all" && (o.category || "") !== catFilter) return false;
      if (statusFilter === "active" && !o.available) return false;
      if (statusFilter === "paused" && o.available) return false;
      if (statusFilter === "nostock" && !(o.stock_control && o.stock !== null && o.stock === 0))
        return false;
      return true;
    });
  }, [offers, search, catFilter, statusFilter]);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll(ids: string[]) {
    setSelected((prev) => {
      const all = ids.length > 0 && ids.every((id) => prev.has(id));
      const next = new Set(prev);
      if (all) ids.forEach((id) => next.delete(id));
      else ids.forEach((id) => next.add(id));
      return next;
    });
  }

  // --- Precios masivos -----------------------------------------------------
  const bulkTargets = useMemo(() => {
    const scoped = selected.size > 0 ? offers.filter((o) => selected.has(o.id)) : filteredOffers;
    return scoped;
  }, [offers, selected, filteredOffers]);

  async function applyBulkPrice() {
    const value = Number(bulkValue);
    if (!bulkValue || !isFinite(value) || value < 0) {
      setMsg("Ingresá un valor válido para modificar precios");
      return;
    }
    if (bulkTargets.length === 0) return;
    setBulkSaving(true);
    try {
      const res = await fetch("/api/vendor/offers/bulk-price", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: bulkTargets.map((o) => o.id), op: bulkOp, value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setMsg(data.error || "No se pudieron actualizar los precios");
        return;
      }
      setMsg(`Precios actualizados en ${data.updated ?? bulkTargets.length} ${itemLabelPlural}`);
      setSelected(new Set());
      setBulkOpen(false);
      setBulkValue("");
      reload();
    } finally {
      setBulkSaving(false);
    }
  }

  // --- Nodos compartidos ----------------------------------------------------
  // El OfferForm puro (una sola instancia de estado): se monta inline en
  // mobile o dentro del drawer (solapa Datos) en desktop.
  const offerForm = (
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
      showPrep={!isComercio}
      noun={isComercio ? "producto" : "plato"}
      offRequiresPrep={offRequiresPrep}
      setOffRequiresPrep={setOffRequiresPrep}
      offCashExcluded={offCashExcluded}
      setOffCashExcluded={setOffCashExcluded}
      offPackSize={offPackSize}
      setOffPackSize={setOffPackSize}
      onClose={closeEditor}
    />
  );

  // Mobile (inline): form + modificadores debajo, como venía funcionando.
  const offerFormInline = (
    <div className="space-y-3">
      {offerForm}
      {editingId && <ProductModifiersBlock productId={editingId} productName={offName} />}
    </div>
  );

  const editingOffer = editingId ? offers.find((o) => o.id === editingId) : undefined;

  let recetaNode: ReactNode = null;
  if (editingId) {
    if (!hasRecipes) {
      recetaNode = (
        <PlanLock
          title="Recetas y costos"
          description={isComercio ? "La receta por producto (escandallo) y el semáforo de food cost forman parte del plan Gestión integral." : "La receta por plato (escandallo) y el semáforo de food cost forman parte del plan Gestión integral."}
        />
      );
    } else if (!recipeCtx) {
      recetaNode = (
        <p className="text-sm text-muted-foreground py-6 text-center">
          {recipeCtxLoading ? "Cargando insumos y recetas…" : "Preparando editor…"}
        </p>
      );
    } else if (editingOffer) {
      recetaNode = (
        <RecipeEditor
          key={editingId}
          target={{ productId: editingOffer.id }}
          title={editingOffer.name}
          subtitle={isComercio ? "Receta del producto (cantidades netas por porción)" : "Receta del plato (cantidades netas por porción)"}
          salePrice={Number(editingOffer.price) || 0}
          ingredients={recipeCtx.ingredients.filter((i) => i.active)}
          recipes={recipeCtx.recipes}
          allItems={recipeCtx.allItems}
          products={offers.map((o) => ({ id: o.id, name: o.name, price: Number(o.price) || 0 }))}
          links={recipeCtx.links}
          thresholds={recipeCtx.thresholds}
          onSaved={refreshRecipeCtx}
          onDeleted={refreshRecipeCtx}
          onLinksChanged={refreshRecipeCtx}
        />
      );
    }
  }

  const sample = bulkTargets[0];
  const bulkValueNum = Number(bulkValue);

  return (
    <div className="space-y-4">
      {/* Header: título + contadores (desktop) + solapas */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <h2 className="font-display text-xl font-semibold flex-shrink-0">{isComercio ? "Catálogo" : "Menú"}</h2>
          <div className="hidden lg:flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="rounded-full border border-border px-2 py-0.5 tabular-nums">
              {stats.total} {itemLabelPlural}
            </span>
            <span className="rounded-full border border-border px-2 py-0.5 tabular-nums">
              {stats.active} activos
            </span>
            {stats.noPhoto > 0 && (
              <span className="rounded-full border border-border px-2 py-0.5 tabular-nums">
                {stats.noPhoto} sin foto
              </span>
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
          {/* Toolbar: desktop con buscador/filtros/precios masivos; mobile = misma fila de siempre */}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="text-sm text-muted-foreground lg:hidden">{isComercio ? "El catálogo que ven tus clientes." : "La carta que ven tus clientes."}</p>
            <div className="hidden lg:flex items-center gap-2 flex-1 min-w-0">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="🔍 Buscar producto…"
                className="w-48"
              />
              <select
                value={catFilter}
                onChange={(e) => setCatFilter(e.target.value)}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                aria-label="Filtrar por categoría"
              >
                <option value="all">Todas las categorías</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
              <select
                value={statusFilter}
                onChange={(e) =>
                  setStatusFilter(e.target.value as "all" | "active" | "paused" | "nostock")
                }
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                aria-label="Filtrar por estado"
              >
                <option value="all">Todos</option>
                <option value="active">Activos</option>
                <option value="paused">Pausados</option>
                <option value="nostock">Sin stock</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="hidden lg:inline-flex"
                disabled={filteredOffers.length === 0}
                onClick={() => setBulkOpen(true)}
              >
                💲 Modificar precios{selected.size > 0 ? ` (${selected.size})` : ""}
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setShowImport(true)}>
                📥 Importar Excel
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  if (editingId || showForm) closeEditor();
                  else openNewForm();
                }}
              >
                {editingId || showForm ? "Cancelar" : "+ " + (isComercio ? "Producto" : "Plato")}
              </Button>
            </div>
          </div>

          {msg && <p className="text-sm text-green-700">{msg}</p>}

          {showForm && !editingId && <div className="lg:hidden">{offerFormInline}</div>}

          {/* Mobile: cards como siempre. Desktop: tabla densa. */}
          <div className="lg:hidden">
            <OfferList
              offers={offers}
              onEdit={startEdit}
              onToggleFeatured={toggleFeatured}
              onToggleAvailable={toggleAvailable}
              onDelete={deleteOffer}
              editingId={editingId}
              editForm={editingId ? offerFormInline : undefined}
              onEditModifiers={(offer) => startEdit(offer)}
              costByProduct={showCosts ? costByProduct : undefined}
              emptyText={isComercio ? "Todavía no cargaste productos." : undefined}
            />
          </div>
          <div className="hidden lg:block">
            {filteredOffers.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-10 rounded-xl border border-border bg-card">
                {offers.length === 0
                  ? `Todavía no cargaste ${itemLabelPlural}.`
                  : "No hay productos con esos filtros."}
              </p>
            ) : (
              <ProductsTable
                offers={filteredOffers}
                costByProduct={showCosts ? costByProduct : undefined}
                selected={selected}
                onToggleSelect={toggleSelect}
                onToggleAll={toggleSelectAll}
                onEdit={openEdit}
                onToggleFeatured={toggleFeatured}
                onToggleAvailable={toggleAvailable}
                onDelete={deleteOffer}
              />
            )}
          </div>

          {selected.size > 0 && (
            <p className="hidden lg:block text-xs text-muted-foreground tabular-nums">
              {selected.size} seleccionado{selected.size === 1 ? "" : "s"} · sin selección el cambio
              de precios aplica a los {filteredOffers.length} filtrados
            </p>
          )}
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
            Las categorías ordenan {isComercio ? "el catálogo" : "la carta"} del micrositio. Usá ↑↓ para cambiar el orden.
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
            `${isComercio ? "Catálogo" : "Menú"} importado: ${sum.imported} ${itemLabelPlural} nuevos, ${sum.updated} actualizados, ${sum.createdCategories.length} categorías creadas.`
          );
        }}
      />

      {/* Precios masivos (desktop) */}
      <Modal
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        title="Modificar precios"
        footer={
          <>
            <Button
              type="button"
              className="flex-1"
              disabled={bulkSaving || !bulkValue}
              onClick={applyBulkPrice}
            >
              {bulkSaving ? "Aplicando…" : `Aplicar a ${bulkTargets.length}`}
            </Button>
            <Button type="button" variant="outline" onClick={() => setBulkOpen(false)}>
              Cancelar
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {selected.size > 0
              ? `Se aplica a los ${bulkTargets.length} ${itemLabelPlural} seleccionados.`
              : `Sin selección: se aplica a los ${bulkTargets.length} ${itemLabelPlural} filtrados.`}{" "}
            Los precios promo no se modifican.
          </p>
          <div className="flex gap-2">
            <select
              value={bulkOp}
              onChange={(e) => setBulkOp(e.target.value as BulkOp)}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              aria-label="Tipo de cambio"
            >
              {BULK_OPS.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
            <Input
              type="number"
              min={0}
              step="any"
              inputMode="decimal"
              placeholder={bulkOp === "pct_up" || bulkOp === "pct_down" ? "10" : "500"}
              value={bulkValue}
              onChange={(e) => setBulkValue(e.target.value)}
              className="flex-1"
            />
          </div>
          {sample && bulkValue && isFinite(bulkValueNum) && bulkValueNum >= 0 && (
            <p className="text-sm rounded-lg bg-muted px-3 py-2 tabular-nums">
              Ej.: {sample.name} ${Number(sample.price).toLocaleString("es-AR")} →{" "}
              <strong>
                ${applyOp(Number(sample.price), bulkOp, bulkValueNum).toLocaleString("es-AR")}
              </strong>
            </p>
          )}
        </div>
      </Modal>

      {/* Drawer de edición (desktop; en mobile el inline sigue vigente: el
          drawer solo se abre desde la tabla ≥lg o desde "+ Nuevo" en ≥lg) */}
      <ProductDrawer
        open={drawerOpen}
        onClose={closeEditor}
        title={editingId ? offName || (isComercio ? "Editar producto" : "Editar plato") : (isComercio ? "Nuevo producto" : "Nuevo plato")}
        subtitle={
          editingId
            ? editingOffer?.category || undefined
            : "Completá los datos y guardá; después asignás opciones y receta."
        }
        isNew={!editingId}
        hasRecipes={hasRecipes}
        datosNode={<div className="space-y-3">{offerForm}</div>}
        opcionesNode={
          editingId ? <ProductModifiersBlock productId={editingId} productName={offName} /> : null
        }
        recetaNode={recetaNode}
      />
    </div>
  );
}
