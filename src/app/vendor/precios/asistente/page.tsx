"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { apiJson, getJson } from "@/components/dashboard/shared";
import { clearDraft, loadDraft, saveDraft } from "@/lib/draft";
import { getPricingStatus } from "@/lib/pricing-status";

type Product = {
  id: string;
  name: string;
  price?: number | null;
  cost_last?: number | null;
  margin_list_id?: string | null;
  price_source?: string | null;
  pricing_skipped?: unknown;
  image_url?: string | null;
  category?: string | null;
  stock_control?: boolean | null;
  is_combo?: boolean | null;
  sku?: string | null;
};
type ListRow = { id: string; name: string; rule: string; pct: number };

type WorkGroup = {
  id: string;
  name: string;
  productIds: string[];
  listId: string | null;
  reason: string;
  custom?: boolean;
};
type Draft = {
  step: number;
  selectedIds: string[];
  scopeName: string;
  scopeFromInvoice: boolean;
  listId: string;
  customGroups: WorkGroup[];
  groupChoices: Record<string, { listId: string | null; reason: string }>;
};

const STEPS = [
  { n: 1, title: "Factura del proveedor", hint: "Subí la factura o el remito y te proponemos los artículos." },
  { n: 2, title: "Productos y listas de trabajo", hint: "Agrupá los productos que faltan por completar." },
  { n: 3, title: "Costo y stock", hint: "Guardá la compra con el costo correcto (neto o con IVA)." },
  { n: 4, title: "Listas de margen", hint: "Asigná una lista por grupo, en una sola operación." },
  { n: 5, title: "Precios de venta", hint: "Revisá el cálculo y aplicá los precios." },
];

function autoGroups(products: Product[]): WorkGroup[] {
  const pick = (test: (p: Product) => boolean) => products.filter(test).map((p) => p.id);
  return [
    { id: "auto:sin_costo", name: "Sin costo", productIds: pick((p) => getPricingStatus(p).stage === "sin_costo"), listId: null, reason: "" },
    { id: "auto:falta_lista", name: "Falta lista", productIds: pick((p) => getPricingStatus(p).stage === "costo"), listId: null, reason: "" },
    { id: "auto:falta_precio", name: "Falta precio", productIds: pick((p) => getPricingStatus(p).stage === "con_lista"), listId: null, reason: "" },
    { id: "auto:manual", name: "Precio manual", productIds: pick((p) => p.price_source === "manual"), listId: null, reason: "Precio manual" },
  ].filter((g) => g.productIds.length > 0);
}

function deriveStep(products: Product[]): number {
  if (products.length === 0) return 2;
  if (products.some((p) => p.cost_last == null)) return 3;
  if (products.some((p) => !p.margin_list_id && !getPricingStatus(p).skipped.list)) return 4;
  return 5;
}

