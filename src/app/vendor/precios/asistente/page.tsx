"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { apiJson, getJson } from "@/components/dashboard/shared";
import { clearDraft, loadDraft, saveDraft } from "@/lib/draft";
import { getPricingStatus, type PricingStage } from "@/lib/pricing-status";

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
type Draft = { step: number; selectedIds: string[]; listId: string };

const STEPS = [
  { n: 1, title: "Factura", hint: "Traemos los artículos del comprobante del proveedor." },
  { n: 2, title: "Productos", hint: "Confirmamos cuáles son y creamos los que faltan." },
  { n: 3, title: "Costo y stock", hint: "Guardamos la compra con el costo correcto." },
  { n: 4, title: "Lista", hint: "Elegimos la lista que define el precio." },
  { n: 5, title: "Precio", hint: "Calculamos y aplicamos el precio de venta." },
];

function deriveStep(products: Product[]): number {
  const incomplete = products.filter((p) => getPricingStatus(p).stage !== "listo");
  if (incomplete.length === 0) return 5;
  if (incomplete.every((p) => p.cost_last == null)) return 1;
  if (incomplete.some((p) => p.cost_last == null)) return 3;
  if (incomplete.some((p) => !p.margin_list_id && !getPricingStatus(p).skipped.list)) return 4;
  return 5;
}

