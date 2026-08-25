"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Props = {
  vendorId: string;
  vendorName: string;
  services?: { id: string; name: string }[];
};

export function BookingForm({ vendorId, vendorName, services }: Props) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [productName, setProductName] = useState("");
  const [bookingDate, setBookingDate] = useState("");
  const [bookingTime, setBookingTime] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  if (done) {
    return (
      <div className="text-center py-6">
        <p className="text-2xl mb-2">📅</p>
        <p className="font-medium">Turno reservado</p>
        <p className="text-sm text-muted-foreground mt-1">
          {bookingDate} a las {bookingTime}. {vendorName} te va a confirmar.
        </p>
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name || !phone || !bookingDate || !bookingTime) return;
    setLoading(true);
    setError("");

    const res = await fetch("/api/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vendorId,
        customerName: name,
        customerPhone: phone,
        productName: productName || null,
        bookingDate,
        bookingTime,
        notes: notes || null,
      }),
    });

    const data = await res.json();
    if (data.error) {
      setError(data.error);
      setLoading(false);
      return;
    }

    setDone(true);
    setLoading(false);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <Label htmlFor="b-name">Tu nombre</Label>
        <Input id="b-name" value={name} onChange={e => setName(e.target.value)} placeholder="Nombre y apellido" required />
      </div>
      <div>
        <Label htmlFor="b-phone">Tu WhatsApp</Label>
        <Input id="b-phone" value={phone} onChange={e => setPhone(e.target.value)} placeholder="221 555 0000" required />
      </div>
      {services && services.length > 0 && (
        <div>
          <Label htmlFor="b-service">Servicio</Label>
          <select
            id="b-service"
            value={productName}
            onChange={e => setProductName(e.target.value)}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="">Seleccionar servicio</option>
            {services.map(s => (
              <option key={s.id} value={s.name}>{s.name}</option>
            ))}
          </select>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="b-date">Fecha *</Label>
          <Input id="b-date" type="date" value={bookingDate} onChange={e => setBookingDate(e.target.value)} required />
        </div>
        <div>
          <Label htmlFor="b-time">Horario *</Label>
          <Input id="b-time" type="time" value={bookingTime} onChange={e => setBookingTime(e.target.value)} required />
        </div>
      </div>
      <div>
        <Label htmlFor="b-notes">Notas (opcional)</Label>
        <Textarea id="b-notes" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Alguna indicación extra..." rows={2} />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? "Reservando..." : "Reservar turno"}
      </Button>
      <p className="text-xs text-muted-foreground text-center">
        {vendorName} te va a confirmar la disponibilidad por WhatsApp.
      </p>
    </form>
  );
}
