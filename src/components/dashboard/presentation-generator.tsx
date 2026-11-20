"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { getJson } from "@/components/dashboard/shared";
import { fetchWithAuthRefresh } from "@/lib/auth-refresh";

type PresentationRow = {
  label: string;
  qty: string;
  unit: string;
  price: string;
  create: boolean;
};

type Props = {
  source: { id: string; name: string; price: number; presentation_qty?: number | null };
  onClose: () => void;
  onCreated: () => void;
};

const DEFAULT_ROWS: PresentationRow[] = [
  { label: "1 kg", qty: "1", unit: "kg", price: "", create: true },
  { label: "500 g", qty: "0.5", unit: "kg", price: "", create: true },
  { label: "250 g", qty: "0.25", unit: "kg", price: "", create: true },
  { label: "100 g", qty: "0.1", unit: "kg", price: "", create: false },
];

export function PresentationGenerator({ source, onClose, onCreated }: Props) {
  const [rows, setRows] = useState<PresentationRow[]>(DEFAULT_ROWS.map((r) => ({ ...r })));
  const [basePricePerKg, setBasePricePerKg] = useState(String(source.price || ""));
  const [pricingMode, setPricingMode] = useState<"manual" | "base_plus_packaging">("manual");
  const [packagingPct, setPackagingPct] = useState("30");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  function updateRow(i: number, patch: Partial<PresentationRow>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  function calcPrice(row: PresentationRow): string {
    if (pricingMode === "base_plus_packaging") {
      const base = Number(basePricePerKg) || 0;
      const qty = Number(row.qty) || 0;
      const pct = Number(packagingPct) || 0;
      const maxQty = 0.5; // envases chicos: < 500g llevan packaging %
      const factor = qty < maxQty ? 1 + pct / 100 : 1;
      return String(Math.round(base * qty * factor));
    }
    return row.price;
  }

  function pricePerKg(row: PresentationRow): string {
    const p = Number(calcPrice(row)) || 0;
    const q = Number(row.qty) || 1;
    if (q <= 0) return "—";
    return `$${Math.round(p / q).toLocaleString("es-AR")}/kg`;
  }

  async function save() {
    setSaving(true);
    setMsg(null);
    const toCreate = rows.filter((r) => r.create);
    if (toCreate.length === 0) {
      setMsg("Seleccioná al menos una presentación para crear.");
      setSaving(false);
      return;
    }
    const presentations = rows.map((r) => ({
      label: r.label.trim(),
      qty: Number(r.qty),
      unit: r.unit,
      price: pricingMode === "manual" ? Number(r.price) : Number(calcPrice(r)),
      create: r.create,
    }));
    const res = await fetchWithAuthRefresh("/api/vendor/products/presentations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source_id: source.id,
        presentations,
        share: { image: true, description: true, category: true, supplier: true, recipe: true, expiry: true, stock_control: true, margin_list: true },
        pricing_mode: pricingMode,
        base_price_per_kg: pricingMode === "base_plus_packaging" ? Number(basePricePerKg) : undefined,
        packaging_pct_by_range: pricingMode === "base_plus_packaging" ? [{ max_qty: 0.5, pct: Number(packagingPct) }] : undefined,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      const detail = Array.isArray(data?.errors) && data.errors.length > 0
        ? data.errors.map((e: any) => e.error || e.label).join("; ")
        : null;
      setMsg(data?.error || detail || "No se pudieron crear las presentaciones");
      return;
    }
    const created = Array.isArray(data?.created) ? data.created.length : 0;
    const errors = Array.isArray(data?.errors) ? data.errors : [];
    if (errors.length > 0) {
      setMsg(`Se crearon ${created}. Errores: ${errors.map((e: any) => e.error).join(", ")}`);
    } else {
      setMsg(`Se crearon ${created} presentaciones.`);
      setTimeout(() => { onCreated(); onClose(); }, 800);
    }
  }

  return (
    <Modal open onClose={onClose} title={`Presentaciones de ${source.name}`}>
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Cada presentación es un producto con su propio precio, stock y código. Se agrupan en una sola ficha en el micrositio.
        </p>

        {/* Fórmula de precio */}
        <div className="rounded-lg border border-border p-3 space-y-2">
          <Label className="text-xs font-semibold">Fórmula de precio</Label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPricingMode("manual")}
              className={`rounded-full border px-3 py-1 text-xs ${pricingMode === "manual" ? "border-primary bg-primary/10 text-primary" : "border-border"}`}
            >
              Manual
            </button>
            <button
              type="button"
              onClick={() => setPricingMode("base_plus_packaging")}
              className={`rounded-full border px-3 py-1 text-xs ${pricingMode === "base_plus_packaging" ? "border-primary bg-primary/10 text-primary" : "border-border"}`}
            >
              Base $/kg + packaging %
            </button>
          </div>
          {pricingMode === "base_plus_packaging" && (
            <div className="flex gap-2 items-center">
              <div className="flex-1">
                <Label className="text-xs">Precio base ($/kg)</Label>
                <Input type="number" value={basePricePerKg} onChange={(e) => setBasePricePerKg(e.target.value)} className="h-8 text-xs" />
              </div>
              <div className="flex-1">
                <Label className="text-xs">Packaging % (envases chicos)</Label>
                <Input type="number" value={packagingPct} onChange={(e) => setPackagingPct(e.target.value)} className="h-8 text-xs" />
              </div>
            </div>
          )}
        </div>

        {/* Tabla de presentaciones */}
        <div className="space-y-2">
          {rows.map((row, i) => (
            <div key={i} className="flex items-center gap-2 rounded-lg border border-border p-2">
              <input
                type="checkbox"
                checked={row.create}
                onChange={(e) => updateRow(i, { create: e.target.checked })}
                className="h-4 w-4"
              />
              <Input
                value={row.label}
                onChange={(e) => updateRow(i, { label: e.target.value })}
                placeholder="Etiqueta"
                className="h-8 text-xs flex-1"
              />
              <Input
                type="number"
                value={row.qty}
                onChange={(e) => updateRow(i, { qty: e.target.value })}
                placeholder="Cant."
                className="h-8 text-xs w-16"
                step="0.001"
              />
              <select
                value={row.unit}
                onChange={(e) => updateRow(i, { unit: e.target.value })}
                className="h-8 text-xs border border-border rounded px-1"
              >
                <option value="kg">kg</option>
                <option value="u">u</option>
                <option value="ml">ml</option>
              </select>
              {pricingMode === "manual" ? (
                <Input
                  type="number"
                  value={row.price}
                  onChange={(e) => updateRow(i, { price: e.target.value })}
                  placeholder="Precio"
                  className="h-8 text-xs w-20"
                />
              ) : (
                <span className="text-xs font-medium tabular-nums w-20 text-right">
                  ${Number(calcPrice(row)).toLocaleString("es-AR")}
                </span>
              )}
              <span className="text-[10px] text-muted-foreground w-16 text-right">
                {pricePerKg(row)}
              </span>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setRows((prev) => [...prev, { label: "", qty: "1", unit: "kg", price: "", create: true }])}
          >
            + Agregar fila
          </Button>
        </div>

        {msg && <p className="text-sm text-amber-600">{msg}</p>}

        <div className="flex gap-2 justify-end">
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button type="button" onClick={save} disabled={saving}>
            {saving ? "Creando..." : "Crear presentaciones"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}