export default function PricingWizardPage() {
  const [vendorId, setVendorId] = useState<string | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [lists, setLists] = useState<ListRow[]>([]);
  const [step, setStep] = useState(1);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [listId, setListId] = useState("");
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<any[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function load() {
    const [me, off, ml] = await Promise.all([
      getJson<{ vendor?: { id: string } }>("/api/vendor/me").catch(() => null),
      getJson<{ offers?: Product[] }>("/api/vendor/offers").catch(() => null),
      getJson<{ lists?: ListRow[] }>("/api/vendor/margin-lists").catch(() => null),
    ]);
    const vid = me?.vendor?.id || null;
    setVendorId(vid);
    const prods = off?.offers || [];
    setProducts(prods);
    setLists(ml?.lists || []);

    const params = new URLSearchParams(window.location.search);
    const urlStep = Number(params.get("step"));
    const urlIds = (params.get("ids") || "").split(",").filter(Boolean);
    const draft = loadDraft<Draft>(vid, "pricing-wizard");

    const incomplete = prods.filter((p) => getPricingStatus(p).stage !== "listo");
    const ids = urlIds.length ? urlIds : draft?.selectedIds?.length ? draft.selectedIds : incomplete.map((p) => p.id);
    setSelectedIds(ids);
    const initialStep = Number.isFinite(urlStep) && urlStep >= 1 && urlStep <= 5
      ? urlStep
      : draft?.step || deriveStep(prods);
    setStep(initialStep);
    setListId(draft?.listId || ml?.lists?.[0]?.id || "");
  }

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (vendorId) saveDraft(vendorId, "pricing-wizard", { step, selectedIds, listId } as Draft);
  }, [vendorId, step, selectedIds, listId]);

  const selected = useMemo(
    () => products.filter((p) => selectedIds.includes(p.id)),
    [products, selectedIds]
  );

  function go(n: number) { setStep(n); setMsg(""); setPreview(null); }

  async function doAssign() {
    setBusy(true); setMsg("");
    const r = await apiJson("/api/vendor/pricing/assign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productIds: selectedIds, listId: listId || null, reason: reason || "Precio manual" }),
    });
    setBusy(false);
    if (!r.ok) return setMsg(r.error || "No se pudo asignar la lista");
    setMsg("Lista asignada. Seguí con el precio.");
    go(5);
    await load();
  }

  async function doPreview(apply = false) {
    setBusy(true); setMsg("");
    const r = await apiJson("/api/vendor/pricing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productIds: selectedIds, listId: listId || null, apply }),
    });
    setBusy(false);
    const data = r as { ok?: boolean; error?: string; items?: any[]; applied?: number };
    if (!data.ok) return setMsg(data.error || "No se pudo calcular");
    setPreview(data.items || []);
    if (apply) {
      setMsg(`Listo: ${data.applied || 0} precios aplicados.`);
      clearDraft(vendorId, "pricing-wizard");
      await load();
    }
  }

  return (
    <div className="mx-auto max-w-5xl p-4 space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold">Asistente de precios</h1>
          <p className="text-sm text-muted-foreground">
            De la factura al precio de venta, sin perderte ningún paso.
          </p>
        </div>
        <Link href="/vendor/dashboard"><Button variant="outline" size="sm">Volver al panel</Button></Link>
      </div>

      <div className="flex gap-2 flex-wrap">
        {STEPS.map((s) => (
          <button
            key={s.n}
            onClick={() => go(s.n)}
            className={`rounded-full border px-3 py-1 text-xs ${step === s.n ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card"}`}
          >
            {s.n}. {s.title}
          </button>
        ))}
      </div>

      <Card className="p-4 space-y-3">
        <div>
          <h2 className="font-medium">{STEPS[step - 1].title}</h2>
          <p className="text-sm text-muted-foreground">{STEPS[step - 1].hint}</p>
        </div>

        {step === 1 && (
          <div className="space-y-3">
            <p className="text-sm">
              Si todavía no cargaste la factura, hacelo desde Compras. Después volvés acá y seguimos.
            </p>
            <Link href="/vendor/dashboard?seccion=compras">
              <Button size="sm">Ir a cargar la factura</Button>
            </Link>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Elegí los productos que querés completar ({selectedIds.length} seleccionados).
            </p>
            <div className="max-h-72 overflow-y-auto rounded-xl border border-border divide-y">
              {products.map((p) => {
                const st = getPricingStatus(p);
                return (
                  <label key={p.id} className="flex items-center gap-2 p-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(p.id)}
                      onChange={(e) => setSelectedIds((prev) => e.target.checked ? [...prev, p.id] : prev.filter((x) => x !== p.id))}
                    />
                    <span className="flex-1 min-w-0 truncate">{p.name}</span>
                    <span className="text-xs text-muted-foreground">{st.label}</span>
                  </label>
                );
              })}
            </div>
            <Button size="sm" onClick={() => go(3)} disabled={selectedIds.length === 0}>Continuar</Button>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-3">
            <p className="text-sm">
              Si ya guardaste la compra, el costo y el stock están actualizados. Si no, hacelo desde Compras:
              la pregunta de IVA define si se usa el neto o el total pagado.
            </p>
            <Link href="/vendor/dashboard?seccion=compras">
              <Button size="sm" variant="outline">Ir a Compras</Button>
            </Link>
            <Button size="sm" onClick={() => go(4)}>Ya guardé la compra</Button>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-3">
            <p className="text-sm">
              Elegí la lista de margen para los {selectedIds.length} productos seleccionados.
            </p>
            <select
              value={listId}
              onChange={(e) => setListId(e.target.value)}
              className="w-full max-w-sm rounded-lg border border-input bg-background px-3 py-2 text-sm"
            >
              {lists.map((l) => <option key={l.id} value={l.id}>{l.name} — {l.rule} {l.pct}%</option>)}
              <option value="">Sin lista (precio manual)</option>
            </select>
            {!listId && (
              <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motivo (opcional)" className="max-w-sm" />
            )}
            <div>
              <Button size="sm" onClick={doAssign} disabled={busy}>{busy ? "Guardando…" : "Asignar lista y continuar"}</Button>
            </div>
          </div>
        )}

        {step === 5 && (
          <div className="space-y-3">
            <p className="text-sm">
              Vista previa del precio calculado desde el costo y la regla de la lista. Nada se guarda hasta aplicar.
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => doPreview(false)} disabled={busy}>Ver vista previa</Button>
              <Button size="sm" onClick={() => doPreview(true)} disabled={busy || !preview}>{busy ? "Aplicando…" : "Aplicar precios"}</Button>
            </div>
            {preview && (
              <div className="rounded-xl border border-border max-h-80 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 text-left">
                    <tr><th className="p-2">Producto</th><th className="p-2">Costo</th><th className="p-2">Antes</th><th className="p-2">Después</th></tr>
                  </thead>
                  <tbody>
                    {preview.map((r) => (
                      <tr key={r.id} className="border-t border-border">
                        <td className="p-2">{r.name}{r.skip && <span className="text-amber-600"> · {r.skip}</span>}</td>
                        <td className="p-2 tabular-nums">{r.cost != null ? `$${Number(r.cost).toLocaleString("es-AR")}` : "—"}</td>
                        <td className="p-2 tabular-nums">{r.oldPrice != null ? `$${Number(r.oldPrice).toLocaleString("es-AR")}` : "—"}</td>
                        <td className="p-2 tabular-nums font-medium">{r.newPrice != null ? `$${Number(r.newPrice).toLocaleString("es-AR")}` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {msg && <p className="text-sm text-muted-foreground">{msg}</p>}
      </Card>
    </div>
  );
}
