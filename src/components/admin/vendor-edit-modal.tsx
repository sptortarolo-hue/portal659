"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { X } from "lucide-react";
import { VERTICALS } from "@/lib/config";

interface VendorData {
  id: string;
  store_name: string;
  slug: string;
  description: string;
  vertical: string;
  neighborhood: string;
  phone: string;
  whatsapp: string;
  address: string;
  verified: boolean;
  featured?: boolean;
  is_admin: boolean;
}

interface VendorEditModalProps {
  open: boolean;
  vendor: VendorData | null;
  onClose: () => void;
  onSave: (data: Partial<VendorData>) => Promise<void>;
}

export default function VendorEditModal({ open, vendor, onClose, onSave }: VendorEditModalProps) {
  const [form, setForm] = useState({
    store_name: "",
    description: "",
    vertical: "",
    neighborhood: "",
    phone: "",
    whatsapp: "",
    address: "",
    featured: false,
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (vendor) {
      setForm({
        store_name: vendor.store_name || "",
        description: vendor.description || "",
        vertical: vendor.vertical || "",
        neighborhood: vendor.neighborhood || "",
        phone: vendor.phone || "",
        whatsapp: vendor.whatsapp || "",
        address: vendor.address || "",
        featured: !!vendor.featured,
      });
    }
  }, [vendor]);

  if (!open || !vendor) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await onSave({ ...vendor, ...form });
      onClose();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-xl font-semibold">Editar comercio</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <Label htmlFor="ve-name">Nombre del comercio</Label>
            <Input id="ve-name" value={form.store_name} onChange={(e) => setForm({ ...form, store_name: e.target.value })} required />
          </div>

          <div>
            <Label htmlFor="ve-desc">Descripción</Label>
            <textarea
              id="ve-desc"
              className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="ve-vert">Vertical</Label>
              <select
                id="ve-vert"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.vertical}
                onChange={(e) => setForm({ ...form, vertical: e.target.value })}
              >
                {VERTICALS.map((v) => (
                  <option key={v.slug} value={v.slug}>{v.name}</option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="ve-neigh">Barrio</Label>
              <Input id="ve-neigh" value={form.neighborhood} onChange={(e) => setForm({ ...form, neighborhood: e.target.value })} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="ve-phone">Teléfono</Label>
              <Input id="ve-phone" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="ve-wa">WhatsApp</Label>
              <Input id="ve-wa" type="tel" value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} />
            </div>
          </div>

          <div>
            <Label htmlFor="ve-addr">Dirección</Label>
            <Input id="ve-addr" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </div>

          <label className="flex items-center gap-3 pt-1 cursor-pointer">
            <input
              type="checkbox"
              checked={form.featured}
              onChange={(e) => setForm({ ...form, featured: e.target.checked })}
              className="h-4 w-4 accent-primary"
            />
            <span className="text-sm">⭐ Destacar en el inicio (sección "Destacados del barrio")</span>
          </label>

          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" className="flex-1" onClick={onClose} disabled={loading}>
              Cancelar
            </Button>
            <Button type="submit" className="flex-1" disabled={loading}>
              {loading ? "Guardando..." : "Guardar"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
