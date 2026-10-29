"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ProductImage } from "@/components/product-image";

type GalleryItem = {
  id: string;
  image_url: string;
  caption?: string | null;
};

/**
 * Galería de fotos de la vidriera (vendor_gallery). Se muestra en el
 * micrositio en la sección "Galería". Reusable por vertical.
 */
export function GalleryManager({
  title = "Galería de fotos",
  emptyText = "Todavía no subiste fotos.",
  addLabel = "Agregar foto",
  captionPlaceholder = "Descripción...",
  onCount,
  onChanged,
}: {
  title?: string;
  emptyText?: string;
  addLabel?: string;
  captionPlaceholder?: string;
  onCount?: (n: number) => void;
  onChanged?: () => void;
}) {
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [savingOrder, setSavingOrder] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [captions, setCaptions] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/vendor/gallery");
      const d = await r.json();
      const list: GalleryItem[] = d.gallery || [];
      setItems(list);
      onCount?.(list.length);
    } catch {
      /* sin conexión: se muestra lo que haya */
    }
  }, [onCount]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("folder", "gallery");
      const upRes = await fetch("/api/vendor/upload", { method: "POST", body: fd });
      const upData = await upRes.json();
      if (!upData.url) {
        setError(upData.error || "Error al subir imagen");
        return;
      }
      const gRes = await fetch("/api/vendor/gallery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_url: upData.url }),
      });
      const gData = await gRes.json();
      if (gData.error) {
        setError(gData.error);
        return;
      }
      await load();
      onChanged?.();
    } catch {
      setError("Error de conexión");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function handleCaptionSave(item: GalleryItem) {
    const caption = (captions[item.id] ?? item.caption ?? "").trim();
    setSavingId(item.id);
    setError("");
    try {
      const r = await fetch(`/api/vendor/gallery/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caption: caption || null }),
      });
      const d = await r.json();
      if (d.error) {
        setError(d.error);
        return;
      }
      setItems((prev) => prev.map((it) => (it.id === item.id ? { ...it, caption: caption || null } : it)));
      setCaptions((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
      onChanged?.();
    } catch {
      setError("Error de conexión");
    } finally {
      setSavingId(null);
    }
  }

  async function handleDelete(id: string) {
    setError("");
    try {
      const r = await fetch(`/api/vendor/gallery/${id}`, { method: "DELETE" });
      const d = await r.json();
      if (d.error) {
        setError(d.error);
        return;
      }
      await load();
      onChanged?.();
    } catch {
      setError("Error de conexión");
    }
  }

  async function persistOrder(next: GalleryItem[]) {
    setSavingOrder(true);
    try {
      await fetch("/api/vendor/gallery/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: next.map((i) => i.id) }),
      });
      onChanged?.();
    } catch {
      /* best-effort */
    } finally {
      setSavingOrder(false);
    }
  }

  function moveItem(from: number, to: number) {
    if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return;
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setItems(next);
    persistOrder(next);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">{title}</p>
        {savingOrder && <span className="text-xs text-muted-foreground">Guardando orden…</span>}
      </div>
      <div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          onChange={handleUpload}
          className="hidden"
        />
        <Button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="w-full"
          variant="outline"
        >
          {uploading ? "Subiendo..." : addLabel}
        </Button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">{emptyText}</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {items.map((item, idx) => {
            const draft = captions[item.id] ?? item.caption ?? "";
            const dirty = draft.trim() !== (item.caption || "").trim();
            return (
              <div
                key={item.id}
                draggable
                onDragStart={() => setDragIndex(idx)}
                onDragOver={(e) => { e.preventDefault(); setDragOver(idx); }}
                onDrop={() => {
                  if (dragIndex != null && dragIndex !== idx) moveItem(dragIndex, idx);
                  setDragIndex(null);
                  setDragOver(null);
                }}
                onDragEnd={() => { setDragIndex(null); setDragOver(null); }}
                className={`border border-border rounded-lg overflow-hidden bg-background ${dragOver === idx ? "ring-2 ring-primary" : ""} ${dragIndex === idx ? "opacity-50" : ""}`}
              >
                <div className="aspect-square relative">
                  <ProductImage
                    src={item.image_url}
                    name={draft || "Foto"}
                    alt={draft || "Foto de la vidriera"}
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="p-2 space-y-1">
                  <div className="flex gap-1">
                    <Input
                      value={draft}
                      onChange={(e) =>
                        setCaptions((prev) => ({ ...prev, [item.id]: e.target.value }))
                      }
                      placeholder={captionPlaceholder}
                      className="h-7 text-xs min-w-0"
                    />
                    {dirty && (
                      <Button
                        type="button"
                        size="sm"
                        className="h-7 text-xs flex-shrink-0"
                        disabled={savingId === item.id}
                        onClick={() => handleCaptionSave(item)}
                      >
                        {savingId === item.id ? "…" : "OK"}
                      </Button>
                    )}
                  </div>
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="flex-1 h-7 text-xs"
                      disabled={idx === 0 || savingOrder}
                      onClick={() => moveItem(idx, idx - 1)}
                      title="Mover a la izquierda"
                    >
                      ←
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="flex-1 h-7 text-xs"
                      disabled={idx === items.length - 1 || savingOrder}
                      onClick={() => moveItem(idx, idx + 1)}
                      title="Mover a la derecha"
                    >
                      →
                    </Button>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="w-full h-7 text-xs text-red-600"
                    onClick={() => handleDelete(item.id)}
                  >
                    Eliminar
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
