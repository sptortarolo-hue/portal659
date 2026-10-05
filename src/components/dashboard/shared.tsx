"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { DropdownMenu } from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { saveDraft, loadDraft, clearDraft } from "@/lib/draft";
import { HoursEditor } from "@/components/dashboard/hours-editor";
import {
  isDeliveryOpen,
  isDeliveryPaused,
  nextDeliverySlots,
  usesStoreHours as usesStoreHoursOf,
} from "@/lib/delivery-schedule";

/**
 * Borrador de formulario con vencimiento (24h). Persiste campos serializables
 * mientras se edita; los File (fotos) no se pueden persistir y se avisan.
 * - snapshot(): estado actual o null si no hay nada que guardar.
 * - restore(d): aplica campos (sin files).
 * - onRestored(): p. ej. abrir el editor.
 */
export function useFormDraft<T extends Record<string, unknown>>(opts: {
  vendorId: string | null | undefined;
  key: string;
  watch: unknown[];
  snapshot: () => T | null;
  restore: (d: T) => void;
  onRestored: () => void;
}): { restored: boolean; discard: () => void; clear: () => void } {
  const [restored, setRestored] = useState(false);
  const ready = useRef(false);
  const keyRef = useRef(opts.key);
  keyRef.current = opts.key;
  const snapRef = useRef(opts.snapshot);
  snapRef.current = opts.snapshot;
  const restoreRef = useRef(opts.restore);
  restoreRef.current = opts.restore;
  const restoredRef = useRef(opts.onRestored);
  restoredRef.current = opts.onRestored;

  useEffect(() => {
    if (ready.current || !opts.vendorId) return;
    ready.current = true;
    try {
      const d = loadDraft<T>(opts.vendorId, opts.key);
      if (d && typeof d === "object") {
        restoreRef.current(d);
        restoredRef.current();
        setRestored(true);
      }
    } catch { /* borrador corrupto: se ignora */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.vendorId]);

  useEffect(() => {
    if (!ready.current || !opts.vendorId) return;
    const t = setTimeout(() => {
      try {
        const snap = snapRef.current();
        if (!snap) clearDraft(opts.vendorId, keyRef.current);
        else saveDraft(opts.vendorId, keyRef.current, snap);
      } catch { /* noop */ }
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, opts.watch);

  return {
    restored,
    discard: () => {
      clearDraft(opts.vendorId, opts.key);
      setRestored(false);
    },
    clear: () => clearDraft(opts.vendorId, opts.key),
  };
}

/** Hace un fetch a una API y devuelve ok + mensaje de error (si lo hay). */
export async function apiJson(url: string, init?: RequestInit): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(url, init);
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, error: data?.error };
  } catch {
    return { ok: false, error: "Error de red" };
  }
}

/** GET JSON tipado (null si falla o no es ok). */
export async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}
import { QuantityInput } from "@/components/ui/quantity-input";
import { ImageCropModal } from "@/components/ui/image-crop-modal";

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
  /** Costo de compra (inventario): distinto del food-cost de preparación. */
  cost_last?: number | null;
  promo_price: number | null;
  requires_prep?: boolean;
  /** Solo sale en la sección Promo (no figura en el menú). */
  promo_only?: boolean;
};

type Modifier = {
  id: string;
  product_id: string;
  group_name: string;
  options: { label: string; price_mod: number }[];
  required: boolean;
  max_selections: number;
  position: number;
};

type MenuCategory = { id: string; name: string; position: number };

type SharedProps = {
  vendor: any;
  offers: Offer[];
  categories: MenuCategory[];
  msg: string;
  setMsg: (m: string) => void;
  reload: () => void;
  saveVendor: (data: Record<string, unknown>) => Promise<void>;
  uploading: boolean;
};

type OfferFormProps = {
  categories: MenuCategory[];
  editingId: string | null;
  offName: string;
  setOffName: (v: string) => void;
  offDesc: string;
  setOffDesc: (v: string) => void;
  offPrice: string;
  setOffPrice: (v: string) => void;
  offCategory: string;
  setOffCategory: (v: string) => void;
  offFile: File | null;
  setOffFile: (f: File | null) => void;
  offPreview: string | null;
  setOffPreview: (v: string | null) => void;
  saving: boolean;
  onCrop?: (target: "offer", src?: string) => void;
  showStock?: boolean;
  offStock?: number;
  setOffStock?: (v: number) => void;
  offStockControl?: boolean;
  setOffStockControl?: (v: boolean) => void;
  offPromoPrice?: string;
  setOffPromoPrice?: (v: string) => void;
  offStockLowThreshold?: number;
  setOffStockLowThreshold?: (v: number) => void;
  showPrep?: boolean;
  offRequiresPrep?: boolean;
  setOffRequiresPrep?: (v: boolean) => void;
  offCashExcluded?: boolean;
  setOffCashExcluded?: (v: boolean) => void;
  /** "Se vende de a N" (pack): string con el N, "" = por unidad. Visible donde el editor lo pasa (gastro y comercio). */
  offPackSize?: string;
  setOffPackSize?: (v: string) => void;
  /** Unidad de venta (balanza): "unidad" o "kg" (precio por kilo). */
  showUnit?: boolean;
  offUnit?: string;
  setOffUnit?: (v: string) => void;
  /** Costo manual de compra (inventario): no pisa el costo de preparación. */
  showCost?: boolean;
  offCost?: string;
  setOffCost?: (v: string) => void;
  costLabel?: string;
  /** Código de barras / SKU (búsqueda y etiquetas en mostrador). */
  showSku?: boolean;
  offSku?: string;
  setOffSku?: (v: string) => void;
  /** Foto remota sugerida por lookup (se descarga al guardar). */
  remotePhoto?: string | null;
  onRemotePhoto?: (url: string | null) => void;
  /** Sustantivo del ítem en el título del form (default "plato"). */
  noun?: string;
  onSubmit: () => void;
  onClose?: () => void;
};

