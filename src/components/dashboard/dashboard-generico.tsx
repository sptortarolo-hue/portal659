"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { ChipToggle } from "@/components/ui/chip-toggle";
import { RadioCards } from "@/components/ui/radio-cards";
import { OfferForm, OfferList, CategoryManager, LivePreview } from "./shared";
import type { Vendor, Product } from "@/types/database";

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

const VERTICAL_OPTIONS = [
  { value: "gastronomia", label: "Gastronomía" },
  { value: "comercio", label: "Comercio" },
  { value: "servicio", label: "Servicio" },
  { value: "moda", label: "Ropa y Accesorios" },
  { value: "salud", label: "Salud y Bienestar" },
  { value: "varios", label: "Varios" },
  { value: "mascotas", label: "Mascotas" },
  { value: "otro", label: "Otro" },
];

type Props = {
  vendor: Vendor | null;
  offers: Product[];
  categories: { id: string; name: string; position: number }[];
  msg: string;
  setMsg: (m: string) => void;
  reload: () => void;
  saveVendor: (data: Record<string, unknown>) => Promise<void>;
  uploading: boolean;
  onCrop: (target: "cover" | "logo" | "offer") => void;
};

export default function DashboardGenerico({
  vendor, offers, categories, msg, setMsg, reload, saveVendor, uploading, onCrop,
}: Props) {
  const [storeName, setStoreName] = useState("");
  const [storeVertical, setStoreVertical] = useState("varios");
  const [storeCategory, setStoreCategory] = useState("");
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

  const [showNew, setShowNew] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [offName, setOffName] = useState("");
  const [offDesc, setOffDesc] = useState("");
  const [offPrice, setOffPrice] = useState("");
  const [offCategory, setOffCategory] = useState("");
  const [offFile, setOffFile] = useState<File | null>(null);
  const [offPreview, setOffPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!vendor) return;
    setStoreName(vendor.store_name || "");
    setStoreVertical(vendor.vertical || "varios");
    setStoreCategory(vendor.category || "");
    setWhatsapp(vendor.whatsapp || "");
    setPhone(vendor.phone || "");
    setAddress(vendor.address || "");
    setHours(vendor.hours || "");
    setDescription(vendor.description || "");
    setStorePreview(vendor.image_url || null);
    setLogoPreview(vendor.logo_url || null);
    setInstagram(vendor.instagram || "");
    setFacebook(vendor.facebook || "");
    setPaymentMethods(vendor.payment_methods ? vendor.payment_methods.split(", ").map((s: string) => s.trim()).filter(Boolean) : []);
    setDeliveryOptions(vendor.delivery_options || "ambos");
  }, [vendor]);

  async function uploadImage(file: File, folder: string): Promise<string | null> {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("folder", folder);
    const res = await fetch("/api/vendor/upload", { method: "POST", body: fd });
    const data = await res.json();
    return data.url || null;
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    let imageUrl = vendor?.image_url || null;
    let logoUrl = vendor?.logo_url || null;
    if (storeFile) { const url = await uploadImage(storeFile, "vendors"); if (url) imageUrl = url; }
    if (logoFile) { const url = await uploadImage(logoFile, "vendors"); if (url) logoUrl = url; }
    await saveVendor({
      store_name: storeName, vertical: storeVertical, category: storeCategory,
      whatsapp, phone, address, hours, description, image_url: imageUrl, logo_url: logoUrl,
      instagram, facebook, payment_methods: paymentMethods.join(", "), delivery_options: deliveryOptions,
    });
    setStoreFile(null);
    setLogoFile(null);
    setSaving(false);
  }

  async function handleNewOffer(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    let imageUrl = null;
    if (offFile) { imageUrl = await uploadImage(offFile, "offers"); }
    const payload = { name: offName, description: offDesc, price: Number(offPrice), category: offCategory, image_url: imageUrl };
    if (editingId) {
      await fetch(`/api/vendor/offers/${editingId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    } else {
      await fetch("/api/vendor/offers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    }
    setShowNew(false);
    setEditingId(null);
    setOffName(""); setOffDesc(""); setOffPrice(""); setOffCategory(""); setOffFile(null); setOffPreview(null);
    setMsg(editingId ? "Plato actualizado" : "Plato agregado");
    reload();
    setSaving(false);
  }

  function startEdit(offer: any) {
    setEditingId(offer.id);
    setOffName(offer.name);
    setOffDesc(offer.description || "");
    setOffPrice(String(offer.price));
    setOffCategory(offer.category || "");
    setOffFile(null);
    setOffPreview(offer.image_url || null);
    setShowNew(true);
  }

  async function toggleFeatured(offer: any) {
    await fetch(`/api/vendor/offers/${offer.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ featured_today: !offer.featured_today }) });
    reload();
  }

  async function toggleAvailable(offer: any) {
    await fetch(`/api/vendor/offers/${offer.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ available: !offer.available }) });
    reload();
  }

  async function deleteOffer(offer: any) {
    await fetch(`/api/vendor/offers/${offer.id}`, { method: "DELETE" });
    reload();
  }

  return (
    <form onSubmit={handleSave} className="space-y-4">
      <LivePreview storeName={storeName} storePreview={storePreview} vendor={vendor} logoPreview={logoPreview} description={description} hours={hours} address={address} paymentMethods={paymentMethods} whatsapp={whatsapp} isService={false} />

      <CollapsibleSection icon="🏪" title="Tu comercio" defaultOpen>
        <div className="space-y-3">
          <div><Label>Tipo</Label><select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={storeVertical} onChange={(e) => setStoreVertical(e.target.value)}>{VERTICAL_OPTIONS.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}</select></div>
          <div><Label>Nombre</Label><Input value={storeName} onChange={(e) => setStoreName(e.target.value)} required /></div>
          <div><Label>Categoría</Label><Input value={storeCategory} onChange={(e) => setStoreCategory(e.target.value)} placeholder="Ej: ropa, farmacia, librería..." /></div>
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
          <div><Label>Foto del comercio</Label><Input type="file" accept="image/*" onChange={(e) => { const f = e.target.files?.[0] || null; if (f) { setStoreFile(f); setStorePreview(URL.createObjectURL(f)); } }} />{storePreview && <img src={storePreview} alt="Vista previa" className="mt-2 h-24 w-full object-cover rounded-lg" />}</div>
          <div><Label>Logo</Label><Input type="file" accept="image/*" onChange={(e) => { const f = e.target.files?.[0] || null; if (f) { setLogoFile(f); setLogoPreview(URL.createObjectURL(f)); } }} />{logoPreview && <img src={logoPreview} alt="Logo" className="mt-2 h-16 w-16 object-cover rounded-full border" />}</div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection icon="📝" title="Descripción">
        <Textarea value={description} onChange={(e) => setDescription(e.target.value)} />
      </CollapsibleSection>

      <CollapsibleSection icon="📱" title="Contacto">
        <div className="space-y-3">
          <div><Label>WhatsApp</Label><Input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} /></div>
          <div><Label>Teléfono</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="2215550000" /></div>
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

      <Button type="submit" className="w-full" disabled={saving}>{saving ? "Guardando..." : "Guardar cambios"}</Button>

      <CollapsibleSection icon="📦" title={`Catálogo (${offers.length})`} defaultOpen>
        <CategoryManager
          categories={categories}
          onAdd={(name) => { fetch("/api/vendor/categories", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }).then(() => reload()); }}
          onRename={(id, name) => { fetch(`/api/vendor/categories/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }).then(() => reload()); }}
          onDelete={(cat) => { if (window.confirm(`¿Eliminar "${cat.name}"?`)) { fetch(`/api/vendor/categories/${cat.id}`, { method: "DELETE" }).then(() => reload()); } }}
          onMove={(cat, dir) => {
            const idx = categories.findIndex((c) => c.id === cat.id);
            const target = idx + dir;
            if (target < 0 || target >= categories.length) return;
            const reordered = [...categories];
            const [moved] = reordered.splice(idx, 1);
            reordered.splice(target, 0, moved);
            Promise.all(reordered.map((c, i) => fetch(`/api/vendor/categories/${c.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ position: i }) }))).then(() => reload());
          }}
        />
        <div className="flex items-center justify-between mt-2 mb-4">
          <h3 className="font-semibold text-sm">Productos</h3>
          <Button size="sm" onClick={() => { setShowNew(!showNew); setEditingId(null); }}>{showNew ? "Cancelar" : "+ Producto"}</Button>
        </div>
        {showNew && (
          <OfferForm categories={categories} editingId={editingId} offName={offName} setOffName={setOffName} offDesc={offDesc} setOffDesc={setOffDesc} offPrice={offPrice} setOffPrice={setOffPrice} offCategory={offCategory} setOffCategory={setOffCategory} offFile={offFile} setOffFile={setOffFile} offPreview={offPreview} setOffPreview={setOffPreview} saving={saving} onSubmit={handleNewOffer} />
        )}
        <OfferList offers={offers} onEdit={startEdit} onToggleFeatured={toggleFeatured} onToggleAvailable={toggleAvailable} onDelete={deleteOffer} />
      </CollapsibleSection>
    </form>
  );
}
