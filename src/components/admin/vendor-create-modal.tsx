"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { X } from "lucide-react";
import { VERTICALS } from "@/lib/config";

type AdminUser = {
  id: string;
  email: string;
  full_name: string;
};

interface VendorCreateModalProps {
  open: boolean;
  onClose: () => void;
  onCreate: (data: Record<string, string>) => Promise<{ error?: string }>;
}

export default function VendorCreateModal({ open, onClose, onCreate }: VendorCreateModalProps) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [form, setForm] = useState({
    user_id: "",
    store_name: "",
    vertical: "gastronomia",
    neighborhood: "sicardi",
    description: "",
    phone: "",
    whatsapp: "",
    address: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setError("");
      setLoadingUsers(true);
      fetch("/api/admin/users?per_page=100")
        .then((r) => r.json())
        .then((d) => setUsers(d.users || []))
        .catch(() => setUsers([]))
        .finally(() => setLoadingUsers(false));
    }
  }, [open]);

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const res = await onCreate({
      user_id: form.user_id,
      store_name: form.store_name,
      vertical: form.vertical,
      neighborhood: form.neighborhood,
      description: form.description,
      phone: form.phone,
      whatsapp: form.whatsapp,
      address: form.address,
    });
    if (res?.error) {
      setError(res.error);
      setLoading(false);
      return;
    }
    setLoading(false);
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-xl font-semibold">Nuevo comercio</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <Label htmlFor="vc-user">Usuario propietario</Label>
            <select
              id="vc-user"
              className="mt-1.5 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={form.user_id}
              onChange={(e) => setForm({ ...form, user_id: e.target.value })}
              required
            >
              <option value="" disabled>
                {loadingUsers ? "Cargando usuarios..." : "Seleccioná un usuario"}
              </option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.full_name || u.email} ({u.email})
                </option>
              ))}
            </select>
            {!loadingUsers && users.length === 0 && (
              <p className="text-xs text-amber-600 mt-1">
                No hay usuarios disponibles. Creá un usuario en "Usuarios" primero.
              </p>
            )}
          </div>

          <div>
            <Label htmlFor="vc-name">Nombre del comercio</Label>
            <Input id="vc-name" value={form.store_name} onChange={(e) => setForm({ ...form, store_name: e.target.value })} required />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="vc-vert">Vertical</Label>
              <select
                id="vc-vert"
                className="mt-1.5 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.vertical}
                onChange={(e) => setForm({ ...form, vertical: e.target.value })}
              >
                {VERTICALS.map((v) => (
                  <option key={v.slug} value={v.slug}>{v.name}</option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="vc-neigh">Barrio</Label>
              <Input id="vc-neigh" value={form.neighborhood} onChange={(e) => setForm({ ...form, neighborhood: e.target.value })} />
            </div>
          </div>

          <div>
            <Label htmlFor="vc-desc">Descripción</Label>
            <textarea
              id="vc-desc"
              className="mt-1.5 flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="vc-phone">Teléfono</Label>
              <Input id="vc-phone" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="vc-wa">WhatsApp</Label>
              <Input id="vc-wa" type="tel" value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} />
            </div>
          </div>

          <div>
            <Label htmlFor="vc-addr">Dirección</Label>
            <Input id="vc-addr" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" className="flex-1" onClick={onClose} disabled={loading}>
              Cancelar
            </Button>
            <Button type="submit" className="flex-1" disabled={loading || !form.user_id}>
              {loading ? "Creando..." : "Crear comercio"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}