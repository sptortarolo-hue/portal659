"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ModifierPicker } from "@/components/offers/modifier-picker";
import { ProductPickCard } from "@/components/vendor/product-pick-card";
import { cashDiscountForItems, normalizeCashPct } from "@/lib/cash-discount";
import { normalizeDeliveryMode, resolveDeliveryFee, type DeliverySelection } from "@/lib/delivery";
import { toE164 } from "@/lib/phone";
import { getCatalogSnapshot, saveCatalogSnapshot } from "@/lib/offline-db";
import { enqueueOfflineAction, isNetworkError, newClientKey, nextProvisionalNumber } from "@/lib/offline-actions";
import { checkOfflineAllowed, offlineDeniedMsg } from "@/lib/offline-plan";
import { dispatchOfflinePrint, markPrintsDone } from "@/lib/local-print";
import { printsAdd } from "@/lib/offline-db";
import { saveDraft, loadDraft, clearDraft } from "@/lib/draft";
import type { ContingencyKind } from "@/lib/offline-print";
import { useCashShift } from "@/lib/use-cash-shift";

const OFFLINE_PAYMENT_LABELS: Record<string, string> = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  tarjeta: "Tarjeta",
  mixto: "Mixto",
};
import { SYNC_COMPLETED_EVENT } from "@/lib/sync-engine";

type ModifierOption = { label: string; price_mod: number };
type ProductModifier = {
  id: string;
  product_id: string;
  group_name: string;
  options: ModifierOption[];
  required: boolean;
  max_selections: number;
  position: number;
  created_at: string;
};
type CartModifier = { group: string; label: string; price_mod: number };

type Product = {
  id: string;
  name: string;
  price: number;
  promo_price: number | null;
  available: boolean;
  image_url?: string | null;
  category?: string | null;
  requires_prep?: boolean;
  cash_discount_excluded?: boolean | null;
  /** Venta en packs (ej: 6). El precio es del paquete; la unidad se deriva. */
  pack_size?: number | null;
  /** Moda: el producto se vende por variante (color × talle). */
  has_variants?: boolean;
  modifiers?: ProductModifier[];
  /** Unidad de venta: "kg" = precio por kilo (balanza en mostrador). */
  unit?: string | null;
  /** Código de barras / SKU (búsqueda y escaneo). */
  sku?: string | null;
};

/** Variante de producto (moda): precio y promo propios, stock por combinación. */
type ProductVariant = {
  id: string;
  product_id: string;
  color: string;
  talle: string;
  price: number;
  promo: number | null;
  stock: number;
};

/** Tamaño del pack (1 = venta por unidad). */
function packOf(p: Product): number {
  return Number.isInteger(Number(p.pack_size)) && Number(p.pack_size) >= 2 ? Math.floor(Number(p.pack_size)) : 1;
}
/** Precio por unidad a FULL PRECISION (nunca sumar unidades redondeadas:
 *  11500/6 = 1916.66… → ×6 = 11500 exacto tras redondear el total). */
function unitPriceOf(p: Product): number {
  const base = Number(p.promo_price ?? p.price);
  const pk = packOf(p);
  return pk > 1 ? base / pk : base;
}
/** Precio del paquete completo (con promo si aplica). */
function packPriceOf(p: Product): number {
  return Number(p.promo_price ?? p.price);
}

type LineItem = {
  product_id: string;
  /** Variante elegida (moda). El nombre ya lleva " (Color · Talle)" para que
    Kanban, detalle, ticket y WhatsApp la muestren sin resolver nada. */
  variant_id?: string;
  name: string;
  price: number;
  qty: number;
  requires_prep: boolean;
  modifiers?: CartModifier[];
  /** Promo vigente + exclusión: reglas del descuento en efectivo. */
  hasPromo: boolean;
  cashExcluded: boolean;
  /** Pack (stepper de a N). */
  packSize?: number;
  /** Unidad de venta ("kg" = fraccionado por peso, sin stock). */
  unit?: string;
  /** Línea manual de mostrador ("Varios"): sin producto ni stock. */
  manual?: boolean;
};

/** Key de línea: producto + variante + modificadores (dos talles del mismo
  producto son líneas distintas). */
function lineKey(productId: string, variantId: string | undefined, modifiers?: CartModifier[]): string {
  return `${productId}|${variantId || ""}|${(modifiers || []).map((m) => m.label).sort().join(",")}`;
}

type MostradorOrder = {
  id: string;
  total: number;
  payment_method: string;
  paid_at: string | null;
  status: string;
  created_at: string;
  customer_name?: string;
  pickup_number?: number | null;
  method?: string;
  /** Venta offline pendiente de sincronizar (UI optimista, F2). */
  pending?: boolean;
  /** El total es estimado (el servidor recalcula al sincronizar). */
  estimated?: boolean;
  /** Número provisorio del día (P-N): se reemplaza por el Nro. real. */
  provisional?: number | null;
  localId?: string;
};

const PAYMENT_OPTIONS = [
  { key: "efectivo", label: "💵 Efectivo" },
  { key: "transferencia", label: "🏦 Transferencia" },
  { key: "tarjeta", label: "💳 Tarjeta" },
  { key: "mixto", label: "🪙 Mixto" },
  { key: "fiado", label: "📓 Fiado" },
];

