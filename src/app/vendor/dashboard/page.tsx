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
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { ChipToggle } from "@/components/ui/chip-toggle";
import { RadioCards } from "@/components/ui/radio-cards";
import { DropdownMenu } from "@/components/ui/dropdown-menu";
import { DEFAULT_NEIGHBORHOOD, ZONE } from "@/lib/config";

type Vendor = {
  id: string;
  store_name: string;
  slug: string | null;
  category: string | null;
  vertical: string;
  neighborhood: string | null;
  whatsapp: string | null;
  phone: string | null;
  instagram: string | null;
  facebook: string | null;
  payment_methods: string | null;
  delivery_options: string | null;
  services_list: string | null;
  service_area: string | null;
  free_estimate: boolean | null;
  accepting_quotes: boolean;
  verified: boolean;
  hours: string | null;
  location: string | null;
  address: string | null;
  description: string | null;
  image_url: string | null;
  logo_url: string | null;
  created_at: string;
};

const VERTICAL_OPTIONS = [
  { value: "gastronomia", label: "Gastronomía (comida)" },
  { value: "almacen", label: "Almacén (verdulería, carnicería)" },
  { value: "servicio", label: "Servicio u oficio (sin menú)" },
  { value: "otro", label: "Otro" },
] as const;

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

type MenuCategory = {
  id: string;
  name: string;
  position: number;
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

const PAYMENT_OPTIONS = [
  { label: "Efectivo", value: "Efectivo", icon: "💵" },
  { label: "Débito", value: "Débito", icon: "💳" },
  { label: "Crédito", value: "Crédito", icon: "💳" },
  { label: "Mercado Pago", value: "Mercado Pago", icon: "📱" },
  { label: "Transferencia", value: "Transferencia", icon: "🏦" },
];

const DELIVERY_OPTIONS = [
  { label: "Retiro", value: "retiro", icon: "🏠", desc: "en local" },
  { label: "Domicilio", value: "domicilio", icon: "🚗", desc: "" },
  { label: "Ambos", value: "ambos", icon: "🔄", desc: "" },
];

const STATUS_LABELS: Record<Order["status"], string> = {
  new: "Nuevo",
  confirmed: "Confirmado",
  completed: "Completado",
  cancelled: "Cancelado",
};

const STATUS_COLORS: Record<Order["status"], string> = {
  new: "bg-sun/20 text-ink",
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
  const [tab, setTab] = useState<"config" | "menu" | "orders">("config");
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");

  const [storeName, setStoreName] = useState("");
  const [storeCategory, setStoreCategory] = useState("otras");
  const [storeVertical, setStoreVertical] = useState("gastronomia");
  const [whatsapp, setWhatsapp] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [hours, setHours] = useState("");
  const [description, setDescription] = useState("");
  const [storeFile, setStoreFile] = useState<File | null>(null);
  const [storePreview, setStorePreview] = useState<string | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [instagram, setInstagram] = useState("");
  const [facebook, setFacebook] = useState("");
  const [paymentMethods, setPaymentMethods] = useState<string[]>([]);
  const [deliveryOptions, setDeliveryOptions] = useState("ambos");
  const [servicesList, setServicesList] = useState("");
  const [serviceArea, setServiceArea] = useState("");
  const [freeEstimate, setFreeEstimate] = useState(true);

  const [showNew, setShowNew] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [offName, setOffName] = useState("");
  const [offDesc, setOffDesc] = useState("");
  const [offPrice, setOffPrice] = useState("");
  const [offCategory, setOffCategory] = useState("empanadas");
  const [offFile, setOffFile] = useState<File | null>(null);
  const [offPreview, setOffPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [newCatName, setNewCatName] = useState("");
  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  const [editingCatName, setEditingCatName] = useState("");
  const [catBusy, setCatBusy] = useState(false);

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
    } catch { /* noop */ }
  }

  async function loadData() {
    const [meRes, offersRes, ordersRes, catsRes] = await Promise.all([
      fetch("/api/vendor/me"),
      fetch("/api/vendor/offers"),
      fetch("/api/vendor/orders"),
      fetch("/api/vendor/categories"),
    ]);
    const me = await meRes.json();
    const off = await offersRes.json();
    const ord = await ordersRes.json();
    const cats = await catsRes.json();

    if (me.error === "No autenticado") {
      router.push("/login");
      return;
    }

    if (me.vendor) {
      setVendor(me.vendor);
      setStoreName(me.vendor.store_name);
      setStoreCategory(me.vendor.category || "otras");
      setStoreVertical(me.vendor.vertical || "gastronomia");
      setWhatsapp(me.vendor.whatsapp || "");
      setPhone(me.vendor.phone || "");
      setAddress(me.vendor.address || "");
      setHours(me.vendor.hours || "");
      setDescription(me.vendor.description || "");
      setStorePreview(me.vendor.image_url || null);
      setLogoPreview(me.vendor.logo_url || null);
      setInstagram(me.vendor.instagram || "");
      setFacebook(me.vendor.facebook || "");
      setPaymentMethods(
        me.vendor.payment_methods
          ? me.vendor.payment_methods.split(", ").map((s: string) => s.trim()).filter(Boolean)
          : []
      );
      setDeliveryOptions(me.vendor.delivery_options || "ambos");
      setServicesList(me.vendor.services_list || "");
      setServiceArea(me.vendor.service_area || "");
      setFreeEstimate(me.vendor.free_estimate !== false);
    }
    if (off.offers) setOffers(off.offers);
    if (ord.orders) setOrders(ord.orders);
    if (cats.categories) {
      setCategories(cats.categories);
      setOffCategory((c) =>
        cats.categories.some((x: MenuCategory) => x.name === c)
          ? c
          : cats.categories[0]?.name || "otras"
      );
    }
    setLoading(false);
  }

  useEffect(() => { loadData(); }, []);

  useEffect(() => {
    if (!vendor?.id) return;
    let channel: ReturnType<SupabaseClient["channel"]> | null = null;
    const poll = setInterval(loadOrdersOnly, 30000);

    (async () => {
      try {
        const { accessToken } = await fetch("/api/auth/token").then((r) => r.json());
        if (!accessToken) return;
        const client = getBrowserClient();
        client.realtime.setAuth(accessToken);
        channel = client
          .channel(`orders-${vendor.id}`)
          .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: `vendor_id=eq."${vendor.id}"` }, () => loadOrdersOnly())
          .subscribe();
      } catch { /* noop */ }
    })();

    return () => {
      clearInterval(poll);
      if (channel) { try { getBrowserClient().removeChannel(channel); } catch { /* noop */ } }
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
    if (storeFile) { const url = await uploadImage(storeFile, "vendors"); if (url) imageUrl = url; else setMsg("No se pudo subir la imagen"); }
    if (logoFile) { const url = await uploadImage(logoFile, "vendors"); if (url) logoUrl = url; else setMsg("No se pudo subir el logo"); }

    const res = await fetch("/api/vendor/me", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        store_name: storeName,
        neighborhood: DEFAULT_NEIGHBORHOOD.slug,
        category: storeCategory,
        vertical: storeVertical,
        whatsapp,
        phone,
        address,
        hours,
        description,
        image_url: imageUrl,
        logo_url: logoUrl,
        instagram,
        facebook,
        payment_methods: paymentMethods.join(", "),
        delivery_options: deliveryOptions,
        services_list: servicesList,
        service_area: serviceArea,
        free_estimate: freeEstimate,
      }),
    });
    const data = await res.json();
    if (data.error) setMsg(data.error);
    else { setVendor(data.vendor); setStoreFile(null); setLogoFile(null); setMsg("Guardado"); }
    setSaving(false);
  }

  async function handleNewOffer(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg("");

    let imageUrl = null;
    if (offFile) { imageUrl = await uploadImage(offFile, "offers"); if (!imageUrl) setMsg("No se pudo subir la imagen"); }

    const payload = { name: offName, description: offDesc, price: Number(offPrice), category: offCategory, image_url: imageUrl };
    let res: Response;
    if (editingId) {
      res = await fetch(`/api/vendor/offers/${editingId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    } else {
      res = await fetch("/api/vendor/offers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    }
    const data = await res.json();
    if (data.error) setMsg(data.error);
    else { setShowNew(false); resetOfferForm(); setMsg(editingId ? "Plato actualizado" : "Plato agregado"); loadData(); }
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
    await fetch(`/api/vendor/offers/${offer.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ featured_today: !offer.featured_today }) });
    loadData();
  }

  async function toggleAvailable(offer: Offer) {
    await fetch(`/api/vendor/offers/${offer.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ available: !offer.available }) });
    loadData();
  }

  async function deleteOffer(offer: Offer) {
    await fetch(`/api/vendor/offers/${offer.id}`, { method: "DELETE" });
    loadData();
  }

  async function updateOrderStatus(order: Order, status: Order["status"]) {
    await fetch(`/api/vendor/orders/${order.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
    loadOrdersOnly();
  }

  async function addCategory(e: React.FormEvent) {
    e.preventDefault();
    if (!newCatName.trim() || catBusy) return;
    setCatBusy(true);
    const res = await fetch("/api/vendor/categories", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: newCatName }) });
    if (res.ok) { setNewCatName(""); loadData(); }
    setCatBusy(false);
  }

  async function renameCategory() {
    if (!editingCatId || !editingCatName.trim() || catBusy) return;
    setCatBusy(true);
    await fetch(`/api/vendor/categories/${editingCatId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: editingCatName }) });
    setEditingCatId(null);
    setCatBusy(false);
    loadData();
  }

  async function deleteCategory(cat: MenuCategory) {
    if (!window.confirm(`¿Eliminar "${cat.name}"? Los platos quedan sin categoría.`)) return;
    await fetch(`/api/vendor/categories/${cat.id}`, { method: "DELETE" });
    loadData();
  }

  async function moveCategory(cat: MenuCategory, dir: -1 | 1) {
    const idx = categories.findIndex((c) => c.id === cat.id);
    const target = idx + dir;
    if (target < 0 || target >= categories.length) return;
    const reordered = [...categories];
    const [moved] = reordered.splice(idx, 1);
    reordered.splice(target, 0, moved);
    setCategories(reordered.map((c, i) => ({ ...c, position: i })));
    await Promise.all(reordered.map((c, i) =>
      fetch(`/api/vendor/categories/${c.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ position: i }) })
    ));
    loadData();
  }

  async function openShare() {
    if (!vendor?.slug) return;
    setCopied(false);
    setQrDataUrl(null);
    setShareOpen(true);
    try {
      const url = `${window.location.origin}/tienda/${vendor.slug}`;
      setQrDataUrl(await QRCode.toDataURL(url, { width: 480, margin: 1 }));
    } catch { /* noop */ }
  }

  async function copyLink() {
    if (!vendor?.slug) return;
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/tienda/${vendor.slug}`);
      setCopied(true);
    } catch { /* noop */ }
  }

  if (loading) return <main className="container mx-auto px-4 py-8"><p className="text-muted-foreground">Cargando...</p></main>;

  if (!vendor) {
    return (
      <main className="container mx-auto px-4 py-8 max-w-lg">
        <h1 className="font-display text-2xl font-semibold mb-1">Tu comercio en Portal 659</h1>
        <p className="text-muted-foreground text-sm mb-6">Completá los datos para armar tu vidriera.</p>
        <form onSubmit={handleSetup} className="space-y-4">
          <CollapsibleSection icon="🏪" title="Tu comercio" defaultOpen>
            <div className="space-y-3">
              <div><Label>Tipo</Label><select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={storeVertical} onChange={(e) => setStoreVertical(e.target.value)}>{VERTICAL_OPTIONS.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}</select></div>
              <div><Label>Nombre</Label><Input value={storeName} onChange={(e) => setStoreName(e.target.value)} required /></div>
              <div><Label>Categoría</Label><select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={storeCategory} onChange={(e) => setStoreCategory(e.target.value)}>{CATEGORIES.map((c) => <option key={c} value={c} className="capitalize">{c}</option>)}</select></div>
            </div>
          </CollapsibleSection>
          <CollapsibleSection icon="📱" title="Contacto" defaultOpen>
            <div className="space-y-3">
              <div><Label>WhatsApp</Label><Input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="5492215550000" required /></div>
              <div><Label>Teléfono (opcional)</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="2215550000" /></div>
            </div>
          </CollapsibleSection>
          <CollapsibleSection icon="📍" title="Ubicación">
            <div className="space-y-3">
              <div><Label>Dirección</Label><Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Calle y número" /></div>
              <div><Label>Horarios</Label><Input value={hours} onChange={(e) => setHours(e.target.value)} placeholder="Mar a Dom 12-22h" /></div>
            </div>
          </CollapsibleSection>
          <CollapsibleSection icon="📝" title="Descripción">
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Contá qué hacés..." />
          </CollapsibleSection>
          <CollapsibleSection icon="📸" title="Fotos">
            <div className="space-y-3">
              <div><Label>Foto del local</Label><Input type="file" accept="image/*" onChange={(e) => { const f = e.target.files?.[0] || null; setStoreFile(f); if (f) readPreview(f, setStorePreview); }} />{storePreview && <img src={storePreview} alt="Vista previa" className="mt-2 h-24 w-full object-cover rounded-lg" />}</div>
              <div><Label>Logo</Label><Input type="file" accept="image/*" onChange={(e) => { const f = e.target.files?.[0] || null; setLogoFile(f); if (f) readPreview(f, setLogoPreview); }} />{logoPreview && <img src={logoPreview} alt="Logo" className="mt-2 h-16 w-16 object-cover rounded-full border" />}</div>
            </div>
          </CollapsibleSection>
          <CollapsibleSection icon="🌐" title="Redes sociales">
            <div className="space-y-3">
              <div><Label>Instagram</Label><Input value={instagram} onChange={(e) => setInstagram(e.target.value)} placeholder="@tulocal" /></div>
              <div><Label>Facebook</Label><Input value={facebook} onChange={(e) => setFacebook(e.target.value)} placeholder="https://facebook.com/tulocal" /></div>
            </div>
          </CollapsibleSection>
          <CollapsibleSection icon="💳" title="Pago y entrega">
            <div className="space-y-4">
              <div><Label className="mb-2 block">Medios de pago</Label><ChipToggle options={PAYMENT_OPTIONS} value={paymentMethods} onChange={setPaymentMethods} /></div>
              <div><Label className="mb-2 block">Entrega</Label><RadioCards options={DELIVERY_OPTIONS} value={deliveryOptions} onChange={setDeliveryOptions} /></div>
            </div>
          </CollapsibleSection>
          {storeVertical === "servicio" && (
            <CollapsibleSection icon="🔧" title="Servicios">
              <div className="space-y-3">
                <div><Label>Servicios que ofrecés</Label><Input value={servicesList} onChange={(e) => setServicesList(e.target.value)} placeholder="Instalaciones, reparaciones, urgencias" /><p className="text-xs text-muted-foreground mt-1">Separá con coma</p></div>
                <div><Label>Zona de cobertura</Label><Input value={serviceArea} onChange={(e) => setServiceArea(e.target.value)} placeholder="Sicardi, Garibaldi" /></div>
                <label className="flex items-center gap-2"><input type="checkbox" checked={freeEstimate} onChange={(e) => setFreeEstimate(e.target.checked)} className="h-4 w-4 rounded border-border" /><span className="text-sm">Presupuesto sin compromiso</span></label>
              </div>
            </CollapsibleSection>
          )}
          {msg && <p className="text-sm text-red-600">{msg}</p>}
          <Button type="submit" className="w-full" disabled={saving}>{saving ? "Guardando..." : "Crear mi vidriera"}</Button>
        </form>
      </main>
    );
  }

  const isService = vendor?.vertical === "servicio";

  const configContent = (
    <form onSubmit={handleSetup} className="space-y-4">
      <CollapsibleSection icon="🏪" title="Tu comercio" defaultOpen badge={storeVertical === "servicio" ? "Servicio" : undefined}>
        <div className="space-y-3">
          <div><Label>Tipo</Label><select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={storeVertical} onChange={(e) => setStoreVertical(e.target.value)}>{VERTICAL_OPTIONS.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}</select></div>
          <div><Label>Nombre</Label><Input value={storeName} onChange={(e) => setStoreName(e.target.value)} required /></div>
          <div><Label>Categoría</Label><select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={storeCategory} onChange={(e) => setStoreCategory(e.target.value)}>{CATEGORIES.map((c) => <option key={c} value={c} className="capitalize">{c}</option>)}</select></div>
        </div>
      </CollapsibleSection>
      <CollapsibleSection icon="📍" title="Ubicación y horarios">
        <div className="space-y-3">
          <div><Label>Dirección</Label><Input value={address} onChange={(e) => setAddress(e.target.value)} /></div>
          <div><Label>Horarios</Label><Input value={hours} onChange={(e) => setHours(e.target.value)} /></div>
        </div>
      </CollapsibleSection>
      <CollapsibleSection icon="📸" title="Fotos">
        <div className="space-y-3">
          <div><Label>Foto del comercio</Label><Input type="file" accept="image/*" onChange={(e) => { const f = e.target.files?.[0] || null; setStoreFile(f); if (f) readPreview(f, setStorePreview); }} />{storePreview && <img src={storePreview} alt="Vista previa" className="mt-2 h-24 w-full object-cover rounded-lg" />}</div>
          <div><Label>Logo</Label><Input type="file" accept="image/*" onChange={(e) => { const f = e.target.files?.[0] || null; setLogoFile(f); if (f) readPreview(f, setLogoPreview); }} />{logoPreview && <img src={logoPreview} alt="Logo" className="mt-2 h-16 w-16 object-cover rounded-full border" />}</div>
        </div>
      </CollapsibleSection>
      <CollapsibleSection icon="📝" title="Descripción">
        <Textarea value={description} onChange={(e) => setDescription(e.target.value)} />
      </CollapsibleSection>
      <CollapsibleSection icon="📱" title="Contacto">
        <div className="space-y-3">
          <div><Label>WhatsApp</Label><Input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} /></div>
          <div><Label>Teléfono directo</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="2215550000" /></div>
        </div>
      </CollapsibleSection>
      <CollapsibleSection icon="🌐" title="Redes sociales">
        <div className="space-y-3">
          <div><Label>Instagram</Label><Input value={instagram} onChange={(e) => setInstagram(e.target.value)} placeholder="@tulocal" /></div>
          <div><Label>Facebook</Label><Input value={facebook} onChange={(e) => setFacebook(e.target.value)} placeholder="https://facebook.com/tulocal" /></div>
        </div>
      </CollapsibleSection>
      <CollapsibleSection icon="💳" title="Pago y entrega">
        <div className="space-y-4">
          <div><Label className="mb-2 block">Medios de pago</Label><ChipToggle options={PAYMENT_OPTIONS} value={paymentMethods} onChange={setPaymentMethods} /></div>
          <div><Label className="mb-2 block">Entrega</Label><RadioCards options={DELIVERY_OPTIONS} value={deliveryOptions} onChange={setDeliveryOptions} /></div>
        </div>
      </CollapsibleSection>
      {isService && (
        <CollapsibleSection icon="🔧" title="Servicios" defaultOpen>
          <div className="space-y-3">
            <div><Label>Servicios que ofrecés</Label><Input value={servicesList} onChange={(e) => setServicesList(e.target.value)} placeholder="Instalaciones, reparaciones, urgencias" /><p className="text-xs text-muted-foreground mt-1">Separá con coma</p></div>
            <div><Label>Zona de cobertura</Label><Input value={serviceArea} onChange={(e) => setServiceArea(e.target.value)} placeholder="Sicardi, Garibaldi" /></div>
            <label className="flex items-center gap-2"><input type="checkbox" checked={freeEstimate} onChange={(e) => setFreeEstimate(e.target.checked)} className="h-4 w-4 rounded border-border" /><span className="text-sm">Presupuesto sin compromiso</span></label>
          </div>
        </CollapsibleSection>
      )}
      <Button type="submit" className="w-full" disabled={saving}>{saving ? "Guardando..." : "Guardar cambios"}</Button>
    </form>
  );

  const menuContent = (
    <>
      <CollapsibleSection icon="📂" title={`Categorías (${categories.length})`}>
        <form onSubmit={addCategory} className="flex gap-2 mb-3">
          <Input placeholder="Nueva categoría" value={newCatName} onChange={(e) => setNewCatName(e.target.value)} />
          <Button type="submit" size="sm" disabled={catBusy || !newCatName.trim()}>+</Button>
        </form>
        {categories.length === 0 ? (
          <p className="text-sm text-muted-foreground">Creá categorías para organizar tu menú.</p>
        ) : (
          <ul className="space-y-2">
            {categories.map((cat, i) => (
              <li key={cat.id} className="flex items-center gap-2 border border-border rounded-lg px-3 py-2">
                {editingCatId === cat.id ? (
                  <>
                    <Input className="h-8 flex-1" value={editingCatName} onChange={(e) => setEditingCatName(e.target.value)} autoFocus />
                    <Button size="sm" variant="outline" disabled={catBusy} onClick={renameCategory}>OK</Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditingCatId(null)}>✕</Button>
                  </>
                ) : (
                  <>
                    <span className="font-medium flex-1 min-w-0 truncate">{cat.name}</span>
                    <span className="text-xs text-muted-foreground">{offers.filter((o) => o.category === cat.name).length} platos</span>
                    <Button size="sm" variant="ghost" disabled={i === 0} onClick={() => moveCategory(cat, -1)}>↑</Button>
                    <Button size="sm" variant="ghost" disabled={i === categories.length - 1} onClick={() => moveCategory(cat, 1)}>↓</Button>
                    <Button size="sm" variant="ghost" onClick={() => { setEditingCatId(cat.id); setEditingCatName(cat.name); }}>✏️</Button>
                    <Button size="sm" variant="ghost" className="text-red-600" onClick={() => deleteCategory(cat)}>🗑️</Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </CollapsibleSection>

      <div className="flex items-center justify-between mt-6 mb-4">
        <h2 className="font-semibold">Menú ({offers.length})</h2>
        <Button size="sm" onClick={() => { if (showNew && !editingId) resetOfferForm(); setShowNew(!showNew); }}>{editingId ? "Cancelar" : "+ Plato"}</Button>
      </div>

      {showNew && (
        <Card className="p-4 mb-4">
          <h3 className="font-semibold mb-3">{editingId ? "Editar plato" : "Nuevo plato"}</h3>
          <form onSubmit={handleNewOffer} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Nombre</Label><Input value={offName} onChange={(e) => setOffName(e.target.value)} required /></div>
              <div><Label>Precio ($)</Label><Input type="number" step="0.01" value={offPrice} onChange={(e) => setOffPrice(e.target.value)} required /></div>
            </div>
            <div><Label>Categoría</Label><select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={offCategory} onChange={(e) => setOffCategory(e.target.value)}>{categories.length === 0 && <option value="otras">otras</option>}{categories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}{offCategory && !categories.some((c) => c.name === offCategory) && offCategory !== "otras" && <option value={offCategory}>{offCategory}</option>}</select></div>
            <div><Label>Foto</Label><Input type="file" accept="image/*" onChange={(e) => { const f = e.target.files?.[0] || null; setOffFile(f); if (f) readPreview(f, setOffPreview); }} />{offPreview && <img src={offPreview} alt="Preview" className="mt-2 h-20 w-full object-cover rounded-lg" />}</div>
            <div><Label>Descripción</Label><Textarea value={offDesc} onChange={(e) => setOffDesc(e.target.value)} /></div>
            <Button type="submit" disabled={saving} className="w-full">{saving ? "Guardando..." : editingId ? "Guardar" : "Agregar"}</Button>
          </form>
        </Card>
      )}

      <div className="space-y-3">
        {offers.length === 0 ? (
          <p className="text-muted-foreground text-sm text-center py-8">Todavía no cargaste platos.</p>
        ) : (
          offers.map((offer) => (
            <Card key={offer.id} className="p-3">
              <div className="flex items-center gap-3">
                {offer.image_url ? (
                  <img src={offer.image_url} alt={offer.name} className="h-12 w-12 rounded-lg object-cover flex-shrink-0" />
                ) : (
                  <div className="h-12 w-12 rounded-lg bg-accent flex items-center justify-center flex-shrink-0"><span className="font-bold text-primary/60">{offer.name.charAt(0)}</span></div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium text-sm truncate">{offer.name}</span>
                    {offer.featured_today && <Badge className="bg-sun/20 text-ink text-[10px] px-1.5 py-0">Hoy</Badge>}
                    {!offer.available && <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Pausado</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground">${Number(offer.price).toLocaleString("es-AR")}{offer.category && ` · ${offer.category}`}</p>
                </div>
                <div className="hidden sm:flex items-center gap-1 flex-shrink-0">
                  <Button variant="outline" size="sm" onClick={() => startEdit(offer)}>Editar</Button>
                  <Button variant="outline" size="sm" onClick={() => toggleFeatured(offer)}>{offer.featured_today ? "Quitar" : "Destacar"}</Button>
                  <Button variant="outline" size="sm" onClick={() => toggleAvailable(offer)}>{offer.available ? "Pausar" : "Activar"}</Button>
                  <Button variant="ghost" size="sm" className="text-red-600" onClick={() => deleteOffer(offer)}>Eliminar</Button>
                </div>
                <div className="sm:hidden flex-shrink-0">
                  <DropdownMenu
                    trigger={<span className="text-xl">⋯</span>}
                    items={[
                      { label: "Editar", icon: "✏️", onClick: () => startEdit(offer) },
                      { label: offer.featured_today ? "Quitar de Hoy" : "Destacar Hoy", icon: "⭐", onClick: () => toggleFeatured(offer) },
                      { label: offer.available ? "Pausar" : "Activar", icon: offer.available ? "⏸️" : "▶️", onClick: () => toggleAvailable(offer) },
                      { label: "Eliminar", icon: "🗑️", onClick: () => deleteOffer(offer), destructive: true },
                    ]}
                  />
                </div>
              </div>
            </Card>
          ))
        )}
      </div>
    </>
  );

  const ordersContent = (
    <div className="space-y-3">
      {orders.length === 0 ? (
        <p className="text-muted-foreground text-center py-12">Todavía no recibiste pedidos.</p>
      ) : (
        orders.map((order) => (
          <Card key={order.id} className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <div>
                <p className="font-semibold text-sm">{order.customer_name}</p>
                <p className="text-xs text-muted-foreground">
                  <a href={`https://wa.me/${order.customer_phone.replace(/[^0-9]/g, "")}`} target="_blank" rel="noopener noreferrer" className="text-primary">{order.customer_phone}</a>
                  {order.method === "delivery" ? ` · ${order.customer_address || "sin dirección"}` : " · Retiro"}
                </p>
              </div>
              <Badge className={STATUS_COLORS[order.status]}>{STATUS_LABELS[order.status]}</Badge>
            </div>
            <div className="border-t pt-2 mb-2">
              {(order.items || []).map((item, i) => (
                <p key={i} className="text-xs flex justify-between"><span>{item.qty}x {item.name}</span><span>${Number(item.price * item.qty).toLocaleString("es-AR")}</span></p>
              ))}
              <div className="border-t mt-1 pt-1 flex justify-between font-bold text-sm"><span>Total</span><span>${Number(order.total).toLocaleString("es-AR")}</span></div>
            </div>
            <p className="text-[10px] text-muted-foreground mb-2">{new Date(order.created_at).toLocaleString("es-AR")}</p>
            <div className="flex flex-wrap gap-2">
              {order.status === "new" && <Button size="sm" onClick={() => updateOrderStatus(order, "confirmed")}>Confirmar</Button>}
              {order.status === "confirmed" && <Button size="sm" onClick={() => updateOrderStatus(order, "completed")}>Completar</Button>}
              {order.status !== "cancelled" && order.status !== "completed" && (
                <Button size="sm" variant="outline" className="text-red-600" onClick={() => updateOrderStatus(order, "cancelled")}>Cancelar</Button>
              )}
            </div>
          </Card>
        ))
      )}
    </div>
  );

  return (
    <main className="min-h-screen bg-background pb-20 sm:pb-8">
      {/* Header */}
      <div className="sticky top-0 z-40 bg-background border-b border-border">
        <div className="container mx-auto px-4 py-3 flex items-center gap-3">
          {vendor.logo_url || vendor.image_url ? (
            <img src={vendor.logo_url || vendor.image_url || ""} alt={vendor.store_name} className="h-10 w-10 rounded-full object-cover flex-shrink-0" />
          ) : (
            <div className="h-10 w-10 rounded-full bg-accent flex items-center justify-center flex-shrink-0"><span className="font-bold text-primary">{vendor.store_name.charAt(0)}</span></div>
          )}
          <div className="flex-1 min-w-0">
            <h1 className="font-semibold text-sm truncate">{vendor.store_name}</h1>
            {vendor.slug && <a href={`/tienda/${vendor.slug}`} target="_blank" rel="noopener noreferrer" className="text-xs text-primary">Ver mi micrositio →</a>}
          </div>
          <Button variant="outline" size="sm" onClick={openShare} className="flex-shrink-0">Compartir</Button>
        </div>
      </div>

      {msg && <div className="container mx-auto px-4 pt-3"><p className="text-sm text-green-600 bg-green-50 rounded-lg px-3 py-2">{msg}</p></div>}

      {/* Desktop tabs */}
      <div className="hidden sm:block container mx-auto px-4 mt-4">
        <div className="flex gap-2 mb-4">
          {!isService && (
            <>
              <Button variant={tab === "config" ? "default" : "outline"} size="sm" onClick={() => setTab("config")}>Configuración</Button>
              <Button variant={tab === "menu" ? "default" : "outline"} size="sm" onClick={() => setTab("menu")}>Menú ({offers.length})</Button>
              <Button variant={tab === "orders" ? "default" : "outline"} size="sm" onClick={() => setTab("orders")}>Pedidos ({orders.length})</Button>
            </>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="container mx-auto px-4 mt-4 max-w-2xl">
        {isService ? (
          <div className="space-y-4">{configContent}</div>
        ) : (
          <>
            <div className={tab === "config" ? "" : "hidden sm:hidden"}>{configContent}</div>
            <div className={tab === "menu" ? "" : "hidden sm:hidden"}>{menuContent}</div>
            <div className={tab === "orders" ? "" : "hidden sm:hidden"}>{ordersContent}</div>
            <div className="hidden sm:block">
              {tab === "config" && configContent}
              {tab === "menu" && menuContent}
              {tab === "orders" && ordersContent}
            </div>
          </>
        )}
      </div>

      {/* Mobile bottom nav */}
      {!isService && (
        <nav className="sm:hidden fixed bottom-0 inset-x-0 bg-card border-t border-border z-50">
          <div className="flex">
            <button onClick={() => setTab("config")} className={`flex-1 flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium ${tab === "config" ? "text-primary" : "text-muted-foreground"}`}>
              <span className="text-lg">⚙️</span>Config
            </button>
            <button onClick={() => setTab("menu")} className={`flex-1 flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium ${tab === "menu" ? "text-primary" : "text-muted-foreground"}`}>
              <span className="text-lg">🍽️</span>Menú
            </button>
            <button onClick={() => setTab("orders")} className={`flex-1 flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium ${tab === "orders" ? "text-primary" : "text-muted-foreground"}`}>
              <span className="text-lg">📦</span>Pedidos
              {orders.length > 0 && <span className="absolute top-1 right-1/3 -translate-x-4 bg-red-500 text-white text-[9px] rounded-full h-4 w-4 flex items-center justify-center">{orders.length}</span>}
            </button>
          </div>
        </nav>
      )}

      {/* Share modal */}
      {shareOpen && vendor.slug && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setShareOpen(false)}>
          <div className="bg-card rounded-2xl p-6 max-w-sm w-full text-center" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-display text-xl font-semibold mb-1">Compartí tu vidriera</h3>
            <p className="text-sm text-muted-foreground mb-4">El QR lleva directo a tu micrositio.</p>
            {qrDataUrl ? <img src={qrDataUrl} alt="QR" className="mx-auto w-48 h-48 mb-4" /> : <div className="mx-auto w-48 h-48 mb-4 bg-muted animate-pulse rounded-lg" />}
            <p className="text-xs text-muted-foreground break-all mb-4">{window.location.origin}/tienda/{vendor.slug}</p>
            <div className="flex gap-2">
              <Button className="flex-1" onClick={copyLink}>{copied ? "¡Copiado!" : "Copiar link"}</Button>
              <Button variant="outline" className="flex-1" onClick={() => setShareOpen(false)}>Cerrar</Button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
