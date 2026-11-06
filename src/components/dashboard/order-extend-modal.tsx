"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { workOrderTitle } from "@/lib/work-order";

/**
 * Prorroga la fecha de entrega de una orden de servicio (eventualidad del
 * taller: falta una pieza, se complicó el trabajo). Guarda la fecha anterior
 * como nota interna y ofrece avisar al cliente por WhatsApp con el texto
 * precargado (se abre wa.me con el mensaje armado).
 */
export function OrderExtendModal({
  booking,
  onClose,
  onSave,
}: {
  booking: any;
  onClose: () => void;
  onSave: (newDate: string, notify: boolean) => void;
}) {
  const prev = String(booking?.delivery_date || "").slice(0, 10);
  const [newDate, setNewDate] = useState(prev);
  const [notify, setNotify] = useState(true);

  return (
    <div className="fixed inset-0 z-[75] flex items-end sm:items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-card rounded-t-2xl sm:rounded-2xl border border-border w-full sm:max-w-sm sm:mx-4 p-5 space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h3 className="font-display text-lg font-semibold">📅 Prorrogar entrega</h3>
          <p className="text-xs text-muted-foreground">
            {workOrderTitle(booking?.work_order_no)} · {booking?.customer_name || "Sin nombre"}
            {prev ? ` · estimada: ${prev.slice(8, 10)}/${prev.slice(5, 7)}` : " · sin fecha estimada"}
          </p>
        </div>

        <div>
          <Label className="text-xs">Nueva fecha de entrega</Label>
          <input
            type="date"
            value={newDate}
            onChange={(e) => setNewDate(e.target.value)}
            className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
          />
        </div>

        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="h-3.5 w-3.5" />
          Avisar al cliente por WhatsApp (se abre el chat con el mensaje listo)
        </label>

        <div className="flex gap-2 pt-1">
          <Button variant="outline" className="flex-1" onClick={onClose}>
            Cancelar
          </Button>
          <Button className="flex-1" disabled={!newDate} onClick={() => onSave(newDate, notify)}>
            Guardar
          </Button>
        </div>
      </div>
    </div>
  );
}
