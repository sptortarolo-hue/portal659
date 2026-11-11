"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EquipmentPicker } from "@/components/dashboard/equipment-picker";
import type { Equipment } from "@/lib/equipment";
import { equipmentLabel } from "@/lib/equipment";

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
  // Sin CRM (plan): el endpoint da 403. Se muestra el motivo en vez de
  // ocultar el buscador, y se reintenta en cada búsqueda.
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    if (q.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    const t = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/vendor/customers?q=${encodeURIComponent(q.trim())}`);
        if (res.status === 403) {
          setDenied(true);
          setSuggestions([]);
          return;
        }
        setDenied(false);
        const data = await res.json();
        setSuggestions((data.customers || []).slice(0, 5));
      } catch { /* noop */ }
    }, 300);
    return () => window.clearTimeout(t);
  }, [q]);

  return (
    <div>
      <Label className="text-xs text-muted-foreground">Buscar cliente existente</Label>
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Nombre o teléfono..."
        className="mt-1 h-8 text-xs"
      />
      {denied && (
        <p className="mt-1 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-800">
          El libro de clientes forma parte de los planes pagos (Gestión u Oficios).
        </p>
      )}
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

type ManualItem = {
  kind: "repuesto" | "material" | "labor";
  description: string;
  qty: string;
  unit_price: string;
  product_id?: string | null;
  variant_id?: string | null;
};

type QuoteVariant = "estetica" | "taller" | "oficios";

/**
 * Presupuesto existente para el modo edición (re-cotizar una orden de
 * taller modifica ESTE presupuesto en vez de crear uno nuevo y
 * desvincular el anterior). Campos espejo de GET /api/vendor/quotes
 * (incluye el join de equipment_*) + partidas (se cargan por separado).
 */
export type QuoteEditPrefill = {
  id: string;
  customer_name?: string | null;
  customer_phone?: string | null;
  service_name?: string | null;
  description?: string | null;
  quoted_price?: number | string | null;
  equipment_id?: string | null;
  equipment_kind?: string | null;
  equipment_brand?: string | null;
  equipment_model?: string | null;
  equipment_identifier?: string | null;
  equipment_rodado?: string | null;
  equipment_color?: string | null;
};

export function QuoteManualModal({
  onClose,
  onCreated,
  variant = "oficios",
  initialCustomerName = "",
  initialCustomerPhone = "",
  initialDeclaredIssue = "",
  initialEquipment = null,
  products = [],
  initialQuote = null,
}: {
  onClose: () => void;
  /** Recibe el presupuesto creado/editado (para vincularlo a la orden y avisar). */
  onCreated: (data: { quote: any | null }) => void;
  /**
   * estetica: precio directo ("consulta"). taller: partidas (materiales +
   * mano de obra), como oficios, con campo "Equipo / Bici" y toggle para
   * precio cerrado. oficios (default): partidas sin "Equipo / Bici".
   */
  variant?: QuoteVariant;
  /** Prefill desde una orden de servicio (cliente + equipo + falla). */
  initialCustomerName?: string;
  initialCustomerPhone?: string;
  initialDeclaredIssue?: string;
  initialEquipment?: Equipment | null;
  /** Catálogo de productos (repuestos) para agregar partidas de repuesto. */
  products?: { id: string; name: string; price?: number | null; promo_price?: number | null }[];
  /** Modo edición: presupuesto existente (PATCH en vez de POST). */
  initialQuote?: QuoteEditPrefill | null;
}) {
  const isEstetica = variant === "estetica";
  const isTaller = variant === "taller";
  const editing = !!initialQuote;
  const quoteEquipment: Equipment | null = initialQuote?.equipment_id
    ? ({
        id: String(initialQuote.equipment_id),
        kind: (initialQuote.equipment_kind ?? null) as Equipment["kind"],
        brand: initialQuote.equipment_brand ?? null,
        model: initialQuote.equipment_model ?? null,
        identifier: initialQuote.equipment_identifier ?? null,
        rodado: initialQuote.equipment_rodado ?? null,
        color: initialQuote.equipment_color ?? null,
        notes: null,
      } as Equipment)
    : null;
  const [customerName, setCustomerName] = useState(initialQuote?.customer_name || initialCustomerName);
  const [customerPhone, setCustomerPhone] = useState(initialQuote?.customer_phone || initialCustomerPhone);
  const [serviceName, setServiceName] = useState("");
  // Ficha de equipo (taller): el presupuesto queda ligado a la bici/equipo.
  const [equipment, setEquipment] = useState<Equipment | null>(initialEquipment ?? quoteEquipment);
  const [description, setDescription] = useState(
    initialQuote ? (initialQuote.description ?? "") : initialDeclaredIssue
  );
  // Precio cerrado (taller en modo "cerrado", estética siempre).
  const [directPrice, setDirectPrice] = useState(
    initialQuote?.quoted_price != null && Number(initialQuote.quoted_price) > 0
      ? String(Number(initialQuote.quoted_price))
      : ""
  );
  // Taller: modo de cotización — partidas (materiales + mano de obra) o precio cerrado.
  const [workshopMode, setWorkshopMode] = useState<"partidas" | "cerrado">("partidas");
  const [items, setItems] = useState<ManualItem[]>([{ kind: "material", description: "", qty: "1", unit_price: "" }]);
  const [partQuery, setPartQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // Memoria de precios: últimos materiales usados (autocompleta precio).
  // No aplica en estética (precio directo).
  const [matMemory, setMatMemory] = useState<{ description: string; unit_price: number }[]>([]);
  useEffect(() => {
    if (isEstetica) return;
    fetch("/api/vendor/quote-materials")
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d?.materials)) setMatMemory(d.materials); })
      .catch(() => {});
  }, [isEstetica]);
  // Modo edición: cargar las partidas del presupuesto existente. Con
  // partidas → modo "partidas" precargadas; sin partidas → modo "cerrado"
  // con su precio (el default del estado ya trae quoted_price).
  const [loadingQuote, setLoadingQuote] = useState(editing);
  useEffect(() => {
    if (!initialQuote) return;
    let cancelled = false;
    fetch(`/api/vendor/quotes/${initialQuote.id}/items`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        const list = Array.isArray(d?.items) ? d.items : [];
        if (list.length > 0) {
          setWorkshopMode("partidas");
          setItems(
            list.map((it: any) => ({
              kind: it.kind === "repuesto" ? "repuesto" : it.kind === "labor" ? "labor" : "material",
              description: String(it.description || ""),
              qty: String(Number(it.qty) || 0),
              unit_price: String(Number(it.unit_price) || 0),
              product_id: it.product_id ?? null,
              variant_id: it.variant_id ?? null,
            }))
          );
        } else {
          setWorkshopMode("cerrado");
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadingQuote(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuote?.id]);

  const total = items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.unit_price) || 0), 0);

  const partMatches = (() => {
    const q = partQuery.trim().toLowerCase();
    if (!q) return [];
    return (products || []).filter((p) => p.name.toLowerCase().includes(q)).slice(0, 6);
  })();

  function addRepuesto(p: { id: string; name: string; price?: number | null; promo_price?: number | null }) {
    setItems((prev) => {
      const cleaned = prev.filter((it) => it.description.trim() !== "");
      return [...(cleaned.length ? cleaned : []), {
        kind: "repuesto",
        description: p.name,
        qty: "1",
        unit_price: String(p.promo_price ?? p.price ?? 0),
        product_id: p.id,
        variant_id: null,
      }];
    });
    setPartQuery("");
  }

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
    if (!customerName.trim() || !customerPhone.trim()) {
      setError("Faltan cliente o teléfono");
      return;
    }
    if (isEstetica && !(Number(directPrice) > 0)) {
      setError("Poné el precio de la consulta");
      return;
    }
    if (isTaller && workshopMode === "cerrado" && !(Number(directPrice) > 0)) {
      setError("Poné el precio cerrado del trabajo");
      return;
    }
    if (isTaller && workshopMode === "partidas" && !items.some((it) => it.description.trim() !== "") && !(Number(directPrice) > 0)) {
      setError("Cargá al menos una partida (material o mano de obra)");
      return;
    }
    setSaving(true);
    try {
      // Payload común (mismos campos en POST y PATCH).
      const common = {
        customer_name: customerName.trim(),
        customer_phone: customerPhone.trim(),
        service_name: isTaller
          ? equipmentLabel(equipment) || (initialQuote?.service_name as string | undefined) || null
          : serviceName.trim() || null,
        description: description.trim() || (isTaller && equipment ? equipmentLabel(equipment) : "") || "Presupuesto",
        ...(isTaller ? { equipment_id: equipment?.id || null } : {}),
      };
      const itemsPayload = {
        ...common,
        items: items
          .filter((it) => it.description.trim() !== "")
          .map((it) => ({
            kind: it.kind,
            description: it.description.trim(),
            qty: Number(it.qty) || 0,
            unit_price: Number(it.unit_price) || 0,
            product_id: it.product_id || null,
            variant_id: it.variant_id || null,
          })),
      };
      const res = editing
        ? // Edición: modifica el presupuesto existente (no genera uno nuevo).
          await fetch(`/api/vendor/quotes/${initialQuote!.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: isEstetica || (isTaller && workshopMode === "cerrado")
              ? JSON.stringify({ ...common, quoted_price: Number(directPrice), items: [] })
              : JSON.stringify(itemsPayload),
          })
        : await fetch("/api/vendor/quotes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: isEstetica || (isTaller && workshopMode === "cerrado")
              ? JSON.stringify({
                  ...common,
                  quoted_price: Number(directPrice),
                })
              : JSON.stringify(itemsPayload),
          });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "No se pudo guardar");
      onCreated({ quote: data?.quote ?? null });
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar");
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
          <h3 className="font-display text-lg font-semibold">
            {editing
              ? isEstetica ? "✏️ Editar consulta" : "✏️ Editar presupuesto"
              : isEstetica ? "＋ Nueva consulta" : "＋ Nuevo presupuesto"}
          </h3>
          <p className="text-xs text-muted-foreground">
            {editing
              ? "Actualiza el presupuesto existente (mismo link de aceptación)."
              : "No cuenta para el tope mensual (es trabajo propio)."}
          </p>
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
          {isTaller ? (
            <EquipmentPicker
              phone={customerPhone}
              customerName={customerName}
              value={equipment}
              onChange={setEquipment}
            />
          ) : (
            <div>
              <Label className="text-xs">Servicio</Label>
              <Input value={serviceName} onChange={(e) => setServiceName(e.target.value)} placeholder={isEstetica ? "Ej: lifting, microblading..." : "Ej: instalación, reparación..."} className="mt-1 h-9 text-sm" />
            </div>
          )}
          <div>
            <Label className="text-xs">Descripción *</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Detalle del trabajo" rows={2} className="mt-1 text-sm" />
          </div>
          {isEstetica ? (
            <div>
              <Label className="text-xs">Precio de la consulta *</Label>
              <Input
                type="number" min={0} value={directPrice} onChange={(e) => setDirectPrice(e.target.value)}
                placeholder="$" className="mt-1 h-9 text-sm"
              />
            </div>
          ) : (
          <>
          {isTaller && (
            <div className="flex gap-1 rounded-lg border border-border p-0.5 w-max">
              <button type="button" onClick={() => setWorkshopMode("partidas")} className={`px-3 h-7 rounded-md text-xs font-medium ${workshopMode === "partidas" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>Partidas</button>
              <button type="button" onClick={() => setWorkshopMode("cerrado")} className={`px-3 h-7 rounded-md text-xs font-medium ${workshopMode === "cerrado" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>Precio cerrado</button>
            </div>
          )}
          {isTaller && workshopMode === "cerrado" ? (
            <div>
              <Label className="text-xs">Precio cerrado del trabajo *</Label>
              <Input
                type="number" min={0} value={directPrice} onChange={(e) => setDirectPrice(e.target.value)}
                placeholder="$" className="mt-1 h-9 text-sm"
              />
            </div>
          ) : (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <Label className="text-xs">Partidas (materiales y mano de obra)</Label>
             {products && products.length > 0 && (
               <div className="relative mb-1.5">
                 <Input value={partQuery} onChange={(e) => setPartQuery(e.target.value)} placeholder=" + Agregar repuesto del catalogo (busca por nombre)" className="h-8 text-xs" />
                 {partMatches.length > 0 && (
                   <div className="absolute z-10 mt-1 w-full rounded-lg border border-border bg-card shadow-lg overflow-hidden max-h-40 overflow-y-auto">
                     {partMatches.map((p) => (
                       <button key={p.id} type="button" onClick={() => addRepuesto(p)} className="flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-muted/50">
                         <span className="min-w-0 flex-1 truncate">{p.name}</span>
                         <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">${Number(p.promo_price ?? p.price ?? 0).toLocaleString("es-AR")}</span>
                       </button>
                     ))}
                   </div>
                 )}
               </div>
             )}
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
                    onChange={(e) => setItem(i, { kind: e.target.value as "repuesto" | "material" | "labor" })}
                    className="h-9 rounded-md border border-input bg-background text-xs w-[86px] flex-shrink-0"
                    title="Tipo"
                  >
                    <option value="repuesto">Repuesto</option>
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
          )}
          </>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <div className="border-t border-border px-5 py-3 shrink-0 bg-card flex gap-2">
          <Button variant="outline" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button className="flex-1" disabled={saving || loadingQuote} onClick={submit}>
            {saving ? "Guardando..." : editing ? "Guardar cambios" : isEstetica ? "Crear consulta" : "Crear presupuesto"}
          </Button>
        </div>
      </div>
    </div>
  );
}
