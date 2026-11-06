"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CustomerPicker } from "@/components/dashboard/quote-manual-modal";
import { EquipmentPicker } from "@/components/dashboard/equipment-picker";
import { defaultDeliveryISO } from "@/lib/work-order";
import type { Equipment } from "@/lib/equipment";

/**
 * Alta de ORDEN DE SERVICIO (recepción de taller): el cliente deja el equipo
 * hoy y se lleva una fecha de entrega estimada. Sin hora ni duración.
 * Seña opcional: si se carga un monto, el panel genera el link de MP después
 * (endpoint de turnos, misma rama del webhook).
 */
export function WorkOrderModal({
  onClose,
  onCreated,
  serviceOptions,
}: {
  onClose: () => void;
  onCreated: (data: { booking: any; work_order_no: number | null }) => void;
  /** Catálogo de servicios (opcional): etiqueta rápida del trabajo. */
  serviceOptions?: { id: string; name: string }[];
}) {
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [equipment, setEquipment] = useState<Equipment | null>(null);
  const [declaredIssue, setDeclaredIssue] = useState("");
  const [deliveryDate, setDeliveryDate] = useState(defaultDeliveryISO());
  const [depositAmount, setDepositAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

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
            Recepción de taller: se ingresa hoy (sin horario) y se estima una fecha de entrega.
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
            <Textarea
              value={declaredIssue}
              onChange={(e) => setDeclaredIssue(e.target.value)}
              placeholder="Ej: rueda trasera descentrada, cambio de cubierta y revisión de frenos"
              rows={2}
              className="mt-1 text-sm"
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
