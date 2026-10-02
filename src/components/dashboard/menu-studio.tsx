"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import {
  OfferForm,
  OfferList,
  CategoryManager,
  apiJson,
  getJson,
  useFormDraft,
} from "@/components/dashboard/shared";
import { clearDraft } from "@/lib/draft";
import { ModifierLibrary, ProductModifiersBlock } from "@/components/dashboard/modifier-editor";
import { VolumeEditor } from "@/components/dashboard/volume-editor";
import { MenuImportModal } from "@/components/dashboard/menu-import";
import { MenuImportWaModal } from "@/components/dashboard/menu-import-wa";
import { ProductsTable } from "@/components/dashboard/products-table";
import { ProductImage } from "@/components/product-image";
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
  /** Solo sale en la sección Promo (no figura en el menú). */
  promo_only?: boolean;
  /** Unidad de venta: 'unidad' o 'kg' (precio por kilo). */
  unit?: string | null;
  /** Código de barras / SKU (etiquetas de góndola). */
  sku?: string | null;
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
  /** Permite editar el costo de compra manual (plan Gestión: inventory o recipes). */
  canEditCost?: boolean;
  /** Para el borrador del formulario (24h). */
  vendorId?: string | null;
  /** Muestra el Kit heladería en la solapa Opciones (solo gastronomía). */
  enableHeladeriaKit?: boolean;
  /** Logo del comercio (vista previa de etiquetas de góndola). */
  vendorLogo?: string | null;
  /** Nombre del comercio (fallback del preview de etiquetas). */
  vendorName?: string | null;
};

type View = "productos" | "categorias" | "opciones" | "volumen";

/**
 * Vista previa de la etiqueta de góndola (estilo supermercado): nombre
 * (hasta 2 líneas) a la izquierda + logo del comercio justificado a la
 * derecha; debajo precio grande (/kg si es por peso), bloque promo y
 * código de barras visual (barras derivadas del SKU — no escaneable).
 */
