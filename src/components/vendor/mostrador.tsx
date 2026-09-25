"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ModifierPicker } from "@/components/offers/modifier-picker";
import { ProductPickCard } from "@/components/vendor/product-pick-card";
import { cashDiscountForItems, normalizeCashPct } from "@/lib/cash-discount";
import { toE164 } from "@/lib/phone";
import { getCatalogSnapshot, saveCatalogSnapshot } from "@/lib/offline-db";
import { enqueueOfflineAction, isNetworkError, newClientKey, nextProvisionalNumber } from "@/lib/offline-actions";
import { checkOfflineAllowed, offlineDeniedMsg } from "@/lib/offline-plan";
import { dispatchOfflinePrint, markPrintsDone } from "@/lib/local-print";
import { printsAdd } from "@/lib/offline-db";
import type { ContingencyKind } from "@/lib/offline-print";

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
];

export function Mostrador({ vendorId }: { vendorId?: string | null }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [items, setItems] = useState<LineItem[]>([]);
  const [payment, setPayment] = useState("efectivo");
  const [customerName, setCustomerName] = useState("");
  const [method, setMethod] = useState<"pickup" | "delivery">("pickup");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
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
  const [converting, setConverting] = useState(false);
  const [notes, setNotes] = useState("");
  // % descuento en efectivo del comercio (0 = sin descuento).
  const [cashPct, setCashPct] = useState(0);
  // Retail (comercio/moda): textos sin referencias a cocina/comida.
  const [isRetail, setIsRetail] = useState(false);
  // Fiscal ARCA (plan Gestión + config completa): toggle por venta.
  const [fiscalReady, setFiscalReady] = useState(false);
  const [withFiscal, setWithFiscal] = useState(false);
  // Pedido con CAE listo para reimprimir con bloque fiscal (el ticket que
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
  const payableTotal = Math.max(0, Math.round((total - activeCashDiscount) * 100) / 100);

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
    const q = query.toLowerCase();
    return products.filter(
      (p) =>
        (!q || p.name.toLowerCase().includes(q)) &&
        (!activeCat || normCat(p.category) === activeCat)
    );
  }, [products, query, activeCat]);

  function add(p: Product) {
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
    // Capado a stock de la variante en cliente (el servidor valida igual).
    const maxStock = v ? Math.max(0, Math.floor(Number(v.stock ?? 0))) : null;
    setItems((prev) => {
      const found = prev.find((i) => lineKey(i.product_id, i.variant_id, i.modifiers) === key);
      if (found) {
        if (maxStock != null && found.qty + qty > maxStock) return prev;
        return prev.map((i) => (i === found ? { ...i, qty: i.qty + qty } : i));
      }
      if (maxStock != null && qty > maxStock) return prev;
      return [...prev, {
        product_id: p.id, variant_id: v?.id, name, price: unitPrice, qty,
        requires_prep: p.requires_prep !== false, modifiers,
        hasPromo: v ? v.promo != null : p.promo_price != null,
        cashExcluded: p.cash_discount_excluded === true,
        packSize: packOf(p),
      }];
    });
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

  async function charge(withReceipt: boolean) {
    if (items.length === 0) return;

    const isDelivery = method === "delivery";
    // Misma validación que el checkout del cliente: celular real (WhatsApp).
    const deliveryPhoneE164 = isDelivery ? toE164(customerPhone) : null;
    if (isDelivery && !deliveryPhoneE164) {
      setMsg("El envío a domicilio requiere el celular del cliente (ej: 11 5555 1234)");
      return;
    }

    // Solo entra a cocina si al menos un ítem requiere elaboración.
    const needsKitchen = items.some((i) => i.requires_prep !== false);

    // El client_key viaja SIEMPRE (online también): un timeout con reintento
    // no duplica gracias a la idempotencia del servidor (Fase 0).
    const payload = {
      items: items.map((i) => ({ ...i, modifiers: (i.modifiers || []).map((m) => m.label) })),
      total,
      paymentMethod: payment,
      customerName: customerName || "Mostrador",
      method,
      customerPhone: isDelivery ? deliveryPhoneE164 : undefined,
      customerAddress: isDelivery ? customerAddress : undefined,
      notes: notes.trim() || null,
      client_key: newClientKey(),
      occurred_at: new Date().toISOString(),
    };

    const clearSaleForm = () => {
      setItems([]);
      setCustomerName("");
      setCustomerPhone("");
      setCustomerAddress("");
      setNotes("");
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
      if (needsKitchen) {
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
        offMsg += printedCount === printDocs.length ? " · 🖨️ impresa local" : " · 🖨️ comprobante en cola";
      }
      if (withFiscal && fiscalReady) offMsg += " · 🧾 sin factura (requiere conexión)";
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

    // Retail: comprobante de venta (ticket con ítems y total). Gastro: comanda
    // si requiere cocina y recién al terminar el stub de retiro (evita dos
    // trabajos concurrentes a la impresora).
    const printSaleDoc = (): Promise<void> => {
      if (withReceipt && !isDelivery) {
        return fetch("/api/print", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId: data.orderId, type: isRetail ? "ticket" : "retiro" }),
        }).then(() => {});
      }
      return Promise.resolve();
    };
    // Comanda de cocina: sale al instante siempre (la cocina no espera al CAE).
    // El ticket al cliente sale después: junto al CAE si hay fiscal, o
    // encadenado a la comanda como antes si no hay.
    const wantFiscalTicket = withFiscal && fiscalReady && data.orderId && withReceipt && !isDelivery;
    if (needsKitchen) {
      const comanda = fetch("/api/print", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: data.orderId, type: "comanda" }),
      });
      if (!wantFiscalTicket) comanda.then(printSaleDoc).catch(() => {});
      else comanda.catch(() => {});
    }

    // El servidor recalcula el descuento en efectivo (pos/order): el total
    // cobrado real viene en data.order.total.
    const netTotal = Number(data.order?.total ?? total);
    const baseMsg = isDelivery
      ? "Pedido a domicilio registrado"
      : `Cobrado $${netTotal.toLocaleString("es-AR")}${withReceipt ? (isRetail ? " · comprobante" : " · comprobante de retiro") : ""}`;
    setMsg(baseMsg);
    clearSaleForm();
    setFiscalPrintId(null);

    // Fiscal opt-in por venta: se espera el CAE (hasta 60s) y se imprime UN
    // solo ticket ya con Factura C + QR. La cocina ya recibió su comanda.
    const wantFiscal = withFiscal && fiscalReady && data.orderId;
    if (wantFiscal) {
      const fiscalOrderId = data.orderId as string;
      setMsg(`${baseMsg} · 🧾 Facturando en ARCA…`);
      try {
        const fres = await fetch("/api/vendor/fiscal/emitir", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId: fiscalOrderId }),
          signal: AbortSignal.timeout(60000),
        });
        const fdata = await fres.json().catch(() => ({}));
        if (fres.ok && fdata.invoice) {
          const inv = fdata.invoice;
          const fiscalMsg =
            `${baseMsg} · 🧾 Factura C ${String(inv.punto_venta).padStart(4, "0")}-${String(inv.cbte_nro).padStart(8, "0")} (CAE …${String(inv.cae).slice(-4)})`;
          if (wantFiscalTicket) {
            // Un solo paso: el ticket sale con el bloque fiscal incluido.
            try {
              await fetch("/api/print", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ orderId: fiscalOrderId, type: "ticket" }),
              });
              setMsg(`${fiscalMsg} · 🖨️ Impreso ✓`);
            } catch {
              setMsg(`${fiscalMsg} · ⚠️ No se pudo imprimir`);
              setFiscalPrintId(fiscalOrderId);
            }
          } else {
            setMsg(fiscalMsg);
          }
        } else if (fdata.error) {
          const hint = fdata.hint ? ` 💡 ${fdata.hint}` : "";
          setMsg(`${baseMsg} · ⚠️ Cobrado sin fiscal: ${fdata.error}${hint} (reintentá desde Config → Fiscal)`);
          if (wantFiscalTicket) printSaleDoc().catch(() => {});
        } else {
          // Respuesta vacía o timeout: el CAE puede llegar igual en el
          // server; sale el comprobante común y queda reimpresión fiscal.
          setMsg(`${baseMsg} · ⚠️ Cobrado sin fiscal confirmado: ARCA tardó demasiado (revisá el detalle del pedido)`);
          if (wantFiscalTicket) printSaleDoc().catch(() => {});
          setFiscalPrintId(fiscalOrderId);
        }
      } catch {
        setMsg(`${baseMsg} · ⚠️ Cobrado sin fiscal confirmado: sin conexión (reintentá desde Config → Fiscal)`);
        if (wantFiscalTicket) printSaleDoc().catch(() => {});
        setFiscalPrintId(fiscalOrderId);
      }
    } else if (!needsKitchen) {
      printSaleDoc().catch(() => {});
    }
    setRecent((prev) =>
      [{ id: data.orderId, total: Number(data.order?.total ?? total), payment_method: data.order?.payment_method ?? payment, paid_at: data.order?.paid_at ?? new Date().toISOString(), status: data.order?.status ?? "preparing", created_at: data.order?.created_at ?? new Date().toISOString(), pickup_number: data.order?.pickup_number ?? null, method: data.order?.method ?? method }, ...prev].slice(0, 20)
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
      const res = await fetch(`/api/vendor/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method: "delivery", customer_phone: convertPhoneE164, customer_address: convertAddress.trim() || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        setMsg(data.error || "No se pudo convertir a domicilio");
      } else {
        setRecent((prev) =>
          prev.map((o) =>
            o.id === orderId ? { ...o, method: "delivery" } : o
          )
        );
        setConvertOrderId(null);
        setConvertPhone("");
        setConvertAddress("");
        setMsg("Pedido convertido a envío a domicilio");
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
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar producto..."
          className="w-full h-10 px-3 text-sm rounded-xl border border-input bg-background"
        />
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
    </div>
  );

  const orderSummary = (
    <>
      <div className="flex-1 space-y-1.5 min-h-0 overflow-y-auto">
        {items.length === 0 && <p className="text-xs text-muted-foreground text-center py-6">Tocá productos para armar el pedido</p>}
        {items.map((i) => (
          <div key={lineKey(i.product_id, i.variant_id, i.modifiers)} className="flex items-center gap-2 text-sm">
            <span className="flex-1 min-w-0 line-clamp-2 break-words">
              {i.name}
              {(i.modifiers || []).length > 0 && (
                <span className="block text-[10px] text-muted-foreground truncate">
                  {(i.modifiers || []).map((m) => m.label).join(", ")}
                </span>
              )}
            </span>
            <div className="flex items-center gap-1">
              <button onClick={() => changeQty(lineKey(i.product_id, i.variant_id, i.modifiers), -1)} className="h-6 w-6 rounded-md bg-muted hover:bg-accent">−</button>
              <span className="w-5 text-center tabular-nums">{i.qty}</span>
              <button onClick={() => changeQty(lineKey(i.product_id, i.variant_id, i.modifiers), 1)} className="h-6 w-6 rounded-md bg-muted hover:bg-accent">+</button>
            </div>
            <span className="w-16 text-right tabular-nums">${(Math.round(i.price * i.qty * 100) / 100).toLocaleString("es-AR")}</span>
          </div>
        ))}
      </div>

      <div className="mt-3 space-y-2 pt-3 border-t border-border">
        {/* Método de entrega */}
        <div className="grid grid-cols-2 gap-1.5">
          <button
            onClick={() => setMethod("pickup")}
            className={`rounded-lg py-1.5 text-xs font-medium border transition-colors ${
              method === "pickup" ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground"
            }`}
          >
            🛍️ Para retirar
          </button>
          <button
            onClick={() => setMethod("delivery")}
            className={`rounded-lg py-1.5 text-xs font-medium border transition-colors ${
              method === "delivery" ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground"
            }`}
          >
            🛵 Envío a domicilio
          </button>
        </div>

        <input
          type="text"
          value={customerName}
          onChange={(e) => setCustomerName(e.target.value)}
          placeholder="Nombre del cliente (opcional)"
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
            <input
              type="text"
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value)}
              placeholder="Teléfono del cliente *"
              className="w-full h-9 px-3 text-xs rounded-lg border border-input bg-background"
            />
            <input
              type="text"
              value={customerAddress}
              onChange={(e) => setCustomerAddress(e.target.value)}
              placeholder="Dirección de entrega *"
              className="w-full h-9 px-3 text-xs rounded-lg border border-input bg-background"
            />
          </>
        )}

        <div className="flex flex-wrap gap-1.5">
          {PAYMENT_OPTIONS.map((o) => (
            <button
              key={o.key}
              onClick={() => setPayment(o.key)}
              className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                payment === o.key ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>

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
        <Button className="w-full" disabled={items.length === 0 || saving} onClick={() => charge(true)}>
          {saving ? "Cobrando..." : method === "pickup" ? (isRetail ? "Cobrar + comprobante" : "Cobrar + comprobante de retiro") : "Cobrar y despachar"}
        </Button>
        <Button className="w-full" variant="outline" disabled={items.length === 0 || saving} onClick={() => charge(false)}>
          {method === "pickup" ? "Cobrar sin comprobante" : "Cobrar sin imprimir comprobante"}
        </Button>
      </div>
    </>
  );

  return (
    <div className="space-y-4">
      {msg && <p className="text-sm text-green-600 bg-green-50 rounded-lg px-3 py-2">{msg}</p>}
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