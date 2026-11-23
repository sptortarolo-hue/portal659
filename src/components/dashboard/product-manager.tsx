"use client";

import { useCallback, useEffect, useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PhotoPicker } from "@/components/ui/photo-picker";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { QuantityInput } from "@/components/ui/quantity-input";
import { Badge } from "@/components/ui/badge";
import { OfferForm, OfferList, CategoryManager, apiJson, useFormDraft } from "@/components/dashboard/shared";
import { MoreActionsMenu } from "@/components/dashboard/more-actions-menu";
import { VolumeEditor } from "@/components/dashboard/volume-editor";
import { MarginListsManager, type MarginList } from "@/components/dashboard/margin-lists-manager";
import {
  applyRounding,
  describeRounding,
  isDefaultRounding,
  resolveRounding,
  type Rounding,
} from "@/lib/price-rounding";
import { SuggestionsManager } from "@/components/dashboard/suggestions-manager";
import { SupplierSelect } from "@/components/dashboard/supplier-select";
import { clearDraft } from "@/lib/draft";
import { toDateOnly } from "@/lib/expiry";
import { isGiftProductRow } from "@/lib/gift-card-share";
import { ProductModifiersBlock } from "@/components/dashboard/modifier-editor";
import { ProductOptionsEditor } from "@/components/dashboard/product-options-editor";
import { ProductImage } from "@/components/product-image";
import { SIZE_GUIDE_TEMPLATES, templateToText } from "@/lib/size-guides";
import type { ProductVariant } from "@/types/database";
import type { ProductImage as ProductImageRow } from "@/types/database";
import type { Vendor } from "@/types/database";


type MenuCategory = { id: string; name: string; position: number };

type OfferRow = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  category: string | null;
  available: boolean;
  online_available?: boolean | null;
  is_combo?: boolean | null;
  /** Lista de margen aplicada (migrate-margin-lists.sql). */
  margin_list_id?: string | null;
  featured_today: boolean;
  suggestible?: boolean;
  image_url: string | null;
  stock: number | null;
  stock_low_threshold: number | null;
  stock_control?: boolean;
  promo_price: number | null;
  requires_prep?: boolean;
  cash_discount_excluded?: boolean;
  has_variants?: boolean;
  /** Código interno (SKU): escáner de mostrador + etiquetas. */
  sku?: string | null;
  /** Formato de pack del producto (1 = por unidad). */
  pack_size?: number | null;
  /** Último costo de compra (migrate-inventory.sql). */
  cost_last?: number | null;
  supplier_id?: string | null;
  expires_at?: string | null;
};

type Props = {
  isModa?: boolean;
  /** Comercio del barrio: usa el mismo editor genérico (sin variantes). */
  isComercio?: boolean;
  /** Catálogo completo (Categorías · Opciones · Volumen · Combos) sin activar
   *  el modo moda (variantes color×talle, guía de talles, etc.). */
  showCatalogViews?: boolean;
  showStock?: boolean;
  showPrep?: boolean;
  /** Muestra el chip de food-cost por plato (requiere plan con preparación). */
  showCosts?: boolean;
  /** Permite editar el costo de compra manual (plan Gestión: inventory o recipes). */
  canEditCost?: boolean;
  /** Muestra el campo de vencimiento del stock (plan Gestión con inventario). */
  showExpiry?: boolean;
  /** Muestra el toggle de venta online (solo taller). */
  showOnlineToggle?: boolean;
  /** Para el borrador del formulario (24h). */
  vendorId?: string | null;
  /** Datos del comercio (para decidir visibilidad de toggle online por vertical). */
  vendor?: Vendor | null;
  /** Variantes de todos los productos (solo moda). */
  variants?: ProductVariant[];
  /** Galería de todos los productos (solo moda). */
  productImages?: ProductImageRow[];
  onCrop?: (target: "offer", src?: string) => void;
  onChanged?: () => void;
};

type CostInfo = { cost: number | null; pct: number | null; status: "ok" | "warn" | "bad" | "none" };

type VariantRow = {
  color: string;
  talle: string;
  price: string;
  promo: string;
  stock: number;
  sku: string;
};

type ComboRow = { product_id: string; name: string; price: number; qty: number; image_url?: string | null };

// Galería moda: 1 portada (image_url) + hasta 7 extras (product_images).
const MAX_EXTRA_IMAGES = 7;

/** Vistas del catálogo moda: mismo patrón que MenuStudio (tab-bar + manager
  * dedicado por vista). Solo moda: el resto de verticales con este panel
  * (estética) sigue con el layout actual. */
const PM_VIEWS: { id: string; icon: string; label: string }[] = [
  { id: "productos", icon: "🛍️", label: "Productos" },
  { id: "categorias", icon: "🗂️", label: "Categorías" },
  { id: "opciones", icon: "⚙️", label: "Opciones" },
  { id: "volumen", icon: "📦", label: "Precios por volumen" },
  { id: "combos", icon: "🧩", label: "Combos" },
  { id: "listas", icon: "🏷️", label: "Listas" },
  { id: "sugerencias", icon: "🛒", label: "Sugerencias" },
];