export default function PricingWizardPage() {
  const [vendorId, setVendorId] = useState<string | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [lists, setLists] = useState<ListRow[]>([]);
  const [step, setStep] = useState(1);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [scopeName, setScopeName] = useState("");
  const [scopeFromInvoice, setScopeFromInvoice] = useState(false);
  const [scopeReady, setScopeReady] = useState(false);
  const [customGroups, setCustomGroups] = useState<WorkGroup[]>([]);
  const [groupChoices, setGroupChoices] = useState<Record<string, { listId: string | null; reason: string }>>({});
  const [listId, setListId] = useState("");
  const [newGroupName, setNewGroupName] = useState("");
  const [preview, setPreview] = useState<any[] | null>(null);
  const [overrides, setOverrides] = useState<Record<string, string | null>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [extracted, setExtracted] = useState<any[] | null>(null);
  const [ivaRecuperable, setIvaRecuperable] = useState(false);

  const groups = useMemo(() => {
    const base = autoGroups(products)
      .map((g) => ({ ...g, productIds: g.productIds.filter((id) => selectedIds.includes(id)), ...(groupChoices[g.id] || {}) }))
      .filter((g) => g.productIds.length > 0);
    const custom = customGroups
      .map((g) => ({ ...g, productIds: g.productIds.filter((id) => selectedIds.includes(id)) }))
      .filter((g) => g.productIds.length > 0);
    return [...base, ...custom];
  }, [products, customGroups, groupChoices, selectedIds]);

  const scopedProducts = useMemo(
    () => products.filter((p) => selectedIds.includes(p.id)),
    [products, selectedIds]
  );

  const completed = useMemo(() => {
    const noCost = scopedProducts.filter((p) => p.cost_last == null).length;
    const noList = scopedProducts.filter((p) => !p.margin_list_id && !getPricingStatus(p).skipped.list).length;
    const notReady = scopedProducts.filter((p) => getPricingStatus(p).stage !== "listo").length;
    return {
      1: scopeFromInvoice || scopedProducts.some((p) => p.price_source === "factura"),
      2: selectedIds.length > 0 || customGroups.length > 0,
      3: scopedProducts.length > 0 && noCost === 0,
      4: scopedProducts.length > 0 && noList === 0,
      5: scopedProducts.length > 0 && notReady === 0,
    } as Record<number, boolean>;
  }, [scopedProducts, selectedIds, customGroups, scopeFromInvoice]);

  const progress = STEPS.filter((s) => completed[s.n]).length;

  async function load() {
    const [me, off, ml] = await Promise.all([
      getJson<{ vendor?: { id: string; iva_recuperable?: boolean | null } }>("/api/vendor/me").catch(() => null),
      getJson<{ offers?: Product[] }>("/api/vendor/offers").catch(() => null),
      getJson<{ lists?: ListRow[] }>("/api/vendor/margin-lists").catch(() => null),
    ]);
    const vid = me?.vendor?.id || null;
    setVendorId(vid);
    setIvaRecuperable(me?.vendor?.iva_recuperable === true);
    const prods = off?.offers || [];
    setProducts(prods);
    setLists(ml?.lists || []);

    const params = new URLSearchParams(window.location.search);
    const urlStep = Number(params.get("step"));
    const urlIds = (params.get("ids") || "").split(",").filter(Boolean);
    const urlGroup = params.get("group");
    const draft = loadDraft<Draft>(vid, "pricing-wizard");
    const custom = draft?.customGroups || [];
    setCustomGroups(custom);
    setGroupChoices(draft?.groupChoices || {});
    setListId(draft?.listId || ml?.lists?.[0]?.id || "");

    const resolvable = [...autoGroups(prods), ...custom];
    let ids: string[] = [];
    let name = "";
    let fromInvoice = false;

    if (urlGroup === "invoice" || urlGroup === "factura") {
      fromInvoice = true;
      name = "Factura nueva";
    } else if (urlGroup) {
      const g = resolvable.find((x) => x.id === urlGroup);
      if (g) { ids = g.productIds; name = g.name; }
    } else if (urlIds.length) {
      ids = urlIds;
      name = "Selección personalizada";
    } else if (draft?.scopeName) {
      ids = draft.selectedIds || [];
      name = draft.scopeName;
      fromInvoice = !!draft.scopeFromInvoice;
    }

    setSelectedIds(ids);
    setScopeName(name);
    setScopeFromInvoice(fromInvoice);
    setScopeReady(!!name);
    const scoped = prods.filter((p) => ids.includes(p.id));
    setStep(Number.isFinite(urlStep) && urlStep >= 1 && urlStep <= 5 ? urlStep : draft?.step || deriveStep(scoped));
  }

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (vendorId) saveDraft(vendorId, "pricing-wizard", { step, selectedIds, scopeName, scopeFromInvoice, listId, customGroups, groupChoices } as Draft);
  }, [vendorId, step, selectedIds, scopeName, scopeFromInvoice, listId, customGroups, groupChoices]);

  function go(n: number) { setStep(n); setMsg(""); setPreview(null); }

  function chooseGroup(g: WorkGroup) {
    setSelectedIds(g.productIds);
    setScopeName(g.name);
    setScopeFromInvoice(false);
    setScopeReady(true);
    setStep(deriveStep(products.filter((p) => g.productIds.includes(p.id))));
    setMsg("");
    setPreview(null);
  }

  function chooseInvoice() {
    setSelectedIds([]);
    setScopeName("Factura nueva");
    setScopeFromInvoice(true);
    setScopeReady(true);
    setStep(1);
    setMsg("");
    setPreview(null);
  }

  function chooseManual() {
    setSelectedIds([]);
    setScopeName("Selección manual");
    setScopeFromInvoice(false);
    setScopeReady(true);
    setStep(2);
    setMsg("");
    setPreview(null);
  }

  function changeGroup() {
    setScopeReady(false);
    setScopeName("");
    setSelectedIds([]);
    setStep(1);
    setMsg("");
    setPreview(null);
  }

  async function extract(file: File) {
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
      setExtracted(data?.extracted?.items || []);
      if (data?.duplicate) setMsg("⚠️ Esta factura ya está registrada. Revisala en Compras antes de crear productos.");
      else setMsg(`Se leyeron ${data?.extracted?.items?.length || 0} líneas. Elegí cuáles crear.`);
    } catch {
      setMsg("No se pudo subir la factura");
    } finally { setBusy(false); }
  }

  async function createFromLine(item: any) {
    setBusy(true); setMsg("");
    const cost = ivaRecuperable
      ? Number(item.unit_price_net ?? item.unit_price ?? 0)
      : Number(item.unit_price_total ?? item.unit_price ?? 0);
    let data: any = {};
    try {
      const res = await fetch("/api/vendor/offers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: String(item.description || "Producto sin nombre"),
          price: 0,
          from_invoice: true,
          cost_last: cost,
          margin_list_id: listId || null,
          price_source: listId ? "lista" : "manual",
          pricing_skipped: listId ? undefined : { list: "Precio manual" },
          supplier_name: null,
        }),
      });
      data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "No se pudo crear el producto");
    } catch (e: any) {
      setBusy(false);
      return setMsg(e?.message || "No se pudo crear el producto");
    }
    const newId = data?.offer?.id ? String(data.offer.id) : null;
    if (newId) setSelectedIds((prev) => prev.includes(newId) ? prev : [...prev, newId]);
    const fresh = await getJson<{ offers?: Product[] }>("/api/vendor/offers").catch(() => null);
    setProducts(fresh?.offers || []);
    setBusy(false);
    setMsg(`Creado: ${item.description}`);
  }

  function addCustomGroup() {
    if (!newGroupName.trim() || selectedIds.length === 0) return;
    setCustomGroups((prev) => [
      ...prev,
      { id: `custom:${Date.now()}`, name: newGroupName.trim(), productIds: [...selectedIds], listId: listId || null, reason: "", custom: true },
    ]);
    setNewGroupName("");
  }

  async function applyGroups() {
    setBusy(true); setMsg("");
    const payloadGroups = groups
      .filter((g) => g.productIds.length > 0)
      .map((g) => ({
        productIds: g.productIds,
        listId: g.listId || null,
        reason: g.reason || "Precio manual",
      }));
    const r = await apiJson("/api/vendor/pricing/assign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groups: payloadGroups }),
    });
    setBusy(false);
    if (!r.ok) return setMsg(r.error || "No se pudo asignar");
    setMsg(`Listas aplicadas a ${payloadGroups.length} grupo(s).`);
    go(5);
    await load();
  }

  async function doPreview(apply = false) {
    setBusy(true); setMsg("");
    let data: { ok?: boolean; error?: string; items?: any[]; applied?: number } = {};
    try {
      const res = await fetch("/api/vendor/pricing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productIds: selectedIds, overrides, apply }),
      });
      data = await res.json().catch(() => ({}));
      if (!res.ok) data.ok = false;
    } catch {
      data = { ok: false, error: "No se pudo conectar" };
    }
    setBusy(false);
    if (!data.ok) return setMsg(data.error || "No se pudo calcular");
    setPreview(data.items || []);
    if (apply) {
      setMsg(`Listo: ${data.applied || 0} precios aplicados.`);
      clearDraft(vendorId, "pricing-wizard");
      await load();
    }
  }

  if (!scopeReady) {
    const selectorGroups = [...autoGroups(products), ...customGroups];
    return (
      <div className="mx-auto max-w-3xl p-4 space-y-4">
        <div>
          <h1 className="text-xl font-semibold">Asistente de precios</h1>
          <p className="text-sm text-muted-foreground">
            Elegí por dónde querés empezar. Todo lo que hagamos después será solo sobre ese grupo.
          </p>
        </div>
        <Card className="p-4 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Empezar por</p>
          <button
            onClick={chooseInvoice}
            className="w-full rounded-xl border border-primary/30 bg-primary/5 p-3 text-left hover:bg-primary/10"
          >
            <p className="font-medium text-sm">📄 Cargar una factura del proveedor</p>
            <p className="text-xs text-muted-foreground">Subí el comprobante y armamos un grupo con esos productos.</p>
          </button>

          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground pt-2">Grupos que necesitan trabajo</p>
          <div className="grid gap-2 md:grid-cols-2">
            {selectorGroups.map((g) => (
              <button
                key={g.id}
                onClick={() => chooseGroup(g)}
                className="rounded-xl border border-border p-3 text-left hover:bg-muted/50"
              >
                <p className="font-medium text-sm">{g.name}</p>
                <p className="text-xs text-muted-foreground">{g.productIds.length} productos</p>
              </button>
            ))}
          </div>
          {selectorGroups.length === 0 && (
            <p className="text-sm text-muted-foreground">No hay grupos pendientes. Podés cargar una factura o elegir productos manualmente.</p>
          )}

          <button
            onClick={chooseManual}
            className="w-full rounded-xl border border-dashed border-border p-3 text-left hover:bg-muted/50"
          >
            <p className="font-medium text-sm">➕ Elegir productos manualmente</p>
            <p className="text-xs text-muted-foreground">Armá tu propio grupo desde el catálogo.</p>
          </button>
        </Card>
        <Link href="/vendor/dashboard">
          <Button variant="outline" size="sm">Volver al panel</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl p-4">
      <div className="flex items-center justify-between gap-2 flex-wrap mb-4">
        <div>
          <h1 className="text-xl font-semibold">Asistente de precios</h1>
          <p className="text-sm text-muted-foreground">
            De la factura al precio de venta, a tu ritmo y sin perder ningún paso.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="rounded-full border border-primary/30 bg-primary/5 px-3 py-1 text-xs">
            Trabajando con: <strong>{scopeName}</strong> · {selectedIds.length} producto{selectedIds.length === 1 ? "" : "s"}
          </span>
          <button onClick={changeGroup} className="text-xs text-primary underline underline-offset-2">Cambiar grupo</button>
          <Link href="/vendor/dashboard"><Button variant="outline" size="sm">Volver al panel</Button></Link>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        {/* CHECKLIST */}
        <Card className="p-3 h-fit lg:sticky lg:top-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Tu progreso</p>
          <div className="h-2 rounded-full bg-muted overflow-hidden mb-3">
            <div className="h-full bg-primary transition-all" style={{ width: `${(progress / STEPS.length) * 100}%` }} />
          </div>
          <p className="text-xs text-muted-foreground mb-1">{progress} de {STEPS.length} pasos listos</p>
          <p className="text-[11px] text-muted-foreground mb-3">
            De estos {scopedProducts.length} productos, {scopedProducts.filter((p) => getPricingStatus(p).stage !== "listo").length} faltan completar.
          </p>
          <div className="space-y-1">
            {STEPS.map((s) => (
              <button
                key={s.n}
                onClick={() => go(s.n)}
                className={`w-full text-left rounded-lg px-3 py-2 text-sm transition-colors ${
                  step === s.n ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted text-muted-foreground"
                }`}
              >
                <span className="inline-flex items-center gap-2">
                  <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${
                    completed[s.n] ? "bg-green-600 text-white" : "border border-border"
                  }`}>{completed[s.n] ? "✓" : s.n}</span>
                  {s.title}
                </span>
              </button>
            ))}
          </div>
        </Card>

        {/* WORK AREA */}
        <Card className="p-4 space-y-4 min-w-0">
          <div>
            <h2 className="font-medium">{STEPS[step - 1].title}</h2>
            <p className="text-sm text-muted-foreground">{STEPS[step - 1].hint}</p>
          </div>

          {step === 1 && (
            <div className="space-y-3">
              <input
                type="file"
                accept="image/*,application/pdf"
                disabled={busy}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) extract(f); e.target.value = ""; }}
                className="w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-primary file:text-primary-foreground file:px-3 file:py-2"
              />
              {busy && <p className="text-xs text-muted-foreground">Leyendo factura…</p>}
              {msg && <p className="text-sm text-muted-foreground">{msg}</p>}
              {extracted && extracted.length > 0 && (
                <div className="rounded-xl border border-border divide-y max-h-80 overflow-y-auto">
                  {extracted.map((it, idx) => (
                    <div key={idx} className="p-2 flex items-center gap-2 flex-wrap text-sm">
                      <span className="flex-1 min-w-0 truncate">{it.description}</span>
                      <span className="text-xs text-muted-foreground">
                        {it.bestMatch ? `≈ ${it.bestMatch.name}` : "Sin match"}
                      </span>
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => createFromLine(it)}>Crear</Button>
                    </div>
                  ))}
                </div>
              )}
              {extracted && extracted.length === 0 && (
                <Link href="/vendor/dashboard?seccion=compras">
                  <Button size="sm" variant="outline">Cargar la compra en Compras</Button>
                </Link>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Este es tu grupo de trabajo. Podés ajustar la selección o armar subgrupos adentro.
              </p>
              <div className="grid gap-2 md:grid-cols-2">
                {groups.map((g) => (
                  <div key={g.id} className="rounded-xl border border-border p-2 space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">{g.name}</span>
                      <span className="text-xs text-muted-foreground">{g.productIds.length} productos</span>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => setSelectedIds(g.productIds)}>Seleccionar</Button>
                      <select
                        value={g.listId || ""}
                        onChange={(e) => {
                          if (g.custom) {
                            setCustomGroups((prev) => prev.map((x) => x.id === g.id ? { ...x, listId: e.target.value || null } : x));
                          } else {
                            setGroupChoices((prev) => ({ ...prev, [g.id]: { listId: e.target.value || null, reason: prev[g.id]?.reason || "" } }));
                          }
                        }}
                        className="h-8 flex-1 rounded-lg border border-input bg-background px-2 text-xs"
                      >
                        {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                        <option value="">Sin lista</option>
                      </select>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex gap-2 flex-wrap">
                <Input value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} placeholder="Nombre del grupo (ej. Bebidas)" className="max-w-xs" />
                <Button size="sm" onClick={addCustomGroup} disabled={!newGroupName.trim() || selectedIds.length === 0}>Crear grupo con seleccionados</Button>
              </div>
              <div className="rounded-xl border border-border max-h-64 overflow-y-auto divide-y">
                {products.map((p) => (
                  <label key={p.id} className="flex items-center gap-2 p-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(p.id)}
                      onChange={(e) => setSelectedIds((prev) => e.target.checked ? [...prev, p.id] : prev.filter((x) => x !== p.id))}
                    />
                    <span className="flex-1 min-w-0 truncate">{p.name}</span>
                    <span className="text-xs text-muted-foreground">{getPricingStatus(p).label}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-3">
              <p className="text-sm">
                Si ya guardaste la compra, el costo y el stock están actualizados. La pregunta de IVA define si se usa el neto o el total pagado.
              </p>
              <div className="flex gap-2 flex-wrap">
                <Link href="/vendor/dashboard?seccion=compras"><Button size="sm" variant="outline">Ir a Compras</Button></Link>
                <Button size="sm" onClick={() => go(4)}>Ya guardé la compra</Button>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-3">
              <p className="text-sm">Elegí una lista de margen por grupo. Un producto pertenece a una sola lista.</p>
              <div className="space-y-2">
                {groups.filter((g) => g.productIds.length > 0).map((g) => (
                  <div key={g.id} className="rounded-xl border border-border p-3 space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">{g.name}</span>
                      <span className="text-xs text-muted-foreground">{g.productIds.length} productos</span>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      <select
                        value={g.listId || ""}
                        onChange={(e) => {
                          if (g.custom) setCustomGroups((prev) => prev.map((x) => x.id === g.id ? { ...x, listId: e.target.value || null } : x));
                          else setGroupChoices((prev) => ({ ...prev, [g.id]: { listId: e.target.value || null, reason: prev[g.id]?.reason || "" } }));
                        }}
                        className="h-9 rounded-lg border border-input bg-background px-2 text-sm"
                      >
                        {lists.map((l) => <option key={l.id} value={l.id}>{l.name} — {l.rule} {l.pct}%</option>)}
                        <option value="">Sin lista (precio manual)</option>
                      </select>
                      {!g.listId && (
                        <Input
                          value={g.reason}
                          onChange={(e) => {
                            if (g.custom) setCustomGroups((prev) => prev.map((x) => x.id === g.id ? { ...x, reason: e.target.value } : x));
                            else setGroupChoices((prev) => ({ ...prev, [g.id]: { listId: prev[g.id]?.listId || null, reason: e.target.value } }));
                          }}
                          placeholder="Motivo (opcional)"
                          className="h-9 flex-1 min-w-[160px]"
                        />
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <Button size="sm" onClick={applyGroups} disabled={busy}>{busy ? "Aplicando…" : "Aplicar listas a todos los grupos"}</Button>
            </div>
          )}

          {step === 5 && (
            <div className="space-y-3">
              <p className="text-sm">Revisá el cálculo por producto. Podés cambiar la lista de una fila sin salir.</p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => doPreview(false)} disabled={busy}>Ver vista previa</Button>
                <Button size="sm" onClick={() => doPreview(true)} disabled={busy || !preview}>{busy ? "Aplicando…" : "Aplicar precios"}</Button>
              </div>
              {preview && (
                <div className="rounded-xl border border-border max-h-96 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50 text-left sticky top-0">
                      <tr>
                        <th className="p-2">Producto</th>
                        <th className="p-2">Lista</th>
                        <th className="p-2">Costo</th>
                        <th className="p-2">Antes</th>
                        <th className="p-2">Después</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.map((r) => (
                        <tr key={r.id} className="border-t border-border">
                          <td className="p-2">{r.name}{r.skip && <span className="text-amber-600"> · {r.skip}</span>}</td>
                          <td className="p-2">
                            <select
                              value={overrides[r.id] !== undefined ? (overrides[r.id] || "") : (r.listId || "")}
                              onChange={(e) => setOverrides((prev) => ({ ...prev, [r.id]: e.target.value || null }))}
                              className="h-7 rounded border border-input bg-background px-1 text-[11px]"
                            >
                              {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                              <option value="">Sin lista</option>
                            </select>
                          </td>
                          <td className="p-2 tabular-nums">{r.cost != null ? `$${Number(r.cost).toLocaleString("es-AR")}` : "—"}</td>
                          <td className="p-2 tabular-nums">{r.oldPrice != null ? `$${Number(r.oldPrice).toLocaleString("es-AR")}` : "—"}</td>
                          <td className="p-2 tabular-nums font-medium">{r.newPrice != null ? `$${Number(r.newPrice).toLocaleString("es-AR")}` : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {Object.keys(overrides).length > 0 && (
                <Button size="sm" variant="outline" onClick={() => { setOverrides({}); setPreview(null); }}>Limpiar cambios de lista</Button>
              )}
            </div>
          )}

          {msg && <p className="text-sm text-muted-foreground">{msg}</p>}
        </Card>
      </div>
    </div>
  );
}
