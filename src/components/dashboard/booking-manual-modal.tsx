"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CustomerPicker } from "@/components/dashboard/quote-manual-modal";

export function BookingManualModal({
  initialDate,
  onClose,
  onCreated,
}: {
  initialDate?: string;
  onClose: () => void;
  onCreated: (warning?: string | null) => void;
}) {
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [serviceName, setServiceName] = useState("");
  const [bookingDate, setBookingDate] = useState(initialDate || new Date().toISOString().slice(0, 10));
  const [bookingTime, setBookingTime] = useState("");
  const [duration, setDuration] = useState("60");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setError("");
    if (!customerName.trim() || !customerPhone.trim() || !bookingDate || !bookingTime) {
      setError("Faltan cliente, teléfono, fecha u hora");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/vendor/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_name: customerName.trim(),
          customer_phone: customerPhone.trim(),
          product_name: serviceName.trim() || null,
          booking_date: bookingDate,
          booking_time: bookingTime,
          duration_min: Number(duration) || 60,
          notes: notes.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "No se pudo crear");
      onCreated(data.warning || null);
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
          <h3 className="font-display text-lg font-semibold">＋ Nuevo turno</h3>
          <p className="text-xs text-muted-foreground">Nace confirmado (entra a recordatorios). No cuenta para el tope.</p>
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
            <Input value={serviceName} onChange={(e) => setServiceName(e.target.value)} placeholder="Ej: arreglo, instalación..." className="mt-1 h-9 text-sm" />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <Label className="text-xs">Fecha *</Label>
              <Input type="date" value={bookingDate} onChange={(e) => setBookingDate(e.target.value)} className="mt-1 h-9 text-sm" />
            </div>
            <div>
              <Label className="text-xs">Hora *</Label>
              <Input type="time" value={bookingTime} onChange={(e) => setBookingTime(e.target.value)} className="mt-1 h-9 text-sm" />
            </div>
            <div>
              <Label className="text-xs">Duración (min)</Label>
              <Input type="number" min={15} max={480} value={duration} onChange={(e) => setDuration(e.target.value)} className="mt-1 h-9 text-sm" />
            </div>
          </div>
          <div>
            <Label className="text-xs">Notas</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Dirección, referencias..." rows={2} className="mt-1 text-sm" />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <div className="border-t border-border px-5 py-3 shrink-0 bg-card flex gap-2">
          <Button variant="outline" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button className="flex-1" disabled={saving} onClick={submit}>
            {saving ? "Guardando..." : "Agendar turno"}
          </Button>
        </div>
      </div>
    </div>
  );
}