/** Gestión completa de platos/productos (listado + ficha inline + modificadores), sin ir a Configuración. */
export function ProductManager({ isModa = false, isComercio = false, showCatalogViews = false, showStock = true, showPrep = false, showCosts = false, canEditCost = false, showExpiry = false, showOnlineToggle = false, vendorId = null, vendor = null, variants, productImages, onCrop, onChanged }: Props) {
  // Wording por vertical: gastro habla de "platos", retail de "productos".
  const noun = isModa || isComercio ? "Producto" : "Plato";
  // Vistas del catálogo: moda las trae por defecto; otros verticales
  // (estética/taller) las prenden con showCatalogViews.
  const catalogViews = isModa || showCatalogViews;
  const [offers, setOffers] = useState<OfferRow[]>([]);
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [costByProduct, setCostByProduct] = useState<Record<string, CostInfo>>({});
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkMode, setBulkMode] = useState<"pct" | "amount" | "markup" | "margin">("pct");

  // Regla global de redondeo (vendors.price_round_*, migrate-price-rounding.sql):
  // la muestra del modal masivo calcula igual que el server.
  const [vendorRound, setVendorRound] = useState<Rounding>(() => resolveRounding(null));
  useEffect(() => {
    let alive = true;
    fetch("/api/vendor/me")
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        setVendorRound(
          resolveRounding({
            step: d?.vendor?.price_round_step,
            mode: d?.vendor?.price_round_mode,
            tail: d?.vendor?.price_round_tail,
          })
        );
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  const [bulkValue, setBulkValue] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMsg, setBulkMsg] = useState("");
  const [bulkIncludePromos, setBulkIncludePromos] = useState(false);
  const isTaller = vendor?.vertical === "taller";
  // Listas de margen: select del editor + solapa Listas.
  const [marginLists, setMarginLists] = useState<MarginList[] | null>(null);
  const [marginListsError, setMarginListsError] = useState<string | null>(null);
  const [offMarginListId, setOffMarginListId] = useState("");
  const refreshMarginLists = useCallback(async () => {
    if (!canEditCost) return;
    try {
      const res = await fetch("/api/vendor/margin-lists");
      const d = await res.json().catch(() => ({}));
      if (res.ok && d.ok) {
        setMarginLists(d.lists ?? []);
        setMarginListsError(null);
        return;
      }
      setMarginLists([]);
      setMarginListsError(d.error || "No se pudieron cargar las listas");
    } catch {
      setMarginLists([]);
      setMarginListsError("No se pudieron cargar las listas");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEditCost]);
  useEffect(() => { refreshMarginLists(); }, [refreshMarginLists]);
  // Vista activa del catálogo (solo moda usa el tab-bar).
  const [view, setView] = useState<string>("productos");
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
  const [offCost, setOffCost] = useState("");
  // Default de "Requiere elaboración": sigue a showPrep — los verticales sin
  // cocina (retail, servicio) nunca preparan: sus productos quedan en false
  // aunque el switch no se muestre (así no entran al flow de cocina del POS).
  const [offRequiresPrep, setOffRequiresPrep] = useState(showPrep);
  const [offCashExcluded, setOffCashExcluded] = useState(false);
  const [offSku, setOffSku] = useState("");
  // Proveedor habitual y vencimiento (inventario).
  const [offSupplierId, setOffSupplierId] = useState("");
  const [offExpiresAt, setOffExpiresAt] = useState("");
  // "Se vende de a N" (pack, moda): precio del PAQUETE. Solo sin variantes.
  const [offPackSize, setOffPackSize] = useState("");
  // Combos (OfferForm): mismo wiring que MenuStudio (solo rama con OfferForm:
  // estética y resto; la ficha de moda usa su form propio con variantes).
  const [offIsCombo, setOffIsCombo] = useState(false);
  const [offComboItems, setOffComboItems] = useState<ComboRow[]>([]);
  const [comboItemsByProduct, setComboItemsByProduct] = useState<Record<string, ComboRow[]>>({});
  // Moda: los combos se cargan desde la vista Combos con el form genérico
  // (OfferForm, igual que las demás verticales) — no desde el form de variantes.
  const [comboFormMode, setComboFormMode] = useState(false);

  // Moda: variantes (color × talle) + galería.
  const [offHasVariants, setOffHasVariants] = useState(false);
  const [variantRows, setVariantRows] = useState<VariantRow[]>([]);
  const [galleryUrls, setGalleryUrls] = useState<{ url: string; color: string | null }[]>([]);
  // Guía de talles (texto, una línea por talle).
  const [offSizeGuide, setOffSizeGuide] = useState("");

  const load = useCallback(async () => {
    const [o, c] = await Promise.all([
      fetch("/api/vendor/offers").then((r) => r.json()),
      fetch("/api/vendor/categories").then((r) => r.json()).catch(() => ({ categories: [] })),
    ]);
    if (o.offers) setOffers(o.offers);
    if (o.comboItemsByProduct) setComboItemsByProduct(o.comboItemsByProduct);
    if (c.categories) setCategories(c.categories);
    if (showCosts) {
      // 403 si el plan no incluye preparación: se ignora y no se muestran chips.
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
    const map: Record<string, { url: string; color: string | null }[]> = {};
    for (const pi of productImages || []) {
      if (!map[pi.product_id]) map[pi.product_id] = [];
      map[pi.product_id].push({ url: pi.image_url, color: pi.color ?? null });
    }
    return map;
  }, [productImages]);

  function resetForm() {
    clearDraft(vendorId, "product-manager");
    setPhotoNotice(false);
    setEditingId(null);
    setShowForm(false);
    setOffName("");
    setOffDesc("");
    setOffPrice("");
    setOffCategory(isModa ? categories?.[0]?.name || "ropa" : "otras");
    setOffFile(null);
    setOffPreview(null);
    setOffStock(0);
    setOffStockControl(false);
    setOffPromoPrice("");
    setOffCost("");
    setOffStockLowThreshold(5);
    setOffRequiresPrep(showPrep);
    setOffCashExcluded(false);
    setOffSku("");
    setOffSupplierId("");
    setOffMarginListId("");
    setOffExpiresAt("");
    setOffPackSize("");
    setOffHasVariants(false);
    setVariantRows([]);
    setGalleryUrls([]);
    setOffSizeGuide("");
    setOffIsCombo(false);
    setOffComboItems([]);
    setComboFormMode(false);
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
    setOffCost((offer as any).cost_last != null ? String((offer as any).cost_last) : "");
    setOffMarginListId(offer.margin_list_id ? String(offer.margin_list_id) : "");
    setOffStockLowThreshold(offer.stock_low_threshold ?? 5);
    // Sin switch visible (retail): al guardar queda en false, nunca cocina.
    setOffRequiresPrep(showPrep ? offer.requires_prep !== false : false);
    setOffCashExcluded(!!offer.cash_discount_excluded);
    setOffSku((offer as { sku?: string | null }).sku ?? "");
    setOffSupplierId(offer.supplier_id ? String(offer.supplier_id) : "");
    setOffExpiresAt(toDateOnly(offer.expires_at) || "");
    setOffPackSize(Number(offer.pack_size) >= 2 ? String(offer.pack_size) : "");
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
    // Combos: carga líneas si las hay (del GET offers comboItemsByProduct).
    // Un combo se edita con el form genérico (OfferForm), no con el de variantes.
    const comboRows = comboItemsByProduct?.[offer.id] || [];
    const isComboRow = Array.isArray(comboRows) && comboRows.length > 0;
    setOffIsCombo(isComboRow);
    if (catalogViews) setComboFormMode(isComboRow);
    setOffComboItems(Array.isArray(comboRows) ? comboRows : []);
    setShowForm(true);
  }

  // Borrador del formulario (24h). La foto/galería (File) no se persiste.
  type ProductDraft = {
    editingId: string | null; offName: string; offDesc: string; offPrice: string;
    offCategory: string; offPreview: string | null; offStock: number;
    offStockControl: boolean; offPromoPrice: string; offCost: string;
    offStockLowThreshold: number; offRequiresPrep: boolean; offCashExcluded: boolean;
    offHasVariants: boolean; offSizeGuide: string; offSku: string;
    offSupplierId: string; offExpiresAt: string; offPackSize: string; variantRows: VariantRow[];
    hadFile: boolean;
  };
  const [photoNotice, setPhotoNotice] = useState(false);
  const importFileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const productDraft = useFormDraft<ProductDraft>({
    vendorId,
    key: "product-manager",
    watch: [showForm, editingId, offName, offDesc, offPrice, offCategory, offPreview, offStock, offStockControl, offPromoPrice, offCost, offStockLowThreshold, offRequiresPrep, offCashExcluded, offHasVariants, offSizeGuide, offSku, offSupplierId, offExpiresAt, offPackSize, variantRows],
    snapshot: () => {
      if (!showForm) return null;
      if (!editingId && !offName.trim() && !offPrice && !offDesc.trim()) return null;
      return {
        editingId, offName, offDesc, offPrice, offCategory, offPreview, offStock,
        offStockControl, offPromoPrice, offCost, offStockLowThreshold, offRequiresPrep,
        offCashExcluded, offHasVariants, offSizeGuide, offSku, offSupplierId, offExpiresAt, offPackSize, variantRows,
        hadFile: offFile != null,
      };
    },
    restore: (d) => {
      const stillThere = d.editingId && offers.some((o) => o.id === d.editingId);
      setEditingId(stillThere ? d.editingId : null);
      setOffName(d.offName || "");
      setOffDesc(d.offDesc || "");
      setOffPrice(d.offPrice || "");
      setOffCategory(d.offCategory || "otras");
      setOffFile(null);
      setOffPreview(d.offPreview || null);
      setOffStock(typeof d.offStock === "number" ? d.offStock : 0);
      setOffStockControl(d.offStockControl === true);
      setOffPromoPrice(d.offPromoPrice || "");
      setOffCost(d.offCost || "");
      setOffStockLowThreshold(typeof d.offStockLowThreshold === "number" ? d.offStockLowThreshold : 5);
      setOffRequiresPrep(showPrep ? d.offRequiresPrep !== false : false);
      setOffCashExcluded(d.offCashExcluded === true);
      setOffHasVariants(d.offHasVariants === true);
      setOffSizeGuide(d.offSizeGuide || "");
      setOffSku(typeof d.offSku === "string" ? d.offSku : "");
      setOffSupplierId(d.offSupplierId || "");
      setOffExpiresAt(d.offExpiresAt || "");
      setOffPackSize(typeof d.offPackSize === "string" ? d.offPackSize : "");
      if (Array.isArray(d.variantRows)) setVariantRows(d.variantRows);
      setPhotoNotice(d.hadFile === true);
    },
    onRestored: () => setShowForm(true),
  });

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

  /** Generador de códigos del comercio: prefijo por iniciales del +secuencia
    * libre contra TODO lo ya usado (productos y variantes de otros productos).
    * Rellena el SKU del producto si falta y las variantes sin código. */
  function generateSkus() {
    const used = new Set<string>();
    for (const o of offers) {
      const s = String(o.sku || "").trim().toLowerCase();
      if (s) used.add(s);
    }
    for (const v of variants || []) {
      if (editingId && v.product_id === editingId) continue;
      const s = String(v.sku || "").trim().slice(0, 64);
      if (s) used.add(s.toLowerCase());
    }
    const base = (offName.trim().replace(/[^a-zA-ZáéíóúÁÉÍÓÚñÑ]/g, "").slice(0, 3).toUpperCase()) || "PRD";
    const usedNums = new Set<number>();
    for (const s of used) {
      const m = s.match(/(\d{1,6})$/);
      if (m) usedNums.add(parseInt(m[1], 10));
    }
    let n = 1;
    while (used.has(`${base}-${String(n).padStart(4, "0")}`.toLowerCase()) || usedNums.has(n)) n++;
    const prodCode = `${base}-${String(n).padStart(4, "0")}`;
    if (!offSku.trim()) setOffSku(prodCode);
    if (offHasVariants) {
      setVariantRows((prev) => prev.map((r, idx) => (r.sku.trim() ? r : { ...r, sku: `${prodCode}-${idx + 1}` })));
    }
    setMsg("Códigos generados (los guardás al guardar el producto)");
  }

  /** Etiquetas térmicas: una por variante (mods en el nombre) o una del producto.
    * Los códigos los define el editor — la API imprime tal cual está. */
  async function printLabels() {
    const dims = (color: string, talle: string) => {
      const parts = [color, talle].filter((s) => String(s || "").trim());
      return parts.length ? ` (${parts.join(" · ")})` : "";
    };
    const rows = offHasVariants && variantRows.length > 0
      ? variantRows.map((r) => ({
          name: `${offName.trim()}${dims(r.color, r.talle)}`,
          price: Number(r.promo) > 0 ? Number(r.promo) : Number(r.price),
          oldPrice: Number(r.promo) > 0 ? Number(r.price) : null,
          code: r.sku.trim() || undefined,
        }))
      : [
          {
            name: offName.trim(),
            price: Number(offPromoPrice) > 0 ? Number(offPromoPrice) : Number(offPrice),
            oldPrice: Number(offPromoPrice) > 0 ? Number(offPrice) : null,
            code: offSku.trim() || undefined,
          },
        ];
    try {
      const res = await fetch("/api/print", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "label", rows }),
      });
      const data = await res.json().catch(() => ({}));
      setMsg(res.ok ? (data.printed === 0 ? "Ninguna etiqueta se imprimió (revisá la impresora)" : `${data.printed} etiqueta(s) mandadas a imprimir`) : data.error || "No se pudieron imprimir las etiquetas");
    } catch {
      setMsg("No se pudieron imprimir las etiquetas (revisá la impresora)");
    }
  }

  async function handleGalleryUpload(files: FileList | null) {
    if (!files) return;
    const room = MAX_EXTRA_IMAGES - galleryUrls.length;
    if (room <= 0) {
      setMsg(`Máximo ${MAX_EXTRA_IMAGES} fotos extra (más la portada)`);
      return;
    }
    const added: { url: string; color: string | null }[] = [];
    for (const f of Array.from(files).slice(0, room)) {
      const fd = new FormData();
      fd.append("file", f);
      fd.append("folder", "offers");
      const upRes = await fetch("/api/vendor/upload", { method: "POST", body: fd });
      const upData = await upRes.json().catch(() => ({ url: null }));
      if (upData.url) added.push({ url: upData.url, color: null });
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

  async function handleSubmit() {
    if (!offName.trim() || !offPrice) {
      setMsg("Completá nombre y precio");
      return;
    }
    if (isModa && offHasVariants && variantRows.length > 0) {
      // Una sola dimensión OK (solo colores, o solo talles) pero con valor.
      const emptyAll = variantRows.filter((r) => !r.color.trim() && !r.talle.trim());
      if (emptyAll.length > 0) {
        setMsg("Cada variante necesita al menos un color o un talle (rellená o borrá la fila vacía)");
        return;
      }
      const seen = new Set<string>();
      for (const r of variantRows) {
        const key = `${r.color.trim().toLowerCase()}|${r.talle.trim().toLowerCase()}`;
        if (seen.has(key)) {
          const label = [r.color.trim(), r.talle.trim()].filter(Boolean).join(" · ");
          setMsg(`Tenés dos variantes iguales (${label || "sin datos"}): borrá la repetida`);
          return;
        }
        seen.add(key);
      }
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
      const upRes = await fetch("/api/vendor/upload", { method: "POST", body: fd });
      const upData = await upRes.json();
      if (upData.url) imageUrl = upData.url;
      else { setSaving(false); setMsg(upData.error || "Error al subir la foto"); return; }
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
          size_guide: offSizeGuide.trim() || null,
          sku: offSku.trim() || undefined,
          pack_size: !offHasVariants && offPackSize ? Math.floor(Number(offPackSize)) : null,
          // Combos (se arman desde la vista Combos con el form genérico):
          // sin is_combo el POST no persiste las líneas (el flag se deriva en
          // runtime de combo_items).
          is_combo: offIsCombo && !offHasVariants,
          combo_items: offIsCombo && !offHasVariants ? offComboItems.map((c) => ({ product_id: c.product_id, qty: c.qty })) : [],
          cost_last: canEditCost && offCost.trim() !== "" && Number.isFinite(Number(offCost)) ? Math.round(Number(offCost) * 100) / 100 : undefined,
          supplier_id: canEditCost ? offSupplierId || null : undefined,
          margin_list_id: canEditCost ? offMarginListId || null : undefined,
          expires_at: showExpiry ? offExpiresAt || null : undefined,
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
          cost_last: canEditCost && offCost.trim() !== "" && Number.isFinite(Number(offCost)) ? Math.round(Number(offCost) * 100) / 100 : undefined,
          supplier_id: canEditCost ? offSupplierId || null : undefined,
          margin_list_id: canEditCost ? offMarginListId || null : undefined,
          expires_at: showExpiry ? offExpiresAt || null : undefined,
          is_combo: offIsCombo,
          combo_items: offIsCombo ? offComboItems.map((c) => ({ product_id: c.product_id, qty: c.qty })) : [],
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
          body: JSON.stringify({ product_id: productId, variants: variantRows.map((r) => ({ color: r.color, talle: r.talle, price: r.price, promo: r.promo || null, stock: r.stock, sku: r.sku.trim() || null })) }),
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
        body: JSON.stringify({ product_id: productId, images: galleryUrls.slice(0, MAX_EXTRA_IMAGES).map((g) => ({ image_url: g.url, color: g.color || null })) }),
      });
    }

    setSaving(false);
    resetForm();
    setMsg(editingId ? `${noun} actualizado` : `${noun} agregado`);
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

  async function toggleSuggestible(offer: OfferRow) {
    const res = await fetch(`/api/vendor/offers/${offer.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ suggestible: !offer.suggestible }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      alert(d?.error || "No se pudo marcar como sugerible");
    }
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

  async function toggleOnline(offer: OfferRow) {
    await fetch(`/api/vendor/offers/${offer.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ online_available: !(offer.online_available !== false) }),
    });
    load(); onChanged?.();
  }

  async function deleteOffer(offer: OfferRow) {
    if (!confirm(`¿Eliminar "${offer.name}"? Esta acción no se puede deshacer.`)) return;
    await fetch(`/api/vendor/offers/${offer.id}`, { method: "DELETE" });
    if (editingId === offer.id) resetForm();
    setMsg(`${noun} eliminado`);
    load(); onChanged?.();
  }

  // --- Categorías (misma lógica que MenuStudio) ---------------------------
  async function addCategory(name: string) {
    const r = await apiJson("/api/vendor/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!r.ok) setMsg(r.error || "No se pudo crear la categoría");
    load();
  }

  async function renameCategory(id: string, name: string) {
    const r = await apiJson(`/api/vendor/categories/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!r.ok) setMsg(r.error || "No se pudo renombrar");
    load();
  }

  async function deleteCategory(cat: MenuCategory) {
    const r = await apiJson(`/api/vendor/categories/${cat.id}`, { method: "DELETE" });
    if (!r.ok) setMsg(r.error || "No se pudo eliminar");
    load();
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
    load();
  }

  /** Nuevo combo moda: mismo form que las demás verticales (OfferForm),
    * con el toggle 🧩 ya prendido. Se crea desde la vista Combos. */
  function openNewCombo() {
    resetForm();
    setComboFormMode(true);
    setOffIsCombo(true);
    setShowForm(true);
  }

  const modaFormNode = (
    <Card className="p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold">{editingId ? "Editar producto" : "Nuevo producto"}</h3>
        <Button type="button" variant="ghost" size="sm" onClick={resetForm}>✕</Button>
      </div>
      {productDraft.restored && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 mb-3">
          <p className="text-xs font-medium text-primary">Recuperamos tu carga en curso{photoNotice ? " (volvé a elegir la foto)" : ""}</p>
          <button
            type="button"
            onClick={() => { productDraft.discard(); resetForm(); }}
            className="text-xs font-medium text-muted-foreground hover:text-foreground underline flex-shrink-0"
          >
            Descartar
          </button>
        </div>
      )}
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Nombre</Label><Input value={offName} onChange={(e) => setOffName(e.target.value)} required /></div>
          <div><Label>Precio ($)</Label><Input type="number" step="0.01" value={offPrice} onChange={(e) => setOffPrice(e.target.value)} required /></div>
        </div>
        <div><Label>Precio promo ($)</Label><Input type="number" step="0.01" value={offPromoPrice} onChange={(e) => setOffPromoPrice(e.target.value)} placeholder="Vacío si no está en oferta" /></div>
        {!offHasVariants && (
          <div>
            <Label>Se vende de a… (pack)</Label>
            <Input
              type="number"
              min={2}
              step={1}
              inputMode="numeric"
              value={offPackSize}
              onChange={(e) => setOffPackSize(e.target.value)}
              placeholder="Ej: 3 boxers (vacío = por unidad)"
            />
            <p className="text-xs text-muted-foreground mt-0.5">
              Con pack, el precio cargado es <strong>por paquete</strong> y solo se vende en múltiplos de {offPackSize || "N"}.
            </p>
            {Number(offPackSize) >= 2 && (
              <p className="text-[11px] text-violet-600 dark:text-violet-400 mt-0.5">
                💡 ¿Querés que el cliente mezcle colores/talles dentro del pack? Usá la vista <strong>📦 Precios por volumen</strong>.
              </p>
            )}
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Código (SKU)</Label>
            <Input value={offSku} onChange={(e) => setOffSku(e.target.value)} placeholder="Ej: REM-0001" />
          </div>
          <div className="flex items-end gap-1.5">
            <Button type="button" variant="outline" size="sm" onClick={generateSkus} title="Rellena el código del producto y los que falten en las variantes">⚡ Códigos</Button>
            <Button type="button" variant="ghost" size="sm" onClick={printLabels} title="Etiquetas térmicas de góndola (una por variante)">🖨️ Etiquetas</Button>
          </div>
        </div>
        {canEditCost && <SupplierSelect value={offSupplierId} onChange={setOffSupplierId} />}
        <div><Label>Categoría</Label><select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={offCategory} onChange={(e) => setOffCategory(e.target.value)}>{categories.length === 0 && <option value="ropa">ropa</option>}{categories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}</select></div>
        <div className="flex items-center gap-2">
          <Switch checked={offHasVariants} onCheckedChange={setOffHasVariants} />
          <span className="text-sm text-muted-foreground">Usar variantes (color y/o talle)</span>
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
              <Label className="text-sm">Variantes (color y/o talle)</Label>
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

        {(!offHasVariants || variantRows.some((r) => r.talle.trim())) && (
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
        )}

        <div><Label>Fotos extra ({galleryUrls.length}/{MAX_EXTRA_IMAGES}) — frente, espalda/en modelo, detalle de tela, escala</Label>
          <PhotoPicker multiple disabled={galleryUrls.length >= MAX_EXTRA_IMAGES} onFiles={(files) => handleGalleryUpload(files as any)} />
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
          <div><Label>Foto principal (portada)</Label>
            <PhotoPicker onFile={(f) => { if (f) { const src = URL.createObjectURL(f); onCrop?.("offer", src); setOffFile(f); setOffPreview(src); } }} />
            {offPreview && <img src={offPreview} alt="Portada" className="mt-2 h-16 w-full object-cover rounded-lg" />}</div>
        </div>

        <div><Label>Descripción</Label><Textarea value={offDesc} onChange={(e) => setOffDesc(e.target.value)} /></div>
        <Button type="button" onClick={() => handleSubmit()} disabled={saving} className="w-full">{saving ? "Guardando..." : editingId ? "Guardar" : "Agregar"}</Button>
      </div>
    </Card>
  );

  // El form genérico (OfferForm) lo usan estética/servicio siempre, y moda
  // solo para combos (se abren desde la vista Combos, igual que las demás
  // verticales). El form de variante de moda queda para productos normales.
  const useModaForm = isModa && !comboFormMode;
  const offerFormNode = useModaForm ? (
    <div className="space-y-3">
      {modaFormNode}
      {editingId && <ProductModifiersBlock productId={editingId} productName={offName} />}
    </div>
  ) : (
    <div className="space-y-3">
      {productDraft.restored && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
          <p className="text-xs font-medium text-primary">Recuperamos tu carga en curso{photoNotice ? " (volvé a elegir la foto)" : ""}</p>
          <button
            type="button"
            onClick={() => { productDraft.discard(); resetForm(); }}
            className="text-xs font-medium text-muted-foreground hover:text-foreground underline flex-shrink-0"
          >
            Descartar
          </button>
        </div>
      )}
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
        showCost={canEditCost}
        offCost={offCost} setOffCost={setOffCost}
        costLabel={showCosts ? "Costo compra ($)" : "Costo ($)"}
        showSupplier={canEditCost}
        offSupplierId={offSupplierId} setOffSupplierId={setOffSupplierId}
        showMarginLists={canEditCost && !offIsCombo && !marginListsError}
        marginLists={marginLists ?? []}
        offMarginListId={offMarginListId}
        setOffMarginListId={setOffMarginListId}
        showExpiry={showExpiry}
        offExpiresAt={offExpiresAt} setOffExpiresAt={setOffExpiresAt}
        // Combos (estética y resto con OfferForm): picker de componentes.
        offIsCombo={offIsCombo}
        setOffIsCombo={setOffIsCombo}
        offComboItems={offComboItems}
        setOffComboItems={setOffComboItems}
        offAllProducts={offers
          .filter((o) => o.available !== false)
          .map((o) => ({ id: o.id, name: o.name, price: Number(o.price) || 0, image_url: o.image_url ?? null }))}
        noun={noun.toLowerCase()}
      />
      {editingId && <ProductModifiersBlock productId={editingId} productName={offName} />}
    </div>
  );

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setMsg("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("action", "import");
      const res = await fetch("/api/vendor/products/import", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (data.error) {
        setMsg(`Error: ${data.error}`);
      } else {
        setMsg(`✅ Importados: ${data.imported ?? 0} nuevos, ${data.updated ?? 0} actualizados`);
        load();
        onChanged?.();
      }
    } catch {
      setMsg("Error al importar el archivo");
    } finally {
      setImporting(false);
      if (importFileRef.current) importFileRef.current.value = "";
    }
  }

  return (
    <div className="space-y-4">
      <input
        ref={importFileRef}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={handleImportFile}
      />
      <div className="flex items-center justify-between">
        <h2 className="font-display text-xl font-semibold">{isModa || isComercio ? "Catálogo" : "Menú y catálogo"}</h2>
        {(!catalogViews || view === "productos") && (
          <div className="flex items-center gap-2">
            <MoreActionsMenu
              groups={[
                {
                  label: "Precios",
                  items: [
                    { label: "Precios masivos", icon: "📊", onClick: () => setBulkOpen(true) },
                  ],
                },
                {
                  label: "Catálogo",
                  items: [
                    { label: "Exportar (Excel)", icon: "⬇️", onClick: () => { window.location.href = "/api/vendor/products/export"; } },
                    { label: "Importar (Excel)", icon: "⬆️", onClick: () => { importFileRef.current?.click(); } },
                    { label: "Descargar plantilla", icon: "📄", onClick: () => { window.location.href = "/api/vendor/products/template"; } },
                  ],
                },
                {
                  label: "Importar desde",
                  items: [
                    { label: "Foto/PDF de carta", icon: "📸", onClick: () => {} },
                    { label: "FUDO", icon: "📋", onClick: () => {} },
                    { label: "WhatsApp Catalogue", icon: "💬", onClick: () => {} },
                  ],
                },
                ...(canEditCost
                  ? [
                      {
                        label: "Herramientas",
                        items: [
                          { label: "Generar códigos SKU", icon: "⚡", onClick: () => {} },
                          { label: "Etiquetas térmicas", icon: "🖨️", onClick: () => {} },
                        ],
                      },
                    ]
                  : []),
              ]}
            />
            <Button size="sm" onClick={() => { if (editingId || showForm) resetForm(); else setShowForm(true); }}>
              {editingId || showForm ? "Cancelar" : `+ ${noun}`}
            </Button>
          </div>
        )}
      </div>

      {catalogViews && (
        <div className="flex rounded-xl border border-border overflow-x-auto max-w-full text-sm font-medium">
          {(canEditCost ? PM_VIEWS : PM_VIEWS.filter((v) => v.id !== "listas")).map((v) => (
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
                  : v.id === "combos"
                    ? ` (${offers.filter((o) => (comboItemsByProduct?.[o.id] || []).length > 0).length})`
                    : ""}
            </button>
          ))}
        </div>
      )}

      {msg && <p className="text-sm text-green-600">{msg}</p>}

      {catalogViews ? (
        <>
          {view === "productos" && (
            <>
              {showForm && !editingId && offerFormNode}
              {loading ? (
                <div className="space-y-2">{[...Array(4)].map((_, i) => <div key={i} className="h-16 rounded-xl bg-muted animate-pulse" />)}</div>
              ) : (
                <OfferList
                  offers={offers}
                  onEdit={startEdit}
                  onToggleFeatured={toggleFeatured}
                  onToggleSuggestible={toggleSuggestible}
                  onToggleAvailable={toggleAvailable}
                  onToggleOnline={isTaller ? toggleOnline : undefined}
                  onDelete={deleteOffer}
                  editingId={editingId}
                  editForm={editingId ? offerFormNode : undefined}
                  onEditModifiers={(offer) => startEdit(offer)}
                  costByProduct={showCosts ? costByProduct : undefined}
                  showBuyCost={canEditCost}
                  emptyText={`Todavía no cargaste productos. Creá uno con "+ ${noun}" o importá desde el menú ⋯.`}
                />
              )}
            </>
          )}

          {view === "categorias" && (
            <>
              <CategoryManager
                defaultOpen
                categories={categories}
                onAdd={addCategory}
                onRename={renameCategory}
                onDelete={deleteCategory}
                onMove={moveCategory}
              />
              <p className="text-xs text-muted-foreground">
                Las categorías ordenan el catálogo del micrositio. Usá ↑↓ para cambiar el orden.
              </p>
            </>
          )}

          {view === "opciones" && (
            <ProductOptionsEditor
              products={offers.map((o) => ({ id: o.id, name: o.name }))}
              initialProductId={editingId}
              isModa={isModa}
              isComercio={isComercio}
              onChanged={load}
            />
          )}

          {view === "volumen" && (
            <>
              <VolumeEditor
                products={offers
                  .filter((o) => !isGiftProductRow(o))
                  .map((o) => ({ id: o.id, name: o.name, category: o.category, price: Number(o.price) || 0, unit: (o as any).unit ?? null }))}
                categories={categories}
              />
              <p className="text-xs text-muted-foreground">
                Packs "llevá N y pagá X" combinando {isModa ? "prendas o accesorios" : "productos"}. Se aplican en el checkout.
              </p>
            </>
          )}

          {view === "combos" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <p className="text-sm text-muted-foreground flex-1 min-w-[240px]">
                  Varios productos juntos por un precio. La ficha del micrositio muestra qué incluye y el stock se descuenta por componente al vender.
                </p>
                <Button size="sm" onClick={openNewCombo}>
                  + Nuevo combo
                </Button>
              </div>
              {showForm && !editingId && offerFormNode}
              {editingId && comboFormMode && offerFormNode}
              {(() => {
                const combos = offers.filter((o) => (comboItemsByProduct?.[o.id] || []).length > 0);
                if (combos.length === 0) {
                  return (
                    <div className="rounded-xl border border-border bg-card p-6 text-center">
                      <p className="text-sm text-muted-foreground">
                        Todavía no cargaste combos. Armá uno con tus productos y poné un precio entre la suma de costos y la de venta.
                      </p>
                    </div>
                  );
                }
                return (
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {combos.map((o) => {
                      const members = comboItemsByProduct?.[o.id] || [];
                      const sumaVenta = members.reduce((s, m) => s + (Number(m.price) || 0) * (Number(m.qty) || 1), 0);
                      const price = Number(o.promo_price ?? o.price) || 0;
                      const oldPrice = o.promo_price != null ? Number(o.price) : null;
                      const hasPromo = oldPrice != null && Math.round(oldPrice * 100) !== Math.round(price * 100);
                      return (
                        <div key={o.id} className="rounded-xl border border-border bg-card p-3 flex gap-3">
                          {o.image_url ? (
                            <ProductImage src={o.image_url} name={o.name} alt={o.name} className="h-20 w-20 rounded-lg object-cover flex-shrink-0" />
                          ) : (
                            <div className="h-20 w-20 rounded-lg bg-muted text-2xl flex items-center justify-center flex-shrink-0">🧩</div>
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="font-medium text-sm line-clamp-2 break-words">{o.name}</p>
                            <p className="text-sm tabular-nums">
                              <span className="font-bold">${price.toLocaleString("es-AR", { maximumFractionDigits: 2 })}</span>
                              {hasPromo && <span className="ml-1 text-xs text-muted-foreground line-through">${(Number(o.price) || 0).toLocaleString("es-AR")}</span>}
                              <span className="ml-2 text-xs text-muted-foreground">Σ venta: ${sumaVenta.toLocaleString("es-AR", { maximumFractionDigits: 2 })}</span>
                            </p>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {members.slice(0, 5).map((m, i) => (
                                <span key={`${m.product_id}-${i}`} className="rounded-full border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground truncate max-w-[130px]">
                                  {(Number(m.qty) || 1) > 1 ? `${m.qty}× ` : ""}{m.name}
                                </span>
                              ))}
                              {members.length > 5 && (
                                <span className="rounded-full border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                  +{members.length - 5}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 mt-2">
                              <button
                                type="button"
                                onClick={() => startEdit(o)}
                                className="text-xs font-medium text-primary hover:underline"
                              >
                                ✏️ Editar
                              </button>
                              <button
                                type="button"
                                onClick={() => toggleAvailable(o)}
                                className="text-xs text-muted-foreground hover:text-foreground"
                              >
                                {o.available !== false ? "⏸ Pausar" : "▶ Activar"}
                              </button>
                              {isTaller && (
                                <button
                                  type="button"
                                  onClick={async () => {
                                    await fetch(`/api/vendor/offers/${o.id}`, {
                                      method: "PATCH",
                                      headers: { "Content-Type": "application/json" },
                                      body: JSON.stringify({ online_available: !(o.online_available !== false) }),
                                    });
                                    load(); onChanged?.();
                                  }}
                                  className="text-xs text-muted-foreground hover:text-foreground"
                                >
                                  {o.online_available !== false ? "🌐 Online" : "🚫 Sin online"}
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          )}

          {view === "listas" && (
            <MarginListsManager
              offers={offers}
              lists={marginLists}
              error={marginListsError}
              onRefresh={refreshMarginLists}
              onChanged={() => { load(); onChanged?.(); }}
            />
          )}

          {view === "sugerencias" && (
            <SuggestionsManager vendorId={vendorId} onChanged={() => { load(); onChanged?.(); }} />
          )}
        </>
      ) : (
        <>
          {showForm && !editingId && offerFormNode}
          {loading ? (
            <div className="space-y-2">{[...Array(4)].map((_, i) => <div key={i} className="h-16 rounded-xl bg-muted animate-pulse" />)}</div>
          ) : (
            <OfferList
              offers={offers}
              onEdit={startEdit}
              onToggleFeatured={toggleFeatured}
              onToggleAvailable={toggleAvailable}
              onToggleOnline={isTaller ? toggleOnline : undefined}
              onDelete={deleteOffer}
              editingId={editingId}
              editForm={editingId ? offerFormNode : undefined}
              onEditModifiers={(offer) => startEdit(offer)}
              costByProduct={showCosts ? costByProduct : undefined}
              showBuyCost={canEditCost}
              emptyText={`Todavía no cargaste ${isComercio ? "productos" : "platos"}. Creá uno con "+ ${noun}" o importá desde el menú ⋯.`}
            />
          )}
        </>
      )}
    {bulkOpen && (
      <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/50" onClick={() => setBulkOpen(false)}>
        <div className="bg-card rounded-t-2xl sm:rounded-2xl border border-border w-full sm:max-w-md sm:mx-4 p-5 space-y-3 max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
          <h3 className="font-display text-lg font-semibold">Precios masivos</h3>
          <p className="text-xs text-muted-foreground">
            {(() => {
              const isCostMode = bulkMode === "markup" || bulkMode === "margin";
              return isCostMode
                ? "Se calcula con el último costo (cost_last); productos y variantes sin costo se saltean y se reportan. Los combos no se tocan. " +
                  (bulkIncludePromos
                    ? "Las promos se recalculan manteniendo el descuento que ya tenían."
                    : "Las promos no se modifican.")
                : "Actualiza el precio de varios productos a la vez. Los precios promo no se modifican.";
            })()}
          </p>
          <div className="grid grid-cols-2 gap-2">
            {([
              { id: "pct", label: "Porcentaje (%)" },
              { id: "amount", label: "Monto fijo ($)" },
              ...(canEditCost
                ? [
                    { id: "markup" as const, label: "Recargo costo (%)" },
                    { id: "margin" as const, label: "Margen costo (%)" },
                  ]
                : []),
            ] as { id: "pct" | "amount" | "markup" | "margin"; label: string }[]).map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setBulkMode(m.id)}
                className={`rounded-lg border px-3 py-2 text-xs font-medium ${bulkMode === m.id ? "border-primary bg-primary/10 text-primary" : "border-border bg-card"}`}
              >
                {m.label}
              </button>
            ))}
          </div>
          <div>
            <label className="text-xs text-muted-foreground">
              {bulkMode === "pct"
                ? "Porcentaje (ej: 10 = +10%, -5 = -5%)"
                : bulkMode === "amount"
                  ? "Monto a sumar/restar ($)"
                  : bulkMode === "markup"
                    ? "Recargo sobre el costo (ej: 100 = costo + 100%)"
                    : "Margen sobre el precio (ej: 50 = margen del 50%, menor al 100%)"}
            </label>
            <input
              type="number"
              min={0}
              step="any"
              value={bulkValue}
              onChange={(e) => setBulkValue(e.target.value)}
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              placeholder={bulkMode === "pct" ? "10" : bulkMode === "amount" ? "500" : bulkMode === "markup" ? "100" : "50"}
            />
          </div>
          {(bulkMode === "markup" || bulkMode === "margin") && (
            <div className="rounded-lg border border-border bg-background px-3 py-2">
              <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={bulkIncludePromos}
                  onChange={(e) => setBulkIncludePromos(e.target.checked)}
                  className="h-4 w-4 accent-lime-500"
                />
                Incluir promos (manteniendo el descuento)
              </label>
              {bulkIncludePromos && (
                <p className="mt-1.5 text-xs text-muted-foreground">
                  La promo se recalcula conservando su proporción sobre el precio. Ej.: $10.000 → $8.000 (–20%); al
                  aplicar el aumento pasa a mantener –20% sobre el nuevo precio.
                </p>
              )}
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Se aplicará a los {offers.length} productos del catálogo. Los precios promo no se tocan salvo que tildés
            “Incluir promos”.
          </p>
          {!isDefaultRounding(vendorRound) && (
            <p className="text-xs text-muted-foreground">
              🎯 Redondeo del comercio: {describeRounding(vendorRound)} (cambiálo en Catálogo → Listas).
            </p>
          )}
          {(() => {
            const val = Number(bulkValue);
            if (!bulkValue.trim() || !Number.isFinite(val)) return null;
            const isCostMode = bulkMode === "markup" || bulkMode === "margin";
            const costSample = offers.find((o) => o.cost_last != null && isFinite(Number(o.cost_last)) && Number(o.cost_last) >= 0);
            const sample = isCostMode ? costSample : offers[0];
            if (!sample) return null;
            if (isCostMode && !costSample) {
              return (
                <p className="text-xs rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
                  Ningún producto del catálogo tiene costo cargado: no hay nada que recalcular.
                </p>
              );
            }
            if (isCostMode && bulkMode === "margin" && val >= 100) {
              return (
                <p className="text-xs rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
                  El margen debe ser menor al 100%.
                </p>
              );
            }
            const oldPrice = Number(sample.price);
            const cost = isCostMode && sample.cost_last != null ? Number(sample.cost_last) : null;
            const newPrice = isCostMode
              ? bulkMode === "markup"
                ? applyRounding((cost as number) * (1 + val / 100), vendorRound)
                : applyRounding((cost as number) / (1 - val / 100), vendorRound)
              : bulkMode === "pct"
                ? Math.max(0, applyRounding(oldPrice * (1 + val / 100), vendorRound))
                : Math.max(0, applyRounding(oldPrice + val, vendorRound));
            let promoLine: string | null = null;
            if (isCostMode && bulkIncludePromos && sample.promo_price != null && oldPrice > 0) {
              const ratio = Math.min(Math.max(Number(sample.promo_price), 0), oldPrice) / oldPrice;
              promoLine = ` · promo $${Math.min(newPrice, applyRounding(newPrice * ratio, vendorRound)).toLocaleString("es-AR")} (mantiene −${Math.round((1 - ratio) * 100)}%)`;
            }
            return (
              <p className="text-xs rounded-lg bg-muted px-3 py-2 tabular-nums">
                Ej.: {sample.name}{" "}
                {isCostMode
                  ? `costo $${(cost as number).toLocaleString("es-AR")} → precio $${newPrice.toLocaleString("es-AR")}`
                  : `$${oldPrice.toLocaleString("es-AR")} → $${newPrice.toLocaleString("es-AR")}`}
                {promoLine}
              </p>
            );
          })()}
          {bulkMsg && <p className="text-xs text-muted-foreground">{bulkMsg}</p>}
          <div className="flex gap-2 pt-1">
            <Button variant="outline" className="flex-1" onClick={() => { setBulkOpen(false); setBulkMsg(""); setBulkIncludePromos(false); }}>
              Cancelar
            </Button>
            <Button
              className="flex-1"
              disabled={bulkBusy || !bulkValue.trim()}
              onClick={async () => {
                const val = Number(bulkValue);
                if (!Number.isFinite(val)) { setBulkMsg("Valor inválido"); return; }
                const isCostMode = bulkMode === "markup" || bulkMode === "margin";
                if (isCostMode && bulkMode === "margin" && val >= 100) { setBulkMsg("El margen debe ser menor al 100%"); return; }
                if (isCostMode && val < 0) { setBulkMsg("El valor no puede ser negativo"); return; }
                if (bulkMode === "markup" && val > 1000) { setBulkMsg("El recargo no puede superar el 1000%"); return; }
                if (bulkMode === "pct" && Math.abs(val) > 500) { setBulkMsg("El porcentaje está fuera de rango (±500)"); return; }
                const targets = offers;
                if (targets.length === 0) { setBulkMsg("No hay productos"); return; }
                let op: "pct_up" | "pct_down" | "add" | "markup_pct" | "margin_pct";
                let value = val;
                if (bulkMode === "pct") { op = val < 0 ? "pct_down" : "pct_up"; value = Math.abs(val); }
                else if (bulkMode === "amount") { op = "add"; value = val; }
                else if (bulkMode === "markup") { op = "markup_pct"; }
                else { op = "margin_pct"; }
                setBulkBusy(true);
                setBulkMsg(`Actualizando ${targets.length} productos...`);
                try {
                  const r = await fetch("/api/vendor/offers/bulk-price", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      ids: targets.map((o) => o.id),
                      op,
                      value,
                      includePromos: isCostMode && bulkIncludePromos,
                    }),
                  });
                  const data = await r.json().catch(() => ({}));
                  if (!r.ok || !data.ok) {
                    setBulkMsg(data.error || "No se pudieron actualizar los precios");
                  } else {
                    const parts = [`${data.updated ?? 0} productos`];
                    if (data.variantsUpdated > 0) parts.push(`${data.variantsUpdated} variantes`);
                    if (data.promosUpdated > 0) parts.push(`${data.promosUpdated} promos`);
                    const tail = data.skippedNoCost > 0 ? ` · ${data.skippedNoCost} sin costo omitidos` : "";
                    setBulkMsg(`Listo: ${parts.join(" + ")}${tail}.`);
                    setBulkIncludePromos(false);
                  }
                } catch {
                  setBulkMsg("No se pudieron actualizar los precios");
                } finally {
                  setBulkBusy(false);
                }
                load(); onChanged?.();
              }}
            >
              {bulkBusy ? "Actualizando..." : "Aplicar"}
            </Button>
          </div>
        </div>
      </div>
    )}
    </div>
  );
}
