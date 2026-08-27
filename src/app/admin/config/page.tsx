"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Trash2, Save } from "lucide-react";

type Neighborhood = { id: string; name: string; slug: string; lat: number | null; lng: number | null };
type Category = { id: string; name: string; slug: string; vertical: string | null };

export default function AdminConfigPage() {
  const [neighborhoods, setNeighborhoods] = useState<Neighborhood[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [newNeighborhood, setNewNeighborhood] = useState({ name: "", slug: "" });
  const [newCategory, setNewCategory] = useState({ name: "", slug: "", vertical: "" });

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/config");
      const data = await res.json();
      if (!data.error) {
        setNeighborhoods(data.neighborhoods);
        setCategories(data.categories);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  async function addNeighborhood() {
    if (!newNeighborhood.name) return;
    await fetch("/api/admin/config/neighborhoods", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newNeighborhood),
    });
    setNewNeighborhood({ name: "", slug: "" });
    fetchData();
  }

  async function deleteNeighborhood(id: string) {
    if (!confirm("¿Eliminar este barrio?")) return;
    await fetch("/api/admin/config/neighborhoods", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    fetchData();
  }

  async function addCategory() {
    if (!newCategory.name) return;
    await fetch("/api/admin/config/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newCategory),
    });
    setNewCategory({ name: "", slug: "", vertical: "" });
    fetchData();
  }

  async function deleteCategory(id: string) {
    if (!confirm("¿Eliminar esta categoría?")) return;
    await fetch("/api/admin/config/categories", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    fetchData();
  }

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-semibold">Configuración</h1>

      <div className="border border-border rounded-xl p-5 bg-card">
        <h2 className="font-medium text-lg mb-4">Barrios</h2>
        {loading ? (
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => <div key={i} className="h-10 rounded-lg bg-muted animate-pulse" />)}
          </div>
        ) : (
          <>
            <div className="space-y-2 mb-4">
              {neighborhoods.map((n) => (
                <div key={n.id} className="flex items-center justify-between py-2 px-3 rounded-lg bg-muted/50">
                  <div>
                    <span className="text-sm font-medium">{n.name}</span>
                    <span className="text-xs text-muted-foreground ml-2">({n.slug})</span>
                  </div>
                  <button onClick={() => deleteNeighborhood(n.id)} className="p-1 rounded hover:bg-red-50 transition-colors">
                    <Trash2 className="h-3.5 w-3.5 text-red-500" />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <Input
                placeholder="Nombre del barrio"
                value={newNeighborhood.name}
                onChange={(e) => setNewNeighborhood({ ...newNeighborhood, name: e.target.value, slug: e.target.value.toLowerCase().replace(/\s+/g, "-") })}
                className="flex-1"
              />
              <Button onClick={addNeighborhood} size="sm" disabled={!newNeighborhood.name}>
                <Plus className="h-4 w-4 mr-1" /> Agregar
              </Button>
            </div>
          </>
        )}
      </div>

      <div className="border border-border rounded-xl p-5 bg-card">
        <h2 className="font-medium text-lg mb-4">Categorías</h2>
        {loading ? (
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => <div key={i} className="h-10 rounded-lg bg-muted animate-pulse" />)}
          </div>
        ) : (
          <>
            <div className="space-y-2 mb-4">
              {categories.map((c) => (
                <div key={c.id} className="flex items-center justify-between py-2 px-3 rounded-lg bg-muted/50">
                  <div>
                    <span className="text-sm font-medium">{c.name}</span>
                    {c.vertical && <span className="text-xs text-muted-foreground ml-2">({c.vertical})</span>}
                  </div>
                  <button onClick={() => deleteCategory(c.id)} className="p-1 rounded hover:bg-red-50 transition-colors">
                    <Trash2 className="h-3.5 w-3.5 text-red-500" />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <Input
                placeholder="Nombre de categoría"
                value={newCategory.name}
                onChange={(e) => setNewCategory({ ...newCategory, name: e.target.value, slug: e.target.value.toLowerCase().replace(/\s+/g, "-") })}
                className="flex-1"
              />
              <select
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                value={newCategory.vertical}
                onChange={(e) => setNewCategory({ ...newCategory, vertical: e.target.value })}
              >
                <option value="">General</option>
                <option value="gastronomia">Gastronomía</option>
                <option value="comercio">Comercio</option>
                <option value="servicio">Servicio</option>
                <option value="moda">Moda</option>
                <option value="salud">Salud</option>
                <option value="varios">Varios</option>
                <option value="mascotas">Mascotas</option>
              </select>
              <Button onClick={addCategory} size="sm" disabled={!newCategory.name}>
                <Plus className="h-4 w-4 mr-1" /> Agregar
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
