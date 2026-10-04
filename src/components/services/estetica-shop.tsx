"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { ProductImage } from "@/components/product-image";

const money = (n: number) => `$${Number(n).toLocaleString("es-AR")}`;

/** Carta visual de servicios (estilo apps de belleza): foto, precio, duración y Elegir. */
export function ServicePickCards({
  services,
}: {
  services: { id: string; name: string; deposit_amount: number | null; duration_min: number | null; price: number | null; require_deposit?: boolean | null; image_url?: string | null }[];
}) {
  if (services.length === 0) return null;
  function pick(id: string) {
    try {
      window.dispatchEvent(new CustomEvent("portal:pick-service", { detail: { serviceId: id } }));
      document.getElementById("reservar-turno")?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch { /* noop */ }
  }
  return (
    <div className="grid sm:grid-cols-2 gap-3">
      {services.map((s) => (
        <Card key={s.id} className="p-3 flex gap-3 items-center">
          <div className="h-16 w-16 rounded-xl overflow-hidden flex-shrink-0 bg-muted">
            <ProductImage src={s.image_url || null} name={s.name} vertical="estetica" alt={s.name} className="w-full h-full object-cover" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm truncate">{s.name}</p>
            <p className="text-xs text-muted-foreground">
              {s.duration_min ? `${s.duration_min} min` : ""}
              {s.price != null ? ` · ${money(Number(s.price))}` : ""}
              {s.require_deposit ? " · 🔒 con seña" : ""}
            </p>
            <Button size="sm" className="mt-1.5 h-8 text-xs" onClick={() => pick(s.id)}>
              Elegir
            </Button>
          </div>
        </Card>
      ))}
    </div>
  );
}

/**
 * Compra online de un pack de sesiones (estética) con Mercado Pago.
 * Cobra con la cuenta del comercio; el webhook acredita las sesiones
 * al teléfono ingresado (llega solo, sin espera).
 */
export function PackBuyCard({
  vendorId,
  pack,
  mpConnected,
  waUrl,
}: {
  vendorId: string;
  pack: { id: string; name: string; sessions_total: number | null; price: number | null };
  mpConnected: boolean;
  waUrl: string;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const price = pack.price != null ? Number(pack.price) : 0;

  async function buy() {
    if (!name.trim() || !phone.trim()) {
      setError("Completá tu nombre y WhatsApp");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/pack-purchase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendorId, packId: pack.id, customerName: name.trim(), customerPhone: phone.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.error || !data.initPoint) {
        setError(data.error || "No se pudo crear el pago");
        return;
      }
      window.location.href = data.initPoint;
    } catch {
      setError("Error de conexión");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="p-4 space-y-2">
      <p className="font-semibold text-sm">🎟️ {pack.name}</p>
      <p className="text-xs text-muted-foreground">
        {pack.sessions_total} sesiones · <strong className="text-foreground">{money(price)}</strong>
      </p>
      {!open ? (
        <div className="flex gap-2">
          {mpConnected && price > 0 ? (
            <Button size="sm" className="flex-1" onClick={() => setOpen(true)}>Comprar online</Button>
          ) : null}
          <a href={waUrl} target="_blank" rel="noopener noreferrer" className="flex-1">
            <Button size="sm" variant={mpConnected && price > 0 ? "outline" : "default"} className="w-full">
              Pedir por WhatsApp
            </Button>
          </a>
        </div>
      ) : (
        <div className="space-y-2">
          <div>
            <Label className="text-xs">Tu nombre</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre y apellido" className="mt-1 h-9 text-sm" />
          </div>
          <div>
            <Label className="text-xs">Tu WhatsApp (ahí se acreditan las sesiones)</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="221 555 0000" className="mt-1 h-9 text-sm" />
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="flex-1" onClick={() => setOpen(false)}>Atrás</Button>
            <Button size="sm" className="flex-1" onClick={buy} disabled={loading}>
              {loading ? "Creando pago..." : `Pagar ${money(price)}`}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

/**
 * Compra online de giftcard (estética) con Mercado Pago.
 * El comercio recibe el código y se lo pasa a la agasajada por WhatsApp.
 */
export function GiftcardBuyCard({
  vendorId,
  mpConnected,
  waUrl,
}: {
  vendorId: string;
  mpConnected: boolean;
  waUrl: string;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function buy() {
    if (!(Number(amount) >= 1000) || !name.trim() || !phone.trim()) {
      setError("Monto mínimo $1.000 + tu nombre y WhatsApp");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/giftcards/buy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendorId, amount: Number(amount), customerName: name.trim(), customerPhone: phone.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.error || !data.initPoint) {
        setError(data.error || "No se pudo crear el pago");
        return;
      }
      window.location.href = data.initPoint;
    } catch {
      setError("Error de conexión");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="p-4 space-y-2">
      <p className="font-semibold text-sm">🎁 Giftcard para regalar</p>
      <p className="text-xs text-muted-foreground">
        Elegís el monto, pagás online y el local le pasa el código a quien vos digas por WhatsApp.
      </p>
      {!open ? (
        <div className="flex gap-2">
          {mpConnected ? (
            <Button size="sm" className="flex-1" onClick={() => setOpen(true)}>Comprar giftcard</Button>
          ) : null}
          <a href={waUrl} target="_blank" rel="noopener noreferrer" className="flex-1">
            <Button size="sm" variant={mpConnected ? "outline" : "default"} className="w-full">
              Pedir por WhatsApp
            </Button>
          </a>
        </div>
      ) : (
        <div className="space-y-2">
          <div>
            <Label className="text-xs">Monto ($, mínimo 1.000)</Label>
            <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="numeric" placeholder="Ej: 20000" className="mt-1 h-9 text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Tu nombre</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Quién regala" className="mt-1 h-9 text-sm" />
            </div>
            <div>
              <Label className="text-xs">Tu WhatsApp</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="221 555 0000" className="mt-1 h-9 text-sm" />
            </div>
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="flex-1" onClick={() => setOpen(false)}>Atrás</Button>
            <Button size="sm" className="flex-1" onClick={buy} disabled={loading}>
              {loading ? "Creando pago..." : "Pagar"}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
