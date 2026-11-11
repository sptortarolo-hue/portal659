"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { orderEquipmentLabel, inferEquipmentKind, equipmentAttrLabel } from "@/lib/equipment";
import { EQUIPMENT_KINDS, equipmentEmoji, equipmentKindLabel, type EquipmentKind } from "@/lib/equipment";

export type OrderForEquipment = {
  id: string;
  customer_name: string | null;
  customer_phone: string | null;
  equipment_id?: string | null;
  equipment_kind?: string | null;
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
  // Tipo de equipo: el de la ficha existente, o el inferido del rubro del
  // comercio al crear una nueva (una gomería crea motos, no bicis).
  const [kind, setKind] = useState<EquipmentKind>("otro");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Tipo inicial: el del equipo vinculado, o el inferido del rubro (una vez).
  useEffect(() => {
    let cancelled = false;
    fetch("/api/vendor/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled) return;
        const fromOrder = (order as { equipment_kind?: string | null }).equipment_kind;
        const next = fromOrder || inferEquipmentKind(d?.vendor?.category);
        setKind(next as EquipmentKind);
      })
      .catch(() => {
        if (!cancelled) setKind("otro");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  /** Mensaje legible de una respuesta fallida (con status si no trae error). */
  async function failMessage(res: Response, fallback: string): Promise<string> {
    let msg = "";
    try {
      const data = await res.json();
      msg = String(data?.error || "");
    } catch {
      try {
        msg = (await res.text()).slice(0, 200);
      } catch {
        /* sin cuerpo */
      }
    }
    return msg || `${fallback} (error ${res.status})`;
  }

  async function save() {
    if (empty) {
      setError("Cargá al menos marca/modelo o N° de serie");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const payload = { brand, model, identifier, rodado, color, notes, kind };
      const equipmentId = String(order.equipment_id || "");
      if (equipmentId) {
        const res = await fetch(`/api/vendor/equipment/${equipmentId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (res.status === 503) {
          setError(await failMessage(res, "Falta aplicar la migración migrate-equipment.sql en la base"));
          return;
        }
        if (!res.ok) throw new Error(await failMessage(res, "No se pudo guardar el equipo"));
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
        if (res.status === 503) {
          setError(await failMessage(res, "Falta aplicar la migración migrate-equipment.sql en la base"));
          return;
        }
        const data = res.ok ? await res.json().catch(() => ({})) : {};
        if (!res.ok || !data?.equipment?.id) {
          throw new Error(await failMessage(res, "No se pudo crear el equipo"));
        }
        // Vincular el equipo nuevo a la orden.
        const link = await fetch(`/api/vendor/bookings/${order.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ equipment_id: String(data.equipment.id) }),
        });
        if (!link.ok) throw new Error(await failMessage(link, "El equipo se creó pero no se pudo vincular a la orden"));
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
          <h3 className="font-display text-base font-semibold">{equipmentEmoji(kind)} Ficha del equipo</h3>
          <p className="text-xs text-muted-foreground">
            {order.equipment_id
              ? `Editando: ${current || "sin datos"}`
              : "La orden quedó sin equipo cargado: completalo acá."}
          </p>
        </div>

        <div className="p-4 space-y-2.5 overflow-y-auto">
          <div className="flex flex-wrap gap-1">
            {EQUIPMENT_KINDS.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={`px-2 h-6 rounded-md text-[11px] font-medium ${kind === k ? "bg-primary text-primary-foreground" : "text-muted-foreground border border-border"}`}
              >
                {equipmentEmoji(k)} {equipmentKindLabel(k)}
              </button>
            ))}
          </div>
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
              <Label className="text-xs">{equipmentAttrLabel(kind)}</Label>
              <Input value={rodado} onChange={(e) => setRodado(e.target.value)} placeholder={equipmentAttrLabel(kind)} className="mt-1 h-9 text-sm" />
            </div>
            <div>
              <Label className="text-xs">{kind === "automotor" ? "N° de motor / VIN" : "N° de cuadro / serie"}</Label>
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
