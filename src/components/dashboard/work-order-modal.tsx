"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CustomerPicker } from "@/components/dashboard/quote-manual-modal";
import { EquipmentPicker } from "@/components/dashboard/equipment-picker";
import { defaultDeliveryISO } from "@/lib/work-order";
import { faultPresetsFor } from "@/lib/work-order";
import type { Equipment } from "@/lib/equipment";

/**
 * Intake ultra-simplificado (estilo RepairBook): recibe el equipo en
 * menos de un minuto. Solo lo indispensable:
 *   1. Cliente (nombre + teléfono)
 *   2. Equipo (elegir o crear al vuelo)
 *   3. Falla (chips por rubro + texto libre)
 *   4. Fecha de entrega estimada
 *   5. Seña (opcional)
 *
 * Todo lo demás (diagnóstico, repuestos, precio final, checklist, notas,
 * firma) se hace después desde la ficha de la orden.
 */
export function WorkOrderModal({
  onClose,
  onCreated,
  serviceOptions,
  vendorCategory,
}: {
  onClose: () => void;
  onCreated: (data: { booking: any; work_order_no: number | null }) => void;
  /** Catálogo de servicios (opcional): no se usa en el intake rápido,
      se vincula después desde el detalle de la orden. */
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const presets = useMemo(() => faultPresetsFor(vendorCategory), [vendorCategory]);

  function togglePreset(item: string) {
    setDeclaredIssue((cur) => {
      const parts = cur.split(/,\s*/).map((s) => s.trim()).filter(Boolean);
      if (parts.includes(item)) return parts.filter((p) => p !== item).join(", ");
      parts.push(item);
      return parts.join(", ");
    });
  }

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
          deposit_amount: depositAmount.trim() ? Number(depositAmount) : null,
          equipment_id: equipment?.id || null,
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
            Ingresá el equipo hoy (sin horario) y estimá una fecha de entrega.
          </p>
        </div>

        <div className="overflow-y-auto px-5 pb-3 space-y-3 flex-1 min-h-0">
          {/* 1. Cliente */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs font-medium">Cliente *</Label>
              <Input
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Nombre"
                className="mt-1 h-9 text-sm"
              />
            </div>
            <div>
              <Label className="text-xs font-medium">Teléfono *</Label>
              <Input
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                placeholder="221 555 0000"
                className="mt-1 h-9 text-sm"
              />
            </div>
          </div>
          <CustomerPicker
            name={customerName}
            phone={customerPhone}
            onPick={(n, p) => {
              setCustomerName(n);
              setCustomerPhone(p);
            }}
          />

          {/* 2. Equipo */}
          <EquipmentPicker
            phone={customerPhone}
            customerName={customerName}
            value={equipment}
            onChange={setEquipment}
          />

          {/* 3. Falla declarada */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-medium">Falla declarada *</Label>
              <span className="text-[10px] text-muted-foreground">toca los chips o escribí</span>
            </div>
            <div className="flex flex-wrap gap-1 mb-1">
              {presets.items.map((item) => {
                const parts = declaredIssue.split(/,\s*/).filter(Boolean);
                const on = parts.includes(item);
                return (
                  <button
                    key={item}
                    type="button"
                    onClick={() => togglePreset(item)}
                    className={`rounded-full border px-2 py-1 text-[11px] font-medium whitespace-nowrap ${on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:bg-muted"}`}
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
              className="mt-0.5 text-sm"
            />
          </div>

          {/* 4. Entrega estimada */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs font-medium">Entrega estimada</Label>
              <Input
                type="date"
                value={deliveryDate}
                onChange={(e) => setDeliveryDate(e.target.value)}
                className="mt-1 h-9 text-sm"
              />
              <p className="text-[10px] text-muted-foreground mt-0.5">Vacío = a convenir.</p>
            </div>
            <div>
              <Label className="text-xs font-medium">Seña (opcional)</Label>
              <Input
                type="number"
                min={0}
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                placeholder="$"
                className="mt-1 h-9 text-sm"
              />
              <p className="text-[10px] text-muted-foreground mt-0.5">Se cobra después.</p>
            </div>
          </div>

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
