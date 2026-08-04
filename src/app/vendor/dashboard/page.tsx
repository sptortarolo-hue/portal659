"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import QRCode from "qrcode";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DEFAULT_NEIGHBORHOOD, ZONE } from "@/lib/config";

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
  logo_url: string | null;
};

type Offer = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  category: string | null;
  available: boolean;
  featured_today: boolean;
  image_url: string | null;
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
  new: "bg-orange-100 text-orange-700",
  confirmed: "bg-amber-100 text-amber-700",
  completed: "bg-green-100 text-green-700",
  cancelled: "bg-red-100 text-red-700",
};

let browserClient: SupabaseClient | null = null;
function getBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  if (!browserClient) {
    browserClient = createClient(url, key, { auth: { persistSession: false } });
  }
  return browserClient;
}

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
  const [storeCategory, setStoreCategory] = useState("otras");
  const [whatsapp, setWhatsapp] = useState("");
  const [address, setAddress] = useState("");
  const [hours, setHours] = useState("");
  const [description, setDescription] = useState("");
  const [storeFile, setStoreFile] = useState<File | null>(null);
  const [storePreview, setStorePreview] = useState<string | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);

  // Offer form
  const [showNew, setShowNew] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [offName, setOffName] = useState("");
  const [offDesc, setOffDesc] = useState("");
  const [offPrice, setOffPrice] = useState("");
  const [offCategory, setOffCategory] = useState("empanadas");
  const [offFile, setOffFile] = useState<File | null>(null);
  const [offPreview, setOffPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Share modal
  const [shareOpen, setShareOpen] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function uploadImage(file: File, folder: string): Promise<string | null> {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("folder", folder);
    const res = await fetch("/api/vendor/upload", { method: "POST", body: fd });
    const data = await res.json();
    return data.url || null;
  }

  function readPreview(file: File, setter: (v: string | null) => void) {
    setter(URL.createObjectURL(file));
  }

  async function loadOrdersOnly() {
    try {
      const res = await fetch("/api/vendor/orders");
      const data = await res.json();
      if (data.orders) setOrders(data.orders);
    } catch {
      /* noop */
    }
  }

  async function loadData() {
    const [meRes, offersRes, ordersRes] = await Promise.all([
      fetch("/api/vendor/me"),
      fetch("/api/vendor/offers"),
      fetch("/api/vendor/orders"),
    ]);
    const me = await meRes.json();
    const off = await offersRes.json();
    const ord = await ordersRes.json();

    if (me.error === "No autenticado") {
      router.push("/login");
      return;
    }

    if (me.vendor) {
      setVendor(me.vendor);
      setStoreName(me.vendor.store_name);
      setStoreCategory(me.vendor.category || "otras");
      setWhatsapp(me.vendor.whatsapp || "");
      setAddress(me.vendor.address || "");
      setHours(me.vendor.hours || "");
      setDescription(me.vendor.description || "");
      setStorePreview(me.vendor.image_url || null);
      setLogoPreview(me.vendor.logo_url || null);
    }
    if (off.offers) setOffers(off.offers);
    if (ord.orders) setOrders(ord.orders);
    setLoading(false);
  }

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (!vendor?.id) return;
    let channel: ReturnType<SupabaseClient["channel"]> | null = null;
    const poll = setInterval(loadOrdersOnly, 30000);

    (async () => {
      try {
        const { accessToken } = await fetch("/api/auth/token").then((r) =>
          r.json()
        );
        if (!accessToken) return;
        const client = getBrowserClient();
        client.realtime.setAuth(accessToken);
        channel = client
          .channel(`orders-${vendor.id}`)
          .on(
            "postgres_changes",
            {
              event: "*",
              schema: "public",
              table: "orders",
              filter: `vendor_id=eq."${vendor.id}"`,
            },
            () => loadOrdersOnly()
          )
          .subscribe();
      } catch {
        /* noop */
      }
    })();

    return () => {
      clearInterval(poll);
      if (channel) {
        try {
          getBrowserClient().removeChannel(channel);
        } catch {
          /* noop */
        }
      }
    };
  }, [vendor?.id]);

  function resetOfferForm() {
    setEditingId(null);
    setOffName("");
    setOffDesc("");
    setOffPrice("");
    setOffCategory("empanadas");
    setOffFile(null);
    setOffPreview(null);
  }

  async function handleSetup(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg("");

    let imageUrl = vendor?.image_url || null;
    let logoUrl = vendor?.logo_url || null;
    if (storeFile) {
      const url = await uploadImage(storeFile, "vendors");
      if (url) imageUrl = url;
      else setMsg("No se pudo subir la imagen");
    }
    if (logoFile) {
      const url = await uploadImage(logoFile, "vendors");
      if (url) logoUrl = url;
      else setMsg("No se pudo subir el logo");
    }

    const res = await fetch("/api/vendor/me", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        store_name: storeName,
        neighborhood: DEFAULT_NEIGHBORHOOD.slug,
        category: storeCategory,
        whatsapp,
        address,
        hours,
        description,
        image_url: imageUrl,
        logo_url: logoUrl,
      }),
    });
    const data = await res.json();
    if (data.error) setMsg(data.error);
    else {
      setVendor(data.vendor);
      setStoreFile(null);
      setLogoFile(null);
      setMsg("Local guardado");
    }
    setSaving(false);
  }

  async function handleNewOffer(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg("");

    let imageUrl = null;
    if (offFile) {
      imageUrl = await uploadImage(offFile, "offers");
      if (!imageUrl) setMsg("No se pudo subir la imagen");
    }

    const payload = {
      name: offName,
      description: offDesc,
      price: Number(offPrice),
      category: offCategory,
      image_url: imageUrl,
    };

    let res: Response;
    if (editingId) {
      res = await fetch(`/api/vendor/offers/${editingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } else {
      res = await fetch("/api/vendor/offers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    }
    const data = await res.json();
    if (data.error) setMsg(data.error);
    else {
      setShowNew(false);
      resetOfferForm();
      setMsg(editingId ? "Plato actualizado" : "Plato agregado");
      loadData();
    }
    setSaving(false);
  }

  function startEdit(offer: Offer) {
    setEditingId(offer.id);
    setOffName(offer.name);
    setOffDesc(offer.description || "");
    setOffPrice(String(offer.price));
    setOffCategory(offer.category || "otras");
    setOffFile(null);
    setOffPreview(offer.image_url || null);
    setShowNew(true);
    setMsg("");
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
    loadOrdersOnly();
  }

  async function openShare() {
    if (!vendor?.slug) return;
    setCopied(false);
    setQrDataUrl(null);
    setShareOpen(true);
    try {
      const url = `${window.location.origin}/tienda/${vendor.slug}`;
      const dataUrl = await QRCode.toDataURL(url, { width: 480, margin: 1 });
      setQrDataUrl(dataUrl);
    } catch {
      /* noop */
    }
  }

  async function copyLink() {
    if (!vendor?.slug) return;
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}/tienda/${vendor.slug}`
      );
      setCopied(true);
    } catch {
      /* noop */
    }
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
        <h1 className="font-display text-3xl font-semibold mb-4">
          Tu local en SeMorfa
        </h1>
        <p className="text-gray-600 mb-6">
          Registrá tu local gastronómico para armar tu menú y recibir pedidos
          de {ZONE.name} por WhatsApp.
        </p>
        <form
          onSubmit={handleSetup}
          className="text-left space-y-4 bg-white border rounded-xl p-6"
        >
          <div>
            <Label>Nombre del local</Label>
            <Input
              value={storeName}
              onChange={(e) => setStoreName(e.target.value)}
              required
            />
          </div>
          <div>
            <Label>Categoría</Label>
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={storeCategory}
              onChange={(e) => setStoreCategory(e.target.value)}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c} className="capitalize">
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label>WhatsApp (con código de país)</Label>
            <Input
              value={whatsapp}
              onChange={(e) => setWhatsapp(e.target.value)}
              placeholder="5492215550000"
              required
            />
          </div>
          <div>
            <Label>Dirección</Label>
            <Input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Calle y número, Sicardi"
            />
          </div>
          <div>
            <Label>Horarios</Label>
            <Input
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              placeholder="Mar a Dom 12-22h"
            />
          </div>
          <div>
            <Label>Descripción</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Contá qué cocinás..."
            />
          </div>
          <div>
            <Label>Foto del local (opcional)</Label>
            <Input
              type="file"
              accept="image/*"
              onChange={(e) => {
                const f = e.target.files?.[0] || null;
                setStoreFile(f);
                if (f) readPreview(f, setStorePreview);
              }}
            />
            {storePreview && (
              <img
                src={storePreview}
                alt="Vista previa"
                className="mt-2 h-24 w-full object-cover rounded-lg"
              />
            )}
          </div>
          <div>
            <Label>Logo del local (cuadrado, opcional)</Label>
            <Input
              type="file"
              accept="image/*"
              onChange={(e) => {
                const f = e.target.files?.[0] || null;
                setLogoFile(f);
                if (f) readPreview(f, setLogoPreview);
              }}
            />
            {logoPreview && (
              <img
                src={logoPreview}
                alt="Vista previa del logo"
                className="mt-2 h-20 w-20 object-cover rounded-full border border-border"
              />
            )}
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
        <div className="flex items-center gap-4 min-w-0">
          {vendor.logo_url || vendor.image_url ? (
            <img
              src={vendor.logo_url || vendor.image_url || ""}
              alt={vendor.store_name}
              className="h-14 w-14 rounded-full object-cover"
            />
          ) : (
            <div className="h-14 w-14 rounded-full bg-accent flex items-center justify-center flex-shrink-0">
              <span className="font-display text-2xl font-bold text-primary/70">
                {vendor.store_name.charAt(0)}
              </span>
            </div>
          )}
          <div className="min-w-0">
            <h1 className="font-display text-3xl font-semibold truncate">
              {vendor.store_name}
            </h1>
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
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={openShare}>
            Compartir
          </Button>
          <Button variant="outline" onClick={() => setTab("menu")}>
            Menú
          </Button>
          <Button variant="outline" onClick={() => setTab("orders")}>
            Pedidos ({orders.length})
          </Button>
        </div>
      </div>

      {msg && <p className="text-sm mb-4 text-green-600">{msg}</p>}

      {tab === "menu" && (
        <>
          <Card className="p-5 mb-6">
            <h2 className="font-semibold mb-3">Configuración del local</h2>
            <form
              onSubmit={handleSetup}
              className="grid grid-cols-1 sm:grid-cols-2 gap-4"
            >
              <div>
                <Label>Nombre</Label>
                <Input
                  value={storeName}
                  onChange={(e) => setStoreName(e.target.value)}
                  required
                />
              </div>
              <div>
                <Label>Categoría</Label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={storeCategory}
                  onChange={(e) => setStoreCategory(e.target.value)}
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c} className="capitalize">
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label>WhatsApp</Label>
                <Input
                  value={whatsapp}
                  onChange={(e) => setWhatsapp(e.target.value)}
                />
              </div>
              <div>
                <Label>Dirección</Label>
                <Input
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                />
              </div>
              <div>
                <Label>Horarios</Label>
                <Input
                  value={hours}
                  onChange={(e) => setHours(e.target.value)}
                />
              </div>
              <div>
                <Label>Foto del local</Label>
                <Input
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const f = e.target.files?.[0] || null;
                    setStoreFile(f);
                    if (f) readPreview(f, setStorePreview);
                  }}
                />
                {storePreview && (
                  <img
                    src={storePreview}
                    alt="Vista previa"
                    className="mt-2 h-24 w-full object-cover rounded-lg"
                  />
                )}
              </div>
              <div>
                <Label>Logo del local (cuadrado)</Label>
                <Input
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const f = e.target.files?.[0] || null;
                    setLogoFile(f);
                    if (f) readPreview(f, setLogoPreview);
                  }}
                />
                {logoPreview && (
                  <img
                    src={logoPreview}
                    alt="Vista previa del logo"
                    className="mt-2 h-20 w-20 object-cover rounded-full border border-border"
                  />
                )}
              </div>
              <div className="sm:col-span-2">
                <Label>Descripción</Label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
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
            <Button
              size="sm"
              onClick={() => {
                if (showNew && !editingId) resetOfferForm();
                setShowNew(!showNew);
              }}
            >
              {editingId ? "Cancelar edición" : "+ Agregar plato"}
            </Button>
          </div>

          {showNew && (
            <Card className="p-5 mb-6">
              <h3 className="font-semibold mb-3">
                {editingId ? "Editar plato" : "Nuevo plato"}
              </h3>
              <form onSubmit={handleNewOffer} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <Label>Nombre</Label>
                    <Input
                      value={offName}
                      onChange={(e) => setOffName(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <Label>Precio ($)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={offPrice}
                      onChange={(e) => setOffPrice(e.target.value)}
                      required
                    />
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
                    <Label>Foto del plato (opcional)</Label>
                    <Input
                      type="file"
                      accept="image/*"
                      onChange={(e) => {
                        const f = e.target.files?.[0] || null;
                        setOffFile(f);
                        if (f) readPreview(f, setOffPreview);
                      }}
                    />
                    {offPreview && (
                      <img
                        src={offPreview}
                        alt="Vista previa"
                        className="mt-2 h-24 w-full object-cover rounded-lg"
                      />
                    )}
                  </div>
                  <div className="sm:col-span-2">
                    <Label>Descripción</Label>
                    <Textarea
                      value={offDesc}
                      onChange={(e) => setOffDesc(e.target.value)}
                    />
                  </div>
                </div>
                <Button type="submit" disabled={saving}>
                  {saving
                    ? "Guardando..."
                    : editingId
                    ? "Guardar cambios"
                    : "Agregar al menú"}
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
                <Card
                  key={offer.id}
                  className="p-4 flex items-center justify-between gap-4"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {offer.image_url ? (
                      <img
                        src={offer.image_url}
                        alt={offer.name}
                        className="h-14 w-14 rounded-lg object-cover flex-shrink-0"
                      />
                    ) : (
                      <div className="h-14 w-14 rounded-lg bg-accent flex items-center justify-center flex-shrink-0">
                        <span className="font-display text-xl font-bold text-primary/60">
                          {offer.name.charAt(0)}
                        </span>
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{offer.name}</span>
                        {offer.featured_today && (
                          <Badge className="bg-orange-100 text-orange-700">
                            Hoy
                          </Badge>
                        )}
                        {!offer.available && (
                          <Badge variant="secondary">Pausado</Badge>
                        )}
                      </div>
                      <p className="text-sm text-gray-500 mt-1">
                        ${Number(offer.price).toLocaleString("es-AR")}
                        {offer.category && ` · ${offer.category}`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => startEdit(offer)}
                    >
                      Editar
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => toggleFeatured(offer)}
                    >
                      {offer.featured_today ? "Quitar de Hoy" : "Destacar Hoy"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => toggleAvailable(offer)}
                    >
                      {offer.available ? "Pausar" : "Activar"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-red-600"
                      onClick={() => deleteOffer(offer)}
                    >
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
                        href={`https://wa.me/${order.customer_phone.replace(
                          /[^0-9]/g,
                          ""
                        )}`}
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
                      <span>
                        ${Number(item.price * item.qty).toLocaleString("es-AR")}
                      </span>
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
                    <Button
                      size="sm"
                      onClick={() => updateOrderStatus(order, "confirmed")}
                    >
                      Confirmar
                    </Button>
                  )}
                  {order.status === "confirmed" && (
                    <Button
                      size="sm"
                      onClick={() => updateOrderStatus(order, "completed")}
                    >
                      Completar
                    </Button>
                  )}
                  {order.status !== "cancelled" &&
                    order.status !== "completed" && (
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

      {shareOpen && vendor.slug && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
          onClick={() => setShareOpen(false)}
        >
          <div
            className="bg-white rounded-2xl p-6 max-w-sm w-full text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-display text-xl font-semibold mb-1">
              Compartí tu vidriera
            </h3>
            <p className="text-sm text-gray-500 mb-4">
              El QR lleva directo a tu micrositio en {ZONE.name}.
            </p>
            {qrDataUrl ? (
              <img
                src={qrDataUrl}
                alt="QR de mi micrositio"
                className="mx-auto w-56 h-56 mb-4"
              />
            ) : (
              <div className="mx-auto w-56 h-56 mb-4 bg-gray-100 animate-pulse rounded-lg" />
            )}
            <p className="text-xs text-gray-500 break-all mb-4">
              {window.location.origin}/tienda/{vendor.slug}
            </p>
            <div className="flex gap-2">
              <Button className="flex-1" onClick={copyLink}>
                {copied ? "¡Link copiado!" : "Copiar link"}
              </Button>
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setShareOpen(false)}
              >
                Cerrar
              </Button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