export function OfferForm({
  categories,
  editingId,
  offName, setOffName,
  offDesc, setOffDesc,
  offPrice, setOffPrice,
  offCategory, setOffCategory,
  offFile, setOffFile,
  offPreview, setOffPreview,
  saving, onSubmit, onCrop,
  showStock,
  offStock = 0, setOffStock,
  offStockControl = false, setOffStockControl,
  offPromoPrice = "", setOffPromoPrice,
  showCost = false, offCost = "", setOffCost, costLabel = "Costo compra ($)",
  offStockLowThreshold = 5, setOffStockLowThreshold,
  showPrep = false,
  offRequiresPrep = true, setOffRequiresPrep,
  offCashExcluded = false, setOffCashExcluded,
  offPackSize = "", setOffPackSize,
  showUnit = false,
  offUnit = "unidad", setOffUnit,
  showSku = false,
  offSku = "", setOffSku,
  remotePhoto = null, onRemotePhoto,
  noun = "plato",
  onClose,
}: OfferFormProps) {
  // Escáner de código de barras con la cámara (rellena el SKU).
  const [scanningSku, setScanningSku] = useState(false);
  const [scanSkuError, setScanSkuError] = useState("");
  const scanSkuVideoRef = useRef<HTMLVideoElement | null>(null);
  const scanSkuStopRef = useRef(false);
  async function stopSkuScan() {
    scanSkuStopRef.current = true;
    setScanningSku(false);
    try {
      const v = scanSkuVideoRef.current;
      const stream = (v as any)?.srcObject as MediaStream | undefined;
      stream?.getTracks().forEach((t) => t.stop());
      if (v) (v as any).srcObject = null;
    } catch { /* noop */ }
  }
  async function startSkuScan() {
    if (!setOffSku) return;
    setScanSkuError("");
    const BD = (window as any).BarcodeDetector;
    if (!BD) {
      setScanSkuError("Este navegador no soporta escaneo (usá Chrome o escribí el código)");
      return;
    }
    scanSkuStopRef.current = false;
    setScanningSku(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      const video = scanSkuVideoRef.current;
      if (!video) {
        stream.getTracks().forEach((t) => t.stop());
        await stopSkuScan();
        return;
      }
      (video as any).srcObject = stream;
      await video.play().catch(() => {});
      const detector = new BD({ formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf"] });
      const seen = new Set<string>();
      while (!scanSkuStopRef.current) {
        let codes: any[] = [];
        try {
          codes = await detector.detect(video);
        } catch {
          break;
        }
        const val = String(codes?.[0]?.rawValue || "").trim();
        if (val && !seen.has(val)) {
          seen.add(val);
          setOffSku(val.slice(0, 64));
          await stopSkuScan();
          return;
        }
        await new Promise((r) => setTimeout(r, 250));
      }
    } catch {
      if (!scanSkuStopRef.current) setScanSkuError("No se pudo abrir la cámara (revisá el permiso)");
    }
    await stopSkuScan();
  }
  useEffect(() => () => { scanSkuStopRef.current = true; }, []);

  // Lookup de código de barras (Open Food Facts + caché propia): sugiere
  // nombre/marca/foto sin pisar lo cargado.
  type LookupHit = { code: string; name: string; brand: string | null; image_url: string | null; source: string };
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupError, setLookupError] = useState("");
  const [lookupHit, setLookupHit] = useState<LookupHit | null>(null);
  async function lookupBarcode() {
    const code = (offSku || "").trim();
    if (!code) return;
    setLookupBusy(true);
    setLookupError("");
    setLookupHit(null);
    try {
      const res = await fetch(`/api/vendor/barcode-lookup?code=${encodeURIComponent(code)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.name) {
        setLookupError(data?.error || "Código no encontrado (cargalo manual)");
        return;
      }
      setLookupHit({ code, name: data.name, brand: data.brand || null, image_url: data.image_url || null, source: data.source || "off" });
    } catch {
      setLookupError("Sin conexión");
    } finally {
      setLookupBusy(false);
    }
  }
  function applyLookupData() {
    if (!lookupHit) return;
    if (!offName.trim()) setOffName(lookupHit.name);
    setLookupHit(null);
  }
  function applyLookupPhoto() {
    if (!lookupHit?.image_url) return;
    onRemotePhoto?.(lookupHit.image_url);
    setOffPreview(lookupHit.image_url);
    setLookupHit(null);
  }

  // Al crear (no editando): si la categoría actual no existe entre las opciones
  // (ej. default "otras" sin fila), usar la primera. Así el desplegable nunca
  // muestra una cosa y guarda otra.
  useEffect(() => {
    if (!editingId && categories.length > 0 && !categories.some((c) => c.name === offCategory)) {
      setOffCategory(categories[0].name);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categories, editingId]);
  const showCurrentAsOption =
    !!offCategory && !categories.some((c) => c.name === offCategory);
  return (
    <Card className="p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold">{editingId ? `Editar ${noun}` : `Nuevo ${noun}`}</h3>
        {onClose && (
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>✕</Button>
        )}
      </div>
      <div className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><Label>Nombre</Label><Input value={offName} onChange={(e) => setOffName(e.target.value)} required onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }} /></div>
          <div><Label>Precio ($)</Label><Input type="number" step="0.01" value={offPrice} onChange={(e) => setOffPrice(e.target.value)} required onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }} /></div>
        {showCost && setOffCost && (
          <div>
            <Label>{costLabel}</Label>
            <Input type="number" step="0.01" min="0" value={offCost} onChange={(e) => setOffCost(e.target.value)} placeholder="Vacío = sin dato" />
            <p className="text-xs text-muted-foreground mt-0.5">
              Costo de compra manual (no toca el costo de preparación). La próxima compra lo actualiza.
            </p>
          </div>
        )}
        </div>
        {showStock && setOffPromoPrice && (
          <div><Label>Precio promo ($)</Label><Input type="number" step="0.01" value={offPromoPrice} onChange={(e) => setOffPromoPrice(e.target.value)} placeholder="Precio de oferta" /></div>
        )}
        {setOffCashExcluded && Number(offPromoPrice) > 0 && (
          <div className="flex items-center justify-between">
            <div>
              <Label>Aplica descuento en efectivo</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Si lo apagás, esta promo no recibe el % de descuento en efectivo
              </p>
            </div>
            <Switch
              checked={!offCashExcluded}
              onCheckedChange={(v) => setOffCashExcluded(!v)}
            />
          </div>
        )}
        <div><Label>Categoría</Label><select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={offCategory} onChange={(e) => setOffCategory(e.target.value)}>{categories.length === 0 && <option value="otras">otras</option>}{categories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}{showCurrentAsOption && <option value={offCategory}>{offCategory}</option>}</select></div>
        {setOffPackSize && (
          <div>
            <Label>Se vende de a… (pack)</Label>
            <Input
              type="number"
              min={2}
              step={1}
              inputMode="numeric"
              value={offPackSize}
              onChange={(e) => setOffPackSize(e.target.value)}
              placeholder="Ej: 6 (vacío = por unidad)"
            />
            <p className="text-xs text-muted-foreground mt-0.5">
              Cantidad mínima y múltiplo de venta (ej: sandwiches de miga de a 6). Con pack, el precio cargado es <strong>por paquete</strong> (6 unidades).
            </p>
          </div>
        )}
        {showUnit && setOffUnit && (
          <div>
            <Label>Se vende por</Label>
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={offUnit}
              onChange={(e) => setOffUnit(e.target.value)}
            >
              <option value="unidad">Por unidad</option>
              <option value="kg">Por peso (precio por kilo, balanza en mostrador)</option>
            </select>
            {offUnit === "kg" && (
              <p className="text-xs text-muted-foreground mt-0.5">
                El precio cargado es <strong>por kilo</strong>. En mostrador se pesa y no descuenta stock.
              </p>
            )}
          </div>
        )}
        {showSku && setOffSku && (
          <div>
            <Label>Código de barras (SKU)</Label>
            <div className="flex gap-1.5">
              <Input
                value={offSku}
                onChange={(e) => setOffSku(e.target.value.trim())}
                placeholder="Ej: 7791234567890 (vacío = sin código)"
                className="flex-1 min-w-0"
              />
              <button
                type="button"
                onClick={startSkuScan}
                className="h-10 w-11 flex-shrink-0 rounded-md border border-input bg-background text-lg hover:border-primary"
                title="Escanear código con la cámara"
                aria-label="Escanear código de barras"
              >
                📷
              </button>
            </div>
            {scanSkuError && <p className="text-[11px] text-amber-700 pt-1">{scanSkuError}</p>}
            <div className="flex gap-1.5 pt-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={lookupBarcode}
                disabled={lookupBusy || !offSku.trim()}
              >
                {lookupBusy ? "Buscando…" : "🔍 Buscar datos"}
              </Button>
            </div>
            {lookupError && <p className="text-[11px] text-amber-700 pt-1">{lookupError}</p>}
            {lookupHit && (
              <div className="mt-2 flex items-center gap-2 rounded-xl border border-border bg-muted/40 p-2">
                {lookupHit.image_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={lookupHit.image_url} alt="" className="h-12 w-12 rounded-lg object-cover flex-shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium truncate">{lookupHit.name}</p>
                  {lookupHit.brand && <p className="text-[11px] text-muted-foreground truncate">{lookupHit.brand}</p>}
                  <p className="text-[10px] text-muted-foreground">
                    Fuente: Open Food Facts (ODbL){lookupHit.source === "cache" ? " · caché propia" : ""}
                  </p>
                </div>
                <div className="flex flex-col gap-1 flex-shrink-0">
                  <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={applyLookupData}>
                    Usar datos
                  </Button>
                  {lookupHit.image_url && (
                    <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={applyLookupPhoto}>
                      Usar foto
                    </Button>
                  )}
                </div>
              </div>
            )}
            {remotePhoto && (
              <p className="text-[11px] text-muted-foreground pt-1">
                Foto sugerida lista: se descarga al guardar ✓{" "}
                <button type="button" onClick={() => onRemotePhoto?.(null)} className="underline">
                  quitar
                </button>
              </p>
            )}
            <p className="text-xs text-muted-foreground mt-0.5">
              Para buscar y escanear en mostrador e imprimir etiquetas.
            </p>
          </div>
        )}
        {showPrep && setOffRequiresPrep && (
          <div className="flex items-center justify-between">
            <div>
              <Label>Requiere elaboración</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Si lo apagás (bebidas, packs ya hechos), un pedido de solo estos ítems no entra a cocina ni imprime comanda
              </p>
            </div>
            <Switch
              checked={offRequiresPrep}
              onCheckedChange={setOffRequiresPrep}
            />
          </div>
        )}
        {showStock && setOffStockControl && (
          <div className="flex items-center justify-between">
            <div>
              <Label>Control de stock</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Muestra y controla las unidades disponibles de este producto
              </p>
            </div>
            <Switch
              checked={offStockControl}
              onCheckedChange={setOffStockControl}
            />
          </div>
        )}
        {showStock && offStockControl && setOffStock && setOffStockLowThreshold && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><Label>Stock</Label><QuantityInput value={offStock} onChange={setOffStock} min={0} /></div>
            <div><Label>Umbral bajo stock</Label><Input type="number" min={0} value={offStockLowThreshold} onChange={(e) => { const v = parseInt(e.target.value, 10); if (!isNaN(v) && v >= 0) setOffStockLowThreshold(v); }} /></div>
          </div>
        )}
        <div><Label>Foto</Label><Input type="file" accept="image/*" onChange={(e) => { const f = e.target.files?.[0] || null; if (f) { const src = URL.createObjectURL(f); setOffFile(f); setOffPreview(src); if (onCrop) onCrop("offer", src); } }} />{offPreview && <img src={offPreview} alt="Preview" className="mt-2 h-20 w-full object-cover rounded-lg" />}</div>
        <div><Label>Descripción</Label><Textarea value={offDesc} onChange={(e) => setOffDesc(e.target.value)} /></div>
        <Button type="button" onClick={() => onSubmit()} disabled={saving} className="w-full">{saving ? "Guardando..." : editingId ? "Guardar" : "Agregar"}</Button>
      </div>
      {scanningSku && (
        <div className="fixed inset-0 z-[70] bg-black/80 flex flex-col items-center justify-center gap-3 p-4" onClick={stopSkuScan}>
          <p className="text-white text-sm font-medium">Apuntá al código de barras del producto</p>
          <video ref={scanSkuVideoRef} playsInline muted className="w-full max-w-sm rounded-xl bg-black aspect-[3/4] object-cover" />
          <Button type="button" variant="outline" onClick={stopSkuScan}>
            Cancelar
          </Button>
        </div>
      )}
    </Card>
  );
}

export function OfferList({ offers, onEdit, onToggleFeatured, onToggleAvailable, onDelete, editingId, editForm, onEditModifiers, costByProduct, showBuyCost = false, emptyText = "Todavía no cargaste platos.", onTogglePromoOnly }: {
  offers: Offer[];
  onEdit: (o: Offer) => void;
  onToggleFeatured: (o: Offer) => void;
  onToggleAvailable: (o: Offer) => void;
  onDelete: (o: Offer) => void;
  editingId?: string | null;
  editForm?: ReactNode;
  onEditModifiers?: (o: Offer) => void;
  /** Costo por plato (módulo Preparación y Costo): { [productId]: { cost, pct, status } }. */
  costByProduct?: Record<string, { cost: number | null; pct: number | null; status: "ok" | "warn" | "bad" | "none" }>;
  /** Muestra el costo de compra en la fila (inventario, distinto del food-cost). */
  showBuyCost?: boolean;
  /** Texto del estado vacío de la lista. */
  emptyText?: string;
  /** Solo-promo (no figura en el menú). Opcional: solo gastro lo pasa. */
  onTogglePromoOnly?: (o: Offer) => void;
}) {
  const editAnchorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!editingId || !editForm) return;
    const t = setTimeout(() => {
      editAnchorRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 60);
    return () => clearTimeout(t);
  }, [editingId, editForm]);

  return (
    <div className="space-y-3">
      {offers.length === 0 ? (
        <p className="text-muted-foreground text-sm text-center py-8">{emptyText}</p>
      ) : (
        offers.map((offer) => (
          <div key={offer.id}>
            <Card className="p-3">
              <div className="flex items-center gap-3">
                {offer.image_url ? (
                  <img src={offer.image_url} alt={offer.name} className="h-12 w-12 rounded-lg object-cover flex-shrink-0" />
                ) : (
                  <div className="h-12 w-12 rounded-lg bg-accent flex items-center justify-center flex-shrink-0"><span className="font-bold text-primary/60">{offer.name.charAt(0)}</span></div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium text-sm truncate">{offer.name}</span>
                    {offer.featured_today && <Badge className="bg-sun/20 text-ink text-[10px] px-1.5 py-0">Hoy</Badge>}
                    {!offer.available && <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Pausado</Badge>}
                    {offer.promo_only && <Badge className="bg-violet-100 text-violet-700 text-[10px] px-1.5 py-0">Solo promo</Badge>}
                    {costByProduct?.[offer.id]?.cost !== null && costByProduct?.[offer.id]?.cost !== undefined && (
                      <Badge
                        className={`text-[10px] px-1.5 py-0 tabular-nums ${
                          costByProduct[offer.id].status === "ok"
                            ? "bg-green-100 text-green-700"
                            : costByProduct[offer.id].status === "warn"
                              ? "bg-amber-100 text-amber-700"
                              : costByProduct[offer.id].status === "bad"
                                ? "bg-red-100 text-red-700"
                                : "bg-gray-100 text-gray-500"
                        }`}
                        title={`Costo ${costByProduct[offer.id].cost !== null ? `$${Number(costByProduct[offer.id].cost).toLocaleString("es-AR")}` : "—"}`}
                      >
                        {costByProduct[offer.id].pct !== null && costByProduct[offer.id].pct !== undefined
                          ? `${Number(costByProduct[offer.id].pct).toLocaleString("es-AR")}%`
                          : "Costo"}
                      </Badge>
                    )}
                    {offer.stock !== null && offer.stock <= (offer.stock_low_threshold || 5) && (
                      <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                        {offer.stock === 0 ? "Sin stock" : `Stock: ${offer.stock}`}
                      </Badge>
                    )}
                    {showBuyCost && offer.cost_last != null && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                        Costo: ${Number(offer.cost_last).toLocaleString("es-AR")}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {offer.promo_price ? (
                      <><span className="line-through">${Number(offer.price).toLocaleString("es-AR")}</span> <span className="text-primary font-medium">${Number(offer.promo_price).toLocaleString("es-AR")}</span></>
                    ) : (
                      <>${Number(offer.price).toLocaleString("es-AR")}</>
                    )}
                    {offer.category && ` · ${offer.category}`}
                  </p>
                </div>
                <div className="hidden sm:flex items-center gap-1 flex-shrink-0">
                  <Button variant="outline" size="sm" onClick={() => onEdit(offer)}>Editar</Button>
                  <Button variant="outline" size="sm" onClick={() => onToggleFeatured(offer)}>{offer.featured_today ? "Quitar" : "Destacar"}</Button>
                  {onTogglePromoOnly && (
                    <Button variant="outline" size="sm" onClick={() => onTogglePromoOnly(offer)}>{offer.promo_only ? "A menú" : "Solo promo"}</Button>
                  )}
                  <Button variant="outline" size="sm" onClick={() => onToggleAvailable(offer)}>{offer.available ? "Pausar" : "Activar"}</Button>
                  <Button variant="ghost" size="sm" className="text-red-600" onClick={() => onDelete(offer)}>Eliminar</Button>
                </div>
                <div className="sm:hidden flex-shrink-0">
                  <DropdownMenu
                    trigger={<span className="text-xl">⋯</span>}
                    items={[
                      { label: "Editar", icon: "✏️", onClick: () => onEdit(offer) },
                      { label: "Modificadores", icon: "⚙️", onClick: () => onEditModifiers ? onEditModifiers(offer) : onEdit(offer) },
                      { label: offer.featured_today ? "Quitar de Hoy" : "Destacar Hoy", icon: "⭐", onClick: () => onToggleFeatured(offer) },
                      ...(onTogglePromoOnly ? [{ label: offer.promo_only ? "Volver al menú" : "Solo promo", icon: "🏷️", onClick: () => onTogglePromoOnly(offer) }] : []),
                      { label: offer.available ? "Pausar" : "Activar", icon: offer.available ? "⏸️" : "▶️", onClick: () => onToggleAvailable(offer) },
                      { label: "Eliminar", icon: "🗑️", onClick: () => onDelete(offer), destructive: true },
                    ]}
                  />
                </div>
              </div>
            </Card>
            {editingId === offer.id && editForm && (
              <div ref={editAnchorRef} className="mt-2">
                {editForm}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}

export function CategoryManager({ categories, onAdd, onRename, onDelete, onMove, defaultOpen }: {
  categories: MenuCategory[];
  onAdd: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (cat: MenuCategory) => void;
  onMove: (cat: MenuCategory, dir: -1 | 1) => void;
  /** Abierto por defecto (ej. cuando se renderiza como solapa dedicada). */
  defaultOpen?: boolean;
}) {
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  const addCategory = () => {
    if (newName.trim()) {
      onAdd(newName.trim());
      setNewName("");
    }
  };

  return (
    <CollapsibleSection icon="📂" title={`Categorías (${categories.length})`} defaultOpen={defaultOpen}>
      <div className="flex gap-2 mb-3">
        <Input
          placeholder="Nueva categoría"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCategory(); } }}
        />
        <Button type="button" size="sm" disabled={!newName.trim()} onClick={addCategory}>+</Button>
      </div>
      {categories.length === 0 ? (
        <p className="text-sm text-muted-foreground">Creá categorías para organizar tu menú.</p>
      ) : (
        <ul className="space-y-2">
          {categories.map((cat, i) => (
            <li key={cat.id} className="flex items-center gap-2 border border-border rounded-lg px-3 py-2">
              {editingId === cat.id ? (
                <>
                  <Input className="h-8 flex-1" value={editingName} onChange={(e) => setEditingName(e.target.value)} autoFocus />
                  <Button type="button" size="sm" variant="outline" onClick={() => { onRename(cat.id, editingName); setEditingId(null); }}>OK</Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setEditingId(null)}>✕</Button>
                </>
              ) : (
                <>
                  <span className="font-medium flex-1 min-w-0 truncate">{cat.name}</span>
                  <Button type="button" size="sm" variant="ghost" disabled={i === 0} onClick={() => onMove(cat, -1)}>↑</Button>
                  <Button type="button" size="sm" variant="ghost" disabled={i === categories.length - 1} onClick={() => onMove(cat, 1)}>↓</Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => { setEditingId(cat.id); setEditingName(cat.name); }}>✏️</Button>
                  <Button type="button" size="sm" variant="ghost" className="text-red-600" onClick={() => onDelete(cat)}>🗑️</Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </CollapsibleSection>
  );
}

export function LivePreview({ storeName, storePreview, vendor, logoPreview, description, hours, address, paymentMethods, whatsapp, isService }: {
  storeName: string;
  storePreview: string | null;
  vendor: any;
  logoPreview: string | null;
  description: string;
  hours: string;
  address: string;
  paymentMethods: string[];
  whatsapp: string;
  isService: boolean;
}) {
  return (
    <div className="rounded-2xl overflow-hidden border border-border bg-card">
      {storePreview || vendor?.image_url ? (
        <div className="h-28 w-full"><img src={storePreview || vendor?.image_url || ""} alt="" className="w-full h-full object-cover" /></div>
      ) : (
        <div className="h-28 w-full bg-gradient-to-br from-secondary to-accent flex items-center justify-center"><span className="font-display text-4xl font-bold text-primary/30">{(storeName || vendor?.store_name || "?").charAt(0)}</span></div>
      )}
      <div className="p-4">
        <div className="flex items-center gap-3 mb-2">
          {logoPreview || vendor?.logo_url ? (
            <img src={logoPreview || vendor?.logo_url || ""} alt="" className="h-10 w-10 rounded-full object-cover border-2 border-white shadow -mt-8 relative" />
          ) : (
            <div className="h-10 w-10 rounded-full bg-accent flex items-center justify-center border-2 border-white shadow -mt-8 relative"><span className="font-bold text-primary text-sm">{(storeName || vendor?.store_name || "?").charAt(0)}</span></div>
          )}
          <div className="min-w-0">
            <p className="font-semibold text-sm truncate">{storeName || vendor?.store_name}</p>
            <p className="text-[10px] text-muted-foreground">Vista previa de tu micrositio</p>
          </div>
        </div>
        {description && <p className="text-xs text-muted-foreground line-clamp-2 mb-2 break-words">{description}</p>}
        <div className="flex flex-wrap gap-1.5 text-[10px] min-w-0">
          {hours && <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground max-w-full break-words">🕐 {hours}</span>}
          {address && <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground max-w-full break-words">📍 {address}</span>}
          {paymentMethods.length > 0 && <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground max-w-full break-words">💳 {paymentMethods.join(", ")}</span>}
        </div>
        {whatsapp && (
          <div className="mt-3 inline-flex items-center gap-1 rounded-md bg-whatsapp/10 text-whatsapp px-3 py-1.5 text-xs font-medium">
            📱 WhatsApp {isService ? "de consulta" : "de pedidos"}
          </div>
        )}
      </div>
    </div>
  );
}

export function TransferConfig({
  vendor,
  saveVendor,
}: {
  vendor: any;
  saveVendor: (data: Record<string, unknown>) => Promise<void>;
}) {
  const [alias, setAlias] = useState<string>(vendor?.transfer_alias || "");
  const [cbu, setCbu] = useState<string>(vendor?.transfer_cbu || "");
  const [holder, setHolder] = useState<string>(vendor?.transfer_holder || "");
  const [block, setBlock] = useState<boolean>(!!vendor?.block_unpaid_orders);

  return (
    <div className="space-y-3 rounded-xl border border-border p-3">
      <div>
        <Label>Alias (CBU)</Label>
        <p className="text-xs text-muted-foreground mt-0.5">
          Lo ves en tu home banking. Ej: super.mi.barrio
        </p>
        <Input
          className="mt-1"
          value={alias}
          onChange={(e) => setAlias(e.target.value)}
          onBlur={() => saveVendor({ transfer_alias: alias || null })}
        />
      </div>
      <div>
        <Label>CBU</Label>
        <Input
          className="mt-1"
          value={cbu}
          onChange={(e) => setCbu(e.target.value)}
          onBlur={() => saveVendor({ transfer_cbu: cbu || null })}
          placeholder="0000000000000000000000"
        />
      </div>
      <div>
        <Label>Titular de la cuenta</Label>
        <p className="text-xs text-muted-foreground mt-0.5">
          Nombre y apellido o razón social a nombre del cual se hace la transferencia
        </p>
        <Input
          className="mt-1"
          value={holder}
          onChange={(e) => setHolder(e.target.value)}
          onBlur={() => saveVendor({ transfer_holder: holder || null })}
        />
      </div>
      <div className="flex items-center justify-between pt-1 border-t border-border">
        <div>
          <Label>Bloquear hasta confirmar pago</Label>
          <p className="text-xs text-muted-foreground mt-0.5">
            No deja avanzar (aceptar/preparar) un pedido pendiente hasta marcar el pago como recibido
          </p>
        </div>
        <Switch
          checked={block}
          onCheckedChange={(v) => {
            setBlock(v);
            saveVendor({ block_unpaid_orders: v });
          }}
        />
      </div>
    </div>
  );
}

type DeliveryZoneRow = {
  id: string;
  name: string;
  description: string | null;
  fee: number | string;
  position: number;
  active: boolean;
};

export function DeliveryFeeConfig({
  vendor,
  saveVendor,
}: {
  vendor: any;
  saveVendor: (data: Record<string, unknown>) => Promise<void>;
}) {
  const [mode, setMode] = useState<string>(vendor?.delivery_mode === "zones" ? "zones" : "flat");
  const [fee, setFee] = useState<string>(vendor?.delivery_fee != null ? String(vendor.delivery_fee) : "");
  const [freeMin, setFreeMin] = useState<string>(vendor?.free_delivery_min != null ? String(vendor.free_delivery_min) : "");
  const [areaText, setAreaText] = useState<string>(vendor?.delivery_area_text || "");
  const [zones, setZones] = useState<DeliveryZoneRow[]>([]);
  const [zonesReady, setZonesReady] = useState<boolean | null>(null);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newFee, setNewFee] = useState("");
  const [zoneMsg, setZoneMsg] = useState("");
  const [savingZone, setSavingZone] = useState(false);

  // El guardado upstream reemplaza `vendor`: sincronizar estado local.
  useEffect(() => {
    setMode(vendor?.delivery_mode === "zones" ? "zones" : "flat");
    setFee(vendor?.delivery_fee != null ? String(vendor.delivery_fee) : "");
    setFreeMin(vendor?.free_delivery_min != null ? String(vendor.free_delivery_min) : "");
    setAreaText(vendor?.delivery_area_text || "");
  }, [vendor?.delivery_mode, vendor?.delivery_fee, vendor?.free_delivery_min, vendor?.delivery_area_text]);

  const loadZones = useCallback(async () => {
    try {
      const res = await fetch("/api/vendor/delivery-zones");
      if (res.status === 503) {
        setZonesReady(false);
        return;
      }
      const data = await res.json().catch(() => ({}));
      setZones(Array.isArray(data?.zones) ? data.zones : []);
      setZonesReady(true);
    } catch {
      setZonesReady(false);
    }
  }, []);

  useEffect(() => {
    if (mode === "zones" && zonesReady === null) loadZones();
  }, [mode, zonesReady, loadZones]);

  function switchMode(m: string) {
    setMode(m);
    saveVendor({ delivery_mode: m });
    if (m === "zones" && zonesReady === null) loadZones();
  }

  async function addZone() {
    const name = newName.trim();
    if (!name) {
      setZoneMsg("Poné un nombre a la zona (ej: Garibaldi)");
      return;
    }
    const nfee = Number(newFee);
    if (!Number.isFinite(nfee) || nfee < 0) {
      setZoneMsg("Precio de envío inválido");
      return;
    }
    setSavingZone(true);
    setZoneMsg("");
    try {
      const res = await fetch("/api/vendor/delivery-zones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description: newDesc.trim() || null, fee: nfee }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setZoneMsg(data?.error || "No se pudo crear la zona");
      } else {
        setNewName("");
        setNewDesc("");
        setNewFee("");
        await loadZones();
      }
    } catch {
      setZoneMsg("Error de red");
    } finally {
      setSavingZone(false);
    }
  }

  async function patchZone(id: string, data: Record<string, unknown>) {
    setZoneMsg("");
    try {
      const res = await fetch(`/api/vendor/delivery-zones/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) setZoneMsg(j?.error || "No se pudo actualizar");
      else await loadZones();
    } catch {
      setZoneMsg("Error de red");
    }
  }

  async function deleteZone(id: string, name: string) {
    if (!window.confirm(`¿Eliminar la zona "${name}"? Los pedidos viejos conservan su nombre.`)) return;
    try {
      await fetch(`/api/vendor/delivery-zones/${id}`, { method: "DELETE" });
      await loadZones();
    } catch {
      setZoneMsg("Error de red");
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-border p-3">
      <div>
        <Label>¿Cómo cobrás el envío?</Label>
        <div className="grid grid-cols-2 gap-1.5 mt-1">
          <button
            type="button"
            onClick={() => switchMode("flat")}
            className={`rounded-lg py-1.5 px-2 text-xs font-medium border transition-colors ${
              mode !== "zones" ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground"
            }`}
          >
            💲 Tarifa única
          </button>
          <button
            type="button"
            onClick={() => switchMode("zones")}
            className={`rounded-lg py-1.5 px-2 text-xs font-medium border transition-colors ${
              mode === "zones" ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground"
            }`}
          >
            🗺️ Por zona (máx 3)
          </button>
        </div>
      </div>

      <div>
        <Label>Tu área de reparto habitual</Label>
        <Input
          className="mt-1"
          type="text"
          placeholder='Ej: Sicardi y Garibaldi, hasta la calle 22'
          value={areaText}
          onChange={(e) => setAreaText(e.target.value)}
          onBlur={() => saveVendor({ delivery_area_text: areaText.trim() || null })}
          maxLength={120}
        />
        <p className="text-xs text-muted-foreground mt-1">
          En lenguaje del barrio: el cliente la lee para saber si está dentro o fuera.
          Si la dejás vacía, no se le pregunta y siempre se cobra la tarifa única.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <Label>{mode === "zones" ? "Envío fuera de zona / provisorio ($)" : "Costo de envío ($)"}</Label>
          <Input
            className="mt-1"
            type="number"
            inputMode="decimal"
            min="0"
            placeholder="0"
            value={fee}
            onChange={(e) => setFee(e.target.value)}
            onBlur={() => saveVendor({ delivery_fee: fee === "" ? null : Number(fee) })}
          />
          {mode === "zones" && (
            <p className="text-xs text-muted-foreground mt-1">
              Se usa como provisorio cuando piden fuera de tus zonas (a convenir por WhatsApp).
            </p>
          )}
        </div>
        <div>
          <Label>Envío gratis desde ($)</Label>
          <Input
            className="mt-1"
            type="number"
            inputMode="decimal"
            min="0"
            placeholder="—"
            value={freeMin}
            onChange={(e) => setFreeMin(e.target.value)}
            onBlur={() => saveVendor({ free_delivery_min: freeMin === "" ? null : Number(freeMin) })}
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Si el pedido a domicilio supera el monto de &quot;Envío gratis desde&quot;, no se cobra el costo de envío (salvo fuera de zona).
      </p>

      {mode === "zones" && (
        <div className="rounded-lg border border-border p-2.5 space-y-2 bg-muted/30">
          {zonesReady === false ? (
            <p className="text-xs text-amber-700">
              ⚠️ Falta aplicar la migración de zonas de envío en la base de datos (avisale al admin).
            </p>
          ) : (
            <>
              {zones.map((z) => (
                <div key={z.id} className="flex items-center gap-2 rounded-lg border border-border bg-background px-2 py-1.5">
                  <Switch
                    checked={z.active !== false}
                    onCheckedChange={(v) => patchZone(z.id, { active: v })}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold truncate">{z.name}</p>
                    {z.description && <p className="text-[11px] text-muted-foreground truncate">{z.description}</p>}
                  </div>
                  <div className="flex items-center gap-1 text-xs font-bold tabular-nums">
                    $<Input
                      className="h-7 w-20 text-xs text-right"
                      type="number"
                      inputMode="decimal"
                      min="0"
                      defaultValue={String(z.fee ?? 0)}
                      key={`${z.id}-${z.fee}`}
                      onBlur={(e) => {
                        const v = Number(e.target.value);
                        if (Number.isFinite(v) && v >= 0 && v !== Number(z.fee)) patchZone(z.id, { fee: v });
                      }}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => deleteZone(z.id, z.name)}
                    className="text-muted-foreground hover:text-red-600 text-sm px-1"
                    title="Eliminar zona"
                  >
                    🗑️
                  </button>
                </div>
              ))}
              {zones.length < 3 ? (
                <div className="space-y-1.5 pt-1">
                  <div className="grid grid-cols-2 gap-1.5">
                    <Input
                      className="h-8 text-xs"
                      placeholder="Nombre (ej: Garibaldi)"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      maxLength={60}
                    />
                    <Input
                      className="h-8 text-xs"
                      type="number"
                      inputMode="decimal"
                      min="0"
                      placeholder="Precio $"
                      value={newFee}
                      onChange={(e) => setNewFee(e.target.value)}
                    />
                  </div>
                  <Input
                    className="h-8 text-xs"
                    placeholder="Descripción (ej: todo Garibaldi) — opcional"
                    value={newDesc}
                    onChange={(e) => setNewDesc(e.target.value)}
                    maxLength={80}
                  />
                  <Button type="button" size="sm" className="w-full" disabled={savingZone} onClick={addZone}>
                    {savingZone ? "Guardando…" : `＋ Agregar zona (${zones.length}/3)`}
                  </Button>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Llegaste al máximo de 3 zonas.</p>
              )}
              {zoneMsg && <p className="text-xs text-red-600">{zoneMsg}</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Horarios de reparto retail (moda + comercio). El cliente ve en el
 * micrositio cuándo le llega el pedido y elige entre los próximos 3 turnos.
 * - Switch "mismo horario del local" (default): delivery_hours = NULL.
 * - Horario propio: HoursEditor reutilizado + botón Guardar explícito (el
 *   editor emite onChange por cada clic: no se autosalva para no spamear PATCH).
 * - Tiempo de preparación y reparto (min, default 60): chips + input con
 *   guardado al salir (mismo patrón que DeliveryFeeConfig).
 * Fuera de horario no se bloquea: el pedido entra con el próximo turno
 * (el checkout lo avisa con cartel amable + alternativa de retiro).
 */
export function DeliveryScheduleConfig({
  vendor,
  saveVendor,
}: {
  vendor: any;
  saveVendor: (data: Record<string, unknown>) => Promise<void>;
}) {
  const [useStoreHours, setUseStoreHours] = useState<boolean>(
    usesStoreHoursOf({ delivery_hours: vendor?.delivery_hours ?? null })
  );
  const [hours, setHours] = useState<string>(
    vendor?.delivery_hours || vendor?.hours || ""
  );
  const [prep, setPrep] = useState<string>(
    vendor?.delivery_prep_min != null ? String(vendor.delivery_prep_min) : "60"
  );
  const [savingHours, setSavingHours] = useState(false);
  const [hoursMsg, setHoursMsg] = useState("");

  // El guardado upstream reemplaza `vendor`: sincronizar estado local.
  useEffect(() => {
    setUseStoreHours(usesStoreHoursOf({ delivery_hours: vendor?.delivery_hours ?? null }));
    setHours(vendor?.delivery_hours || vendor?.hours || "");
    setPrep(vendor?.delivery_prep_min != null ? String(vendor.delivery_prep_min) : "60");
  }, [vendor?.delivery_hours, vendor?.hours, vendor?.delivery_prep_min]);

  const sched = {
    hours: vendor?.hours ?? null,
    delivery_hours: useStoreHours ? null : hours || null,
    open_override: vendor?.open_override ?? null,
    delivery_override: vendor?.delivery_override ?? null,
    delivery_paused_until: vendor?.delivery_paused_until ?? null,
    delivery_pause_reason: vendor?.delivery_pause_reason ?? null,
    delivery_extra_days: vendor?.delivery_extra_days ?? null,
  };
  let previewOpen: boolean | null = null;
  let previewSlots: { id: string; label: string }[] = [];
  try {
    previewOpen = isDeliveryOpen(sched);
    previewSlots = nextDeliverySlots(sched, { count: 3 });
  } catch {
    previewOpen = null;
    previewSlots = [];
  }

  async function toggleStoreHours(v: boolean) {
    setUseStoreHours(v);
    setHoursMsg("");
    if (v) {
      setHours(vendor?.hours || "");
      await saveVendor({ delivery_hours: null });
    } else {
      setHours(vendor?.delivery_hours || vendor?.hours || "");
    }
  }

  async function saveHours() {
    setSavingHours(true);
    setHoursMsg("");
    try {
      const t = hours.trim();
      await saveVendor({ delivery_hours: t || null });
      if (!t) setUseStoreHours(true);
      setHoursMsg("Horario de reparto guardado");
    } catch {
      setHoursMsg("No se pudo guardar");
    } finally {
      setSavingHours(false);
    }
  }

  function savePrep() {
    const n = prep === "" ? 60 : Number(prep);
    if (!Number.isFinite(n) || n < 0 || n > 240) return;
    saveVendor({ delivery_prep_min: Math.round(n) });
  }

  return (
    <div className="space-y-3 rounded-xl border border-border p-3">
      <div>
        <Label>🛵 Horarios de reparto</Label>
        <p className="text-xs text-muted-foreground mt-0.5">
          El cliente ve cuándo le llega el pedido y elige entre los próximos 3 turnos.
          Fuera de horario el pedido entra igual, para el próximo turno.
        </p>
      </div>

      <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
        <div>
          <Label className="text-sm">Mismo horario del local</Label>
          <p className="text-xs text-muted-foreground">
            {useStoreHours ? "El reparto sigue tu horario de atención." : "El reparto tiene horario propio."}
          </p>
        </div>
        <Switch checked={useStoreHours} onCheckedChange={toggleStoreHours} />
      </div>

      {!useStoreHours && (
        <div className="space-y-2">
          <HoursEditor value={hours} onChange={setHours} />
          <Button type="button" size="sm" className="w-full" disabled={savingHours} onClick={saveHours}>
            {savingHours ? "Guardando…" : "Guardar horario de reparto"}
          </Button>
          {hoursMsg && <p className="text-xs text-muted-foreground">{hoursMsg}</p>}
        </div>
      )}

      <div>
        <Label>Tiempo de preparación y reparto (min)</Label>
        <div className="flex flex-wrap gap-1.5 mt-1">
          {[30, 60, 90, 120].map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setPrep(String(m));
                saveVendor({ delivery_prep_min: m });
              }}
              className={`rounded-lg py-1.5 px-2.5 text-xs font-medium border transition-colors ${
                Number(prep) === m
                  ? "border-primary bg-primary/5 text-primary"
                  : "border-border text-muted-foreground"
              }`}
            >
              {m} min
            </button>
          ))}
          <Input
            className="h-8 w-20 text-xs"
            type="number"
            inputMode="numeric"
            min="0"
            max="240"
            value={prep}
            onChange={(e) => setPrep(e.target.value)}
            onBlur={savePrep}
            aria-label="Minutos de preparación y reparto"
          />
        </div>
      </div>

      <div className="rounded-lg bg-muted/50 px-3 py-2">
        {isDeliveryPaused(sched) ? (
          <p className="text-xs text-muted-foreground">
            ⏸️ Reparto en pausa — los pedidos siguen entrando para el próximo turno.
            {previewSlots.length > 0 && (
              <> Próximos: <span className="font-medium text-foreground">{previewSlots.map((s) => s.label).join(" · ")}</span></>
            )}
          </p>
        ) : previewSlots.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            {previewOpen === false ? "😴 Reparto cerrado ahora · " : "🛵 "}
            Próximos turnos: <span className="font-medium text-foreground">{previewSlots.map((s) => s.label).join(" · ")}</span>
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Sin turnos configurados: cargá tu horario de atención o uno propio para mostrar cuándo llega cada pedido.
          </p>
        )}
      </div>
    </div>
  );
}
