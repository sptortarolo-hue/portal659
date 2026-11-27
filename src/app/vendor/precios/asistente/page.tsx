"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getJson } from "@/components/dashboard/shared";
import { CategorySelect, type CategoryOption } from "@/components/dashboard/category-select";
import { loadDraft, saveDraft } from "@/lib/draft";
import { getPricingStatus } from "@/lib/pricing-status";

type Product = {
  id: string;
  name: string;
  price?: number | null;
  cost_last?: number | null;
  margin_list_id?: string | null;
  price_source?: string | null;
  pricing_skipped?: unknown;
  is_combo?: boolean | null;
  sku?: string | null;
  stock?: number | null;
};
type ListRow = { id: string; name: string; rule: string; pct: number };
type ExtractedItem = {
  description: string;
  qty: number;
  unit: string;
  unit_price: number;
  unit_price_net?: number;
  unit_price_total?: number;
  line_total?: number;
  iva_discriminado?: boolean;
  bestMatch?: { id: string; name: string; kind: string };
};
type Extracted = {
  supplier_name?: string | null;
  receipt_number?: string | null;
  receipt_type?: string | null;
  purchased_at?: string | null;
  items?: ExtractedItem[];
};
type CreatedLine = { id: string; qty: number; cost: number };
type GuideDraft = {
  step: number;
  extracted: Extracted | null;
  url: string | null;
  fileHash: string | null;
  lineIndex: number;
  createdLines: CreatedLine[];
  savedPurchaseId: string | null;
  ivaRecuperable: boolean;
  duplicateOverride: boolean;
  selectedCostId: string | null;
  selectedListId: string | null;
  selectedPriceId: string | null;
};

const STEPS = [
  { n: 1, title: "Factura", hint: "Subí el comprobante del proveedor." },
  { n: 2, title: "Productos", hint: "Creá los artículos que encontramos." },
  { n: 3, title: "Costo y stock", hint: "Cargá el costo de compra." },
  { n: 4, title: "Listas", hint: "Elegí la lista de margen." },
  { n: 5, title: "Precios", hint: "Calculá el precio de venta." },
];

function relevant(p: Product) {
  return !p.is_combo && !(p.sku || "").startsWith("GC-");
}

