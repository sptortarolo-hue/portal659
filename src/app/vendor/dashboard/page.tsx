"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PRIMARY_NEIGHBORHOOD } from "@/lib/config";

type Vendor = {
  id: string;
  store_name: string;
  slug: string | null;
  category: string | null;
  neighborhood: string | null;
  whatsapp: string | null;
  address: string | null;
  hours: string | null;
  description: string | null;
  image_url: string | null;
};

type Offer = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  category: string | null;
  available: boolean;
  featured_today: boolean;
};

type Order = {
  id: string;
  customer_name: string;
  customer_phone: string;
  customer_address: string | null;
  method: "pickup" | "delivery";
  items: { name: string; price: number; qty: number }[];
  total: number;
  status: "new" | "confirmed" | "completed" | "cancelled";
  created_at: string;
};

const CATEGORIES = [
  "empanadas",
  "pizzas",
  "pastas",
  "asado",
  "postres",
  "regional",
  "otras",
];

const STATUS_LABELS: Record<Order["status"], string> = {
  new: "Nuevo",
  confirmed: "Confirmado",
  completed: "Completado",
  cancelled: "Cancelado",
};

const STATUS_COLORS: Record<Order["status"], string> = {
  new: "bg-blue-100 text-blue-700",
  confirmed: "bg-amber-100 text-amber-700",
  completed: "bg-green-100 text-green-700",
  cancelled: "bg-red-100 text-red-700",
};

