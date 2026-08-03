"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useCart } from "@/lib/cart";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function CheckoutPage() {
  const router = useRouter();
  const { vendor, items, total, clear } = useCart();

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [method, setMethod] = useState<"delivery" | "pickup">("delivery");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  if (!vendor || items.length === 0) {
    return (
      <main className="container mx-auto px-4 py-20 max-w-md text-center">
        <h1 className="text-2xl font-bold mb-4">Tu pedido está vacío</h1>
        <p className="text-gray-500 mb-6">
          Agregá platos de un local para poder hacer el pedido.
        </p>
        <Button onClick={() => router.push("/")}>Ver ofertas</Button>
      </main>
    );
  }

  const v = vendor;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name || !phone) return;

    setLoading(true);
    setError("");

    const res = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vendorId: v.id,
        customerName: name,
        customerPhone: phone,
        customerAddress: method === "delivery" ? address : null,
        method,
        items: items.map((i) => ({
          name: i.name,
          price: i.price,
          qty: i.qty,
        })),
        total,
      }),
    });

    const data = await res.json();

    if (data.error) {
      setError(data.error);
      setLoading(false);
      return;
    }

    const lines = items.map(
      (i) => `- ${i.qty}x ${i.name} ($${(i.price * i.qty).toLocaleString("es-AR")})`
    );

    const message = [
      `Hola ${v.storeName}! Quiero hacer un pedido:`,
      "",
      ...lines,
      "",
      `Total: $${total.toLocaleString("es-AR")}`,
      `Nombre: ${name}`,
      `WhatsApp: ${phone}`,
      method === "delivery" ? `Dirección: ${address}` : "Retiro en el local",
    ].join("\n");

    const waNumber = v.whatsapp.replace(/[^0-9]/g, "");
    window.open(
      `https://wa.me/${waNumber}?text=${encodeURIComponent(message)}`,
      "_blank"
    );

    clear();
    setDone(true);
    setLoading(false);
  }

  if (done) {
    return (
      <main className="container mx-auto px-4 py-20 max-w-md text-center">
        <h1 className="text-2xl font-bold mb-4">Pedido enviado</h1>
        <p className="text-gray-600 mb-6">
          Se abrió WhatsApp con tu pedido para{" "}
          <span className="font-medium">{v.storeName}</span>. El local te
          va a confirmar el pedido y el pago por ahí.
        </p>
        <Button onClick={() => router.push("/")}>Seguir viendo ofertas</Button>
      </main>
    );
  }

  return (
    <main className="container mx-auto px-4 py-8 max-w-md">
      <h1 className="text-2xl font-bold mb-2">Confirmar pedido</h1>
      <p className="text-gray-500 text-sm mb-6">
        Con {v.storeName} · {items.length} items ·{" "}
        <span className="font-semibold">${total.toLocaleString("es-AR")}</span>
      </p>

      <div className="border rounded-lg p-4 mb-6 bg-gray-50 space-y-1">
        {items.map((i) => (
          <p key={i.offerId} className="text-sm flex justify-between">
            <span>
              {i.qty}x {i.name}
            </span>
            <span className="font-medium">
              ${Number(i.price * i.qty).toLocaleString("es-AR")}
            </span>
          </p>
        ))}
        <div className="border-t pt-2 mt-2 flex justify-between font-bold">
          <span>Total</span>
          <span>${total.toLocaleString("es-AR")}</span>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <Label htmlFor="name">Tu nombre</Label>
          <Input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nombre y apellido"
            required
          />
        </div>
        <div>
          <Label htmlFor="phone">Tu WhatsApp</Label>
          <Input
            id="phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="221 555 0000"
            required
          />
        </div>
        <div>
          <Label>¿Retirás o pedís delivery?</Label>
          <div className="flex gap-2 mt-1">
            <button
              type="button"
              onClick={() => setMethod("delivery")}
              className={`flex-1 rounded-md border py-2 text-sm ${
                method === "delivery"
                  ? "border-primary bg-primary/5 font-medium"
                  : "text-gray-500"
              }`}
            >
              A domicilio
            </button>
            <button
              type="button"
              onClick={() => setMethod("pickup")}
              className={`flex-1 rounded-md border py-2 text-sm ${
                method === "pickup"
                  ? "border-primary bg-primary/5 font-medium"
                  : "text-gray-500"
              }`}
            >
              Retiro en el local
            </button>
          </div>
        </div>
        {method === "delivery" && (
          <div>
            <Label htmlFor="address">Dirección</Label>
            <Input
              id="address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Calle y número"
            />
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? "Enviando pedido..." : "Enviar pedido por WhatsApp"}
        </Button>
        <p className="text-xs text-gray-400 text-center">
          El pedido se envía al WhatsApp del local. Sin registro, sin pagar
          online: el local te pasa el total y coordinás el pago directo.
        </p>
      </form>
    </main>
  );
}