function PendingChips<T>({
  items,
  getKey,
  getLabel,
  selectedKey,
  onSelect,
  emptyText,
}: {
  items: T[];
  getKey: (item: T) => string;
  getLabel: (item: T) => string;
  selectedKey: string | null;
  onSelect: (key: string) => void;
  emptyText: string;
}) {
  if (items.length === 0) return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  return (
    <div className="rounded-xl border border-border bg-muted/30 p-2 space-y-1.5">
      <p className="text-xs font-medium">Faltan {items.length} — elegí cuál completar</p>
      <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
        {items.map((item) => {
          const key = getKey(item);
          const selected = key === selectedKey;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onSelect(key)}
              title={getLabel(item)}
              className={`max-w-[170px] truncate rounded-full border px-2.5 py-1 text-xs transition-colors ${
                selected
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background hover:bg-muted"
              }`}
            >
              {getLabel(item)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function PricingGuidePage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [lists, setLists] = useState<ListRow[]>([]);
  const [vendorId, setVendorId] = useState<string | null>(null);
  const [step, setStep] = useState(1);
  const [extracted, setExtracted] = useState<Extracted | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [fileHash, setFileHash] = useState<string | null>(null);
  const [lineIndex, setLineIndex] = useState(0);
  const [createdLines, setCreatedLines] = useState<CreatedLine[]>([]);
  const [savedPurchaseId, setSavedPurchaseId] = useState<string | null>(null);
  const [ivaRecuperable, setIvaRecuperable] = useState(false);
  const [duplicateOverride, setDuplicateOverride] = useState(false);
  const [duplicateInfo, setDuplicateInfo] = useState<any | null>(null);
  const [selectedCostId, setSelectedCostId] = useState<string | null>(null);
  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const [selectedPriceId, setSelectedPriceId] = useState<string | null>(null);

  const [listChoice, setListChoice] = useState("");
  const [categoryChoice, setCategoryChoice] = useState("");
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [costInput, setCostInput] = useState("");
  const [suggested, setSuggested] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function reloadProducts() {
    const d = await getJson<{ offers?: Product[] }>("/api/vendor/offers").catch(() => null);
    setProducts(d?.offers || []);
  }

  useEffect(() => {
    Promise.all([
      getJson<{ vendor?: { id: string; iva_recuperable?: boolean | null } }>("/api/vendor/me").catch(() => null),
      getJson<{ offers?: Product[] }>("/api/vendor/offers").catch(() => null),
      getJson<{ lists?: ListRow[] }>("/api/vendor/margin-lists").catch(() => null),
      getJson<{ categories?: CategoryOption[] }>("/api/vendor/categories").catch(() => null),
    ]).then(([me, off, ml, cats]) => {
      setVendorId(me?.vendor?.id || null);
      setIvaRecuperable(me?.vendor?.iva_recuperable === true);
      setProducts(off?.offers || []);
      setLists(ml?.lists || []);
      setCategories(cats?.categories || []);
      const draft = loadDraft<GuideDraft>(me?.vendor?.id, "pricing-guide");
      if (draft) {
        setStep(draft.step || 1);
        setExtracted(draft.extracted || null);
        setUrl(draft.url || null);
        setFileHash(draft.fileHash || null);
        setLineIndex(draft.lineIndex || 0);
        setCreatedLines(draft.createdLines || []);
        setSavedPurchaseId(draft.savedPurchaseId || null);
        setIvaRecuperable(!!draft.ivaRecuperable);
        setDuplicateOverride(!!draft.duplicateOverride);
        setSelectedCostId(draft.selectedCostId || null);
        setSelectedListId(draft.selectedListId || null);
        setSelectedPriceId(draft.selectedPriceId || null);
      } else {
        const prods = off?.offers || [];
        const missingCost = prods.filter((p) => relevant(p) && p.cost_last == null).length;
        const missingList = prods.filter((p) => relevant(p) && p.cost_last != null && !p.margin_list_id && !getPricingStatus(p).skipped.list).length;
        const missingPrice = prods.filter((p) => relevant(p) && p.cost_last != null && (p.margin_list_id || getPricingStatus(p).skipped.list) && (!p.price || Number(p.price) <= 0)).length;
        setStep(prods.length === 0 ? 1 : missingCost > 0 ? 3 : missingList > 0 ? 4 : missingPrice > 0 ? 5 : 5);
      }
    });
  }, []);

  useEffect(() => {
    if (vendorId) {
      const draft: GuideDraft = {
        step, extracted, url, fileHash, lineIndex, createdLines, savedPurchaseId,
        ivaRecuperable, duplicateOverride, selectedCostId, selectedListId, selectedPriceId,
      };
      saveDraft(vendorId, "pricing-guide", draft);
    }
  }, [vendorId, step, extracted, url, fileHash, lineIndex, createdLines, savedPurchaseId, ivaRecuperable, duplicateOverride, selectedCostId, selectedListId, selectedPriceId]);

  const missingCost = useMemo(
    () => products.filter((p) => relevant(p) && p.cost_last == null),
    [products]
  );
  const missingList = useMemo(
    () => products.filter((p) => relevant(p) && p.cost_last != null && !p.margin_list_id && !getPricingStatus(p).skipped.list),
    [products]
  );
  const missingPrice = useMemo(
    () => products.filter((p) => relevant(p) && p.cost_last != null && (p.margin_list_id || getPricingStatus(p).skipped.list) && (!p.price || Number(p.price) <= 0)),
    [products]
  );

  const done = useMemo(() => {
    const lines = extracted?.items || [];
    return {
      1: !!extracted || products.length > 0,
      2: !extracted || lineIndex >= lines.length,
      3: missingCost.length === 0 && products.length > 0,
      4: missingList.length === 0 && products.length > 0,
      5: missingPrice.length === 0 && products.length > 0,
    } as Record<number, boolean>;
  }, [extracted, lineIndex, missingCost, missingList, missingPrice, products]);

  function pickById(list: Product[], id: string | null): Product | null {
    return list.find((p) => p.id === id) || list[0] || null;
  }

  const currentLine = extracted?.items?.[lineIndex] || null;
  const currentCostProduct = pickById(missingCost, selectedCostId);
  const currentListProduct = pickById(missingList, selectedListId);
  const currentPriceProduct = pickById(missingPrice, selectedPriceId);

  useEffect(() => {
    setCostInput(currentCostProduct?.cost_last != null ? String(currentCostProduct.cost_last) : "");
    setListChoice(lists[0]?.id || "");
    setSuggested(null);
    setMsg("");
  }, [currentCostProduct?.id, currentListProduct?.id, currentPriceProduct?.id, lists]);

  function go(n: number) { setStep(n); setMsg(""); setSuggested(null); }

  function setIva(value: boolean) {
    setIvaRecuperable(value);
    if (vendorId) {
      fetch("/api/vendor/me", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ iva_recuperable: value }),
      }).catch(() => {});
    }
  }

  function costForLine(item: ExtractedItem): number {
    const net = Number(item.unit_price_net ?? item.unit_price ?? 0);
    const total = Number(item.unit_price_total ?? item.unit_price ?? 0);
    return Math.round((ivaRecuperable ? net : total) * 10000) / 10000;
  }

  async function handleFile(file: File) {
    setBusy(true); setMsg("");
    const fd = new FormData();
    fd.append("file", file);
    fd.append("folder", "purchases");
    try {
      const res = await fetch("/api/vendor/purchases/extract", { method: "POST", body: fd });
      const text = await res.text();
      let data: any = {};
      try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text.slice(0, 200) }; }
      if (!res.ok) return setMsg(data?.error || "No se pudo leer la factura");
      setExtracted(data.extracted || null);
      setUrl(data.url || null);
      setFileHash(data.fileHash || null);
      setLineIndex(0);
      setCreatedLines([]);
      setSavedPurchaseId(null);
      setDuplicateInfo(data.duplicate || null);
      setDuplicateOverride(false);
      setMsg(`Factura leída: ${data.extracted?.items?.length || 0} líneas.`);
      go(2);
    } catch {
      setMsg("No se pudo subir la factura");
    } finally { setBusy(false); }
  }

  async function createCurrentLine() {
    if (!currentLine) return;
    setBusy(true); setMsg("");
    const cost = costForLine(currentLine);
    try {
      const res = await fetch("/api/vendor/offers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: currentLine.description || "Producto sin nombre",
          price: 0,
          from_invoice: true,
          cost_last: cost,
          margin_list_id: listChoice || null,
          price_source: listChoice ? "lista" : "manual",
          pricing_skipped: listChoice ? undefined : { list: "Precio manual" },
          supplier_name: extracted?.supplier_name || null,
          category: categoryChoice || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "No se pudo crear el producto");
      if (data?.offer?.id) setCreatedLines((prev) => [...prev, { id: String(data.offer.id), qty: Number(currentLine.qty) || 1, cost }]);
      setLineIndex((i) => i + 1);
      await reloadProducts();
      setMsg("Producto creado. Vamos con el siguiente.");
    } catch (e: any) {
      setMsg(e?.message || "No se pudo crear el producto");
    } finally { setBusy(false); }
  }

  function skipCurrentLine() {
    setLineIndex((i) => i + 1);
    setMsg("Línea omitida.");
  }

  async function savePurchase() {
    setBusy(true); setMsg("");
    try {
      let supplierId: string | null = null;
      const name = String(extracted?.supplier_name || "").trim();
      if (name) {
        const sr = await fetch("/api/vendor/suppliers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });
        const sd = await sr.json().catch(() => ({}));
        if (sr.ok && sd?.supplier?.id) supplierId = String(sd.supplier.id);
      }
      const res = await fetch("/api/vendor/purchases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplier_id: supplierId,
          purchased_at: extracted?.purchased_at || undefined,
          receipt_type: extracted?.receipt_type || "ninguno",
          receipt_number: extracted?.receipt_number || null,
          attachment_urls: url ? [url] : undefined,
          source_hash: fileHash || undefined,
          iva_recuperable: ivaRecuperable,
          allow_duplicate: duplicateOverride,
          duplicate_reason: duplicateOverride ? "Cargada desde el asistente de precios" : undefined,
          items: createdLines.map((l) => ({ product_id: l.id, qty: l.qty, unit_cost: l.cost })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data?.duplicate) setDuplicateInfo(data.duplicate);
        throw new Error(data?.error || "No se pudo guardar la compra");
      }
      setSavedPurchaseId(data.purchase_id || "ok");
      setDuplicateInfo(null);
      await reloadProducts();
      setMsg("Compra guardada. Costo y stock actualizados.");
    } catch (e: any) {
      setMsg(e?.message || "No se pudo guardar la compra");
    } finally { setBusy(false); }
  }

  async function saveCurrentCost() {
    if (!currentCostProduct) return;
    const cost = Number(String(costInput).replace(/\./g, "").replace(",", "."));
    if (!Number.isFinite(cost) || cost < 0) return setMsg("Ingresá un costo válido");
    setBusy(true); setMsg("");
    try {
      const res = await fetch("/api/vendor/costs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targets: [{ kind: "product", id: currentCostProduct.id, cost }] }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data?.error || "No se pudo guardar");
      await reloadProducts();
      setSelectedCostId(null);
      setMsg("Costo guardado. Vamos con el siguiente.");
    } catch (e: any) {
      setMsg(e?.message || "No se pudo guardar el costo");
    } finally { setBusy(false); }
  }

  async function assignCurrentList() {
    if (!currentListProduct) return;
    setBusy(true); setMsg("");
    try {
      const res = await fetch("/api/vendor/pricing/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productIds: [currentListProduct.id], listId: listChoice || null, reason: "Precio manual" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data?.error || "No se pudo guardar");
      await reloadProducts();
      setSelectedListId(null);
      setMsg("Lista asignada. Vamos con el siguiente.");
    } catch (e: any) {
      setMsg(e?.message || "No se pudo asignar la lista");
    } finally { setBusy(false); }
  }

  async function previewCurrentPrice() {
    if (!currentPriceProduct) return;
    setBusy(true); setMsg(""); setSuggested(null);
    try {
      const res = await fetch("/api/vendor/pricing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productIds: [currentPriceProduct.id] }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data?.error || "No se pudo calcular");
      setSuggested(data?.items?.[0]?.newPrice ?? null);
    } catch (e: any) {
      setMsg(e?.message || "No se pudo calcular");
    } finally { setBusy(false); }
  }

  async function applyCurrentPrice() {
    if (!currentPriceProduct) return;
    setBusy(true); setMsg("");
    try {
      const res = await fetch("/api/vendor/pricing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productIds: [currentPriceProduct.id], apply: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data?.error || "No se pudo aplicar");
      await reloadProducts();
      setSelectedPriceId(null);
      setSuggested(null);
      setMsg("Precio aplicado. Vamos con el siguiente.");
    } catch (e: any) {
      setMsg(e?.message || "No se pudo aplicar el precio");
    } finally { setBusy(false); }
  }

  function startOver() {
    setExtracted(null); setUrl(null); setFileHash(null); setLineIndex(0);
    setCreatedLines([]); setSavedPurchaseId(null); setDuplicateInfo(null);
    setSelectedCostId(null); setSelectedListId(null); setSelectedPriceId(null);
    go(1);
  }

  const progress = Object.values(done).filter(Boolean).length;

  return (
    <div className="mx-auto max-w-3xl p-4 space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold">Asistente de precios</h1>
          <p className="text-sm text-muted-foreground">
            Te guío paso a paso. Vamos a dejar tus productos listos para vender.
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={startOver} className="text-xs text-muted-foreground underline underline-offset-2">
            Cargar otra factura
          </button>
          <Link href="/vendor/dashboard">
            <Button variant="outline" size="sm">Salir</Button>
          </Link>
        </div>
      </div>

      <Card className="p-4 space-y-3">
        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <div className="h-full bg-primary transition-all" style={{ width: `${(progress / 5) * 100}%` }} />
        </div>
        <div className="flex flex-wrap gap-2">
          {STEPS.map((s) => (
            <button
              key={s.n}
              onClick={() => go(s.n)}
              className={`rounded-full border px-3 py-1 text-xs ${step === s.n ? "border-primary bg-primary text-primary-foreground" : done[s.n] ? "border-green-600 text-green-700" : "border-border bg-card"}`}
            >
              {done[s.n] ? "✓" : s.n} {s.title}
            </button>
          ))}
        </div>
      </Card>

      <Card className="p-5 space-y-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Paso {step} de 5</p>
          <h2 className="text-lg font-semibold">{STEPS[step - 1].title}</h2>
          <p className="text-sm text-muted-foreground">{STEPS[step - 1].hint}</p>
        </div>

        {/* Aviso de compra parecida: visible en TODOS los pasos (al leer se
            salta al paso 2, así que dentro del paso 1 nunca se veía). */}
        {duplicateInfo && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 space-y-2">
            <p className="font-medium">
              ⚠️ {duplicateInfo.type === "exact_file"
                ? "Este comprobante ya fue registrado"
                : "Hay una compra parecida (no te bloquea)"}
            </p>
            <p className="text-xs">
              {duplicateInfo.reason || (duplicateInfo.type === "exact_file" ? "Es el mismo archivo" : "Mismo proveedor y monto cercano")}.
              {" "}Compra del {duplicateInfo.purchased_at || "—"} · {duplicateInfo.receipt_number || "sin n°"} · ${Number(duplicateInfo.total || 0).toLocaleString("es-AR")}
            </p>
            {duplicateInfo.type !== "exact_file" && (
              <p className="text-xs">Si es una factura nueva, seguí con los pasos normalmente.</p>
            )}
            <Button size="sm" onClick={() => { setDuplicateOverride(true); setDuplicateInfo(null); }}>
              {duplicateInfo.type === "exact_file" ? "Cargar igual" : "Es nueva, continuar"}
            </Button>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4">
            <p className="text-sm">
              Elegí la foto o el PDF de la factura. Lo leo y te muestro los artículos que encuentro.
            </p>
            <input
              type="file"
              accept="image/*,application/pdf"
              disabled={busy}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
              className="w-full text-base file:mr-3 file:rounded-lg file:border-0 file:bg-primary file:text-primary-foreground file:px-4 file:py-3 file:text-sm file:font-medium"
            />
            {busy && <p className="text-sm text-muted-foreground">Leyendo factura…</p>}
            {!extracted && products.length > 0 && (
              <div className="rounded-xl border border-border bg-muted/40 p-3 text-sm">
                Ya tenés {products.length} productos en el catálogo. Si solo querés completar costos, listas o precios,
                pasá al paso que corresponda con los botones de arriba.
                <div className="mt-2"><Button size="sm" onClick={() => go(missingCost.length ? 3 : missingList.length ? 4 : 5)}>Ir al paso pendiente</Button></div>
              </div>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <PendingChips
              items={(extracted?.items || []).map((it, i) => ({
                key: String(i),
                label: `${i < lineIndex ? "✓ " : ""}${i + 1}. ${it.description}`,
              }))}
              getKey={(x) => x.key}
              getLabel={(x) => x.label}
              selectedKey={String(lineIndex)}
              onSelect={(key) => { setLineIndex(Number(key)); setMsg(""); }}
              emptyText="No hay líneas para revisar."
            />
            {currentLine ? (
              <>
                <p className="text-xs text-muted-foreground">Línea {lineIndex + 1} de {extracted?.items?.length || 0}</p>
                <div className="rounded-xl border border-border p-4 space-y-3">
                  <p className="font-medium">{currentLine.description}</p>
                  <p className="text-sm text-muted-foreground">
                    {currentLine.bestMatch ? `Sugerencia: ${currentLine.bestMatch.name}` : "No encontramos coincidencia: lo creamos nuevo."}
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div>
                      <p className="text-xs text-muted-foreground">Costo de compra</p>
                      <p className="text-lg font-semibold">${costForLine(currentLine).toLocaleString("es-AR")}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {ivaRecuperable ? "Usamos el neto (recuperás IVA)" : "Usamos el total pagado (no recuperás IVA)"}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Lista de margen</p>
                      <select
                        value={listChoice}
                        onChange={(e) => setListChoice(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                      >
                        {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                        <option value="">Sin lista (precio manual)</option>
                      </select>
                    </div>
                  </div>
                  <CategorySelect
                    categories={categories}
                    value={categoryChoice}
                    onChange={setCategoryChoice}
                    onCategoryCreated={(cat) => setCategories((prev) => [...prev.filter((c) => c.id !== cat.id), cat])}
                  />
                  <div className="flex gap-2">
                    <Button onClick={createCurrentLine} disabled={busy}>{busy ? "Creando…" : "Crear y siguiente"}</Button>
                    <Button variant="outline" onClick={skipCurrentLine} disabled={busy}>Omitir</Button>
                  </div>
                </div>
              </>
            ) : (
              <div className="space-y-3">
                <p className="text-sm">Ya revisamos todas las líneas de la factura.</p>
                {createdLines.length > 0 && savedPurchaseId == null && (
                  <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3">
                    <p className="font-medium">Guardá la compra para cargar el costo y el stock</p>
                    <p className="text-xs text-muted-foreground">Se van a guardar {createdLines.length} productos y el comprobante adjunto.</p>
                    <Button onClick={savePurchase} disabled={busy}>{busy ? "Guardando…" : "Guardar compra"}</Button>
                  </div>
                )}
                <Button onClick={() => go(savedPurchaseId ? 4 : 3)}>Continuar</Button>
              </div>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <div className="rounded-xl border border-border bg-muted/40 p-4 space-y-3">
              <p className="font-medium">¿Recuperás el IVA de tus compras?</p>
              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  onClick={() => setIva(false)}
                  className={`rounded-lg border p-3 text-left text-sm ${!ivaRecuperable ? "border-primary bg-primary/5" : "border-border"}`}
                >
                  <strong>No recupero</strong>
                  <span className="block text-xs text-muted-foreground">Monotributo / Factura B o C</span>
                </button>
                <button
                  onClick={() => setIva(true)}
                  className={`rounded-lg border p-3 text-left text-sm ${ivaRecuperable ? "border-primary bg-primary/5" : "border-border"}`}
                >
                  <strong>Sí, recupero</strong>
                  <span className="block text-xs text-muted-foreground">Responsable Inscripto / Factura A</span>
                </button>
              </div>
            </div>

            <PendingChips
              items={missingCost}
              getKey={(p) => p.id}
              getLabel={(p) => p.name}
              selectedKey={currentCostProduct?.id || null}
              onSelect={setSelectedCostId}
              emptyText="✓ Ningún producto esperando costo."
            />

            {currentCostProduct ? (
              <div className="rounded-xl border border-border p-4 space-y-3">
                <p className="text-xs text-muted-foreground">
                  Faltan {missingCost.length} · producto {missingCost.findIndex((p) => p.id === currentCostProduct.id) + 1} de {missingCost.length}
                </p>
                <p className="font-medium">{currentCostProduct.name}</p>
                <p className="text-sm text-muted-foreground">
                  Cargá el costo de compra. {ivaRecuperable ? "Si recuperás IVA, cargá el precio neto." : "Si no recuperás IVA, cargá el total que pagaste."}
                </p>
                <Input
                  type="number"
                  min={0}
                  step="any"
                  value={costInput}
                  onChange={(e) => setCostInput(e.target.value)}
                  placeholder="Costo $"
                  className="max-w-xs"
                />
                <Button onClick={saveCurrentCost} disabled={busy}>{busy ? "Guardando…" : "Guardar y siguiente"}</Button>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm">✓ Todos los productos tienen costo cargado.</p>
                <Button onClick={() => go(4)}>Continuar a listas</Button>
              </div>
            )}
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4">
            <PendingChips
              items={missingList}
              getKey={(p) => p.id}
              getLabel={(p) => p.name}
              selectedKey={currentListProduct?.id || null}
              onSelect={setSelectedListId}
              emptyText="✓ Ningún producto esperando lista."
            />

            {currentListProduct ? (
              <div className="rounded-xl border border-border p-4 space-y-3">
                <p className="text-xs text-muted-foreground">
                  Faltan {missingList.length} · producto {missingList.findIndex((p) => p.id === currentListProduct.id) + 1} de {missingList.length}
                </p>
                <p className="font-medium">{currentListProduct.name}</p>
                <p className="text-sm text-muted-foreground">Elegí la lista que define cuánto se recarga sobre el costo.</p>
                <select
                  value={listChoice}
                  onChange={(e) => setListChoice(e.target.value)}
                  className="w-full max-w-sm rounded-lg border border-input bg-background px-3 py-2 text-sm"
                >
                  {lists.map((l) => <option key={l.id} value={l.id}>{l.name} — {l.rule} {l.pct}%</option>)}
                  <option value="">Sin lista (precio manual)</option>
                </select>
                <Button onClick={assignCurrentList} disabled={busy}>{busy ? "Guardando…" : "Asignar y siguiente"}</Button>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm">✓ Todos los productos tienen lista o precio manual declarado.</p>
                <Button onClick={() => go(5)}>Continuar a precios</Button>
              </div>
            )}
          </div>
        )}

        {step === 5 && (
          <div className="space-y-4">
            <PendingChips
              items={missingPrice}
              getKey={(p) => p.id}
              getLabel={(p) => p.name}
              selectedKey={currentPriceProduct?.id || null}
              onSelect={setSelectedPriceId}
              emptyText="✓ Ningún producto esperando precio."
            />

            {currentPriceProduct ? (
              <div className="rounded-xl border border-border p-4 space-y-3">
                <p className="text-xs text-muted-foreground">
                  Faltan {missingPrice.length} · producto {missingPrice.findIndex((p) => p.id === currentPriceProduct.id) + 1} de {missingPrice.length}
                </p>
                <p className="font-medium">{currentPriceProduct.name}</p>
                <p className="text-sm text-muted-foreground">
                  Costo: ${Number(currentPriceProduct.cost_last || 0).toLocaleString("es-AR")}
                </p>
                {suggested == null ? (
                  <Button onClick={previewCurrentPrice} disabled={busy}>{busy ? "Calculando…" : "Ver precio sugerido"}</Button>
                ) : (
                  <div className="rounded-lg bg-muted/50 p-3 space-y-2">
                    <p className="text-sm">
                      Precio sugerido: <strong className="text-lg">${Number(suggested).toLocaleString("es-AR")}</strong>
                    </p>
                    <Button onClick={applyCurrentPrice} disabled={busy}>{busy ? "Aplicando…" : "Aplicar y siguiente"}</Button>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3 rounded-xl border border-green-600/30 bg-green-50 p-4 dark:bg-green-950">
                <p className="font-medium">🎉 Listo</p>
                <p className="text-sm">Todos los productos tienen factura, costo, lista y precio.</p>
                <Link href="/vendor/dashboard?tab=menu">
                  <Button size="sm">Ver en Catálogo</Button>
                </Link>
              </div>
            )}
          </div>
        )}

        {msg && <p className="text-sm text-muted-foreground">{msg}</p>}
      </Card>
    </div>
  );
}