export default function VendorDashboard() {
  const router = useRouter();
  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [tab, setTab] = useState<"menu" | "orders">("menu");
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");

  // Vendor form
  const [storeName, setStoreName] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [address, setAddress] = useState("");
  const [hours, setHours] = useState("");
  const [description, setDescription] = useState("");

  // New offer form
  const [showNew, setShowNew] = useState(false);
  const [offName, setOffName] = useState("");
  const [offDesc, setOffDesc] = useState("");
  const [offPrice, setOffPrice] = useState("");
  const [offCategory, setOffCategory] = useState("empanadas");
  const [saving, setSaving] = useState(false);

  async function loadData() {
    const [meRes, offersRes, ordersRes] = await Promise.all([
      fetch("/api/vendor/me"),
      fetch("/api/vendor/offers"),
      fetch("/api/vendor/orders"),
    ]);
    const me = await meRes.json();
    const off = await offersRes.json();
    const ord = await ordersRes.json();

    if (me.vendor) {
      setVendor(me.vendor);
      setStoreName(me.vendor.store_name);
      setWhatsapp(me.vendor.whatsapp || "");
      setAddress(me.vendor.address || "");
      setHours(me.vendor.hours || "");
      setDescription(me.vendor.description || "");
    }
    if (off.offers) setOffers(off.offers);
    if (ord.orders) setOrders(ord.orders);
    setLoading(false);
  }

  useEffect(() => {
    loadData();
  }, []);

  async function handleSetup(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg("");
    const res = await fetch("/api/vendor/me", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        store_name: storeName,
        neighborhood: PRIMARY_NEIGHBORHOOD.slug,
        whatsapp,
        address,
        hours,
        description,
      }),
    });
    const data = await res.json();
    if (data.error) setMsg(data.error);
    else {
      setVendor(data.vendor);
      setMsg("Local guardado");
    }
    setSaving(false);
  }

  async function handleNewOffer(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg("");
    const res = await fetch("/api/vendor/offers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: offName,
        description: offDesc,
        price: offPrice,
        category: offCategory,
      }),
    });
    const data = await res.json();
    if (data.error) setMsg(data.error);
    else {
      setShowNew(false);
      setOffName("");
      setOffDesc("");
      setOffPrice("");
      setOffCategory("empanadas");
      setMsg("Plato agregado");
      loadData();
    }
    setSaving(false);
  }

  async function toggleFeatured(offer: Offer) {
    await fetch(`/api/vendor/offers/${offer.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ featured_today: !offer.featured_today }),
    });
    loadData();
  }

  async function toggleAvailable(offer: Offer) {
    await fetch(`/api/vendor/offers/${offer.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ available: !offer.available }),
    });
    loadData();
  }

  async function deleteOffer(offer: Offer) {
    await fetch(`/api/vendor/offers/${offer.id}`, { method: "DELETE" });
    loadData();
  }

  async function updateOrderStatus(order: Order, status: Order["status"]) {
    await fetch(`/api/vendor/orders/${order.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    loadData();
  }

  if (loading)
    return (
      <main className="container mx-auto px-4 py-8">
        <p className="text-gray-500">Cargando...</p>
      </main>
    );

  if (!vendor) {
    return (
      <main className="container mx-auto px-4 py-20 max-w-lg text-center">
        <h1 className="text-2xl font-bold mb-4">Tu local en conectaMOS</h1>
        <p className="text-gray-600 mb-6">
          Registrá tu local gastronómico para armar tu menú y recibir pedidos
          de {PRIMARY_NEIGHBORHOOD.name} por WhatsApp.
        </p>
        <form onSubmit={handleSetup} className="text-left space-y-4 bg-white border rounded-xl p-6">
          <div>
            <Label>Nombre del local</Label>
            <Input value={storeName} onChange={(e) => setStoreName(e.target.value)} required />
          </div>
          <div>
            <Label>WhatsApp (con código de país)</Label>
            <Input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="5492215550000" required />
          </div>
          <div>
            <Label>Dirección</Label>
            <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Calle y número, Sicardi" />
          </div>
          <div>
            <Label>Horarios</Label>
            <Input value={hours} onChange={(e) => setHours(e.target.value)} placeholder="Mar a Dom 12-22h" />
          </div>
          <div>
            <Label>Descripción</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Contá qué cocinás..." />
          </div>
          {msg && <p className="text-sm text-red-600">{msg}</p>}
          <Button type="submit" className="w-full" disabled={saving}>
            {saving ? "Guardando..." : "Registrar mi local"}
          </Button>
        </form>
      </main>
    );
  }

  return (
    <main className="container mx-auto px-4 py-8 max-w-4xl">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold">{vendor.store_name}</h1>
          <p className="text-gray-500 text-sm">
            {vendor.slug && (
              <a
                href={`/tienda/${vendor.slug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline"
              >
                Ver mi micrositio
              </a>
            )}
            {vendor.whatsapp && ` · WhatsApp: ${vendor.whatsapp}`}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setTab("menu")}>
            Menú
          </Button>
          <Button variant="outline" onClick={() => setTab("orders")}>
            Pedidos ({orders.length})
          </Button>
        </div>
      </div>

      {msg && (
        <p className="text-sm mb-4 text-green-600">{msg}</p>
      )}

      {tab === "menu" && (
        <>
          <Card className="p-5 mb-6">
            <h2 className="font-semibold mb-3">Configuración del local</h2>
            <form onSubmit={handleSetup} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>Nombre</Label>
                <Input value={storeName} onChange={(e) => setStoreName(e.target.value)} required />
              </div>
              <div>
                <Label>WhatsApp</Label>
                <Input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} />
              </div>
              <div>
                <Label>Dirección</Label>
                <Input value={address} onChange={(e) => setAddress(e.target.value)} />
              </div>
              <div>
                <Label>Horarios</Label>
                <Input value={hours} onChange={(e) => setHours(e.target.value)} />
              </div>
              <div className="sm:col-span-2">
                <Label>Descripción</Label>
                <Textarea value={description} onChange={(e) => setDescription(e.target.value)} />
              </div>
              <div className="sm:col-span-2">
                <Button type="submit" size="sm" disabled={saving}>
                  {saving ? "Guardando..." : "Guardar local"}
                </Button>
              </div>
            </form>
          </Card>

          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Tu menú ({offers.length})</h2>
            <Button size="sm" onClick={() => setShowNew(!showNew)}>
              + Agregar plato
            </Button>
          </div>

          {showNew && (
            <Card className="p-5 mb-6">
              <h3 className="font-semibold mb-3">Nuevo plato</h3>
              <form onSubmit={handleNewOffer} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <Label>Nombre</Label>
                    <Input value={offName} onChange={(e) => setOffName(e.target.value)} required />
                  </div>
                  <div>
                    <Label>Precio ($)</Label>
                    <Input type="number" step="0.01" value={offPrice} onChange={(e) => setOffPrice(e.target.value)} required />
                  </div>
                  <div className="sm:col-span-2">
                    <Label>Categoría</Label>
                    <select
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={offCategory}
                      onChange={(e) => setOffCategory(e.target.value)}
                    >
                      {CATEGORIES.map((c) => (
                        <option key={c} value={c} className="capitalize">
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <Label>Descripción</Label>
                    <Textarea value={offDesc} onChange={(e) => setOffDesc(e.target.value)} />
                  </div>
                </div>
                <Button type="submit" disabled={saving}>
                  {saving ? "Agregando..." : "Agregar al menú"}
                </Button>
              </form>
            </Card>
          )}

          <div className="space-y-3">
            {offers.length === 0 ? (
              <p className="text-gray-500 text-sm">
                Todavía no cargaste platos. ¡Agregá tu primer plato!
              </p>
            ) : (
              offers.map((offer) => (
                <Card key={offer.id} className="p-4 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{offer.name}</span>
                      {offer.featured_today && (
                        <Badge className="bg-orange-100 text-orange-700">Hoy</Badge>
                      )}
                      {!offer.available && <Badge variant="secondary">Pausado</Badge>}
                    </div>
                    <p className="text-sm text-gray-500 mt-1">
                      ${Number(offer.price).toLocaleString("es-AR")}
                      {offer.category && ` · ${offer.category}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Button variant="outline" size="sm" onClick={() => toggleFeatured(offer)}>
                      {offer.featured_today ? "Quitar de Hoy" : "Destacar Hoy"}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => toggleAvailable(offer)}>
                      {offer.available ? "Pausar" : "Activar"}
                    </Button>
                    <Button variant="ghost" size="sm" className="text-red-600" onClick={() => deleteOffer(offer)}>
                      Eliminar
                    </Button>
                  </div>
                </Card>
              ))
            )}
          </div>
        </>
      )}

      {tab === "orders" && (
        <div className="space-y-4">
          {orders.length === 0 ? (
            <p className="text-gray-500 text-center py-12">
              Todavía no recibiste pedidos. Compartí tu micrositio para arrancar.
            </p>
          ) : (
            orders.map((order) => (
              <Card key={order.id} className="p-5">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                  <div>
                    <p className="font-semibold">{order.customer_name}</p>
                    <p className="text-sm text-gray-500">
                      <a
                        href={`https://wa.me/${order.customer_phone.replace(/[^0-9]/g, "")}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary"
                      >
                        {order.customer_phone}
                      </a>
                      {order.method === "delivery"
                        ? ` · A domicilio: ${order.customer_address || "sin dirección"}`
                        : " · Retira en el local"}
                    </p>
                  </div>
                  <Badge className={STATUS_COLORS[order.status]}>
                    {STATUS_LABELS[order.status]}
                  </Badge>
                </div>
                <div className="border-t pt-3 mb-3">
                  {(order.items || []).map((item, i) => (
                    <p key={i} className="text-sm flex justify-between">
                      <span>
                        {item.qty}x {item.name}
                      </span>
                      <span>${Number(item.price * item.qty).toLocaleString("es-AR")}</span>
                    </p>
                  ))}
                  <div className="border-t mt-2 pt-2 flex justify-between font-bold">
                    <span>Total</span>
                    <span>${Number(order.total).toLocaleString("es-AR")}</span>
                  </div>
                </div>
                <p className="text-xs text-gray-400 mb-3">
                  {new Date(order.created_at).toLocaleString("es-AR")}
                </p>
                <div className="flex flex-wrap gap-2">
                  {order.status === "new" && (
                    <Button size="sm" onClick={() => updateOrderStatus(order, "confirmed")}>
                      Confirmar
                    </Button>
                  )}
                  {order.status === "confirmed" && (
                    <Button size="sm" onClick={() => updateOrderStatus(order, "completed")}>
                      Completar
                    </Button>
                  )}
                  {order.status !== "cancelled" && order.status !== "completed" && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-red-600"
                      onClick={() => updateOrderStatus(order, "cancelled")}
                    >
                      Cancelar
                    </Button>
                  )}
                </div>
              </Card>
            ))
          )}
        </div>
      )}
    </main>
  );
}
