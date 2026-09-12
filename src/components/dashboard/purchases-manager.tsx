"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { apiJson, getJson } from "@/components/dashboard/shared";
import type { Ingredient, Supplier } from "@/types/database";
import {
  LINE_UNITS,
  RECEIPT_TYPE_LABEL,
  RECEIPT_TYPE_OPTIONS,
  formatMoney,
  unitFactor,
  type IngredientUnit,
} from "@/lib/costing";

// ---------------------------------------------------------------------------
// Compras: formulario de carga rápida (proveedor + líneas con costo neto).
// Al guardar, cada insumo actualiza su costo al ÚLTIMO precio (la API).
// ---------------------------------------------------------------------------
type BuyLine = { key: number; ingredient_id: string; qty: string; unit: string; unit_cost: string; total_paid: string };

function PurchaseForm({
  suppliers,
  ingredients,
  onSupplierCreated,
  onDone,
  onCancel,
}: {
  suppliers: Supplier[];
  ingredients: Ingredient[];
  onSupplierCreated: () => void;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [supplierId, setSupplierId] = useState("");
  const [newSupplier, setNewSupplier] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [receiptType, setReceiptType] = useState("ninguno");
  const [receiptNumber, setReceiptNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<BuyLine[]>([
    { key: 0, ingredient_id: "", qty: "", unit: "g", unit_cost: "", total_paid: "" },
  ]);
  const [keySeq, setKeySeq] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const ingMap = useMemo(() => new Map(ingredients.map((i) => [i.id, i])), [ingredients]);

  function patchLine(key: number, patch: Partial<BuyLine>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function pickIngredient(key: number, ingredientId: string) {
    const ing = ingMap.get(ingredientId);
    patchLine(key, { ingredient_id: ingredientId, unit: ing ? ing.base_unit : "g" });
  }

  // Ayuda estilo Fudo: total pagado ÷ cantidad → costo por unidad de línea.
  function applyTotalHelper(key: number) {
    const l = lines.find((x) => x.key === key);
    if (!l) return;
    const t = Number(l.total_paid);
    const q = Number(l.qty);
    if (t > 0 && q > 0) patchLine(key, { unit_cost: String(Math.round((t / q) * 10000) / 10000) });
  }

  const preview = lines.map((l) => {
    const ing = ingMap.get(l.ingredient_id);
    const f = ing ? unitFactor(l.unit, ing.base_unit) : null;
    const qty = Number(l.qty) || 0;
    const unitCost = Number(l.unit_cost) || 0;
    return {
      ing,
      factor: f,
      badUnit: !!ing && f === null,
      // Costo neto resultante por unidad BASE (es lo que pisa el costo actual).
      unitNet: f ? unitCost / f : 0,
      lineTotal: qty * unitCost,
    };
  });
  const grand = preview.reduce((s, p) => s + (isFinite(p.lineTotal) ? p.lineTotal : 0), 0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    let sid: string | null = supplierId || null;
    if (!sid && newSupplier.trim()) {
      const res = await fetch("/api/vendor/suppliers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newSupplier.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return setError(data?.error || "No se pudo crear el proveedor");
      sid = data.supplier.id;
      onSupplierCreated();
    }
    const clean = lines.filter(
      (l) => l.ingredient_id && Number(l.qty) > 0 && l.unit_cost !== "" && Number(l.unit_cost) >= 0
    );
    if (clean.length === 0) return setError("Agregá al menos una línea con cantidad y costo");
    if (preview.some((p) => p.badUnit)) return setError("Hay líneas con unidad incompatible");
    setSaving(true);
    const r = await apiJson("/api/vendor/purchases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        supplier_id: sid,
        purchased_at: date || undefined,
        receipt_type: receiptType,
        receipt_number: receiptNumber.trim() || null,
        notes: notes.trim() || null,
        items: clean.map((l) => ({
          ingredient_id: l.ingredient_id,
          qty: Number(l.qty),
          unit: l.unit,
          unit_cost: Number(l.unit_cost),
        })),
      }),
    });
    setSaving(false);
    if (!r.ok) return setError(r.error || "No se pudo guardar");
    onDone();
  }

  return (
    <Card className="p-4 border-primary/30">
      <form onSubmit={handleSubmit} className="space-y-3">
        <h4 className="font-medium text-sm">Nueva compra</h4>
        <div className="grid grid-cols-2 gap-2">
          <div className="col-span-2 sm:col-span-1">
            <Label className="text-xs">Proveedor</Label>
            <select
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              className="w-full rounded-lg border border-input bg-background px-2 py-2 text-sm"
            >
              <option value="">Sin proveedor</option>
              {suppliers
                .filter((s) => s.active)
                .map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
            </select>
          </div>
          <div className="col-span-2 sm:col-span-1">
            <Label className="text-xs">O crear proveedor</Label>
            <Input
              value={newSupplier}
              onChange={(e) => setNewSupplier(e.target.value)}
              placeholder="Nombre del nuevo…"
              disabled={!!supplierId}
            />
          </div>
          <div>
            <Label className="text-xs">Fecha</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Comprobante</Label>
            <select
              value={receiptType}
              onChange={(e) => setReceiptType(e.target.value)}
              className="w-full rounded-lg border border-input bg-background px-2 py-2 text-sm"
            >
              {RECEIPT_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div>
            <Label className="text-xs">N° comprobante (opcional)</Label>
            <Input value={receiptNumber} onChange={(e) => setReceiptNumber(e.target.value)} placeholder="0001-…" />
          </div>
          <div>
            <Label className="text-xs">Notas (opcional)</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="…" />
          </div>
        </div>

        <div className="space-y-2">
          <Label className="text-xs">Mercadería (costos netos, sin IVA)</Label>
          {lines.map((l, idx) => {
            const ing = ingMap.get(l.ingredient_id);
            const units = ing
              ? LINE_UNITS[ing.base_unit as IngredientUnit] ?? [ing.base_unit]
              : ["mg", "g", "kg", "ml", "cl", "l", "u", "doc"];
            const pv = preview[idx];
            return (
              <div key={l.key} className="rounded-xl border border-border p-2 space-y-1.5">
                <div className="flex gap-1.5">
                  <select
                    value={l.ingredient_id}
                    onChange={(e) => pickIngredient(l.key, e.target.value)}
                    className="flex-1 min-w-0 rounded-lg border border-input bg-background px-2 py-2 text-sm"
                  >
                    <option value="">Elegí insumo…</option>
                    {ingredients.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.name} (actual ${Number(i.cost_per_unit).toLocaleString("es-AR")}/{i.base_unit})
                      </option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-red-600 px-2"
                    onClick={() => setLines((prev) => prev.filter((x) => x.key !== l.key))}
                    title="Quitar línea"
                  >
                    ✕
                  </Button>
                </div>
                <div className="flex gap-1.5">
                  <Input
                    type="number" min={0} step="any" placeholder="Cantidad"
                    value={l.qty} onChange={(e) => patchLine(l.key, { qty: e.target.value })}
                    className="flex-1"
                  />
                  <select
                    value={l.unit}
                    onChange={(e) => patchLine(l.key, { unit: e.target.value })}
                    className="w-20 rounded-lg border border-input bg-background px-1 py-2 text-sm"
                  >
                    {units.map((u) => (
                      <option key={u} value={u}>{u}</option>
                    ))}
                  </select>
                  <Input
                    type="number" min={0} step="any" placeholder={`Costo x ${l.unit}`}
                    value={l.unit_cost} onChange={(e) => patchLine(l.key, { unit_cost: e.target.value })}
                    className="flex-1"
                    title={`Costo neto por ${l.unit}`}
                  />
                </div>
                <div className="flex gap-1.5 items-center">
                  <Input
                    type="number" min={0} step="any" placeholder="Total pagado (ayuda)"
                    value={l.total_paid} onChange={(e) => patchLine(l.key, { total_paid: e.target.value })}
                    className="flex-1 h-8 text-xs"
                  />
                  <Button type="button" variant="outline" size="sm" className="h-8" onClick={() => applyTotalHelper(l.key)} title="Total ÷ cantidad → costo">=</Button>
                  <span className="text-xs text-muted-foreground tabular-nums flex-shrink-0">
                    = {formatMoney(isFinite(pv.lineTotal) ? pv.lineTotal : 0)}
                  </span>
                </div>
                {pv.badUnit && (
                  <p className="text-xs text-red-600">Unidad incompatible con “{ing!.base_unit}”.</p>
                )}
                {ing && pv.factor !== null && l.unit_cost !== "" && (
                  <p className="text-xs text-muted-foreground tabular-nums">
                    → {formatMoney(pv.unitNet)}/{ing.base_unit} (pisa el actual {formatMoney(Number(ing.cost_per_unit))}/{ing.base_unit})
                  </p>
                )}
              </div>
            );
          })}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setLines((prev) => [...prev, { key: keySeq, ingredient_id: "", qty: "", unit: "g", unit_cost: "", total_paid: "" }]);
              setKeySeq((k) => k + 1);
            }}
          >
            + Línea
          </Button>
        </div>

        <div className="flex items-center justify-between rounded-xl bg-muted/60 px-3 py-2">
          <span className="text-sm text-muted-foreground">Total compra</span>
          <span className="text-lg font-bold tabular-nums">{formatMoney(grand)}</span>
        </div>
        <p className="text-xs text-muted-foreground">
          Al guardar, el costo de cada insumo se actualiza al último precio y los platos se recalculan solos.
        </p>

        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-2">
          <Button type="submit" disabled={saving} className="flex-1">
            {saving ? "Guardando…" : "Guardar compra"}
          </Button>
          <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
            Cancelar
          </Button>
        </div>
      </form>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Compras: lista + detalle + borrado (con reversión) + proveedores.
// ---------------------------------------------------------------------------
type PurchaseRow = {
  id: string;
  purchased_at: string;
  receipt_type: string;
  receipt_number: string | null;
  notes: string | null;
  total: number;
  supplier_id: string | null;
  supplier_name: string | null;
  items_count: number;
};

type PurchaseDetail = {
  purchase: PurchaseRow;
  items: {
    id: string;
    ingredient_id: string;
    qty: number;
    unit: string;
    unit_cost_net: number;
    line_total: number;
    ingredient_name: string;
    ingredient_unit: string;
  }[];
};

function SupplierForm({
  initial,
  onDone,
  onCancel,
}: {
  initial?: Supplier | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name || "");
  const [phone, setPhone] = useState(initial?.phone || "");
  const [email, setEmail] = useState(initial?.email || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!name.trim()) return setError("Indicá el nombre");
    setSaving(true);
    const payload = { name: name.trim(), phone: phone.trim() || null, email: email.trim() || null };
    const r = initial
      ? await apiJson(`/api/vendor/suppliers/${initial.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
      : await apiJson("/api/vendor/suppliers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
    setSaving(false);
    if (!r.ok) return setError(r.error || "No se pudo guardar");
    onDone();
  }

  return (
    <Card className="p-3 border-primary/30">
      <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-end">
        <div className="flex-1">
          <Label className="text-xs">Nombre</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Distribuidora Sur" />
        </div>
        <div className="flex-1">
          <Label className="text-xs">Teléfono</Label>
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="221…" />
        </div>
        <div className="flex-1">
          <Label className="text-xs">Email (opcional)</Label>
          <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="…" />
        </div>
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={saving}>{saving ? "…" : "Guardar"}</Button>
          <Button type="button" size="sm" variant="outline" onClick={onCancel}>✕</Button>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </form>
    </Card>
  );
}

export function PurchasesManager({
  ingredients,
  search,
  onChanged,
}: {
  ingredients: Ingredient[];
  search: string;
  onChanged: () => void;
}) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [purchases, setPurchases] = useState<PurchaseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showSuppliers, setShowSuppliers] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | "new" | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [detail, setDetail] = useState<PurchaseDetail | null>(null);
  const [msg, setMsg] = useState("");

  const loadAll = useCallback(async () => {
    const [s, p] = await Promise.all([
      getJson<{ suppliers: Supplier[] }>("/api/vendor/suppliers"),
      getJson<{ purchases: PurchaseRow[] }>("/api/vendor/purchases"),
    ]);
    if (s?.suppliers) setSuppliers(s.suppliers);
    if (p?.purchases) setPurchases(p.purchases);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return purchases;
    return purchases.filter(
      (p) =>
        (p.supplier_name || "").toLowerCase().includes(q) ||
        (p.receipt_number || "").toLowerCase().includes(q)
    );
  }, [purchases, search]);

  function fmtDate(iso: string) {
    const [y, m, d] = iso.slice(0, 10).split("-");
    return `${d}/${m}/${y}`;
  }

  async function openDetail(id: string) {
    if (expanded === id) {
      setExpanded(null);
      return;
    }
    setDetail(null);
    setExpanded(id);
    const d = await getJson<PurchaseDetail>(`/api/vendor/purchases/${id}`);
    if (d) {
      setDetail(d);
    } else {
      // Si falla, se colapsa para no mostrar el detalle de otra compra.
      setExpanded(null);
    }
  }

  async function deletePurchase(id: string) {
    if (!window.confirm("¿Borrar esta compra? Los costos vuelven al precio de la compra anterior.")) return;
    const r = await apiJson(`/api/vendor/purchases/${id}`, { method: "DELETE" });
    if (!r.ok) return setMsg(r.error || "No se pudo borrar");
    setMsg("Compra borrada y costos revertidos ✅");
    setExpanded(null);
    await loadAll();
    onChanged();
  }

  async function deleteSupplier(s: Supplier) {
    if (!window.confirm(`¿Borrar “${s.name}”?`)) return;
    const res = await fetch(`/api/vendor/suppliers/${s.id}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setMsg(data?.error || "No se pudo borrar");
    setMsg(data?.archived ? `“${s.name}” archivado (tiene compras en el historial)` : "Proveedor borrado");
    await loadAll();
  }

  if (loading) {
    return (
      <div className="space-y-2">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-16 rounded-xl bg-muted animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <Button size="sm" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Cerrar" : "+ Nueva compra"}
        </Button>
        <Button size="sm" variant="outline" onClick={() => setShowSuppliers((v) => !v)}>
          🏭 Proveedores ({suppliers.filter((s) => s.active).length})
        </Button>
      </div>

      {msg && <p className="text-sm text-green-600">{msg}</p>}

      {showForm && (
        <PurchaseForm
          suppliers={suppliers}
          ingredients={ingredients}
          onSupplierCreated={loadAll}
          onDone={() => {
            setShowForm(false);
            setMsg("Compra guardada y costos actualizados ✅");
            loadAll();
            onChanged();
          }}
          onCancel={() => setShowForm(false)}
        />
      )}

      {showSuppliers && (
        <Card className="p-3 space-y-2">
          <div className="flex items-center justify-between px-1">
            <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wide">Proveedores</p>
            <Button size="sm" variant="outline" onClick={() => setEditingSupplier("new")}>+ Proveedor</Button>
          </div>
          {editingSupplier && (
            <SupplierForm
              initial={editingSupplier === "new" ? null : editingSupplier}
              onDone={() => {
                setEditingSupplier(null);
                loadAll();
              }}
              onCancel={() => setEditingSupplier(null)}
            />
          )}
          {suppliers.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-3">
              Todavía no hay proveedores. Creá el primero — o se crea solo al cargar una compra.
            </p>
          )}
          {suppliers.map((s) => (
            <div key={s.id} className={`flex items-center gap-2 rounded-xl border border-border p-2.5 ${!s.active ? "opacity-50" : ""}`}>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-medium truncate">{s.name}</span>
                {s.phone && <span className="block text-xs text-muted-foreground">{s.phone}</span>}
              </span>
              {!s.active && <Badge variant="secondary">Archivado</Badge>}
              <Button size="sm" variant="outline" onClick={() => setEditingSupplier(s)}>Editar</Button>
              <Button size="sm" variant="ghost" className="text-red-600" onClick={() => deleteSupplier(s)}>Borrar</Button>
            </div>
          ))}
        </Card>
      )}

      <Card className="p-3">
        <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wide px-1 mb-2">
          Historial de compras
        </p>
        <div className="space-y-1.5 max-h-[70vh] overflow-y-auto">
          {filtered.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-6">
              Todavía no hay compras. Con la primera, los costos se actualizan solos.
            </p>
          )}
          {filtered.map((p) => (
            <div key={p.id} className="rounded-xl border border-border">
              <button
                onClick={() => openDetail(p.id)}
                className="w-full text-left p-2.5 flex items-center gap-2"
              >
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-medium truncate">
                    {p.supplier_name || "Sin proveedor"}
                  </span>
                  <span className="block text-xs text-muted-foreground tabular-nums">
                    {fmtDate(p.purchased_at)} · {RECEIPT_TYPE_LABEL[p.receipt_type] || p.receipt_type}
                    {p.receipt_number ? ` ${p.receipt_number}` : ""} · {p.items_count} ítems
                  </span>
                </span>
                <span className="text-sm font-bold tabular-nums flex-shrink-0">
                  {formatMoney(Number(p.total))}
                </span>
                <span className="text-muted-foreground text-xs flex-shrink-0">{expanded === p.id ? "▲" : "▼"}</span>
              </button>
              {expanded === p.id && detail?.purchase.id === p.id ? (
                <div className="border-t border-border px-2.5 py-2 space-y-1">
                  {detail.items.map((it) => (
                    <div key={it.id} className="flex justify-between gap-2 text-xs tabular-nums">
                      <span className="text-muted-foreground truncate">
                        {it.ingredient_name} · {Number(it.qty).toLocaleString("es-AR")} {it.unit} × {formatMoney(Number(it.unit_cost_net))}/{it.ingredient_unit}
                      </span>
                      <span className="font-medium flex-shrink-0">{formatMoney(Number(it.line_total))}</span>
                    </div>
                  ))}
                  {p.notes && <p className="text-xs text-muted-foreground italic">{p.notes}</p>}
                  <div className="pt-1">
                    <Button size="sm" variant="ghost" className="text-red-600 h-7 text-xs" onClick={() => deletePurchase(p.id)}>
                      Borrar compra (revierte costos)
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground px-2.5 py-2">Cargando detalle…</p>
              )}
            </div>
          ))}
        </div>
      </Card>
      <p className="text-xs text-muted-foreground">
        Cada compra actualiza el costo al último precio neto y deja historial. Borrar una compra revierte los costos a la compra anterior.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Historial de precios de un insumo (variación en el tiempo).
// ---------------------------------------------------------------------------
type PricePoint = {
  purchased_at: string;
  receipt_type: string;
  supplier_name: string | null;
  qty: number;
  unit: string;
  unit_cost_net: number;
  line_total: number;
};

export function PriceHistory({ ingredientId, baseUnit }: { ingredientId: string; baseUnit: string }) {
  const [history, setHistory] = useState<PricePoint[] | null>(null);

  useEffect(() => {
    getJson<{ history: PricePoint[] }>(`/api/vendor/purchases/prices?ingredientId=${ingredientId}`).then(
      (d) => setHistory(d?.history ?? [])
    );
  }, [ingredientId]);

  if (!history || history.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Sin compras registradas todavía. Al cargar una compra, el costo se actualiza solo.
      </p>
    );
  }

  function fmtDate(iso: string) {
    const [y, m, d] = iso.slice(0, 10).split("-");
    return `${d}/${m}`;
  }

  return (
    <div className="rounded-xl bg-muted/60 p-2.5 space-y-1">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Últimas compras</p>
      {history.slice(0, 5).map((h, i) => {
        const older = history[i + 1];
        const prev = older ? Number(older.unit_cost_net) : null;
        const cur = Number(h.unit_cost_net);
        const pct = prev ? ((cur - prev) / prev) * 100 : null;
        return (
          <div key={`${h.purchased_at}-${i}`} className="flex items-center justify-between gap-2 text-xs tabular-nums">
            <span className="text-muted-foreground truncate">
              {fmtDate(h.purchased_at)} · {h.supplier_name || "s/prov."} · {Number(h.qty).toLocaleString("es-AR")} {h.unit}
            </span>
            <span className="flex items-center gap-1.5 flex-shrink-0">
              <span className="font-medium">{formatMoney(cur)}/{baseUnit}</span>
              {pct !== null && Math.abs(pct) >= 0.05 && (
                <Badge className={pct > 0 ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"}>
                  {pct > 0 ? "▲" : "▼"} {Math.abs(pct).toLocaleString("es-AR", { maximumFractionDigits: 1 })}%
                </Badge>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
