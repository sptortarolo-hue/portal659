"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import DeleteConfirmModal from "@/components/admin/delete-confirm-modal";
import { NEIGHBORHOODS } from "@/lib/config";
import { Plus, Trash2, Pencil, ChevronUp, ChevronDown, Megaphone, X, Check } from "lucide-react";

type InfoItem = {
  id: string;
  zone: string;
  category: string;
  title: string;
  body: string | null;
  tags: string[] | null;
  active: boolean;
  sort: number;
  updated_at: string;
};

const CATEGORIES = [
  { value: "transporte", label: "Transporte", color: "bg-sky-50 text-sky-700" },
  { value: "utilidades", label: "Utilidades", color: "bg-emerald-50 text-emerald-700" },
  { value: "horarios", label: "Horarios", color: "bg-amber-50 text-amber-700" },
  { value: "noticias", label: "Avisos", color: "bg-violet-50 text-violet-700" },
];

const EMPTY_FORM = { id: "", zone: "sicardi", category: "transporte", title: "", body: "", tags: "" };

export default function AdminAlertaPage() {
  const [items, setItems] = useState<InfoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [deleteItem, setDeleteItem] = useState<InfoItem | null>(null);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/info-items");
      const data = await res.json();
      if (!data.error) setItems(data.items);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  function resetForm() {
    setForm(EMPTY_FORM);
    setEditing(false);
    setError("");
  }

  async function saveItem() {
    setSaving(true);
    setError("");
    const payload = {
      zone: form.zone,
      category: form.category,
      title: form.title,
      body: form.body,
      tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
    };
    const method = editing ? "PATCH" : "POST";
    const body = editing ? { id: form.id, ...payload } : payload;

    try {
      const res = await fetch("/api/admin/info-items", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        return;
      }
      resetForm();
      fetchItems();
    } finally {
      setSaving(false);
    }
  }

  async function startEdit(item: InfoItem) {
    setEditing(true);
    setForm({
      id: item.id,
      zone: item.zone || "sicardi",
      category: item.category,
      title: item.title,
      body: item.body || "",
      tags: (item.tags || []).join(", "),
    });
    setError("");
  }

  async function toggleActive(item: InfoItem) {
    await fetch("/api/admin/info-items", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...item, active: !item.active }),
    });
    fetchItems();
  }

  async function moveItem(item: InfoItem, dir: 1 | -1) {
    const sorted = [...items].sort((a, b) => a.sort - b.sort || a.title.localeCompare(b.title));
    const idx = sorted.findIndex((i) => i.id === item.id);
    const swapWith = sorted[idx + dir];
    if (!swapWith) return;
    await Promise.all([
      fetch("/api/admin/info-items", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...item, sort: swapWith.sort }),
      }),
      fetch("/api/admin/info-items", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...swapWith, sort: item.sort }),
      }),
    ]);
    fetchItems();
  }

  async function handleDelete() {
    if (!deleteItem) return;
    await fetch("/api/admin/info-items", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: deleteItem.id }),
    });
    setDeleteItem(null);
    fetchItems();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-semibold">Alerta Vecinal</h1>
        <span className="text-sm text-muted-foreground">{items.length} ítems</span>
      </div>

      <div className="border border-border rounded-xl p-5 bg-card">
        <h2 className="font-medium text-lg mb-4 flex items-center gap-2">
          <Megaphone className="h-5 w-5 text-primary" />
          {editing ? "Editar ítem" : "Nuevo ítem"}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label>Barrio</Label>
            <select
              className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={form.zone}
              onChange={(e) => setForm({ ...form, zone: e.target.value })}
            >
              {NEIGHBORHOODS.map((n) => (
                <option key={n.slug} value={n.slug}>{n.name}</option>
              ))}
            </select>
          </div>
          <div>
            <Label>Categoría</Label>
            <select
              className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
            >
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>
          <div>
            <Label>Título</Label>
            <Input
              className="mt-1.5"
              placeholder="Título del aviso"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </div>
          <div className="sm:col-span-2">
            <Label>Cuerpo</Label>
            <Textarea
              className="mt-1.5"
              placeholder="Contenido del aviso (opcional)"
              rows={3}
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
            />
          </div>
          <div className="sm:col-span-2">
            <Label>Tags (separados por coma)</Label>
            <Input
              className="mt-1.5"
              placeholder="colectivos, sube, horarios"
              value={form.tags}
              onChange={(e) => setForm({ ...form, tags: e.target.value })}
            />
          </div>
        </div>
        {error && <p className="text-sm text-red-600 mt-3">{error}</p>}
        <div className="flex gap-3 mt-5">
          <Button onClick={saveItem} disabled={saving || !form.title}>
            <Plus className="h-4 w-4 mr-1" /> {saving ? "Guardando..." : editing ? "Guardar cambios" : "Agregar"}
          </Button>
          {editing && (
            <Button variant="outline" onClick={resetForm}>
              <X className="h-4 w-4 mr-1" /> Cancelar
            </Button>
          )}
        </div>
      </div>

      <div>
        <h2 className="font-medium text-lg mb-3">Ítems publicados</h2>
        {loading ? (
          <div className="space-y-3">
            {[...Array(4)].map((_, i) => <div key={i} className="h-16 rounded-xl bg-muted animate-pulse" />)}
          </div>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hay ítems todavía.</p>
        ) : (
          <div className="space-y-2">
            {items.map((item) => {
              const cat = CATEGORIES.find((c) => c.value === item.category);
              return (
                <div
                  key={item.id}
                  className={`flex items-center justify-between gap-3 py-3 px-4 rounded-xl border border-border bg-card ${
                    !item.active ? "opacity-60" : ""
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-primary/10 text-primary">
                        {NEIGHBORHOODS.find((n) => n.slug === item.zone)?.name || item.zone}
                      </span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${cat?.color || "bg-muted"}`}>
                        {cat?.label || item.category}
                      </span>
                      {!item.active && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-gray-100 text-gray-600">Oculto</span>
                      )}
                      <span className="text-sm font-medium">{item.title}</span>
                    </div>
                    {item.body && (
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{item.body}</p>
                    )}
                    {(item.tags || []).length > 0 && (
                      <div className="flex gap-1 mt-1">
                        {(item.tags || []).map((t) => (
                          <span key={t} className="text-[10px] text-muted-foreground">#{t}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button onClick={() => moveItem(item, -1)} className="p-1.5 rounded hover:bg-muted transition-colors" title="Subir">
                      <ChevronUp className="h-4 w-4" />
                    </button>
                    <button onClick={() => moveItem(item, 1)} className="p-1.5 rounded hover:bg-muted transition-colors" title="Bajar">
                      <ChevronDown className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => toggleActive(item)}
                      className="p-1.5 rounded hover:bg-muted transition-colors"
                      title={item.active ? "Ocultar" : "Mostrar"}
                    >
                      {item.active ? <Check className="h-4 w-4 text-emerald-600" /> : <X className="h-4 w-4 text-gray-400" />}
                    </button>
                    <button onClick={() => startEdit(item)} className="p-1.5 rounded hover:bg-muted transition-colors" title="Editar">
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button onClick={() => setDeleteItem(item)} className="p-1.5 rounded hover:bg-red-50 transition-colors" title="Eliminar">
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <DeleteConfirmModal
        open={!!deleteItem}
        onClose={() => setDeleteItem(null)}
        onConfirm={handleDelete}
        title="Eliminar ítem"
        message="¿Eliminar este ítem de la Alerta Vecinal? Esta acción no se puede deshacer."
      />
    </div>
  );
}