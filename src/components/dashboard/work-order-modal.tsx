"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CustomerPicker } from "@/components/dashboard/quote-manual-modal";
import { EquipmentPicker } from "@/components/dashboard/equipment-picker";
import { defaultDeliveryISO } from "@/lib/work-order";
import { ACCESORIO_PRESETS, faultPresetsFor, type IntakeChecklist } from "@/lib/work-order";
import type { Equipment } from "@/lib/equipment";

/**
 * Intake < 60s (RepairBook/SpokeHub): recepción de taller en 3 toques —
 * cliente (autocompleta + sus equipos) → equipo (elegir/crear con foto) →
 * falla (chips por rubro + texto) y entrega/seña/precio estimado.
 * Checklist de ingreso OPCIONAL y genérico (colapsado por defecto):
 * accesorios, contraseña/patrón y estado al recibir — sirve igual para
 * bicicletería, electrónica, electrodomésticos, hogar, etc.
 */
export function WorkOrderModal({
  onClose,
  onCreated,
  serviceOptions,
  vendorCategory,
}: {
  onClose: () => void;
  onCreated: (data: { booking: any; work_order_no: number | null }) => void;
  /** Catálogo de servicios (opcional): etiqueta rápida del trabajo. */
  serviceOptions?: { id: string; name: string }[];
  /** Rubro del comercio (para las chips de falla). */
  vendorCategory?: string;
}) {
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [equipment, setEquipment] = useState<Equipment | null>(null);
  const [declaredIssue, setDeclaredIssue] = useState("");
  const [deliveryDate, setDeliveryDate] = useState(defaultDeliveryISO());
  const [depositAmount, setDepositAmount] = useState("");
  const [estimatedPrice, setEstimatedPrice] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Checklist de ingreso (opcional): colapsado por defecto — intake rápido.
  const [showChecklist, setShowChecklist] = useState(false);
  const [checklist, setChecklist] = useState<IntakeChecklist>({ accessories: [] });

  const presets = useMemo(() => faultPresetsFor(vendorCategory), [vendorCategory]);

  function togglePreset(item: string) {
    setDeclaredIssue((cur) => {
      const parts = cur.split(/,\s*/).map((s) => s.trim()).filter(Boolean);
      if (parts.includes(item)) return parts.filter((p) => p !== item).join(", ");
      parts.push(item);
      return parts.join(", ");
    });
  }

  const checklistHasContent =
    (checklist.accessories?.length || 0) > 0 ||
    !!(checklist.other && checklist.other.trim()) ||
    !!(checklist.unlock && checklist.unlock.trim()) ||
    !!(checklist.condition && checklist.condition.trim());

  async function submit() {
    setError("");
    if (!customerName.trim() || !customerPhone.trim() || !declaredIssue.trim()) {
      setError("Faltan cliente, teléfono o la falla declarada");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/vendor/work-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_name: customerName.trim(),
          customer_phone: customerPhone.trim(),
          declared_issue: declaredIssue.trim(),
          delivery_date: deliveryDate || null,
          notes: notes.trim() || null,
          deposit_amount: depositAmount.trim() ? Number(depositAmount) : null,
          service_price: estimatedPrice.trim() ? Number(estimatedPrice) : null,
          equipment_id: equipment?.id || null,
          intake_checklist: checklistHasContent ? checklist : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "No se pudo crear la orden");
      onCreated(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo crear la orden");
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
          <h3 className="font-display text-lg font-semibold">🛠️ Nueva orden de servicio</h3>
          <p className="text-xs text-muted-foreground">
            Ingresá el equipo hoy (sin horario) y estimá una fecha de entrega. Con precio estimado nace aprobada.
          </p>
        </div>

        <div className="overflow-y-auto px-5 pb-3 space-y-3 flex-1 min-h-0">
          <CustomerPicker
            name={customerName}
            phone={customerPhone}
            onPick={(n, p) => {
              setCustomerName(n);
              setCustomerPhone(p);
            }}
          />
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Cliente *</Label>
              <Input
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Nombre"
                className="mt-1 h-9 text-sm"
              />
            </div>
            <div>
              <Label className="text-xs">Teléfono *</Label>
              <Input
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                placeholder="221 555 0000"
                className="mt-1 h-9 text-sm"
              />
            </div>
          </div>

          <EquipmentPicker
            phone={customerPhone}
            customerName={customerName}
            value={equipment}
            onChange={setEquipment}
          />

          <div>
            <Label className="text-xs">Falla declarada / trabajo a realizar *</Label>
            {/* Chips por rubro: un toque arma la falla (editable después) */}
            <div className="flex flex-wrap gap-1 mt-1.5">
              {presets.items.map((item) => {
                const parts = declaredIssue.split(/,\s*/).filter(Boolean);
                const on = parts.includes(item);
                return (
                  <button
                    key={item}
                    type="button"
                    onClick={() => togglePreset(item)}
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:bg-muted"}`}
                  >
                    {item}
                  </button>
                );
              })}
            </div>
            <Textarea
              value={declaredIssue}
              onChange={(e) => setDeclaredIssue(e.target.value)}
              placeholder="Ej: rueda trasera descentrada, cambio de cubierta y revisión de frenos"
              rows={2}
              className="mt-1.5 text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Entrega estimada</Label>
              <Input
                type="date"
                value={deliveryDate}
                onChange={(e) => setDeliveryDate(e.target.value)}
                className="mt-1 h-9 text-sm"
              />
              <p className="text-[10px] text-muted-foreground mt-0.5">Vacío = a convenir con el cliente.</p>
            </div>
            <div>
              <Label className="text-xs">Seña (opcional)</Label>
              <Input
                type="number"
                min={0}
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                placeholder="$"
                className="mt-1 h-9 text-sm"
              />
              <p className="text-[10px] text-muted-foreground mt-0.5">Después generás el link de cobro.</p>
            </div>
          </div>

          <div>
            <Label className="text-xs">Precio estimado (opcional)</Label>
            <Input
              type="number"
              min={0}
              value={estimatedPrice}
              onChange={(e) => setEstimatedPrice(e.target.value)}
              placeholder="$ (si lo sabés al ingreso)"
              className="mt-1 h-9 text-sm"
            />
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Si lo cargás, la orden nace "Aprobada" (sin presupuesto). Si el costo cambia después, cotizá con partidas.
            </p>
          </div>

          {/* Checklist de ingreso — OPCIONAL, colapsado por defecto */}
          {!showChecklist ? (
            <button
              type="button"
              className="text-xs text-primary font-medium hover:underline"
              onClick={() => setShowChecklist(true)}
            >
              ＋ Checklist de ingreso (opcional: accesorios, contraseña, estado)
            </button>
          ) : (
            <div className="rounded-xl border border-border p-2.5 space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Checklist de ingreso — tildá lo que entrega el cliente
              </p>
              <div className="flex flex-wrap gap-1">
                {ACCESORIO_PRESETS.map((a) => {
                  const on = (checklist.accessories || []).includes(a);
                  return (
                    <button
                      key={a}
                      type="button"
                      onClick={() => {
                        const cur = checklist.accessories || [];
                        setChecklist({
                          ...checklist,
                          accessories: on ? cur.filter((x) => x !== a) : [...cur, a],
                        });
                      }}
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:bg-muted"}`}
                    >
                      {a}
                    </button>
                  );
                })}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <Input
                  value={checklist.other || ""}
                  onChange={(e) => setChecklist({ ...checklist, other: e.target.value })}
                  placeholder="Otros accesorios (libre)"
                  className="h-8 text-xs"
                />
                <Input
                  value={checklist.unlock || ""}
                  onChange={(e) => setChecklist({ ...checklist, unlock: e.target.value })}
                  placeholder="🔑 Contraseña / patrón"
                  className="h-8 text-xs"
                />
              </div>
              <Input
                value={checklist.condition || ""}
                onChange={(e) => setChecklist({ ...checklist, condition: e.target.value })}
                placeholder="Estado al recibir (rayones, golpes, falta algo...)"
                className="h-8 text-xs"
              />
              <p className="text-[10px] text-muted-foreground">
                Solo lo ve tu taller (nunca el cliente). Sirve para cualquier rubro.
              </p>
            </div>
          )}

          <div>
            <Label className="text-xs">Notas internas</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Detalles para el taller (no se imprime en el comprobante)"
              rows={2}
              className="mt-1 text-sm"
            />
          </div>

          {serviceOptions && serviceOptions.length > 0 && (
            <p className="text-[11px] text-muted-foreground">
              Si el trabajo coincide con un servicio del catálogo, podés vincularlo después desde el detalle de la orden.
            </p>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        <div className="border-t border-border px-5 py-3 shrink-0 bg-card flex gap-2">
          <Button variant="outline" className="flex-1" onClick={onClose}>
            Cancelar
          </Button>
          <Button className="flex-1" disabled={saving} onClick={submit}>
            {saving ? "Guardando..." : "Crear orden"}
          </Button>
        </div>
      </div>
    </div>
  );
}
