"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Props = {
  vendorId: string;
  vendorName: string;
  servicesList?: string | null;
};

export function QuoteForm({ vendorId, vendorName, servicesList }: Props) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [serviceName, setServiceName] = useState("");
  const [description, setDescription] = useState("");
  const [preferredDate, setPreferredDate] = useState("");
  const [preferredTime, setPreferredTime] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  if (done) {
    return (
      <div className="text-center py-6">
        <p className="text-2xl mb-2">✅</p>
        <p className="font-medium">Presupuesto enviado</p>
        <p className="text-sm text-muted-foreground mt-1">
          {vendorName} te va a responder pronto.
        </p>
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name || !phone || !description) return;
    setLoading(true);
    setError("");

    const res = await fetch("/api/quotes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vendorId,
        customerName: name,
        customerPhone: phone,
        serviceName: serviceName || null,
        description,
        preferredDate: preferredDate || null,
        preferredTime: preferredTime || null,
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
        <Label htmlFor="q-name">Tu nombre</Label>
        <Input id="q-name" value={name} onChange={e => setName(e.target.value)} placeholder="Nombre y apellido" required />
      </div>
      <div>
        <Label htmlFor="q-phone">Tu WhatsApp</Label>
        <Input id="q-phone" value={phone} onChange={e => setPhone(e.target.value)} placeholder="221 555 0000" required />
      </div>
      {servicesList && (
        <div>
          <Label htmlFor="q-service">Servicio que necesitás</Label>
          <Input id="q-service" value={serviceName} onChange={e => setServiceName(e.target.value)} placeholder={servicesList} />
        </div>
      )}
      <div>
        <Label htmlFor="q-desc">Describí lo que necesitás *</Label>
        <Textarea id="q-desc" value={description} onChange={e => setDescription(e.target.value)} placeholder="Contanos brevemente qué necesitás, medidas, cantidades, etc." required rows={3} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="q-date">Fecha preferida</Label>
          <Input id="q-date" type="date" value={preferredDate} onChange={e => setPreferredDate(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="q-time">Horario preferido</Label>
          <Input id="q-time" type="time" value={preferredTime} onChange={e => setPreferredTime(e.target.value)} />
        </div>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? "Enviando..." : "Solicitar presupuesto"}
      </Button>
      <p className="text-xs text-muted-foreground text-center">
        Sin compromiso. {vendorName} te responde por WhatsApp.
      </p>
    </form>
  );
}
