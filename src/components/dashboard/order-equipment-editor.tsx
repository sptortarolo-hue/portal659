"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { orderEquipmentLabel } from "@/lib/equipment";

export type OrderForEquipment = {
  id: string;
  customer_name: string | null;
  customer_phone: string | null;
  equipment_id?: string | null;
  equipment_brand?: string | null;
  equipment_model?: string | null;
  equipment_rodado?: string | null;
  equipment_identifier?: string | null;
  equipment_color?: string | null;
  equipment_notes?: string | null;
  declared_issue?: string | null;
};

/**
 * Editor de la ficha del equipo desde la orden de servicio: cargarla si no
 * existe o corregirla. Guarda en `equipment` y, si la orden no tenía equipo,
 * la vincula con el PATCH del booking.
 */
export function OrderEquipmentEditor({
  order,
  onClose,
  onSaved,
}: {
  order: OrderForEquipment;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [brand, setBrand] = useState(String(order.equipment_brand || ""));
  const [model, setModel] = useState(String(order.equipment_model || ""));
  const [rodado, setRodado] = useState(String(order.equipment_rodado || ""));
  const [identifier, setIdentifier] = useState(String(order.equipment_identifier || ""));
  const [color, setColor] = useState(String(order.equipment_color || ""));
  const [notes, setNotes] = useState(String(order.equipment_notes || ""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const current = orderEquipmentLabel(order);
  const empty =
    !brand.trim() && !model.trim() && !identifier.trim() && !rodado.trim() && !color.trim();

  async function save() {
    if (empty) {
      setError("Cargá al menos marca/modelo o N° de serie");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const payload = { brand, model, identifier, rodado, color, notes };
      const equipmentId = String(order.equipment_id || "");
      if (equipmentId) {
        const res = await fetch(`/api/vendor/equipment/${equipmentId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => ({}));
        if (res.status === 503) {
          setError(String(data?.error || "Falta aplicar la migración migrate-equipment.sql en la base"));
          return;
        }
        if (!res.ok) throw new Error(String(data?.error || "No se pudo guardar el equipo"));
      } else {
        const res = await fetch("/api/vendor/equipment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...payload,
            customer_name: order.customer_name || null,
            customer_phone: order.customer_phone,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.status === 503) {
          setError(String(data?.error || "Falta aplicar la migración migrate-equipment.sql en la base"));
          return;
        }
        if (!res.ok || !data?.equipment?.id) throw new Error(String(data?.error || "No se pudo crear el equipo"));
        // Vincular el equipo nuevo a la orden.
        const link = await fetch(`/api/vendor/bookings/${order.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ equipment_id: String(data.equipment.id) }),
        });
        if (!link.ok) throw new Error("El equipo se creó pero no se pudo vincular a la orden");
      }
      await onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar el equipo");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4" onClick={onClose}>
      <div
        className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl border border-border bg-card max-h-[92vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 pb-2 border-b border-border">
          <h3 className="font-display text-base font-semibold">🚲 Ficha del equipo</h3>
          <p className="text-xs text-muted-foreground">
            {order.equipment_id
              ? `Editando: ${current || "sin datos"}`
              : "La orden quedó sin equipo cargado: completalo acá."}
          </p>
        </div>

        <div className="p-4 space-y-2.5 overflow-y-auto">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Marca</Label>
              <Input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Scott" className="mt-1 h-9 text-sm" />
            </div>
            <div>
              <Label className="text-xs">Modelo</Label>
              <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="XT rodado 29" className="mt-1 h-9 text-sm" />
            </div>
            <div>
              <Label className="text-xs">N° de cuadro / serie</Label>
              <Input value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="ABC123" className="mt-1 h-9 text-sm" />
            </div>
            <div>
              <Label className="text-xs">Rodado / medida</Label>
              <Input value={rodado} onChange={(e) => setRodado(e.target.value)} placeholder="29" className="mt-1 h-9 text-sm" />
            </div>
            <div>
              <Label className="text-xs">Color</Label>
              <Input value={color} onChange={(e) => setColor(e.target.value)} placeholder="Negro" className="mt-1 h-9 text-sm" />
            </div>
          </div>
          <div>
            <Label className="text-xs">Notas del equipo</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Detalles, estado, historial..."
              className="mt-1 min-h-[70px] text-sm"
            />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <div className="p-4 pt-2 border-t border-border flex gap-2">
          <Button variant="outline" className="flex-1 h-9 text-sm" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button className="flex-1 h-9 text-sm" onClick={save} disabled={busy || empty}>
            {busy ? "Guardando..." : "Guardar ficha"}
          </Button>
        </div>
      </div>
    </div>
  );
}
