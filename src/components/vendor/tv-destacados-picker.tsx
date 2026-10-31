"use client";

import { useMemo, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { ProductImage } from "@/components/product-image";
import type { TvItem } from "@/lib/tv-snapshot";

type Props = {
  open: boolean;
  /** Todos los productos de la carta (vienen del snapshot del preview). */
  items: Pick<TvItem, "id" | "name" | "priceLabel" | "imageUrl">[];
  /** Productos ya elegidos (guardados en hero.productIds). */
  selected: string[];
  onClose: () => void;
  onSave: (ids: string[]) => void;
};

/** Tope de destacados manuales (coincide con el server: slice(0, 4)). */
const MAX = 4;

/**
 * Modal para elegir a mano los productos del banner de destacados.
 *
 * El config de la pantalla ya soportaba `hero.productIds` (modo manual) pero
 * no había forma de elegirlos desde el panel: este modal cierra ese hueco.
 * Guarda por el flujo normal del editor (PATCH del draft), sin migración.
 */
export function TvDestacadosPicker({ open, items, selected, onClose, onSave }: Props) {
  const [pick, setPick] = useState<string[]>(selected);
  const [q, setQ] = useState("");

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((i) => i.name.toLowerCase().includes(needle));
  }, [items, q]);

  function toggle(id: string) {
    setPick((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= MAX ? prev : [...prev, id]
    );
  }

  const full = pick.length >= MAX;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Elegir destacados a mano"
      size="2xl"
      footer={
        <div className="flex w-full items-center gap-3">
          <span className="text-xs text-muted-foreground">
            {pick.length} de {MAX} elegidos · el banner rota entre estos
          </span>
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent transition-colors"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => onSave(pick)}
              className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              Guardar
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <input
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
          placeholder="Buscar producto…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />

        {full && (
          <p className="text-xs text-amber-600">
            Llegaste al máximo de {MAX}. Desmarcá uno para elegir otro.
          </p>
        )}

        <div className="grid gap-2 sm:grid-cols-2">
          {list.map((i) => {
            const on = pick.includes(i.id);
            const disabled = !on && full;
            return (
              <button
                key={i.id}
                type="button"
                onClick={() => toggle(i.id)}
                disabled={disabled}
                className={`flex items-center gap-3 rounded-xl border p-2 text-left transition-colors ${
                  on
                    ? "border-primary bg-primary/5"
                    : "border-border bg-card hover:border-primary/40 disabled:opacity-50 disabled:hover:border-border"
                }`}
              >
                <span
                  className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border text-[11px] font-bold ${
                    on ? "border-primary bg-primary text-primary-foreground" : "border-border"
                  }`}
                >
                  {on ? "✓" : ""}
                </span>
                <ProductImage
                  src={i.imageUrl}
                  name={i.name}
                  alt={i.name}
                  className="h-10 w-10 flex-shrink-0 rounded-lg"
                  iconClassName="h-5 w-5"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{i.name}</span>
                  {i.priceLabel && (
                    <span className="block text-xs text-muted-foreground">{i.priceLabel}</span>
                  )}
                </span>
              </button>
            );
          })}
          {list.length === 0 && (
            <p className="text-sm text-muted-foreground">No hay productos que coincidan.</p>
          )}
        </div>
      </div>
    </Modal>
  );
}