export function Mostrador({ vendorId }: { vendorId?: string | null }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [items, setItems] = useState<LineItem[]>([]);
  const [payment, setPayment] = useState("efectivo");
  const [customerName, setCustomerName] = useState("");
  const [method, setMethod] = useState<"pickup" | "delivery" | "direct">("pickup");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // Switch "exigir caja abierta": sin turno no se cobra (el servidor lo
  // valida igual: 409). Banner + botones deshabilitados.
  const { shift: cashShift, requireOpenShift, loading: cashShiftLoading } = useCashShift(true);
  const shiftBlocked = requireOpenShift && !cashShiftLoading && !cashShift;
  const [msg, setMsg] = useState("");
  // El mensaje vive dentro del sheet mobile: al cambiar, se scrollea a la
  // vista (antes los errores quedaban tapados detrás y parecía que no pasaba nada).
  const msgRef = useRef<HTMLParagraphElement | null>(null);
  useEffect(() => {
    if (msg) msgRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [msg]);
  const msgIsErr = /^(No se pudo|Sin |Error|Hay |Ingresá|El envío|Completá)/.test(msg) || msg.includes("⚠️");
  const [recent, setRecent] = useState<MostradorOrder[]>([]);
  const [query, setQuery] = useState("");
  const [activeCat, setActiveCat] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [modifiersMap, setModifiersMap] = useState<Record<string, ProductModifier[]>>({});
  const [pickerProduct, setPickerProduct] = useState<Product | null>(null);
  // Variante pendiente cuando el producto tiene variantes Y modificadores
  // (primero se elige variante, después abre el picker de modificadores).
  const [pendingVariant, setPendingVariant] = useState<ProductVariant | null>(null);
  // Producto con variantes tocado: hay que elegir color × talle.
  const [variantPicker, setVariantPicker] = useState<Product | null>(null);
  const [variantsMap, setVariantsMap] = useState<Record<string, ProductVariant[]>>({});
  const [convertOrderId, setConvertOrderId] = useState<string | null>(null);
  const [convertPhone, setConvertPhone] = useState("");
  const [convertAddress, setConvertAddress] = useState("");
  const [convertReferences, setConvertReferences] = useState("");
  const [convertZoneId, setConvertZoneId] = useState("");
  const [convertOutOfArea, setConvertOutOfArea] = useState(false);
  const [convertManualFee, setConvertManualFee] = useState("");
  const [converting, setConverting] = useState(false);
  // Envío por zona del comercio (venta directa a domicilio).
  const [deliveryMode, setDeliveryMode] = useState<"flat" | "zones">("flat");
  const [deliveryBaseFee, setDeliveryBaseFee] = useState<number | null>(null);
  const [deliveryFreeMin, setDeliveryFreeMin] = useState<number | null>(null);
  const [deliveryAreaText, setDeliveryAreaText] = useState<string | null>(null);
  const [deliveryZones, setDeliveryZones] = useState<{ id: string; name: string; description: string | null; fee: number }[]>([]);
  const [posZoneId, setPosZoneId] = useState("");
  const [posOutOfArea, setPosOutOfArea] = useState(false);
  const [posManualFee, setPosManualFee] = useState("");
  const [posReferences, setPosReferences] = useState("");
  const [notes, setNotes] = useState("");
  // Bloque cliente colapsado: default = consumidor final. Se despliega para
  // cargar datos; al elegir delivery se abre solo (ahí el teléfono es requerido).
  const [clientOpen, setClientOpen] = useState(false);
  // % descuento en efectivo del comercio (0 = sin descuento).
  const [cashPct, setCashPct] = useState(0);
  // Retail (comercio/moda): textos sin referencias a cocina/comida.
  const [isRetail, setIsRetail] = useState(false);
  // Fiscal ARCA (plan Gestión + config completa): toggle por venta.
  const [fiscalReady, setFiscalReady] = useState(false);
  const [withFiscal, setWithFiscal] = useState(false);
// Receptor fiscal: consumidor final por default; con documento sale a nombre.
const [fiscalReceptorTipo, setFiscalReceptorTipo] = useState<"cf" | "dni" | "cuit">("cf");
const [fiscalReceptorNro, setFiscalReceptorNro] = useState("");
const [fiscalReceptorNombre, setFiscalReceptorNombre] = useState("");
const [fiscalReceptorCond, setFiscalReceptorCond] = useState("6");  // Pedido con CAE listo para reimprimir con bloque fiscal (el ticket que
  // salió al cobrar no lo trae porque el CAE llega después, en fondo).
  const [fiscalPrintId, setFiscalPrintId] = useState<string | null>(null);
  const [fiscalPrinting, setFiscalPrinting] = useState(false);

  useEffect(() => {
    fetch("/api/vendor/fiscal/config")
      .then((r) => r.json())
      .then((d) => setFiscalReady(d?.ready === true))
      .catch(() => {});
  }, []);

  const total = useMemo(() => items.reduce((s, i) => s + i.price * i.qty, 0), [items]);

  // Descuento en efectivo EN VIVO (misma fórmula que el servidor y el
  // micrositio): cambia al tocar medio de pago o al armar el pedido.
  // Con pack, la base es pack-price × N° de packs (sin drift de decimales).
  const cashResult = useMemo(
    () =>
      cashDiscountForItems(
        items.map((i) => {
          const pk = i.packSize && i.packSize >= 2 ? i.packSize : 1;
          return {
            unitPrice: pk > 1 ? i.price * pk : i.price,
            qty: pk > 1 ? i.qty / pk : i.qty,
            hasPromo: i.hasPromo,
            excluded: i.cashExcluded,
          };
        }),
        cashPct
      ),
    [items, cashPct]
  );
  const activeCashDiscount = payment === "efectivo" ? cashResult.cashDiscount : 0;
  // Envío por zona EN VIVO (espejo visual; el servidor recalcula al cobrar).
  // En mostrador el comerciante es autoridad: fuera de zona admite monto manual.
  const posZonesMode = deliveryMode === "zones" && deliveryZones.length > 0;
  const posZoneOut = posZoneId === "__OUT__";
  const posActiveZoneId = posZoneOut ? "" : posZoneId || deliveryZones[0]?.id || "";
  const posSelection: DeliverySelection =
    method !== "delivery"
      ? { kind: "pickup" }
      : posZonesMode
        ? posActiveZoneId
          ? { kind: "zone", zoneId: posActiveZoneId }
          : { kind: "out_of_area", manualFee: Number(posManualFee) || null }
        : posOutOfArea
          ? { kind: "out_of_area", manualFee: Number(posManualFee) || null }
          : { kind: "in_area" };
  const posResolvedDelivery = resolveDeliveryFee({
    mode: deliveryMode,
    baseFee: deliveryBaseFee,
    freeMin: deliveryFreeMin,
    zones: deliveryZones,
    selection: posSelection,
    netSubtotal: total,
    allowManual: true,
  });
  const posDeliveryFee = method === "delivery" ? posResolvedDelivery.fee : 0;
  const posOutOfAreaFlag = method === "delivery" && posResolvedDelivery.outOfArea;
  const payableTotal = Math.max(0, Math.round((total - activeCashDiscount + posDeliveryFee) * 100) / 100);

  // Chips de categoría agrupados por clave normalizada (trim+lowercase):
  // "Pizzas", "pizzas" o " Pizzas" forman un solo chip (igual que el micrositio).
  const normCat = (s: string | null | undefined) => (s || "").trim().toLowerCase();

  const categories = useMemo(() => {
    const map = new Map<string, string>();
    products.forEach((p) => {
      if (p.category && p.category.trim()) {
        const key = normCat(p.category);
        if (!map.has(key)) map.set(key, p.category.trim());
      }
    });
    return Array.from(map.entries())
      .sort((a, b) => a[1].localeCompare(b[1], "es"))
      .map(([key, label]) => ({ key, label }));
  }, [products]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Snapshot local primero (stale-while-revalidate, Track Ventas F1):
      // pinta el catálogo de inmediato y permite operar si no hay red; la
      // red refresca después y reescribe el snapshot.
      if (vendorId) {
        try {
          const snap = await getCatalogSnapshot(vendorId);
          if (snap && !cancelled) {
            setCashPct(snap.cashPct);
            setIsRetail(snap.vertical === "comercio" || snap.vertical === "moda");
            setModifiersMap((snap.modifiersByProduct || {}) as any);
            if (snap.variantsMap) setVariantsMap(snap.variantsMap as any);
            setProducts(((snap.products || []) as any[]).filter((o: any) => o.available !== false));
          }
        } catch { /* sin snapshot: espera a la red */ }
      }
      try {
        const [offRes, ordRes, meRes, varRes] = await Promise.all([
          fetch("/api/vendor/offers"),
          fetch("/api/vendor/orders"),
          fetch("/api/vendor/me"),
          fetch("/api/vendor/variants").catch(() => null),
        ]);
        const off = await offRes.json();
        const ord = await ordRes.json();
        const me = await meRes.json().catch(() => null);
        const vdata = varRes ? await varRes.json().catch(() => null) : null;
        if (cancelled) return;
        const pct = normalizeCashPct(me?.vendor?.cash_discount_pct);
        const vertical = (me?.vendor?.vertical as string | undefined) ?? null;
        setCashPct(pct);
        setIsRetail(vertical === "comercio" || vertical === "moda");
        // Retail: la venta directa es el caso común (retiro con pedido queda opcional).
        if (vertical === "comercio" || vertical === "moda") {
          setMethod((m) => (m === "pickup" ? "direct" : m));
        }
        // Config de envío por zona (espejo visual; el servidor resuelve).
        setDeliveryMode(normalizeDeliveryMode((me?.vendor as any)?.delivery_mode));
        setDeliveryBaseFee((me?.vendor as any)?.delivery_fee != null ? Number((me?.vendor as any).delivery_fee) : null);
        setDeliveryFreeMin((me?.vendor as any)?.free_delivery_min != null ? Number((me?.vendor as any).free_delivery_min) : null);
        setDeliveryAreaText((me?.vendor as any)?.delivery_area_text != null ? String((me?.vendor as any).delivery_area_text) : null);
        try {
          const zres = await fetch("/api/vendor/delivery-zones");
          const zdata = await zres.json().catch(() => ({}));
          if (zres.ok && Array.isArray(zdata?.zones)) {
            setDeliveryZones(
              (zdata.zones as any[])
                .filter((z) => z && z.active !== false)
                .map((z) => ({ id: String(z.id), name: String(z.name ?? ""), description: z.description != null ? String(z.description) : null, fee: Number(z.fee) || 0 }))
            );
          }
        } catch { /* sin zonas: modo flat */ }
        const vmap: Record<string, ProductVariant[]> = {};
        for (const v of (vdata?.variants || []) as ProductVariant[]) {
          if (!v || !v.product_id) continue;
          if (!vmap[v.product_id]) vmap[v.product_id] = [];
          vmap[v.product_id].push(v);
        }
        setVariantsMap(vmap);
        const today = new Date().toDateString();
        const modsMap = off.modifiersByProduct || {};
        setModifiersMap(modsMap);
        const mapped = (off.offers || [])
          .filter((o: any) => o.available !== false)
          .map((o: any) => ({ ...o, modifiers: modsMap[o.id] || [] }));
        setProducts(mapped);
        setRecent(
          (ord.orders || [])
            .filter((o: any) => o.channel === "mostrador")
            .filter((o: any) => new Date(o.created_at).toDateString() === today)
            .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        );
        // Snapshot para operar offline (fire-and-forget).
        const vid = vendorId || (me?.vendor?.id as string | undefined) || null;
        if (vid) {
          saveCatalogSnapshot(vid, {
            products: mapped,
            categories: [],
            modifiersByProduct: modsMap,
            variantsMap: vmap as unknown as Record<string, Record<string, any>[]>,
            cashPct: pct,
            vertical,
          }).catch(() => {});
        }
      } catch { /* noop */ } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [vendorId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter(
      (p) =>
        (!q || p.name.toLowerCase().includes(q) || ((p as any).sku || "").toLowerCase() === q || ((p as any).sku || "").toLowerCase().includes(q)) &&
        (!activeCat || normCat(p.category) === activeCat)
    );
  }, [products, query, activeCat]);

  // Enter con código exacto (SKU) agrega directo sin tocar la lista.
  function submitCodeSearch() {
    const q = query.trim().toLowerCase();
    if (!q) return;
    const hit = products.find((p) => ((p as any).sku || "").toLowerCase() === q && p.available !== false);
    if (hit) {
      add(hit);
      setQuery("");
      setMsg("");
    } else {
      // Sin coincidencia: ofrecer crear el producto pre-llenado.
      openQuickCreate(/^\d+$/.test(q) ? { sku: q } : { name: query.trim() });
    }
  }

  // Alta rápida desde mostrador: crea el producto (otros) y lo suma a la venta.
  // Si vino de una línea manual, la reemplaza por el producto real.
  const [qcOpen, setQcOpen] = useState(false);
  const [qcName, setQcName] = useState("");
  const [qcPrice, setQcPrice] = useState("");
  const [qcSku, setQcSku] = useState("");
  const [qcUnit, setQcUnit] = useState<"unidad" | "kg">("unidad");
  const [qcRemotePhoto, setQcRemotePhoto] = useState<string | null>(null);
  const [qcLookupMsg, setQcLookupMsg] = useState("");
  const [qcSaving, setQcSaving] = useState(false);
  const [qcMsg, setQcMsg] = useState("");
  const [qcReplaceKey, setQcReplaceKey] = useState<string | null>(null);
  const [qcFromManual, setQcFromManual] = useState(false);
  async function openQuickCreate(prefill: { name?: string; price?: string; sku?: string; replaceKey?: string; fromManual?: boolean }) {
    setQcName(prefill.name || "");
    setQcPrice(prefill.price || "");
    setQcSku(prefill.sku || "");
    setQcUnit("unidad");
    setQcRemotePhoto(null);
    setQcLookupMsg("");
    setQcMsg("");
    setQcReplaceKey(prefill.replaceKey || null);
    setQcFromManual(!!prefill.fromManual);
    setQcOpen(true);
    // Sugerencia automática por lookup (no pisa nada cargado).
    if (prefill.sku) {
      try {
        const res = await fetch(`/api/vendor/barcode-lookup?code=${encodeURIComponent(prefill.sku)}`);
        const data = await res.json().catch(() => ({}));
        if (res.ok && data?.name) {
          if (!prefill.name) setQcName(String(data.name));
          if (data.image_url) setQcRemotePhoto(String(data.image_url));
          setQcLookupMsg(`Datos: ${data.source === "cache" ? "caché propia" : "Open Food Facts (ODbL)"}`);
        }
      } catch { /* sin red: alta manual igual */ }
    }
  }
  async function saveQuickCreate() {
    const name = qcName.trim();
    const price = Number(qcPrice);
    if (!name || !(price > 0)) {
      setQcMsg("Completá nombre y precio");
      return;
    }
    setQcSaving(true);
    setQcMsg("");
    try {
      const res = await fetch("/api/vendor/offers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name, price, category: "otros",
          sku: qcSku.trim() || undefined,
          unit: qcUnit,
          image_url: qcRemotePhoto || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.offer) {
        setQcMsg(data?.error || "No se pudo crear");
        return;
      }
      const created = { ...data.offer, modifiers: [] } as Product;
      setProducts((prev) => [...prev, created]);
      if (qcReplaceKey) {
        setItems((prev) => prev.filter((l) => lineKey(l.product_id, l.variant_id, l.modifiers) !== qcReplaceKey));
      }
      if (qcFromManual) {
        // La línea manual nunca se agregó: se limpia el borrador.
        setManualName("");
        setManualPrice("");
      }
      if (qcUnit === "kg") {
        const key = lineKey(created.id, undefined, []);
        addLine(created, null, 0, Number(created.price) || 0, []);
        setQcOpen(false);
        gotoKgLine(created.id, key);
        setMsg(`Creado “${name}”: cargá los kilos`);
      } else {
        add(created);
        setQcOpen(false);
        setQuery("");
        setMsg(`Creado y agregado: “${name}”`);
      }
    } catch {
      setQcMsg("Sin conexión");
    } finally {
      setQcSaving(false);
    }
  }

  // Escáner de código de barras con la cámara (BarcodeDetector, Chrome/Edge).
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState("");
  const scanVideoRef = useRef<HTMLVideoElement | null>(null);
  const scanStopRef = useRef(false);
  async function stopScan() {
    scanStopRef.current = true;
    setScanning(false);
    try {
      const v = scanVideoRef.current;
      const stream = (v as any)?.srcObject as MediaStream | undefined;
      stream?.getTracks().forEach((t) => t.stop());
      if (v) (v as any).srcObject = null;
    } catch { /* noop */ }
  }
  async function startScan() {
    setScanError("");
    const BD = (window as any).BarcodeDetector;
    if (!BD) {
      setScanError("Este navegador no soporta escaneo (usá Chrome o escribí el código)");
      return;
    }
    scanStopRef.current = false;
    setScanning(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      const video = scanVideoRef.current;
      if (!video) {
        stream.getTracks().forEach((t) => t.stop());
        await stopScan();
        return;
      }
      (video as any).srcObject = stream;
      await video.play().catch(() => {});
      const detector = new BD({ formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf"] });
      const seen = new Set<string>();
      while (!scanStopRef.current) {
        let codes: any[] = [];
        try {
          codes = await detector.detect(video);
        } catch {
          break;
        }
        const val = String(codes?.[0]?.rawValue || "").trim();
        if (val && !seen.has(val)) {
          seen.add(val);
          const hit = products.find(
            (p) => ((p as any).sku || "").toLowerCase() === val.toLowerCase() && p.available !== false
          );
          if (hit) {
            add(hit);
            setQuery("");
            setMsg(`Agregado por código: ${hit.name}`);
            await stopScan();
            return;
          } else {
            setQuery(val);
            setMsg(`Código ${val}: no está en el catálogo`);
            await stopScan();
            return;
          }
        }
        await new Promise((r) => setTimeout(r, 250));
      }
    } catch {
      if (!scanStopRef.current) setScanError("No se pudo abrir la cámara (revisá el permiso)");
    }
    await stopScan();
  }
  useEffect(() => () => { scanStopRef.current = true; }, []);

  function add(p: Product) {
    // Por peso: si ya está en la venta no se duplica — se lleva a la línea
    // existente para repesar (patrón Loyverse/Odoo).
    if ((p as any).unit === "kg") {
      const key = lineKey(p.id, undefined, []);
      const exists = items.some((i) => lineKey(i.product_id, i.variant_id, i.modifiers) === key);
      if (exists) {
        gotoKgLine(p.id, key);
        return;
      }
    }
    // Moda: primero se elige color × talle (el precio y el stock son por combinación).
    const variants = variantsMap[p.id] || [];
    if (p.has_variants && variants.length > 0) {
      setPendingVariant(null);
      setVariantPicker(p);
      return;
    }
    const mods = modifiersMap[p.id] || [];
    if (mods.length > 0) {
      setPendingVariant(null);
      setPickerProduct(p);
      return;
    }
    addLine(p, null, packOf(p), unitPriceOf(p), []);
  }

  /** Variante elegida en el picker: o va directo a la línea, o encadena al
    picker de modificadores (con la base de la variante). */
  function chooseVariant(p: Product, v: ProductVariant) {
    const mods = modifiersMap[p.id] || [];
    if (mods.length > 0) {
      setPendingVariant(v);
      setVariantPicker(null);
      setPickerProduct(p);
      return;
    }
    setVariantPicker(null);
    addLine(p, v, 1, Number(v.promo ?? v.price), []);
  }

  function addLine(p: Product, v: ProductVariant | null, qty: number, unitPrice: number, modifiers?: CartModifier[]) {
    const name = v ? `${p.name} (${v.color} · ${v.talle})` : p.name;
    const key = lineKey(p.id, v?.id, modifiers);
    // Por peso arranca en 0: el peso se carga con balanza o tipeo.
    const startQty = (p as any).unit === "kg" ? 0 : qty;
    // Capado a stock de la variante en cliente (el servidor valida igual).
    const maxStock = v ? Math.max(0, Math.floor(Number(v.stock ?? 0))) : null;
    setItems((prev) => {
      const found = prev.find((i) => lineKey(i.product_id, i.variant_id, i.modifiers) === key);
      if (found) {
        if (maxStock != null && found.qty + startQty > maxStock) return prev;
        return prev.map((i) => (i === found ? { ...i, qty: i.qty + startQty } : i));
      }
      if (maxStock != null && startQty > maxStock) return prev;
      return [...prev, {
        product_id: p.id, variant_id: v?.id, name, price: unitPrice, qty: startQty,
        requires_prep: p.requires_prep !== false, modifiers,
        hasPromo: v ? v.promo != null : p.promo_price != null,
        cashExcluded: p.cash_discount_excluded === true,
        packSize: packOf(p),
        unit: (p as any).unit === "kg" ? "kg" : undefined,
      }];
    });
    // Producto por peso: enfocar su input de kilos recién agregado.
    if ((p as any).unit === "kg") setFocusKgKey(key);
  }

  function handleModConfirm(selected: CartModifier[], finalPrice: number) {
    if (pickerProduct) {
      const v = pendingVariant;
      if (v) addLine(pickerProduct, v, 1, finalPrice, selected);
      else addLine(pickerProduct, null, packOf(pickerProduct), finalPrice, selected);
    }
    setPickerProduct(null);
    setPendingVariant(null);
  }

  function changeQty(key: string, delta: number) {
    setItems((prev) =>
      prev
        .map((i) => (lineKey(i.product_id, i.variant_id, i.modifiers) === key ? { ...i, qty: i.qty + delta * (i.packSize || 1) } : i))
        .filter((i) => i.qty > 0)
    );
  }

  // Quitar una línea (las de peso no tienen stepper −).
  function removeLine(key: string) {
    setItems((prev) => prev.filter((i) => lineKey(i.product_id, i.variant_id, i.modifiers) !== key));
  }

  // Monto manual ("Varios"): línea sin producto ni stock, fuera de estadísticas.
  const [manualName, setManualName] = useState("");
  const [manualPrice, setManualPrice] = useState("");
  // Borrador de venta (24h): sobrevive a recargas del SO/crash/deploy.
  const [restored, setRestored] = useState(false);
  const draftReady = useRef(false);
  type SaleDraft = {
    items: LineItem[]; customerName: string; customerPhone: string;
    customerAddress: string; posReferences: string; payment: string;
    method: "pickup" | "delivery" | "direct"; notes: string;
    withFiscal: boolean; fiscalReceptorTipo: "cf" | "dni" | "cuit";
    fiscalReceptorNro: string; fiscalReceptorNombre: string;
    fiscalReceptorCond: string; posManualFee: string; sheetOpen: boolean;
  };
  // Restaurar una sola vez al montar (si hay borrador con ítems).
  useEffect(() => {
    if (draftReady.current || !vendorId) return;
    draftReady.current = true;
    try {
      const d = loadDraft<SaleDraft>(vendorId, "mostrador");
      if (d && Array.isArray(d.items) && d.items.length > 0) {
        setItems(d.items);
        setCustomerName(d.customerName || "");
        setCustomerPhone(d.customerPhone || "");
        setCustomerAddress(d.customerAddress || "");
        setPosReferences(d.posReferences || "");
        if (d.payment) setPayment(d.payment);
        if (d.method === "pickup" || d.method === "delivery" || d.method === "direct") setMethod(d.method);
        setNotes(d.notes || "");
        setWithFiscal(d.withFiscal === true);
        if (d.fiscalReceptorTipo === "cf" || d.fiscalReceptorTipo === "dni" || d.fiscalReceptorTipo === "cuit") {
          setFiscalReceptorTipo(d.fiscalReceptorTipo);
        }
        setFiscalReceptorNro(d.fiscalReceptorNro || "");
        setFiscalReceptorNombre(d.fiscalReceptorNombre || "");
        setFiscalReceptorCond(d.fiscalReceptorCond || "6");
        setPosManualFee(d.posManualFee || "");
        if (d.sheetOpen === true) setSheetOpen(true);
        setRestored(true);
      }
    } catch { /* borrador corrupto: se ignora */ }
  }, [vendorId]);
  // Guardar con debounce mientras se arma la venta; limpiar si queda vacía.
  useEffect(() => {
    if (!draftReady.current || !vendorId) return;
    const t = setTimeout(() => {
      if (items.length === 0 && !customerName && !customerPhone && !notes) {
        clearDraft(vendorId, "mostrador");
        return;
      }
      saveDraft(vendorId, "mostrador", {
        items, customerName, customerPhone, customerAddress, posReferences,
        payment, method, notes, withFiscal, fiscalReceptorTipo,
        fiscalReceptorNro, fiscalReceptorNombre, fiscalReceptorCond, posManualFee,
        sheetOpen,
      } satisfies SaleDraft);
    }, 400);
    return () => clearTimeout(t);
  }, [items, customerName, customerPhone, customerAddress, posReferences, payment, method, notes, withFiscal, fiscalReceptorTipo, fiscalReceptorNro, fiscalReceptorNombre, fiscalReceptorCond, posManualFee, sheetOpen, vendorId]);
  function discardDraft() {
    clearDraft(vendorId, "mostrador");
    setItems([]);
    setCustomerName("");
    setCustomerPhone("");
    setCustomerAddress("");
    setPosReferences("");
    setNotes("");
    setPosManualFee("");
    setWithFiscal(false);
    setRestored(false);
  }
  function addManualLine() {
    const name = manualName.trim() || "Varios";
    const price = Math.round(Number(manualPrice) * 100) / 100;
    if (!Number.isFinite(price) || price <= 0) {
      setMsg("Ingresá un monto mayor a $0");
      return;
    }
    const key = lineKey(`manual:${name}`, undefined, undefined);
    setItems((prev) => {
      const found = prev.find((i) => lineKey(i.product_id, i.variant_id, i.modifiers) === key);
      if (found) return prev.map((i) => (i === found ? { ...i, qty: i.qty + 1 } : i));
      return [...prev, {
        product_id: `manual:${name}`, name, price, qty: 1,
        requires_prep: false, modifiers: undefined,
        hasPromo: false, cashExcluded: false, manual: true,
      }];
    });
    setManualName("");
    setManualPrice("");
    setMsg("");
  }

  // Peso manual para productos por kilo (balanza o tipeo).
  // focusKgKey: al agregar un producto por peso se enfoca su input de kilos.
  const [focusKgKey, setFocusKgKey] = useState<string | null>(null);
  // flashKgKey: resalta la línea por peso existente al re-tocarla.
  const [flashKgKey, setFlashKgKey] = useState<string | null>(null);
  // Lleva a la línea por peso existente para repesar (scroll + foco + aviso).
  function gotoKgLine(productId: string, key: string) {
    setFocusKgKey(key);
    setFlashKgKey(key);
    window.setTimeout(() => {
      setFlashKgKey((cur) => (cur === key ? null : cur));
    }, 2000);
    requestAnimationFrame(() => {
      document.getElementById(`kgline-${productId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    setMsg("Ya está agregado: actualizá el peso o tocá Pesar");
  }
  function setLineKg(key: string, kg: number) {
    if (!Number.isFinite(kg) || kg <= 0 || kg > 1000) return;
    const rounded = Math.round(kg * 1000) / 1000;
    setItems((prev) =>
      prev.map((i) => (lineKey(i.product_id, i.variant_id, i.modifiers) === key ? { ...i, qty: rounded } : i))
    );
  }

  // Balanza física por Web Serial (Chrome/Edge en la PC del mostrador).
  // Lee el stream ASCII de la balanza (~2s) y vuelca el último peso estable.
  const [scaleReading, setScaleReading] = useState(false);
  async function readScaleInto(key: string) {
    const nav = navigator as any;
    if (!nav?.serial) {
      setMsg("Este navegador no soporta balanza directa (usá Chrome en PC o cargá el peso manual)");
      return;
    }
    setScaleReading(true);
    setMsg("");
    try {
      const port = await nav.serial.requestPort();
      await port.open({ baudRate: 9600 });
      const reader = port.readable.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let lastKg: number | null = null;
      const deadline = Date.now() + 4000;
      try {
        while (Date.now() < deadline) {
          const { value, done } = await Promise.race([
            reader.read(),
            new Promise<{ value?: undefined; done: true }>((res) => setTimeout(() => res({ done: true }), 500)),
          ]);
          if (done || !value) break;
          buf += decoder.decode(value, { stream: true });
          // Formatos típicos: "ST,GS,+  1.235kg", " 0.542 kg", "1240 g".
          const m = buf.match(/([+-]?\s*\d+[.,]\d+)\s*(kg|KG|g\b|G\b)?/);
          if (m) {
            let v = Number(m[1].replace(/\s/g, "").replace(",", "."));
            if (Number.isFinite(v)) {
              if (m[2] && m[2].toLowerCase() === "g") v = v / 1000;
              lastKg = Math.abs(v);
            }
          }
          if (buf.length > 500) buf = buf.slice(-200);
        }
      } finally {
        try { reader.releaseLock(); } catch { /* noop */ }
        try { await port.close(); } catch { /* noop */ }
      }
      if (lastKg != null && lastKg > 0) {
        setLineKg(key, lastKg);
        setMsg("");
      } else {
        setMsg("No se pudo leer el peso: poné algo en la balanza e intentá de nuevo");
      }
    } catch (e: any) {
      if (e?.name !== "NotFoundError") setMsg("No se pudo abrir la balanza (revisá el cable y el puerto)");
    } finally {
      setScaleReading(false);
    }
  }

  // Wrapper anti-silencio: cualquier excepción inesperada del cobro deja
  // mensaje visible y desbloquea el botón (antes quedaba en "Cobrando..."
  // para siempre y los toques siguientes no hacían nada).
  async function charge(withReceipt: boolean) {
    // Migaja de inicio (fire-and-forget): si el tap llega hasta acá, el
    // servidor lo ve en docker logs aunque todo lo demás falle.
    try {
      fetch("/api/client-error", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: `mostrador:charge:start withReceipt=${withReceipt} items=${items.length} payment=${payment} method=${method}`,
          pathname: "/vendor (mostrador)",
        }),
      }).catch(() => {});
    } catch { /* noop */ }
    try {
      await chargeInner(withReceipt);
    } catch (e) {
      console.error("[mostrador] charge", e);
      try {
        fetch("/api/client-error", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: `mostrador:charge:fail ${String((e as Error)?.message || e).slice(0, 200)}`,
            stack: String((e as Error)?.stack || "").slice(0, 1000),
            pathname: "/vendor (mostrador)",
          }),
        }).catch(() => {});
      } catch { /* noop */ }
      setMsg("No se pudo registrar el pedido (error inesperado, reintentá)");
      setSaving(false);
    }
  }

  // Atajo desktop: Enter ×2 cobra la venta directa (mismo charge(true) del
  // botón). Solo puntero fino, solo modo directa, nunca desde formularios
  // (el buscador usa Enter para SKU, inputs de peso/precio, etc.).
  const [finePointer, setFinePointer] = useState(false);
  useEffect(() => {
    try {
      setFinePointer(window.matchMedia?.("(pointer: fine)").matches ?? false);
    } catch { /* noop */ }
  }, []);
  // Refs para leer estado fresco desde el listener sin re-suscribirlo.
  const chargeStateRef = useRef({ method, hasItems: false, saving, blocked: false });
  chargeStateRef.current = { method, hasItems: items.length > 0, saving, blocked: shiftBlocked };
  const chargeFnRef = useRef(charge);
  chargeFnRef.current = charge;
  const lastEnterRef = useRef(0);
  useEffect(() => {
    if (!finePointer) return;
    const DOUBLE_MS = 500;
    function onKeyDown(e: KeyboardEvent) {
      // Cualquier otra tecla rompe la secuencia (también evita que un
      // escáner de código de barras —que "tipea" + Enter— dispare el cobro).
      if (e.key !== "Enter") { lastEnterRef.current = 0; return; }
      if (e.repeat || e.isComposing) return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      const st = chargeStateRef.current;
      if (st.method !== "direct" || !st.hasItems || st.saving || st.blocked) { lastEnterRef.current = 0; return; }
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t?.isContentEditable) return;
      const now = Date.now();
      if (now - lastEnterRef.current <= DOUBLE_MS) {
        lastEnterRef.current = 0;
        e.preventDefault();
        chargeFnRef.current(true);
      } else {
        lastEnterRef.current = now;
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [finePointer]);

  async function chargeInner(withReceipt: boolean) {
    if (items.length === 0) return;

    // Venta directa: retail sin pedido (nace cerrada). Retiro/delivery = pedido.
    const direct = method === "direct";
    // Fiscal: check por venta (con fiscal = Factura ARCA, sin = ticket no fiscal).
    const useFiscal = fiscalReady && withFiscal;

    // Ítems por peso sin peso cargado: no se puede cobrar.
    const pendingKg = items.find((i) => i.unit === "kg" && !(Number(i.qty) > 0));
    if (pendingKg) {
      setMsg(`Ingresá el peso de "${pendingKg.name}" o tocá Pesar con la balanza`);
      setFocusKgKey(lineKey(pendingKg.product_id, pendingKg.variant_id, pendingKg.modifiers));
      return;
    }

    const isDelivery = method === "delivery";
    // Misma validación que el checkout del cliente: celular real (WhatsApp).
    const deliveryPhoneE164 = isDelivery ? toE164(customerPhone) : null;
    if (isDelivery && !deliveryPhoneE164) {
      setMsg("El envío a domicilio requiere el celular del cliente (ej: 11 5555 1234)");
      return;
    }

    // Solo entra a cocina si al menos un ítem requiere elaboración.
    const needsKitchen = items.some((i) => i.requires_prep !== false);

    // Dirección + referencias en una línea (igual que el checkout web).
    const addrTrim = customerAddress.trim();
    const refTrim = posReferences.trim();
    const fullAddr = addrTrim && refTrim ? `${addrTrim} — Ref: ${refTrim}` : addrTrim || refTrim || undefined;

    // El client_key viaja SIEMPRE (online también): un timeout con reintento
    // no duplica gracias a la idempotencia del servidor (Fase 0).
    const payload = {
      items: items.map((i) => ({ ...i, modifiers: (i.modifiers || []).map((m) => m.label) })),
      total,
      paymentMethod: payment,
      customerName: customerName || "Mostrador",
      // La DB solo admite pickup/delivery: la directa viaja como pickup + flag.
      method: direct ? "pickup" : method,
      direct,
      customerPhone: isDelivery ? deliveryPhoneE164 : (toE164(customerPhone) || undefined),
      customerAddress: isDelivery ? fullAddr : undefined,
      deliveryZoneId: isDelivery && posZonesMode && !posOutOfAreaFlag && posActiveZoneId ? posActiveZoneId : undefined,
      deliveryOutOfArea: isDelivery ? posOutOfAreaFlag : false,
      deliveryManualFee: isDelivery && posOutOfAreaFlag && Number(posManualFee) > 0 ? Number(posManualFee) : undefined,
      notes: notes.trim() || null,
      client_key: newClientKey(),
      occurred_at: new Date().toISOString(),
    };

    const clearSaleForm = () => {
      clearDraft(vendorId, "mostrador");
      setItems([]);
      setCustomerName("");
      setCustomerPhone("");
      setCustomerAddress("");
      setPosReferences("");
      setPosOutOfArea(false);
      setPosManualFee("");
      setNotes("");
      setManualName("");
      setManualPrice("");
      setClientOpen(false);
      setFiscalReceptorTipo("cf");
      setFiscalReceptorNro("");
      setFiscalReceptorNombre("");
      setFiscalReceptorCond("6");
      setSheetOpen(false);
      setSaving(false);
    };

    setSaving(true);
    setMsg("");

    // Camino offline (F2): sin red → encolar + UI optimista con número
    // provisorio. El sync engine (F3) lo envía al reconectar.
    const goOffline = async () => {
      if (!vendorId) {
        setMsg("Sin conexión y sin contexto del comercio: no se puede guardar");
        setSaving(false);
        return;
      }
      // Gate F4: vender offline exige plan verificado dentro del grace period.
      const gate = await checkOfflineAllowed(vendorId);
      if (!gate.allowed) {
        setMsg(offlineDeniedMsg(gate));
        setSaving(false);
        return;
      }
      const prov = nextProvisionalNumber(vendorId);
      // En el payload para que el KDS offline muestre el P-N (el servidor
      // ignora campos desconocidos).
      (payload as any).__provisional = prov;
      const localId = await enqueueOfflineAction({
        vendorId,
        scope: "pos",
        type: "pos_order",
        payload,
      });
      const nowIso = new Date().toISOString();
      // Documentos a imprimir (igual que online: comanda si hay cocina +
      // comprobante si lo pidió). Se encolan y se intentan en listener local.
      const printDocs: { doc: ContingencyKind; kind: "comanda" | "ticket" | "retiro"; payload: Record<string, any> }[] = [];
      // Venta directa: sin comanda (las líneas manuales marcan requires_prep).
      if (needsKitchen && !direct) {
        printDocs.push({
          doc: "COMANDA",
          kind: "comanda",
          payload: { items: payload.items, customerName: payload.customerName },
        });
      }
      if (withReceipt && !isDelivery) {
        const kind = (isRetail ? "ticket" : "retiro") as "ticket" | "retiro";
        printDocs.push({
          doc: isRetail ? "TICKET" : "RETIRO",
          kind,
          payload: {
            items: payload.items,
            total: payableTotal,
            payment: payload.paymentMethod,
            customerName: payload.customerName,
            method,
          },
        });
      }
      let printedCount = 0;
      const failedDocs: string[] = [];
      for (const d of printDocs) {
        const printId = await printsAdd({
          vendorId,
          orderLocalId: localId,
          doc: d.kind,
          payload: d.payload,
        });
        const items = ((d.payload.items || []) as any[]).map((i) => ({
          qty: Number(i.qty) || 1,
          name: String(i.name || ""),
          modifiers: Array.isArray(i.modifiers) ? i.modifiers.map((m: any) => String(m)) : [],
        }));
        const r = await dispatchOfflinePrint(vendorId, {
          kind: d.doc,
          provisional: prov,
          customerName: String(d.payload.customerName || ""),
          items,
          total: Number(d.payload.total ?? 0),
          paymentLabel: OFFLINE_PAYMENT_LABELS[payment] ?? payment,
          cashPct:
            d.doc !== "COMANDA" && payment === "efectivo" && activeCashDiscount > 0
              ? cashResult.cashPct
              : 0,
          cashTotal:
            d.doc !== "COMANDA" && payment === "efectivo" && activeCashDiscount > 0
              ? payableTotal
              : 0,
          createdAt: Date.now(),
        }).catch(() => ({ printed: false as const }));
        if (r.printed) {
          printedCount++;
          if (printId != null) {
            const { printsPatch } = await import("@/lib/offline-db");
            printsPatch(printId, { printed: true }).catch(() => {});
          }
        } else {
          failedDocs.push(d.doc);
        }
      }
      if (printDocs.length > 0 && printedCount === printDocs.length) {
        await markPrintsDone(vendorId, localId).catch(() => {});
      }
      setRecent((prev) =>
        [{
          id: localId,
          localId,
          total: payableTotal,
          estimated: true,
          pending: true,
          provisional: prov,
          payment_method: payment,
          paid_at: nowIso,
          status: needsKitchen ? "preparing" : "new",
          created_at: nowIso,
          pickup_number: null,
          customer_name: customerName || "Mostrador",
          method,
        }, ...prev].slice(0, 20)
      );
      let offMsg = `📡 Sin conexión: venta P-${prov} guardada en este equipo, se envía al reconectar`;
      if (printDocs.length > 0) {
        offMsg += failedDocs.length === 0
          ? " · 🖨️ impresa local"
          : ` · ⚠️ no salió en local: ${failedDocs.join(" + ")} (en cola para imprimir)`;
      }
      if (useFiscal) offMsg += " · 🧾 sin factura (requiere conexión)";
      setMsg(offMsg);
      clearSaleForm();
    };

    if (typeof navigator !== "undefined" && !navigator.onLine) {
      await goOffline();
      return;
    }

    let res: Response;
    try {
      res = await fetch("/api/vendor/pos/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      // Solo el fallo de conectividad cae al camino offline; cualquier otro
      // error mantiene el comportamiento anterior.
      if (isNetworkError(e)) {
        await goOffline();
        return;
      }
      setMsg("No se pudo registrar el pedido");
      setSaving(false);
      return;
    }
    const data = await res.json().catch(() => ({}));
    if (!data.ok) {
      setMsg(data.error || "No se pudo registrar el pedido");
      setSaving(false);
      return;
    }

    // El servidor recalcula el descuento en efectivo (pos/order): el total
    // cobrado real viene en data.order.total.
    const netTotal = Number(data.order?.total ?? total);
    const baseMsg = direct
      ? `Venta registrada $${netTotal.toLocaleString("es-AR")}${withReceipt ? " · comprobante" : ""}`
      : isDelivery
      ? "Pedido a domicilio registrado"
      : `Cobrado $${netTotal.toLocaleString("es-AR")}${withReceipt ? (isRetail ? " · comprobante" : " · comprobante de retiro") : ""}`;

    // /api/print responde 200 aunque el trabajo falle (ok:false en el body):
    // hay que leerlo, si no una comanda fallida pasa en silencio y sale
    // solo el retiro. Devuelve el error o null si salió/omitió.
    const checkPrintRes = async (p: Promise<Response>, docName: string): Promise<string | null> => {
      try {
        const r = await p;
        const d = await r.json().catch(() => ({} as any));
        if (d && (d.ok || d.skipped)) return null;
        return `${docName} no salió: ${d?.error || "error de impresión"}`;
      } catch {
        return `${docName} no salió: sin conexión con la impresora`;
      }
    };
    // Retail: comprobante de venta (ticket con ítems y total). Gastro: comanda
    // si requiere cocina y recién al terminar el stub de retiro (evita dos
    // trabajos concurrentes a la impresora).
    const saleDocName = isRetail ? "El comprobante" : "El comprobante de retiro";
    const printSaleDoc = async (): Promise<string | null> => {
      if (withReceipt && !isDelivery) {
        return checkPrintRes(
          fetch("/api/print", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ orderId: data.orderId, type: isRetail ? "ticket" : "retiro" }),
          }),
          saleDocName
        );
      }
      return null;
    };
    // Comanda de cocina: sale al instante siempre (la cocina no espera al CAE).
    // El ticket al cliente sale después: junto al CAE si hay fiscal, o
    // encadenado a la comanda como antes si no hay.
    const wantFiscalTicket = useFiscal && data.orderId && withReceipt && !isDelivery;
    let comandaError: string | null = null;
    // Venta directa: sin comanda (no hay pedido ni cocina que avisar).
    if (needsKitchen && !direct) {
      const comandaP = checkPrintRes(
        fetch("/api/print", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId: data.orderId, type: "comanda" }),
        }),
        "La comanda"
      );
      if (!wantFiscalTicket) {
        comandaP
          .then(async (cerr) => {
            const serr = await printSaleDoc();
            const errs = [cerr, serr].filter(Boolean).join(" · ");
            if (errs) setMsg(`${baseMsg} · ⚠️ ${errs}`);
          })
          .catch(() => {});
      } else {
        // Con fiscal el msg lo arma el flujo del CAE (abajo): solo se guarda
        // el error para incluirlo ahí.
        comandaP.then((cerr) => { comandaError = cerr; }).catch(() => {});
      }
    }
    const comandaSuffix = () => (comandaError ? ` · ⚠️ ${comandaError}` : "");
    setMsg(baseMsg);
    clearSaleForm();
    setFiscalPrintId(null);

    // Fiscal opt-in por venta: se espera el CAE (hasta 60s) y se imprime UN
    // solo ticket ya con Factura C + QR. La cocina ya recibió su comanda.
    const wantFiscal = useFiscal && data.orderId;
    if (wantFiscal) {
      const fiscalOrderId = data.orderId as string;
      setMsg(`${baseMsg} · 🧾 Facturando en ARCA…`);
      try {
      const fres = await fetch("/api/vendor/fiscal/emitir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: fiscalOrderId,
          ...(fiscalReceptorTipo === "cf"
            ? {}
            : {
                receptorDocTipo: fiscalReceptorTipo === "cuit" ? 80 : 96,
                receptorDocNro: fiscalReceptorNro.replace(/\D/g, ""),
                receptorNombre: fiscalReceptorNombre.trim() || undefined,
                receptorCondIva: fiscalReceptorTipo === "cuit" ? Number(fiscalReceptorCond) || 6 : 5,
              }),
        }),
        signal: AbortSignal.timeout(60000),
      });
        const fdata = await fres.json().catch(() => ({}));
        if (fres.ok && fdata.invoice) {
          const inv = fdata.invoice;
          const fiscalMsg =
            `${baseMsg} · 🧾 Factura C ${String(inv.punto_venta).padStart(4, "0")}-${String(inv.cbte_nro).padStart(8, "0")} (CAE …${String(inv.cae).slice(-4)})`;
          if (wantFiscalTicket) {
            // Un solo paso: el ticket sale con el bloque fiscal incluido.
            const ticketErr = await checkPrintRes(
              fetch("/api/print", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ orderId: fiscalOrderId, type: "ticket" }),
              }),
              "El ticket fiscal"
            );
            if (!ticketErr) setMsg(`${fiscalMsg}${comandaSuffix()} · 🖨️ Impreso ✓`);
            else {
              setMsg(`${fiscalMsg}${comandaSuffix()} · ⚠️ ${ticketErr}`);
              setFiscalPrintId(fiscalOrderId);
            }
          } else {
            setMsg(`${fiscalMsg}${comandaSuffix()}`);
          }
        } else if (fdata.error) {
          const hint = fdata.hint ? ` 💡 ${fdata.hint}` : "";
          setMsg(`${baseMsg}${comandaSuffix()} · ⚠️ Cobrado sin fiscal: ${fdata.error}${hint} (reintentá desde Config → Fiscal)`);
          if (wantFiscalTicket) {
            printSaleDoc().then((serr) => {
              if (serr) setMsg((m) => `${m} · ⚠️ ${serr}`);
            }).catch(() => {});
          }
        } else {
          // Respuesta vacía o timeout: el CAE puede llegar igual en el
          // server; sale el comprobante común y queda reimpresión fiscal.
          setMsg(`${baseMsg}${comandaSuffix()} · ⚠️ Cobrado sin fiscal confirmado: ARCA tardó demasiado (revisá el detalle del pedido)`);
          if (wantFiscalTicket) {
            printSaleDoc().then((serr) => {
              if (serr) setMsg((m) => `${m} · ⚠️ ${serr}`);
            }).catch(() => {});
          }
          setFiscalPrintId(fiscalOrderId);
        }
      } catch {
        setMsg(`${baseMsg}${comandaSuffix()} · ⚠️ Cobrado sin fiscal confirmado: sin conexión (reintentá desde Config → Fiscal)`);
        if (wantFiscalTicket) {
          printSaleDoc().then((serr) => {
            if (serr) setMsg((m) => `${m} · ⚠️ ${serr}`);
          }).catch(() => {});
        }
        setFiscalPrintId(fiscalOrderId);
      }
    } else if (!needsKitchen || direct) {
      // Sin cocina: directo. Venta directa con cocina: tampoco hay comanda
      // (no hay pedido en cocina que avisar), el comprobante sale directo.
      // No-directa con cocina ya salió encadenada arriba: no llega acá.
      printSaleDoc().then((serr) => {
        if (serr) setMsg(`${baseMsg} · ⚠️ ${serr}`);
      }).catch(() => {});
    }
    setRecent((prev) =>
      [{ id: data.orderId, total: Number(data.order?.total ?? total), payment_method: data.order?.payment_method ?? payment, paid_at: data.order?.paid_at ?? new Date().toISOString(), status: data.order?.status ?? (direct ? "completed" : "preparing"), created_at: data.order?.created_at ?? new Date().toISOString(), pickup_number: data.order?.pickup_number ?? null, method: data.order?.method ?? (direct ? "pickup" : method) }, ...prev].slice(0, 20)
    );
  }

  // El cliente no quiere esperar más en el mostrador: convertir el pedido a domicilio.
  async function convertToDelivery(orderId: string) {
    // Celular válido (misma regla que el checkout): es el que recibe los WA.
    const convertPhoneE164 = toE164(convertPhone);
    if (!convertPhoneE164) {
      setMsg("Ingresá un celular válido del cliente (ej: 11 5555 1234)");
      return;
    }
    setConverting(true);
    setMsg("");
    try {
      const cAddr = convertAddress.trim();
      const cRef = convertReferences.trim();
      const cFull = cAddr && cRef ? `${cAddr} — Ref: ${cRef}` : cAddr || cRef || null;
      const cOut = posZonesMode ? convertZoneId === "__OUT__" : convertOutOfArea;
      const cZone = posZonesMode && !cOut ? convertZoneId || deliveryZones[0]?.id || null : null;
      const res = await fetch(`/api/vendor/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          method: "delivery",
          customer_phone: convertPhoneE164,
          customer_address: cFull,
          delivery_zone_id: cZone,
          delivery_out_of_area: cOut,
          delivery_manual_fee: cOut && Number(convertManualFee) > 0 ? Number(convertManualFee) : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        setMsg(data.error || "No se pudo convertir a domicilio");
      } else {
        const newTotal = Number((data.order as any)?.total);
        setRecent((prev) =>
          prev.map((o) =>
            o.id === orderId
              ? { ...o, method: "delivery", total: Number.isFinite(newTotal) ? newTotal : o.total }
              : o
          )
        );
        setConvertOrderId(null);
        setConvertPhone("");
        setConvertAddress("");
        setConvertReferences("");
        setConvertZoneId("");
        setConvertOutOfArea(false);
        setConvertManualFee("");
        setMsg(
          Number.isFinite(newTotal)
            ? `Pedido convertido a domicilio · nuevo total $${newTotal.toLocaleString("es-AR")}`
            : "Pedido convertido a envío a domicilio"
        );
      }
    } catch {
      setMsg("Error de conexión al convertir");
    } finally {
      setConverting(false);
    }
  }

  // Al sincronizar (F3), las ventas pendientes se reemplazan por los datos
  // reales del servidor (Nro. definitivo, total recalculado). Los localIds
  // descartados desde el visor de conflictos (F4) se eliminan del listado.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent)?.detail as
        | {
            mappings?: Record<string, { orderId: string; pickup_number?: number | null; total?: number | null; order?: any }>;
            syncedLocalIds?: string[];
          }
        | undefined;
      const mappings = detail?.mappings ?? {};
      const synced = new Set(detail?.syncedLocalIds ?? []);
      if (Object.keys(mappings).length === 0 && synced.size === 0) return;
      setRecent((prev) =>
        prev
          .filter((o) => {
            if (!o.localId || !synced.has(o.localId)) return true;
            // Sincronizado con pedido real → se reemplaza abajo; descartado
            // (sin mapping) → se elimina del listado.
            return !!mappings[o.localId]?.orderId;
          })
          .map((o) => {
            if (!o.localId) return o;
            const m = mappings[o.localId];
            if (!m?.orderId) return o;
            const ord = m.order as any | undefined;
            return {
              ...o,
              id: m.orderId,
              pending: false,
              estimated: false,
              provisional: null,
              total: Number(m.total ?? ord?.total ?? o.total),
              payment_method: ord?.payment_method ?? o.payment_method,
              paid_at: ord?.paid_at ?? o.paid_at,
              status: ord?.status ?? o.status,
              created_at: ord?.created_at ?? o.created_at,
              pickup_number: m.pickup_number ?? ord?.pickup_number ?? null,
              method: ord?.method ?? o.method,
            };
          })
      );
    };
    window.addEventListener(SYNC_COMPLETED_EVENT, handler);
    return () => window.removeEventListener(SYNC_COMPLETED_EVENT, handler);
  }, []);

  if (loading) return <p className="text-sm text-muted-foreground">Cargando mostrador...</p>;

  const productsGrid = (
    <div className="space-y-2">
      {/* Buscador + categorías fijas arriba en mobile (debajo del header del dashboard) */}
      <div className="sticky top-24 z-30 -mx-4 px-4 py-2 bg-background sm:static sm:mx-0 sm:px-0 sm:py-0">
        <div className="flex gap-1.5">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submitCodeSearch(); }}
            placeholder="Buscar producto o código…"
            className="flex-1 min-w-0 h-10 px-3 text-sm rounded-xl border border-input bg-background"
          />
          <button
            type="button"
            onClick={startScan}
            className="h-10 w-11 flex-shrink-0 rounded-xl border border-border bg-card text-lg hover:border-primary"
            title="Escanear código de barras con la cámara"
            aria-label="Escanear código de barras"
          >
            📷
          </button>
        </div>
        {scanError && <p className="text-[11px] text-amber-700 pt-1">{scanError}</p>}
        {qcOpen && (
          <div className="mt-2 rounded-xl border border-primary/40 bg-card p-2.5 space-y-2">
            <p className="text-xs font-semibold">＋ Crear producto y agregarlo a la venta</p>
            <input
              type="text"
              value={qcName}
              onChange={(e) => setQcName(e.target.value)}
              placeholder="Nombre del producto"
              className="w-full h-9 px-3 text-xs rounded-lg border border-input bg-background"
            />
            <div className="flex gap-1.5">
              <input
                type="number"
                inputMode="decimal"
                min="0"
                value={qcPrice}
                onChange={(e) => setQcPrice(e.target.value)}
                placeholder={qcUnit === "kg" ? "$ por kilo" : "$ precio"}
                className="flex-1 min-w-0 h-9 px-3 text-xs rounded-lg border border-input bg-background"
              />
              <select
                value={qcUnit}
                onChange={(e) => setQcUnit(e.target.value as "unidad" | "kg")}
                className="h-9 px-2 text-xs rounded-lg border border-input bg-background"
              >
                <option value="unidad">Unidad</option>
                <option value="kg">Por peso</option>
              </select>
            </div>
            {qcSku && <p className="text-[11px] text-muted-foreground">Código: {qcSku}</p>}
            {(qcLookupMsg || qcRemotePhoto) && (
              <p className="text-[11px] text-muted-foreground">
                {qcRemotePhoto ? "Foto sugerida: se descarga al guardar ✓ · " : ""}{qcLookupMsg}
              </p>
            )}
            {qcMsg && <p className="text-[11px] text-amber-700">{qcMsg}</p>}
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={saveQuickCreate}
                disabled={qcSaving}
                className="flex-1 h-9 rounded-lg bg-primary text-primary-foreground text-xs font-semibold disabled:opacity-50"
              >
                {qcSaving ? "Guardando…" : "Guardar y agregar"}
              </button>
              <button
                type="button"
                onClick={() => setQcOpen(false)}
                className="h-9 px-3 rounded-lg bg-muted text-xs font-medium"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}
        {categories.length > 1 && (
          <div className="flex gap-1.5 overflow-x-auto pb-1 pt-2 scrollbar-hide">
            <button
              onClick={() => setActiveCat(null)}
              className={`flex-shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                activeCat === null ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
              }`}
            >
              Todos
            </button>
            {categories.map((c) => (
              <button
                key={c.key}
                onClick={() => setActiveCat(activeCat === c.key ? null : c.key)}
                className={`flex-shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                  activeCat === c.key ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
        )}
        {products.length > 0 && !products.some((p) => (p as any).unit === "kg") && (
          <p className="text-[11px] text-muted-foreground">
            Tip: marcá productos “Por peso” en el Catálogo para pesar con balanza o cargar kilos acá.
          </p>
        )}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2">
        {filtered.map((p) => (
          <ProductPickCard
            key={p.id}
            product={p}
            hasModifiers={(modifiersMap[p.id] || []).length > 0}
            onAdd={() => add(p)}
          />
        ))}
        {filtered.length === 0 && <p className="text-xs text-muted-foreground col-span-full text-center py-6">Sin productos</p>}
      </div>
      {scanning && (
        <div className="fixed inset-0 z-[70] bg-black/80 flex flex-col items-center justify-center gap-3 p-4" onClick={stopScan}>
          <p className="text-white text-sm font-medium">Apuntá al código de barras</p>
          <video ref={scanVideoRef} playsInline muted className="w-full max-w-sm rounded-xl bg-black aspect-[3/4] object-cover" />
          <Button type="button" variant="outline" onClick={stopScan}>
            Cancelar
          </Button>
        </div>
      )}
    </div>
  );

  const orderSummary = (
    <>
      <div className="flex-1 space-y-1.5 min-h-0 overflow-y-auto">
        {items.length === 0 && <p className="text-xs text-muted-foreground text-center py-6">Tocá productos para armar el pedido</p>}
        {items.map((i) => (
          <div
            key={lineKey(i.product_id, i.variant_id, i.modifiers)}
            {...(i.unit === "kg" ? { id: `kgline-${i.product_id}` } : {})}
            className={`flex items-center gap-2 text-sm rounded-lg transition-colors ${
              i.unit === "kg" && flashKgKey === lineKey(i.product_id, i.variant_id, i.modifiers)
                ? "bg-primary/10 outline outline-2 outline-primary/40"
                : ""
            }`}
          >
            <span className="flex-1 min-w-0 line-clamp-2 break-words">
              {i.name}
              {i.unit === "kg" && (
                <span className="ml-1 rounded bg-muted px-1 text-[10px] text-muted-foreground">$/kg</span>
              )}
              {(i.modifiers || []).length > 0 && (
                <span className="block text-[10px] text-muted-foreground truncate">
                  {(i.modifiers || []).map((m) => m.label).join(", ")}
                </span>
              )}
            </span>
            {i.unit === "kg" ? (
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.001"
                  value={i.qty}
                  onChange={(e) => setLineKg(lineKey(i.product_id, i.variant_id, i.modifiers), Number(e.target.value))}
                  ref={(el) => {
                    const k = lineKey(i.product_id, i.variant_id, i.modifiers);
                    if (focusKgKey === k && el) {
                      el.focus();
                      el.select();
                      setFocusKgKey(null);
                    }
                  }}
                  className="w-20 h-9 px-1 text-xs text-center tabular-nums rounded-md border border-input bg-background"
                  aria-label={`Peso en kilos de ${i.name}`}
                />
                <span className="text-[10px] text-muted-foreground">kg</span>
                <button
                  type="button"
                  onClick={() => readScaleInto(lineKey(i.product_id, i.variant_id, i.modifiers))}
                  disabled={scaleReading}
                  className="h-9 px-2 rounded-md bg-primary/10 text-primary hover:bg-primary/20 text-xs font-semibold whitespace-nowrap"
                  title="Leer peso de la balanza (Chrome en PC)"
                >
                  {scaleReading ? "Leyendo…" : "Pesar"}
                </button>
                <button
                  type="button"
                  onClick={() => removeLine(lineKey(i.product_id, i.variant_id, i.modifiers))}
                  className="h-9 w-7 rounded-md text-muted-foreground hover:text-red-600 hover:bg-red-50 text-sm"
                  title={`Quitar ${i.name}`}
                  aria-label={`Quitar ${i.name}`}
                >
                  ×
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-1">
                <button onClick={() => changeQty(lineKey(i.product_id, i.variant_id, i.modifiers), -1)} className="h-6 w-6 rounded-md bg-muted hover:bg-accent">−</button>
                <span className="w-5 text-center tabular-nums">{i.qty}</span>
                <button onClick={() => changeQty(lineKey(i.product_id, i.variant_id, i.modifiers), 1)} className="h-6 w-6 rounded-md bg-muted hover:bg-accent">+</button>
              </div>
            )}
            <span className="w-16 text-right tabular-nums">${(Math.round(i.price * i.qty * 100) / 100).toLocaleString("es-AR")}</span>
          </div>
        ))}
      </div>

      {/* Monto manual ("Varios"): sin producto ni stock */}
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          value={manualName}
          onChange={(e) => setManualName(e.target.value)}
          placeholder="Monto manual (ej: Varios)"
          className="flex-1 min-w-0 h-9 px-3 text-xs rounded-lg border border-input bg-background"
        />
        <input
          type="number"
          inputMode="decimal"
          min="0"
          value={manualPrice}
          onChange={(e) => setManualPrice(e.target.value)}
          placeholder="$"
          className="w-24 h-9 px-2 text-xs rounded-lg border border-input bg-background"
        />
        <button
          type="button"
          onClick={addManualLine}
          className="h-9 px-3 rounded-lg bg-muted hover:bg-accent text-xs font-medium"
        >
          ＋ Monto
        </button>
        <button
          type="button"
          title="Guardar esta línea como producto del catálogo (con código y stock de ahora en más)"
          onClick={() => openQuickCreate({ name: manualName.trim(), price: manualPrice, fromManual: true })}
          disabled={!manualName.trim() && !manualPrice}
          className="h-9 px-2 rounded-lg bg-muted hover:bg-accent text-xs font-medium disabled:opacity-50"
        >
          💾
        </button>
      </div>
      {qcReplaceKey && (
        <p className="text-[11px] text-muted-foreground pt-1">
          Al guardar se reemplaza la línea manual “{manualName.trim() || "Varios"}” por el producto real.
        </p>
      )}

      <div className="mt-3 space-y-2 pt-3 border-t border-border">
        {/* Método de entrega (default: retiro; retail defaultea directa) + venta directa (sin pedido) */}
        <div className="grid gap-1.5 grid-cols-3">
          <button
            onClick={() => setMethod("direct")}
            className={`rounded-lg py-1.5 text-xs font-medium border transition-colors ${
              method === "direct" ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground"
            }`}
          >
            ⚡ Venta directa
          </button>
          <button
            onClick={() => setMethod("pickup")}
            className={`rounded-lg py-1.5 text-xs font-medium border transition-colors ${
              method === "pickup" ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground"
            }`}
          >
            🛍️ Para retirar
          </button>
          <button
            onClick={() => { setMethod("delivery"); setClientOpen(true); }}
            className={`rounded-lg py-1.5 text-xs font-medium border transition-colors ${
              method === "delivery" ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground"
            }`}
          >
            🛵 Envío a domicilio
          </button>
        </div>

        {/* Cliente colapsado: default = consumidor final */}
        <div className="rounded-xl border border-border overflow-hidden">
          <button
            type="button"
            onClick={() => setClientOpen((v) => !v)}
            className="flex w-full items-center justify-between gap-2 px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted/50"
            aria-expanded={clientOpen}
          >
            <span className="truncate">
              👤 {customerName.trim() || customerPhone.trim()
                ? `${customerName.trim() || "Cliente"}${customerPhone.trim() ? ` · ${customerPhone.trim()}` : ""}`
                : "Cliente: Consumidor final"}
            </span>
            <span className="flex-shrink-0">{clientOpen ? "▾" : "▸"}</span>
          </button>
          {clientOpen && (
            <div className="space-y-2 px-2 pb-2">
              <input
                type="text"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Nombre del cliente (opcional)"
                className="w-full h-9 px-3 text-xs rounded-lg border border-input bg-background"
              />
              <input
                type="tel"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                placeholder={method === "delivery" ? "Teléfono del cliente *" : "Teléfono del cliente (opcional, para ficha y aviso)"}
                className="w-full h-9 px-3 text-xs rounded-lg border border-input bg-background"
              />
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={isRetail ? "📝 Notas de la venta (ej: bolsa extra, envolver para regalo)" : "📝 Instrucciones especiales (ej: sin cebolla, extra picante, cortar al medio)"}
                className="w-full h-9 px-3 text-xs rounded-lg border border-input bg-background"
              />
              {method === "delivery" && (
                <>
                  {posZonesMode ? (
                    <select
                      value={posZoneOut ? "__OUT__" : posActiveZoneId}
                      onChange={(e) => setPosZoneId(e.target.value)}
                      className="w-full h-9 px-2 text-xs rounded-lg border border-input bg-background"
                    >
                      {deliveryZones.map((z) => (
                        <option key={z.id} value={z.id}>
                          {z.name} — ${Number(z.fee).toLocaleString("es-AR")}
                        </option>
                      ))}
                      <option value="__OUT__">Otra zona (monto manual)</option>
                    </select>
                  ) : (
                    <div className="grid grid-cols-2 gap-1.5">
                      <button
                        type="button"
                        onClick={() => setPosOutOfArea(false)}
                        className={`rounded-lg py-1.5 text-[11px] font-medium border transition-colors ${
                          !posOutOfArea ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground"
                        }`}
                      >
                        Dentro{deliveryAreaText ? ` (${deliveryAreaText.slice(0, 24)}${deliveryAreaText.length > 24 ? "…" : ""})` : ""}
                      </button>
                      <button
                        type="button"
                        onClick={() => setPosOutOfArea(true)}
                        className={`rounded-lg py-1.5 text-[11px] font-medium border transition-colors ${
                          posOutOfArea ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground"
                        }`}
                      >
                        Fuera de zona
                      </button>
                    </div>
                  )}
                  {posOutOfAreaFlag && (
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      value={posManualFee}
                      onChange={(e) => setPosManualFee(e.target.value)}
                      placeholder={`Monto del envío $ (vacío = provisorio $${Number(deliveryBaseFee || 0).toLocaleString("es-AR")})`}
                      className="w-full h-9 px-3 text-xs rounded-lg border border-input bg-background"
                    />
                  )}
                  <input
                    type="text"
                    value={customerAddress}
                    onChange={(e) => setCustomerAddress(e.target.value)}
                    placeholder="Dirección de entrega"
                    className="w-full h-9 px-3 text-xs rounded-lg border border-input bg-background"
                  />
                  <input
                    type="text"
                    value={posReferences}
                    onChange={(e) => setPosReferences(e.target.value)}
                    placeholder="Referencias (opcional: casa verde, portón…)"
                    className="w-full h-9 px-3 text-xs rounded-lg border border-input bg-background"
                  />
                </>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-1.5">
          {PAYMENT_OPTIONS.map((o) => (
            <button
              key={o.key}
              onClick={() => {
                setPayment(o.key);
                if (o.key === "fiado") setClientOpen(true);
              }}
              className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                payment === o.key ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
        {payment === "fiado" && (
          <p className="text-[11px] text-amber-700">
            📓 El fiado requiere nombre y celular del cliente (bloque Cliente).
          </p>
        )}

        <div className="space-y-1 pt-1">
          {activeCashDiscount > 0 && (
            <>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Subtotal</span>
                <span className="tabular-nums">${total.toLocaleString("es-AR")}</span>
              </div>
              <div className="flex items-center justify-between text-xs font-medium text-green-600 dark:text-green-400">
                <span>💵 Desc. efectivo ({cashResult.cashPct}%)</span>
                <span className="tabular-nums">−${activeCashDiscount.toLocaleString("es-AR")}</span>
              </div>
            </>
          )}
          {method === "delivery" && (
            <>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Productos</span>
                <span className="tabular-nums">${total.toLocaleString("es-AR")}</span>
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Envío{posResolvedDelivery.zoneName ? ` (${posResolvedDelivery.zoneName})` : ""}</span>
                {posOutOfAreaFlag && !(Number(posManualFee) > 0) ? (
                  <span className="font-semibold text-amber-700">A convenir*</span>
                ) : posResolvedDelivery.freeShipping ? (
                  <span className="font-semibold text-green-600">🎉 ¡Gratis!</span>
                ) : (
                  <span className="tabular-nums">${posDeliveryFee.toLocaleString("es-AR")}{posOutOfAreaFlag ? "*" : ""}</span>
                )}
              </div>
            </>
          )}
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold">Total</span>
            <span className="font-display font-bold text-lg tabular-nums">${payableTotal.toLocaleString("es-AR")}</span>
          </div>
          {cashResult.cashPct > 0 && payment !== "efectivo" && cashResult.cashDiscount > 0 && (
            <p className="text-[11px] leading-snug text-green-700 dark:text-green-400">
              💵 Pagando en efectivo: ${(total - cashResult.cashDiscount).toLocaleString("es-AR")}
            </p>
          )}
        </div>

        {fiscalReady && (
          <button
            type="button"
            onClick={() => setWithFiscal((v) => !v)}
            className={`flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left text-xs font-medium transition-colors ${
              withFiscal
                ? "border-primary bg-primary/5 text-primary"
                : "border-border text-muted-foreground"
            }`}
            aria-pressed={withFiscal}
          >
            <span
              className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border-2 text-[12px] font-bold ${
                withFiscal ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40 text-transparent"
              }`}
              aria-hidden
            >
              ✓
            </span>
            🧾 Con comprobante fiscal (Factura C)
          </button>
        )}
        {fiscalReady && withFiscal && (
          <div className="space-y-1.5 rounded-xl border border-border p-2.5">
            <div className="flex gap-1.5">
              <select
                value={fiscalReceptorTipo}
                onChange={(e) => setFiscalReceptorTipo(e.target.value as "cf" | "dni" | "cuit")}
                className="h-9 rounded-lg border border-input bg-background px-2 text-xs"
                aria-label="Receptor del comprobante"
              >
                <option value="cf">Consumidor final</option>
                <option value="dni">DNI</option>
                <option value="cuit">CUIT</option>
              </select>
              {fiscalReceptorTipo !== "cf" && (
                <input
                  value={fiscalReceptorNro}
                  onChange={(e) => setFiscalReceptorNro(e.target.value)}
                  placeholder={fiscalReceptorTipo === "cuit" ? "CUIT (11 dígitos)" : "DNI (7-8 dígitos)"}
                  inputMode="numeric"
                  className="h-9 min-w-0 flex-1 rounded-lg border border-input bg-background px-2 text-xs"
                />
              )}
            </div>
            {fiscalReceptorTipo === "cuit" && (
              <div className="flex gap-1.5">
                <input
                  value={fiscalReceptorNombre}
                  onChange={(e) => setFiscalReceptorNombre(e.target.value)}
                  placeholder="Razón social (opcional)"
                  className="h-9 min-w-0 flex-1 rounded-lg border border-input bg-background px-2 text-xs"
                />
                <select
                  value={fiscalReceptorCond}
                  onChange={(e) => setFiscalReceptorCond(e.target.value)}
                  className="h-9 rounded-lg border border-input bg-background px-2 text-xs"
                  aria-label="Condición IVA del receptor"
                >
                  <option value="6">Monotributo</option>
                  <option value="1">Resp. Inscripto</option>
                  <option value="4">Exento</option>
                </select>
              </div>
            )}
            {fiscalReceptorTipo === "cf" && payableTotal >= 10000000 && (
              <p className="text-[11px] text-amber-700">
                ⚠️ ARCA exige identificar al comprador desde $10.000.000: cargá DNI o CUIT.
              </p>
            )}
          </div>
        )}
        {restored && (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
            <p className="text-xs font-medium text-primary">Recuperamos tu venta en curso</p>
            <button
              type="button"
              onClick={discardDraft}
              className="text-xs font-medium text-muted-foreground hover:text-foreground underline flex-shrink-0"
            >
              Descartar
            </button>
          </div>
        )}
        {msg && (
          <p
            ref={msgRef}
            className={`text-sm rounded-lg px-3 py-2 ${msgIsErr ? "text-red-700 bg-red-50" : "text-green-600 bg-green-50"}`}
          >
            {msg}
          </p>
        )}
        {shiftBlocked && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            🔒 Abrí la caja para cobrar.{" "}
            <button type="button" className="underline font-semibold" onClick={() => window.dispatchEvent(new Event("portal:go-caja"))}>
              Ir a la caja →
            </button>
          </div>
        )}
        {method === "direct" ? (
          <>
          <Button
            className="w-full"
            disabled={items.length === 0 || saving || shiftBlocked}
            onClick={() => charge(true)}
            title={finePointer ? "Atajo: apretá Enter dos veces para cobrar" : undefined}
          >
            {saving ? "Cobrando..." : <>Cobrar{finePointer && <span className="opacity-70 font-normal"> ⏎⏎</span>}</>}
          </Button>
          <Button
            className="w-full"
            variant="outline"
            disabled={items.length === 0 || saving || shiftBlocked}
            onClick={() => charge(false)}
          >
            Cobrar sin comprobante
          </Button>
          </>
        ) : (
          <>
            <Button className="w-full" disabled={items.length === 0 || saving || shiftBlocked} onClick={() => charge(true)}>
              {saving ? "Cobrando..." : method === "pickup" ? (isRetail ? "Cobrar + comprobante" : "Cobrar + comprobante de retiro") : "Cobrar y despachar"}
            </Button>
            <Button className="w-full" variant="outline" disabled={items.length === 0 || saving || shiftBlocked} onClick={() => charge(false)}>
              {method === "pickup" ? "Cobrar sin comprobante" : "Cobrar sin imprimir comprobante"}
            </Button>
          </>
        )}
      </div>
    </>
  );

  return (
    <div className="space-y-4">
      {fiscalPrintId && (
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          disabled={fiscalPrinting}
          onClick={async () => {
            setFiscalPrinting(true);
            try {
              const res = await fetch("/api/print", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ orderId: fiscalPrintId, type: "ticket" }),
              });
              const data = await res.json().catch(() => ({}));
              setMsg(
                data.ok || data.skipped
                  ? `${msg} · 🖨️ Ticket fiscal impreso ✓`
                  : `${msg} · ⚠️ No se pudo imprimir: ${data.error || "revisá la impresora"}`
              );
              if (data.ok) setFiscalPrintId(null);
            } catch {
              setMsg(`${msg} · ⚠️ Sin conexión con la impresora`);
            }
            setFiscalPrinting(false);
          }}
        >
          {fiscalPrinting ? "🖨️ Imprimiendo…" : "🖨️ Imprimir factura fiscal"}
        </Button>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_360px] gap-4 items-start">
        <div className="min-w-0">{productsGrid}</div>

        {/* Desktop sidebar: fija a altura de pantalla con scroll interno */}
        <div className="hidden sm:flex rounded-2xl border border-border bg-card p-4 flex-col max-h-[70vh] lg:sticky lg:top-24 lg:h-[calc(100vh-12rem)] lg:max-h-none">
          <h3 className="font-display font-semibold text-sm mb-2 flex-shrink-0">Pedido actual</h3>
          {orderSummary}
        </div>
      </div>

      {/* Mobile bottom bar */}
      {items.length > 0 && (
        <div className="sm:hidden fixed bottom-14 left-0 right-0 z-40 px-3 pb-3">
          <button
            onClick={() => setSheetOpen(true)}
            className="w-full flex items-center justify-between rounded-xl bg-primary text-primary-foreground px-4 py-3 shadow-lg"
          >
            <span className="text-sm font-semibold">{items.length} {items.length === 1 ? "producto" : "productos"}</span>
            <span className="text-base font-bold">${payableTotal.toLocaleString("es-AR")}</span>
          </button>
        </div>
      )}

      {/* Mobile fullscreen modal del pedido */}
      {sheetOpen && (
        <div className="sm:hidden fixed inset-0 z-[60] bg-background flex flex-col">
          <header className="relative flex items-center border-b border-border px-3 py-3">
            {/* Volver/agregar más productos: mismo patrón que el modal de Mesas */}
            <button
              onClick={() => setSheetOpen(false)}
              className="shrink-0 h-8 w-8 rounded-full hover:bg-muted flex items-center justify-center text-muted-foreground"
              aria-label="Volver y agregar más productos"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div className="flex-1 min-w-0 text-center">
              <h3 className="font-display font-semibold leading-tight">Pedido actual</h3>
              <p className="text-[11px] text-muted-foreground">{items.length} {items.length === 1 ? "producto" : "productos"} · ${total.toLocaleString("es-AR")}</p>
            </div>
            <button
              onClick={() => setItems([])}
              disabled={items.length === 0}
              className="shrink-0 h-8 px-2 rounded-lg text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-40"
            >
              Limpiar
            </button>
          </header>
          <div className="flex-1 overflow-y-auto p-4 flex flex-col pb-[calc(env(safe-area-inset-bottom,0px)+1rem)]">
            {orderSummary}
          </div>
        </div>
      )}

      {recent.length > 0 && (
        <div className="rounded-2xl border border-border bg-card p-4">
          <h3 className="font-display font-semibold text-sm mb-3">Ventas de hoy en mostrador</h3>
          <div className="space-y-1.5">
            {recent.map((o) => {
              const canConvert =
                !o.pending &&
                (o.method !== "delivery") &&
                o.status !== "completed" &&
                o.status !== "cancelled";
              return (
                <div key={o.id} className="space-y-2">
                  <div className="flex items-center justify-between text-xs gap-2">
                    <div className="flex items-center gap-2 min-w-0 flex-wrap">
                      <Badge variant="secondary" className="text-[9px]">{o.payment_method}</Badge>
                      {o.pending ? (
                        <Badge className="text-[9px] bg-amber-100 text-amber-800">
                          📡 P-{o.provisional} · pendiente{o.estimated ? " (est.)" : ""}
                        </Badge>
                      ) : (
                        o.pickup_number != null && (
                          <Badge className="text-[9px] bg-status-new/15 text-status-new">Nro. {o.pickup_number}</Badge>
                        )
                      )}
                      {o.method === "delivery" && (
                        <Badge className="text-[9px] bg-blue-100 text-blue-700">🛵 A domicilio</Badge>
                      )}
                      <span className="text-muted-foreground truncate">{o.customer_name || "Mostrador"}</span>
                      <span className="text-muted-foreground/60 shrink-0">{new Date(o.created_at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}</span>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {canConvert && (
                        <button
                          type="button"
                          title="Convertir a envío a domicilio"
                          onClick={() => {
                            if (convertOrderId === o.id) { setConvertOrderId(null); return; }
                            setConvertOrderId(o.id); setConvertPhone(""); setConvertAddress("");
                            setConvertReferences(""); setConvertZoneId(""); setConvertOutOfArea(false); setConvertManualFee("");
                          }}
                          className="h-6 w-6 rounded-md bg-blue-50 text-blue-600 border border-blue-200 hover:bg-blue-100 flex items-center justify-center text-xs"
                        >
                          🛵
                        </button>
                      )}
                      <span className="font-semibold tabular-nums">${Number(o.total).toLocaleString("es-AR")}</span>
                    </div>
                  </div>
                  {convertOrderId === o.id && (
                    <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-2 space-y-1.5">
                      <p className="text-[10px] font-semibold text-blue-800">Enviar este pedido a domicilio</p>
                      <input
                        type="tel"
                        value={convertPhone}
                        onChange={(e) => setConvertPhone(e.target.value)}
                        placeholder="Teléfono del cliente *"
                        className="w-full h-8 px-2 text-xs rounded-lg border border-input bg-background"
                      />
                      <input
                        type="text"
                        value={convertAddress}
                        onChange={(e) => setConvertAddress(e.target.value)}
                        placeholder="Dirección de entrega (opcional)"
                        className="w-full h-8 px-2 text-xs rounded-lg border border-input bg-background"
                      />
                      <input
                        type="text"
                        value={convertReferences}
                        onChange={(e) => setConvertReferences(e.target.value)}
                        placeholder="Referencias (opcional)"
                        className="w-full h-8 px-2 text-xs rounded-lg border border-input bg-background"
                      />
                      {posZonesMode ? (
                        <select
                          value={convertZoneId === "__OUT__" ? "__OUT__" : convertZoneId || deliveryZones[0]?.id || ""}
                          onChange={(e) => setConvertZoneId(e.target.value)}
                          className="w-full h-8 px-1 text-xs rounded-lg border border-input bg-background"
                        >
                          {deliveryZones.map((z) => (
                            <option key={z.id} value={z.id}>
                              {z.name} — ${Number(z.fee).toLocaleString("es-AR")}
                            </option>
                          ))}
                          <option value="__OUT__">Otra zona (monto manual)</option>
                        </select>
                      ) : (
                        <div className="grid grid-cols-2 gap-1.5">
                          <button
                            type="button"
                            onClick={() => setConvertOutOfArea(false)}
                            className={`rounded-lg py-1 text-[11px] font-medium border ${!convertOutOfArea ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground"}`}
                          >
                            Dentro
                          </button>
                          <button
                            type="button"
                            onClick={() => setConvertOutOfArea(true)}
                            className={`rounded-lg py-1 text-[11px] font-medium border ${convertOutOfArea ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground"}`}
                          >
                            Fuera de zona
                          </button>
                        </div>
                      )}
                      {(convertZoneId === "__OUT__" || (!posZonesMode && convertOutOfArea)) && (
                        <input
                          type="number"
                          inputMode="decimal"
                          min="0"
                          value={convertManualFee}
                          onChange={(e) => setConvertManualFee(e.target.value)}
                          placeholder="Monto del envío $ (vacío = provisorio)"
                          className="w-full h-8 px-2 text-xs rounded-lg border border-input bg-background"
                        />
                      )}
                      <div className="flex gap-1.5">
                        <Button size="sm" className="h-7 text-xs flex-1" disabled={converting} onClick={() => convertToDelivery(o.id)}>
                          {converting ? "..." : "Confirmar envío"}
                        </Button>
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setConvertOrderId(null)}>Cancelar</Button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {pickerProduct && (
        <ModifierPicker
          modifiers={modifiersMap[pickerProduct.id] || []}
          productName={pendingVariant ? `${pickerProduct.name} (${pendingVariant.color} · ${pendingVariant.talle})` : pickerProduct.name}
          basePrice={pendingVariant ? Number(pendingVariant.promo ?? pendingVariant.price) : unitPriceOf(pickerProduct)}
          onConfirm={handleModConfirm}
          onCancel={() => { setPickerProduct(null); setPendingVariant(null); }}
        />
      )}

      {variantPicker && (
        <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/50 p-4" onClick={() => setVariantPicker(null)}>
          <div className="w-full max-w-sm rounded-2xl bg-card border border-border p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-1">
              <h3 className="font-display text-base font-semibold">{variantPicker.name}</h3>
              <button onClick={() => setVariantPicker(null)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground" aria-label="Cerrar">✕</button>
            </div>
            <p className="text-xs text-muted-foreground mb-3">Elegí color y talle</p>
            <div className="space-y-1.5 max-h-72 overflow-y-auto">
              {(variantsMap[variantPicker.id] || []).map((v) => {
                const stock = Math.max(0, Math.floor(Number(v.stock ?? 0)));
                const price = Number(v.promo ?? v.price);
                return (
                  <button
                    key={v.id}
                    disabled={stock <= 0}
                    onClick={() => chooseVariant(variantPicker, v)}
                    className="w-full flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm text-left hover:border-primary disabled:opacity-40"
                  >
                    <span className="flex-1 min-w-0">
                      <span className="font-medium">{v.color} · {v.talle}</span>
                      <span className="block text-[11px] text-muted-foreground">
                        {stock <= 0 ? "Sin stock" : stock <= 5 ? `¡Quedan ${stock}!` : `Stock: ${stock}`}
                      </span>
                    </span>
                    <span className="tabular-nums font-semibold">
                      {v.promo != null && (
                        <span className="mr-1.5 text-xs text-muted-foreground line-through font-normal">
                          ${Number(v.price).toLocaleString("es-AR")}
                        </span>
                      )}
                      ${price.toLocaleString("es-AR")}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
