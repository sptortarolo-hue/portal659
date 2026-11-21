"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { getJson } from "@/components/dashboard/shared";

type PresentationRow = {
  label: string;
  qty: string;
  unit: string;
  price: string;
  packaging_pct: string;
  create: boolean;
};

type Template = {
  id: string;
  name: string;
  rows: { label: string; qty: number; unit: string; packaging_pct?: number }[];
};

type Props = {
  source: { id: string; name: string; price: number; presentation_qty?: number | null };
  onClose: () => void;
  onCreated: () => void;
};

const DEFAULT_ROWS: PresentationRow[] = [
  { label: "1 kg", qty: "1", unit: "kg", price: "", packaging_pct: "0", create: true },
  { label: "500 g", qty: "0.5", unit: "kg", price: "", packaging_pct: "0", create: true },
  { label: "250 g", qty: "0.25", unit: "kg", price: "", packaging_pct: "0", create: true },
  { label: "100 g", qty: "0.1", unit: "kg", price: "", packaging_pct: "0", create: false },
];

export function PresentationGenerator({ source, onClose, onCreated }: Props) {
  const [rows, setRows] = useState<PresentationRow[]>(DEFAULT_ROWS.map((r) => ({ ...r })));
  const [basePricePerKg, setBasePricePerKg] = useState(String(source.price || ""));
  const [pricingMode, setPricingMode] = useState<"manual" | "base">("manual");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Templates
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");
  const [templateName, setTemplateName] = useState("");
  const [savingTemplate, setSavingTemplate] = useState(false);

  const loadTemplates = useCallback(async () => {
    const r = await getJson<{ templates?: Template[] }>("/api/vendor/presentation-templates");
    if (r?.templates) setTemplates(r.templates);
  }, []);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  function updateRow(i: number, patch: Partial<PresentationRow>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  function loadTemplate(tpl: Template) {
    setRows(tpl.rows.map((r) => ({
      label: r.label,
      qty: String(r.qty),
      unit: r.unit,
      price: "",
      packaging_pct: String(r.packaging_pct ?? 0),
      create: true,
    })));
    setSelectedTemplate(tpl.id);
  }

  function calcPrice(row: PresentationRow): string {
    if (pricingMode === "base") {
      const base = Number(basePricePerKg) || 0;
      const qty = Number(row.qty) || 0;
      const pct = Number(row.packaging_pct) || 0;
      return String(Math.round(base * qty * (1 + pct / 100)));
    }
    return row.price;
  }

  function pricePerKg(row: PresentationRow): string {
    const p = Number(pricingMode === "manual" ? row.price : calcPrice(row)) || 0;
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
      packaging_pct: Number(r.packaging_pct) || 0,
      create: r.create,
    }));
    const res = await fetch("/api/vendor/products/presentations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source_id: source.id,
        presentations,
        share: { image: true, description: true, category: true, supplier: true, recipe: true, expiry: true, stock_control: true, margin_list: true },
        pricing_mode: pricingMode === "base" ? "base_plus_packaging" : "manual",
        base_price_per_kg: pricingMode === "base" ? Number(basePricePerKg) : undefined,
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

  async function saveTemplate() {
    const name = templateName.trim() || prompt("Nombre de la plantilla:");
    if (!name) return;
    setSavingTemplate(true);
    const res = await fetch("/api/vendor/presentation-templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        rows: rows.filter((r) => r.create).map((r) => ({
          label: r.label.trim(),
          qty: Number(r.qty),
          unit: r.unit,
          packaging_pct: Number(r.packaging_pct) || 0,
        })),
      }),
    });
    setSavingTemplate(false);
    if (res.ok) {
      setTemplateName("");
      loadTemplates();
      setMsg("Plantilla guardada.");
    } else {
      const data = await res.json().catch(() => ({}));
      setMsg(data?.error || "No se pudo guardar la plantilla");
    }
  }

  async function deleteTemplate(id: string) {
    if (!confirm("¿Borrar esta plantilla?")) return;
    const res = await fetch("/api/vendor/presentation-templates", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (res.ok) {
      if (selectedTemplate === id) setSelectedTemplate("");
      loadTemplates();
    }
  }

  return (
    <Modal open onClose={onClose} title={`Presentaciones de ${source.name}`}>
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Cada presentación es un producto con su propio precio, stock y código. Se agrupan en una sola ficha en el micrositio.
        </p>

        {/* Selector de plantilla */}
        {templates.length > 0 && (
          <div className="rounded-lg border border-border p-3 space-y-2">
            <Label className="text-xs font-semibold">Plantilla guardada</Label>
            <div className="flex flex-wrap gap-1.5">
              {templates.map((t) => (
                <div key={t.id} className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => loadTemplate(t)}
                    className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                      selectedTemplate === t.id
                        ? "border-primary bg-primary/5 text-primary"
                        : "border-border hover:border-primary/50"
                    }`}
                  >
                    {t.name}
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteTemplate(t.id)}
                    className="text-xs text-muted-foreground hover:text-red-500 px-1"
                    title="Borrar plantilla"
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => { setSelectedTemplate(""); setRows(DEFAULT_ROWS.map((r) => ({ ...r }))); }}
                className="rounded-full border border-dashed border-border px-2.5 py-1 text-xs text-muted-foreground hover:border-primary/50"
              >
                + Nueva (default)
              </button>
            </div>
          </div>
        )}

        {/* Fórmula de precio */}
        <div className="rounded-lg border border-border p-3 space-y-2">
          <Label className="text-xs font-semibold">Fórmula de precio</Label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPricingMode("manual")}
              className={`rounded-full border px-3 py-1 text-xs ${pricingMode === "manual" ? "border-primary bg-primary/5 text-primary" : "border-border"}`}
            >
              Manual
            </button>
            <button
              type="button"
              onClick={() => setPricingMode("base")}
              className={`rounded-full border px-3 py-1 text-xs ${pricingMode === "base" ? "border-primary bg-primary/5 text-primary" : "border-border"}`}
            >
              Base $/kg
            </button>
          </div>
          {pricingMode === "base" && (
            <div>
              <Label className="text-xs">Precio base ($/kg)</Label>
              <Input type="number" value={basePricePerKg} onChange={(e) => setBasePricePerKg(e.target.value)} className="h-8 text-xs" />
              <p className="text-[10px] text-muted-foreground mt-1">
                Cada fila calcula: base × cantidad × (1 + % packaging). El % se configura por fila.
              </p>
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
                className="h-4 w-4 flex-shrink-0"
              />
              <Input
                value={row.label}
                onChange={(e) => updateRow(i, { label: e.target.value })}
                placeholder="Etiqueta"
                className="h-8 text-xs flex-1 min-w-0"
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
              {pricingMode === "base" && (
                <Input
                  type="number"
                  value={row.packaging_pct}
                  onChange={(e) => updateRow(i, { packaging_pct: e.target.value })}
                  placeholder="% pkg"
                  className="h-8 text-xs w-14"
                  title="% de packaging (envase chico)"
                />
              )}
              <span className="text-[10px] text-muted-foreground w-16 text-right">
                {pricePerKg(row)}
              </span>
            </div>
          ))}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setRows((prev) => [...prev, { label: "", qty: "1", unit: "kg", price: "", packaging_pct: "0", create: true }])}
            >
              + Agregar fila
            </Button>
            {rows.filter((r) => r.create).length > 0 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={savingTemplate}
                onClick={saveTemplate}
              >
                {savingTemplate ? "Guardando..." : "💾 Guardar como plantilla"}
              </Button>
            )}
          </div>
          {templates.length > 0 && (
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground">Nombre de plantilla:</Label>
              <Input
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                placeholder="Ej: Maní, Gaseosas..."
                className="h-7 text-xs flex-1"
              />
            </div>
          )}
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