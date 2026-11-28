"use client";

/**
 * Etiquetas de góndola en hoja A4 (4 × 8 = 32 etiquetas de 50 × 35 mm).
 *
 * Componente NUEVO y aislado: no reutiliza el estado de las solapas térmica /
 * PL-500 del modal "Etiquetas", no llama a `/api/print` y no depende de que la
 * impresora adhesiva esté configurada. Si se borra, el panel queda igual.
 */

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type A4Offer = {
  id: string;
  name: string;
  sku?: string | null;
  price?: number | null;
  promo_price?: number | null;
};

const money = (n: number | null | undefined) =>
  n == null ? "—" : `$${Number(n).toLocaleString("es-AR", { maximumFractionDigits: 2 })}`;

export function GondolaA4Panel({ offers }: { offers: A4Offer[] }) {
  const [search, setSearch] = useState("");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [includeNet, setIncludeNet] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? offers.filter(
          (o) =>
            o.name.toLowerCase().includes(q) ||
            String(o.sku ?? "").toLowerCase().includes(q)
        )
      : offers;
    return list.slice(0, 300);
  }, [offers, search]);

  const selected = useMemo(
    () => offers.filter((o) => checked.has(o.id)).slice(0, 200),
    [offers, checked]
  );

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const href =
    selected.length > 0
      ? `/api/vendor/label/gondola-a4?productIds=${encodeURIComponent(
          selected.map((o) => o.id).join(",")
        )}${includeNet ? "&net=1" : ""}`
      : null;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        Papel A4, 32 etiquetas por hoja (4 × 8). No necesita impresora de
        etiquetas: es un PDF para imprimir en cualquier impresora.
      </div>

      <div>
        <Label htmlFor="gondola-a4-search">Productos</Label>
        <Input
          id="gondola-a4-search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="🔍 Buscar por nombre o código…"
          className="mt-1 h-9"
        />
        <div className="mt-2 max-h-64 overflow-y-auto rounded-md border border-input divide-y divide-border">
          {filtered.length === 0 && (
            <p className="p-3 text-center text-sm text-muted-foreground">
              {offers.length === 0 ? "Sin productos." : "Nada coincide con la búsqueda."}
            </p>
          )}
          {filtered.map((o) => (
            <label
              key={o.id}
              className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-muted/50"
            >
              <input
                type="checkbox"
                className="h-4 w-4 flex-shrink-0 accent-primary"
                checked={checked.has(o.id)}
                onChange={() => toggle(o.id)}
              />
              <span className="min-w-0 flex-1 truncate">{o.name}</span>
              <span className="flex-shrink-0 text-xs tabular-nums text-muted-foreground">
                {money(o.promo_price ?? o.price)}
              </span>
            </label>
          ))}
        </div>
        <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            {checked.size} seleccionado{checked.size === 1 ? "" : "s"}
            {checked.size > 200 ? " (máximo 200)" : ""}
          </span>
          <button
            type="button"
            onClick={() => setChecked(new Set(filtered.map((o) => o.id).slice(0, 200)))}
            className="font-medium text-primary hover:underline"
          >
            Seleccionar los visibles
          </button>
        </div>
      </div>

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 accent-primary"
          checked={includeNet}
          onChange={(e) => setIncludeNet(e.target.checked)}
        />
        <span>
          Incluir precio sin impuestos nacionales
          <span className="block text-xs text-muted-foreground">
            La etiqueta lleva una línea abajo con el precio neto (IVA 21% sobre
            el precio de lista) o la leyenda &ldquo;IVA incluido (no
            discriminado)&rdquo;.
          </span>
        </span>
      </label>

      <div className="flex flex-wrap gap-2 border-t border-border pt-3">
        {href ? (
          <>
            <a href={href} target="_blank" rel="noreferrer">
              <Button type="button" variant="outline">
                👁️ Ver PDF
              </Button>
            </a>
            <a href={`${href}&download=1`} download="gondola-a4.pdf">
              <Button type="button">📄 Descargar A4</Button>
            </a>
          </>
        ) : (
          <Button type="button" disabled>
            📄 Descargar A4
          </Button>
        )}
      </div>
    </div>
  );
}
