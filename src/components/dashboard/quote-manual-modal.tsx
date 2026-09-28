"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type CustomerSuggestion = { id: string; name: string | null; phone: string };

/** Buscador de clientes con alta al vuelo (patrón Fresha: se crea al agendar). */
export function CustomerPicker({
  name,
  phone,
  onPick,
}: {
  name: string;
  phone: string;
  onPick: (name: string, phone: string) => void;
}) {
  const [q, setQ] = useState("");
  const [suggestions, setSuggestions] = useState<CustomerSuggestion[]>([]);
  const [allowed, setAllowed] = useState(true);

  useEffect(() => {
    if (q.trim().length < 2 || !allowed) {
      setSuggestions([]);
      return;
    }
    const t = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/vendor/customers?q=${encodeURIComponent(q.trim())}`);
        if (res.status === 403) {
          setAllowed(false);
          return;
        }
        const data = await res.json();
        setSuggestions((data.customers || []).slice(0, 5));
      } catch { /* noop */ }
    }, 300);
    return () => window.clearTimeout(t);
  }, [q, allowed]);

  if (!allowed) return null;

  return (
    <div>
      <Label className="text-xs text-muted-foreground">Buscar cliente existente</Label>
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Nombre o teléfono..."
        className="mt-1 h-8 text-xs"
      />
      {suggestions.length > 0 && (
        <div className="mt-1 rounded-lg border border-border divide-y divide-border max-h-36 overflow-y-auto">
          {suggestions.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                onPick(c.name || name, c.phone);
                setQ("");
                setSuggestions([]);
              }}
              className="w-full text-left px-2.5 py-1.5 text-xs hover:bg-muted"
            >
              <strong>{c.name || "Sin nombre"}</strong>{" "}
              <span className="text-muted-foreground">{c.phone}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

type ManualItem = { kind: "material" | "labor"; description: string; qty: string; unit_price: string };

export function QuoteManualModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [serviceName, setServiceName] = useState("");
  const [description, setDescription] = useState("");
  const [items, setItems] = useState<ManualItem[]>([{ kind: "material", description: "", qty: "1", unit_price: "" }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // Memoria de precios: últimos materiales usados (autocompleta precio).
  const [matMemory, setMatMemory] = useState<{ description: string; unit_price: number }[]>([]);
  useEffect(() => {
    fetch("/api/vendor/quote-materials")
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d?.materials)) setMatMemory(d.materials); })
      .catch(() => {});
  }, []);

  const total = items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.unit_price) || 0), 0);

  function setItem(i: number, patch: Partial<ManualItem>) {
    setItems((prev) => {
      const next = prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it));
      // Al elegir un material conocido sin precio, sugiere el último usado.
      const row = next[i];
      if (patch.description !== undefined && row && row.kind === "material" && row.unit_price === "") {
        const hit = matMemory.find((m) => m.description.toLowerCase() === patch.description!.trim().toLowerCase());
        if (hit) next[i] = { ...row, unit_price: String(hit.unit_price) };
      }
      return next;
    });
  }

  async function submit() {
    setError("");
    if (!customerName.trim() || !customerPhone.trim() || !description.trim()) {
      setError("Faltan cliente, teléfono o descripción");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/vendor/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_name: customerName.trim(),
          customer_phone: customerPhone.trim(),
          service_name: serviceName.trim() || null,
          description: description.trim(),
          items: items
            .filter((it) => it.description.trim() !== "")
            .map((it) => ({
              kind: it.kind,
              description: it.description.trim(),
              qty: Number(it.qty) || 0,
              unit_price: Number(it.unit_price) || 0,
            })),
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "No se pudo crear");
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo crear");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-card rounded-t-2xl sm:rounded-2xl border border-border w-full sm:max-w-md sm:mx-4 max-h-[92vh] sm:max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 pb-3 shrink-0">
          <h3 className="font-display text-lg font-semibold">＋ Nuevo presupuesto</h3>
          <p className="text-xs text-muted-foreground">No cuenta para el tope mensual (es trabajo propio).</p>
        </div>
        <div className="overflow-y-auto px-5 pb-3 space-y-3 flex-1 min-h-0">
          <CustomerPicker name={customerName} phone={customerPhone} onPick={(n, p) => { setCustomerName(n); setCustomerPhone(p); }} />
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Cliente *</Label>
              <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Nombre" className="mt-1 h-9 text-sm" />
            </div>
            <div>
              <Label className="text-xs">Teléfono *</Label>
              <Input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} placeholder="221 555 0000" className="mt-1 h-9 text-sm" />
            </div>
          </div>
          <div>
            <Label className="text-xs">Servicio</Label>
            <Input value={serviceName} onChange={(e) => setServiceName(e.target.value)} placeholder="Ej: instalación, reparación..." className="mt-1 h-9 text-sm" />
          </div>
          <div>
            <Label className="text-xs">Descripción *</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Detalle del trabajo" rows={2} className="mt-1 text-sm" />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <Label className="text-xs">Partidas (materiales y mano de obra)</Label>
              <button
                type="button"
                onClick={() => setItems((prev) => [...prev, { kind: "material", description: "", qty: "1", unit_price: "" }])}
                className="text-xs text-primary font-medium hover:underline"
              >
                + Partida
              </button>
            </div>
            <div className="space-y-1.5">
              <datalist id="qm-materials">
                {matMemory.map((m) => (
                  <option key={m.description} value={m.description}>
                    ${Number(m.unit_price).toLocaleString("es-AR")}
                  </option>
                ))}
              </datalist>
              {items.map((it, i) => (
                <div key={i} className="flex gap-1.5">
                  <select
                    value={it.kind}
                    onChange={(e) => setItem(i, { kind: e.target.value as "material" | "labor" })}
                    className="h-9 rounded-md border border-input bg-background text-xs w-[86px] flex-shrink-0"
                    title="Tipo"
                  >
                    <option value="material">Material</option>
                    <option value="labor">M. obra</option>
                  </select>
                  <Input
                    value={it.description}
                    onChange={(e) => setItem(i, { description: e.target.value })}
                    placeholder="Descripción"
                    className="h-9 text-xs flex-1 min-w-0"
                    list="qm-materials"
                  />
                  <Input
                    type="number" min={0} value={it.qty} onChange={(e) => setItem(i, { qty: e.target.value })}
                    placeholder="Cant" title="Cantidad" className="h-9 text-xs w-16 flex-shrink-0"
                  />
                  <Input
                    type="number" min={0} value={it.unit_price} onChange={(e) => setItem(i, { unit_price: e.target.value })}
                    placeholder="$" title="Precio unitario" className="h-9 text-xs w-24 flex-shrink-0"
                  />
                  {items.length > 1 && (
                    <button type="button" onClick={() => setItems((prev) => prev.filter((_, idx) => idx !== i))} className="text-red-600 text-sm px-1 flex-shrink-0" aria-label="Quitar">
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-1.5 text-right">
              Total: <strong className="text-foreground">${total.toLocaleString("es-AR")}</strong>
            </p>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <div className="border-t border-border px-5 py-3 shrink-0 bg-card flex gap-2">
          <Button variant="outline" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button className="flex-1" disabled={saving} onClick={submit}>
            {saving ? "Guardando..." : "Crear presupuesto"}
          </Button>
        </div>
      </div>
    </div>
  );
}