function LabelPreview({
  offer,
  logoUrl,
  storeName,
}: {
  offer: Offer | null;
  logoUrl: string | null;
  storeName: string | null;
}) {
  if (!offer) {
    return (
      <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        Elegí productos para ver la vista previa de la etiqueta.
      </div>
    );
  }
  const sku = (offer.sku || "").trim();
  const isKg = String(offer.unit || "").trim().toLowerCase() === "kg";
  const price = Number(offer.promo_price ?? offer.price) || 0;
  const oldPrice = offer.promo_price != null ? Number(offer.price) : null;
  const hasPromo = oldPrice != null && Math.round(oldPrice * 100) !== Math.round(price * 100);
  const saving = hasPromo ? Math.round((oldPrice - price) * 100) / 100 : 0;
  const fmt = (n: number) =>
    n.toLocaleString("es-AR", {
      minimumFractionDigits: isKg ? 2 : 0,
      maximumFractionDigits: 2,
    });

  const seed = sku || "000000000000";
  const bars: number[] = [];
  for (let i = 0; i < 40; i++) {
    const c = seed.charCodeAt(i % seed.length) + i * 7;
    bars.push(1 + (c % 3));
  }

  return (
    <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-sm leading-tight break-words line-clamp-2">{offer.name}</p>
        </div>
        {logoUrl && (
          <ProductImage
            src={logoUrl}
            name={storeName || "?"}
            alt={storeName || "Logo"}
            className="h-10 w-10 rounded-full flex-shrink-0"
          />
        )}
      </div>
      <div className="text-center mt-2">
        {hasPromo && <p className="text-xs text-muted-foreground">ANTES: ${fmt(oldPrice)}</p>}
        <p className="text-2xl font-bold tabular-nums leading-tight">
          ${fmt(price)}
          {isKg && <span className="text-sm font-semibold">/kg</span>}
        </p>
        {hasPromo && saving > 0 && (
          <p className="inline-block bg-yellow-200 text-yellow-900 rounded px-1.5 py-0.5 text-[11px] font-medium mt-0.5">
            AHORRÁS ${fmt(saving)}
          </p>
        )}
      </div>
      {sku && (
        <div className="mt-2">
          <div className="flex items-stretch justify-center gap-px h-9">
            {bars.map((w, i) => (
              <span key={i} className="bg-black" style={{ width: w }} />
            ))}
          </div>
          <p className="text-center text-[10px] tracking-widest text-muted-foreground mt-1">{sku}</p>
        </div>
      )}
    </div>
  );
}

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
  enableHeladeriaKit = false,
  canEditCost = false,
  vendorId = null,
  vendorLogo = null,
  vendorName = null,
}: Props) {
  const [view, setView] = useState<View>("productos");
  const [showImport, setShowImport] = useState(false);
  const [showImportWa, setShowImportWa] = useState(false);
  // Etiquetas de góndola (requiere impresora + SKU en el producto).
  const [showLabels, setShowLabels] = useState(false);
  const [labelProductId, setLabelProductId] = useState("");
  const [labelChecked, setLabelChecked] = useState<Set<string>>(new Set());
  const [labelSearch, setLabelSearch] = useState("");
  const [labelCopies, setLabelCopies] = useState("5");
  const [labelBusy, setLabelBusy] = useState(false);
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
  // Unidad de venta (balanza): "unidad" o "kg" (precio por kilo).
  const [offUnit, setOffUnit] = useState("unidad");
  // Costo de compra manual (inventario): convive con el food-cost de receta.
  const [offCost, setOffCost] = useState("");
  // Código de barras / SKU (búsqueda y etiquetas en mostrador).
  const [offSku, setOffSku] = useState("");
  // Foto remota sugerida por lookup (se descarga al guardar).
  const [offRemotePhoto, setOffRemotePhoto] = useState<string | null>(null);

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
    clearDraft(vendorId, "menu-studio");
    setPhotoNotice(false);
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
    setOffUnit("unidad");
    setOffSku("");
    setOffRemotePhoto(null);
    setOffCost("");
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
    setOffUnit((offer as any).unit === "kg" ? "kg" : "unidad");
    setOffSku((offer as any).sku ? String((offer as any).sku) : "");
    setOffCost((offer as any).cost_last != null ? String((offer as any).cost_last) : "");
    setOffRemotePhoto(null);
    setShowForm(true);
    setMsg("");
  }

  // Borrador del formulario (24h): sobrevive a recargas. La foto (File) no
  // se puede persistir: se avisa para re-elegirla.
  type MenuDraft = {
    editingId: string | null; offName: string; offDesc: string; offPrice: string;
    offCategory: string; offPreview: string | null; offStock: number;
    offStockControl: boolean; offPromoPrice: string; offStockLowThreshold: number;
    offRequiresPrep: boolean; offCashExcluded: boolean; offPackSize: string;
    offUnit: string; offSku: string; offCost: string;
    offRemotePhoto: string | null; hadFile: boolean;
  };
  const [photoNotice, setPhotoNotice] = useState(false);
  const menuDraft = useFormDraft<MenuDraft>({
    vendorId,
    key: "menu-studio",
    watch: [showForm, editingId, offName, offDesc, offPrice, offCategory, offPreview, offStock, offStockControl, offPromoPrice, offStockLowThreshold, offRequiresPrep, offCashExcluded, offPackSize, offUnit, offSku, offCost, offRemotePhoto],
    snapshot: () => {
      if (!showForm) return null;
      if (!editingId && !offName.trim() && !offPrice && !offDesc.trim()) return null;
      return {
        editingId, offName, offDesc, offPrice, offCategory, offPreview, offStock,
        offStockControl, offPromoPrice, offStockLowThreshold, offRequiresPrep,
        offCashExcluded, offPackSize, offUnit, offSku, offCost, offRemotePhoto,
        hadFile: offFile != null,
      };
    },
    restore: (d) => {
      const stillThere = d.editingId && offers.some((o) => o.id === d.editingId);
      setEditingId(stillThere ? d.editingId : null);
      setOffName(d.offName || "");
      setOffDesc(d.offDesc || "");
      setOffPrice(d.offPrice || "");
      setOffCategory(d.offCategory || (isComercio ? "otros" : "otras"));
      setOffFile(null);
      setOffPreview(d.offPreview || null);
      setOffStock(typeof d.offStock === "number" ? d.offStock : 0);
      setOffStockControl(d.offStockControl === true);
      setOffPromoPrice(d.offPromoPrice || "");
      setOffStockLowThreshold(typeof d.offStockLowThreshold === "number" ? d.offStockLowThreshold : 5);
      setOffRequiresPrep(isComercio ? false : d.offRequiresPrep !== false);
      setOffCashExcluded(d.offCashExcluded === true);
      setOffPackSize(d.offPackSize || "");
      setOffUnit(d.offUnit === "kg" ? "kg" : "unidad");
      setOffSku(d.offSku || "");
      setOffCost(d.offCost || "");
      setOffRemotePhoto(d.offRemotePhoto || null);
      setPhotoNotice(d.hadFile === true);
    },
    onRestored: () => setShowForm(true),
  });

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
    } else if (offRemotePhoto) {
      // Foto sugerida por lookup: el servidor la descarga a uploads.
      imageUrl = offRemotePhoto;
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
      unit: isComercio ? offUnit : undefined,
      sku: isComercio && offSku.trim() ? offSku.trim() : null,
      cost_last: canEditCost && offCost.trim() !== "" && Number.isFinite(Number(offCost)) ? Math.round(Number(offCost) * 100) / 100 : undefined,
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
      menuDraft.clear();
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

  async function togglePromoOnly(offer: Offer) {
    const toPromo = !offer.promo_only;
    if (toPromo && !(offer.promo_price != null && Number(offer.promo_price) > 0)) {
      setMsg("Poné un precio promo antes de mandarlo a Solo promo");
      return;
    }
    await fetch(`/api/vendor/offers/${offer.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ promo_only: toPromo }),
    });
    setMsg(toPromo ? `"${offer.name}" ahora sale solo en Promo` : `"${offer.name}" volvió al menú`);
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

  // Etiquetas: toggle del lote + el preview sigue al último tildado.
  function toggleLabelCheck(id: string) {
    setLabelChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setLabelProductId(id);
  }

  const labelSearchOffers = useMemo(() => {
    const q = labelSearch.trim().toLowerCase();
    if (!q) return offers;
    return offers.filter((o) => o.name.toLowerCase().includes(q) || (o.sku || "").toLowerCase().includes(q));
  }, [offers, labelSearch]);

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
      showUnit={isComercio}
      offUnit={offUnit}
      setOffUnit={setOffUnit}
      showSku={isComercio}
      offSku={offSku}
      setOffSku={setOffSku}
      showCost={canEditCost}
      offCost={offCost}
      setOffCost={setOffCost}
      costLabel={showCosts ? "Costo compra ($)" : "Costo ($)"}
      remotePhoto={offRemotePhoto}
      onRemotePhoto={setOffRemotePhoto}
      onClose={closeEditor}
    />
  );

  // Mobile (inline): form + modificadores debajo, como venía funcionando.
  const offerFormInline = (
    <div className="space-y-3">
      {menuDraft.restored && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
          <p className="text-xs font-medium text-primary">Recuperamos tu carga en curso{photoNotice ? " (volvé a elegir la foto)" : ""}</p>
          <button
            type="button"
            onClick={() => { menuDraft.discard(); resetForm(); }}
            className="text-xs font-medium text-muted-foreground hover:text-foreground underline flex-shrink-0"
          >
            Descartar
          </button>
        </div>
      )}
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
            <div className="flex flex-wrap items-center gap-2">
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
                📥 <span className="hidden sm:inline">Importar </span>Excel
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setShowImportWa(true)}>
                💬 <span className="hidden sm:inline">Importar </span>WhatsApp
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  const first = offers.find((o) => o.sku);
                  setLabelProductId(first ? first.id : offers[0]?.id || "");
                  setLabelChecked(new Set(first ? [first.id] : []));
                  setLabelSearch("");
                  setLabelCopies("5");
                  setShowLabels(true);
                }}
              >
                🏷️ Etiquetas
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
              showBuyCost={canEditCost}
              emptyText={isComercio ? "Todavía no cargaste productos." : undefined}
              onTogglePromoOnly={togglePromoOnly}
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
                showBuyCost={canEditCost}
                selected={selected}
                onToggleSelect={toggleSelect}
                onToggleAll={toggleSelectAll}
                onEdit={openEdit}
                onToggleFeatured={toggleFeatured}
                onToggleAvailable={toggleAvailable}
                onDelete={deleteOffer}
                onTogglePromoOnly={togglePromoOnly}
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
        <ModifierLibrary
          products={offers.map((o) => ({ id: o.id, name: o.name }))}
          onChanged={reload}
          enableHeladeriaKit={enableHeladeriaKit}
        />
      )}

      {view === "volumen" && (
        <VolumeEditor
          products={offers.map((o) => ({ id: o.id, name: o.name, category: o.category, price: Number(o.price) || 0 }))}
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
        isComercio={isComercio}
      />

      <MenuImportWaModal
        open={showImportWa}
        onClose={() => setShowImportWa(false)}
        onImported={(sum) => {
          setView("productos");
          reload();
          setMsg(
            `${isComercio ? "Catálogo" : "Menú"} importado desde WhatsApp: ${sum.imported} ${itemLabelPlural} nuevos, ${sum.updated} actualizados.`
          );
        }}
        isComercio={isComercio}
      />

      {/* Etiquetas de góndola estilo supermercado (requiere SKU + impresora con plan) */}
      <Modal
        open={showLabels}
        onClose={() => setShowLabels(false)}
        title="Imprimir etiquetas"
        footer={
          <>
            <Button
              type="button"
              className="flex-1"
              disabled={labelBusy || labelChecked.size === 0}
              onClick={async () => {
                setLabelBusy(true);
                try {
                  const res = await fetch("/api/print", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      type: "label",
                      productIds: Array.from(labelChecked),
                      copies: Math.min(50, Math.max(1, Math.floor(Number(labelCopies) || 1))),
                    }),
                  });
                  const data = await res.json().catch(() => ({}));
                  if (res.ok && data.ok) {
                    const sin =
                      Array.isArray(data.sinCodigo) && data.sinCodigo.length > 0
                        ? ` · Sin código: ${data.sinCodigo.join(", ")}`
                        : "";
                    setMsg(`Etiquetas enviadas a la impresora ✓ (${data.printed ?? 0}/${data.total ?? 0})${sin}`);
                    setShowLabels(false);
                  } else {
                    setMsg(data.error || "No se pudieron imprimir");
                  }
                } catch {
                  setMsg("Sin conexión con la impresora");
                }
                setLabelBusy(false);
              }}
            >
              {labelBusy
                ? "Imprimiendo…"
                : `Imprimir ${labelChecked.size * Math.max(1, Math.floor(Number(labelCopies) || 1))} etiquetas`}
            </Button>
            <Button type="button" variant="outline" onClick={() => setShowLabels(false)}>
              Cancelar
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <LabelPreview
            offer={offers.find((o) => o.id === labelProductId) || null}
            logoUrl={vendorLogo}
            storeName={vendorName}
          />
          <div>
            <div className="flex items-center justify-between gap-2">
              <Label>Productos (con código)</Label>
              <span className="text-xs text-muted-foreground tabular-nums">
                {labelChecked.size} seleccionado{labelChecked.size === 1 ? "" : "s"}
              </span>
            </div>
            <Input
              value={labelSearch}
              onChange={(e) => setLabelSearch(e.target.value)}
              placeholder="🔍 Buscar…"
              className="mt-1 h-9"
            />
            <div className="mt-2 rounded-md border border-input max-h-56 overflow-y-auto divide-y divide-border">
              {labelSearchOffers.length === 0 && (
                <p className="p-3 text-sm text-muted-foreground text-center">
                  {offers.length === 0 ? "Sin productos." : "Nada coincide con la búsqueda."}
                </p>
              )}
              {labelSearchOffers.map((o) => {
                const sku = o.sku || "";
                const checked = labelChecked.has(o.id);
                return (
                  <label
                    key={o.id}
                    className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-muted/50"
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-primary flex-shrink-0"
                      checked={checked}
                      onChange={() => toggleLabelCheck(o.id)}
                      aria-label={`Seleccionar ${o.name}`}
                    />
                    <span className="min-w-0 flex-1 truncate">{o.name}</span>
                    <span className="text-xs text-muted-foreground tabular-nums flex-shrink-0">
                      {sku ? sku : "sin código — se generará"}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
          <div>
            <Label>Copias por producto (1-50)</Label>
            <Input
              type="number"
              min={1}
              max={50}
              value={labelCopies}
              onChange={(e) => setLabelCopies(e.target.value)}
              className="mt-1"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Logo + nombre + precio (con promo) + código de barras. Usá papel de etiquetas (no el rollo de tickets).
          </p>
        </div>
      </Modal>

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
        datosNode={<div className="space-y-3">{menuDraft.restored && (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
            <p className="text-xs font-medium text-primary">Recuperamos tu carga en curso{photoNotice ? " (volvé a elegir la foto)" : ""}</p>
            <button
              type="button"
              onClick={() => { menuDraft.discard(); resetForm(); }}
              className="text-xs font-medium text-muted-foreground hover:text-foreground underline flex-shrink-0"
            >
              Descartar
            </button>
          </div>
        )}{offerForm}</div>}
        opcionesNode={
          editingId ? <ProductModifiersBlock productId={editingId} productName={offName} /> : null
        }
        recetaNode={recetaNode}
      />
    </div>
  );
}
