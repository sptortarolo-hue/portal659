"use client";

import { useCallback, useEffect, useState, useRef } from "react";
import { ProductImage } from "@/components/product-image";
import { Button } from "@/components/ui/button";

type Item = {
  id: string;
  name: string;
  price: number;
  image: string | null;
  available: boolean;
  suggestible: boolean;
  position: number;
  eligible: boolean;
  reason: string | null;
  stock: number | null;
  stockControl: boolean;
  unit: string;
  category: string | null;
};

type Props = {
  vendorId: string | null;
  onChanged?: () => void;
};

export function SuggestionsManager({ vendorId, onChanged }: Props) {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [limit, setLimit] = useState(8);
  const [dragId, setDragId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!vendorId) return;
    setLoading(true);
    try {
      const res = await fetch("/api/vendor/suggestions");
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        setItems(Array.isArray(d?.items) ? d.items : []);
      } else {
        setMsg(d?.error || "No se pudo cargar");
      }
    } catch {
      setMsg("Error de red");
    } finally {
      setLoading(false);
    }
  }, [vendorId]);

  useEffect(() => {
    load();
  }, [load]);

  const active = items
    .filter((i) => i.suggestible)
    .sort((a, b) => (a.position || 9999) - (b.position || 9999));
  const eligible = items.filter((i) => !i.suggestible && i.eligible && i.available);
  const ineligible = items.filter((i) => !i.eligible || !i.available);

  const toggle = async (item: Item) => {
    const res = await fetch(`/api/vendor/offers/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ suggestible: !item.suggestible }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setMsg(d?.error || "No se pudo actualizar");
    } else {
      setMsg("");
    }
    await load();
    onChanged?.();
  };

  const reorder = async (newOrder: string[]) => {
    const res = await fetch("/api/vendor/suggestions/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order: newOrder }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setMsg(d?.error || "No se pudo reordenar");
    }
    await load();
    onChanged?.();
  };

  // Drag & drop handlers
  const onDragStart = (id: string) => setDragId(id);
  const onDragOver = (e: React.DragEvent, overId: string) => {
    e.preventDefault();
    if (!dragId || dragId === overId) return;
    const idx = active.findIndex((i) => i.id === dragId);
    const overIdx = active.findIndex((i) => i.id === overId);
    if (idx < 0 || overIdx < 0) return;
    const reordered = [...active];
    const [moved] = reordered.splice(idx, 1);
    reordered.splice(overIdx, 0, moved);
    // actualizar posición localmente (optimista)
    const newOrder = reordered.map((i) => i.id);
    // no persistir aún; se persiste en drop
    setDragId(dragId);
  };
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    if (!dragId) return;
    const reordered = [...active];
    // recompute from current active order (dragId ya movido visualmente? no, optimista no aplicado)
    // Simpler: persistir el orden actual de `active` tras el último dragOver no cambió estado.
    // Para persistir, reordenamos según el dragId final: movemos dragId al final de la lista de
    // ids actuales... mejor: guardamos el orden en un ref durante drag.
    setDragId(null);
  };

  // Para hacer el reorder robusto, usamos un ref con el orden actual durante el drag.
  const dragOrderRef = useRef<string[]>([]);
  useEffect(() => {
    dragOrderRef.current = active.map((i) => i.id);
  }, [active]);

  const handleDragStart = (id: string) => {
    dragOrderRef.current = active.map((i) => i.id);
    setDragId(id);
  };
  const handleDragOver = (e: React.DragEvent, overId: string) => {
    e.preventDefault();
    if (!dragId || dragId === overId) return;
    const order = [...dragOrderRef.current];
    const idx = order.indexOf(dragId);
    const overIdx = order.indexOf(overId);
    if (idx < 0 || overIdx < 0) return;
    order.splice(idx, 1);
    order.splice(overIdx, 0, dragId);
    dragOrderRef.current = order;
    // forzar re-render moviendo el item en la lista local
    setItems((prev) => {
      const map = new Map(prev.map((i) => [i.id, i]));
      const reordered = order.map((id) => map.get(id)!).filter(Boolean);
      const rest = prev.filter((i) => !order.includes(i.id));
      return [...reordered, ...rest];
    });
  };
  const handleDrop = async () => {
    if (!dragId) return;
    const newOrder = [...dragOrderRef.current];
    setDragId(null);
    await reorder(newOrder);
  };

  return (
    <div className="space-y-4">
      {msg && <p className="text-sm text-red-600">{msg}</p>}

      {/* Vista previa */}
      <div className="border border-border rounded-xl p-4 bg-card">
        <p className="text-sm font-semibold mb-2">Vista previa del carrusel</p>
        {active.length === 0 ? (
          <p className="text-xs text-muted-foreground">No hay productos sugeribles todavía.</p>
        ) : (
          <div className="flex gap-2 overflow-x-auto pb-2">
            {active.slice(0, limit).map((i) => (
              <div key={i.id} className="flex-shrink-0 w-20 text-center">
                <div className="h-16 w-16 mx-auto rounded-lg overflow-hidden bg-muted flex items-center justify-center">
                  {i.image ? (
                    <ProductImage src={i.image} name={i.name} alt={i.name} className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-xl">🛒</span>
                  )}
                </div>
                <p className="text-[10px] font-medium mt-1 line-clamp-2">{i.name}</p>
                <p className="text-[10px] font-bold">${i.price.toLocaleString("es-AR")}</p>
              </div>
            ))}
          </div>
        )}
        {active.length > limit && (
          <p className="text-[10px] text-muted-foreground mt-1">
            Se muestran {limit} de {active.length}. El cliente ve hasta {limit}.
          </p>
        )}
      </div>

      {/* Límite */}
      <div className="flex items-center gap-2">
        <label className="text-sm">Máximo visible en el carrito:</label>
        <select
          value={limit}
          onChange={(e) => setLimit(Number(e.target.value))}
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
        >
          {[4, 6, 8, 10, 12].map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
      </div>

      {/* Activos con drag & drop */}
      <div className="border border-border rounded-xl p-4 bg-card space-y-2">
        <p className="text-sm font-semibold">Sugeribles activos ({active.length})</p>
        {active.length === 0 ? (
          <p className="text-xs text-muted-foreground">Marcá productos de la lista de abajo para sugerirlos.</p>
        ) : (
          <div className="space-y-1">
            {active.map((i) => (
              <div
                key={i.id}
                draggable
                onDragStart={() => handleDragStart(i.id)}
                onDragOver={(e) => handleDragOver(e, i.id)}
                onDrop={handleDrop}
                className={`flex items-center gap-2 border border-border rounded-lg p-2 cursor-move ${dragId === i.id ? "opacity-50" : ""}`}
              >
                <span className="text-muted-foreground">≡</span>
                <div className="h-8 w-8 rounded overflow-hidden bg-muted flex-shrink-0">
                  {i.image ? (
                    <ProductImage src={i.image} name={i.name} alt={i.name} className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-xs">🛒</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{i.name}</p>
                  <p className="text-xs text-muted-foreground">${i.price.toLocaleString("es-AR")}</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => toggle(i)}>Quitar</Button>
              </div>
            ))}
          </div>
        )}
        {active.length > 0 && (
          <p className="text-[10px] text-muted-foreground">Arrastrá para reordenar. El orden se guarda automáticamente.</p>
        )}
      </div>

      {/* Elegibles no sugeridos */}
      <div className="border border-border rounded-xl p-4 bg-card space-y-2">
        <p className="text-sm font-semibold">Productos elegibles ({eligible.length})</p>
        {eligible.length === 0 ? (
          <p className="text-xs text-muted-foreground">No hay productos elegibles disponibles.</p>
        ) : (
          <div className="space-y-1 max-h-64 overflow-y-auto">
            {eligible.map((i) => (
              <div key={i.id} className="flex items-center gap-2 border border-border rounded-lg p-2">
                <div className="h-8 w-8 rounded overflow-hidden bg-muted flex-shrink-0">
                  {i.image ? (
                    <ProductImage src={i.image} name={i.name} alt={i.name} className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-xs">🛒</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{i.name}</p>
                  <p className="text-xs text-muted-foreground">${i.price.toLocaleString("es-AR")}{i.category ? ` · ${i.category}` : ""}</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => toggle(i)}>Sugerir</Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* No elegibles */}
      {ineligible.length > 0 && (
        <details className="border border-border rounded-xl p-4 bg-card">
          <summary className="text-sm font-semibold cursor-pointer">
            No elegibles ({ineligible.length})
          </summary>
          <div className="mt-2 space-y-1">
            {ineligible.map((i) => (
              <div key={i.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>⊘</span>
                <span className="flex-1 truncate">{i.name}</span>
                <span className="text-[10px]">{i.reason || "No disponible"}</span>
              </div>
            ))}
          </div>
        </details>
      )}

      <Button variant="outline" size="sm" onClick={load} disabled={loading}>
        {loading ? "Cargando…" : "Recargar"}
      </Button>
    </div>
  );
}
