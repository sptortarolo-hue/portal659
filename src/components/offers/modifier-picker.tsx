"use client";

import { useMemo, useState } from "react";
import type { ProductModifier, ModifierOption } from "@/types/database";
import type { CartModifier } from "@/lib/cart";
import {
  BIG_GROUP_THRESHOLD,
  categoriesOf,
  effectiveMax,
  filterOptions,
  groupStatusText,
  missingCount,
  missingText,
  toggleWithCap,
} from "@/lib/modifier-select";

type ModifierPickerProps = {
  modifiers: ProductModifier[];
  productName: string;
  basePrice: number;
  onConfirm: (selected: CartModifier[], finalPrice: number) => void;
  onCancel: () => void;
};

export function ModifierPicker({
  modifiers,
  productName,
  basePrice,
  onConfirm,
  onCancel,
}: ModifierPickerProps) {
  const [selected, setSelected] = useState<Record<string, ModifierOption[]>>({});
  // Estado solo del modo hoja (grupos grandes): búsqueda + categoría + hint.
  const [queries, setQueries] = useState<Record<string, string>>({});
  const [cats, setCats] = useState<Record<string, string | null>>({});
  const [hints, setHints] = useState<Record<string, string>>({});

  // Un grupo "grande" (ej: 30 gustos) se muestra como hoja con buscador en vez
  // de filas interminables. Los grupos chicos rinden igual que siempre.
  const bigGroups = useMemo(() => {
    const s = new Set<string>();
    for (const m of modifiers || []) {
      if ((m.options || []).length > BIG_GROUP_THRESHOLD) s.add(m.group_name);
    }
    return s;
  }, [modifiers]);

  function toggleOption(groupName: string, option: ModifierOption, max: number) {
    const res = toggleWithCap(selected[groupName] || [], option, max);
    setSelected((prev) => ({ ...prev, [groupName]: res.next }));
    if (res.replaced) {
      setHints((prev) => ({ ...prev, [groupName]: `Se reemplazó ${res.replaced!.label}` }));
      window.setTimeout(() => {
        setHints((prev) => {
          if (!prev[groupName]) return prev;
          const next = { ...prev };
          delete next[groupName];
          return next;
        });
      }, 2200);
    }
  }

  function removeOption(groupName: string, label: string) {
    setSelected((prev) => ({
      ...prev,
      [groupName]: (prev[groupName] || []).filter((o) => o.label !== label),
    }));
  }

  function handleConfirm() {
    const flat: CartModifier[] = [];
    for (const [group, opts] of Object.entries(selected)) {
      for (const o of opts) {
        flat.push({ group, label: o.label, price_mod: o.price_mod });
      }
    }
    const modTotal = flat.reduce((s, m) => s + m.price_mod, 0);
    onConfirm(flat, basePrice + modTotal);
  }

  const totalModPrice = Object.values(selected)
    .flat()
    .reduce((s, o) => s + o.price_mod, 0);

  // Mínimo por grupo (min_selections si es obligatorio; legacy = ≥1 si required).
  const missingByGroup = useMemo(() => {
    const map: Record<string, number> = {};
    for (const m of modifiers || []) {
      map[m.group_name] = missingCount(m, (selected[m.group_name] || []).length);
    }
    return map;
  }, [modifiers, selected]);
  const allMinMet = Object.values(missingByGroup).every((n) => n <= 0);
  const totalMissing = Object.values(missingByGroup).reduce((s, n) => s + n, 0);

  const selectedChips = useMemo(() => {
    const chips: { group: string; label: string }[] = [];
    for (const [group, opts] of Object.entries(selected)) {
      for (const o of opts) chips.push({ group, label: o.label });
    }
    return chips;
  }, [selected]);

  // El grupo "Variante" (is_variant) siempre aparece primero y es obligatorio.
  const orderedModifiers = [...modifiers].sort(
    (a, b) => Number(b.is_variant || false) - Number(a.is_variant || false)
  );

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/50" onClick={onCancel}>
      <div
        className="bg-card rounded-t-2xl sm:rounded-2xl border border-border w-full sm:max-w-sm sm:mx-4 max-h-[92vh] sm:max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 pb-3 shrink-0">
          <h3 className="font-display text-lg font-semibold mb-1">{productName}</h3>
          <p className="text-sm text-muted-foreground">
            Personalizá tu pedido
          </p>
        </div>

        <div className="overflow-y-auto px-6 pb-2 flex-1 min-h-0">
          {orderedModifiers.map((mod) => {
            const groupSelected = selected[mod.group_name] || [];
            const isVariant = !!mod.is_variant;
            const max = effectiveMax(mod);
            const isBig = bigGroups.has(mod.group_name);
            const status = groupStatusText(mod, groupSelected.length);
            const missing = missingByGroup[mod.group_name] || 0;

            if (!isBig) {
              return (
                <div key={mod.id} className={`mb-4 ${isVariant ? "rounded-xl bg-primary/5 border border-primary/20 p-3 -mx-1" : ""}`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className={`text-sm font-medium ${isVariant ? "text-primary" : ""}`}>
                      {isVariant ? "⭐ Variante" : mod.group_name}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {mod.required ? "Obligatorio" : "Opcional"}
                      {max > 1 ? ` · ${status}` : mod.required ? " · elegí 1" : ""}
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {mod.options.map((opt) => {
                      const isChecked = groupSelected.some((o) => o.label === opt.label);
                      return (
                        <button
                          key={opt.label}
                          type="button"
                          onClick={() =>
                            toggleOption(mod.group_name, opt, max)
                          }
                          className={`w-full flex items-center justify-between rounded-lg border px-3 py-2 text-sm transition-colors ${
                            isChecked
                              ? "border-primary bg-primary/5"
                              : "border-border hover:border-primary/50"
                          }`}
                        >
                          <span className="flex items-center gap-2">
                            <span
                              className={`h-4 w-4 rounded-full border flex items-center justify-center flex-shrink-0 ${
                                isChecked ? "border-primary bg-primary" : "border-muted-foreground"
                              }`}
                            >
                              {isChecked && (
                                <svg className="h-2.5 w-2.5 text-white" fill="currentColor" viewBox="0 0 20 20">
                                  <path d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" />
                                </svg>
                              )}
                            </span>
                            {opt.label}
                          </span>
                          {opt.price_mod > 0 && (
                            <span className="text-muted-foreground">
                              +${opt.price_mod.toLocaleString("es-AR")}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  {missing > 0 && (
                    <p className="text-xs text-amber-600 mt-1.5">{missingText(mod, groupSelected.length)}</p>
                  )}
                </div>
              );
            }

            // Modo hoja (grupo grande, ej: gustos de heladería).
            const q = queries[mod.group_name] || "";
            const activeCat = cats[mod.group_name] ?? null;
            const catsList = categoriesOf(mod.options);
            const visible = filterOptions(mod.options, q, activeCat);
            return (
              <div key={mod.id} className="mb-4 rounded-xl bg-primary/5 border border-primary/20 p-3 -mx-1">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium text-primary">
                    {mod.group_name} · {groupSelected.length}/{max}
                  </span>
                  <span className="text-xs text-muted-foreground">{status}</span>
                </div>
                {hints[mod.group_name] && (
                  <p className="text-xs text-muted-foreground mb-1.5">{hints[mod.group_name]}</p>
                )}
                {missing > 0 && (
                  <p className="text-xs text-amber-600 mb-1.5">{missingText(mod, groupSelected.length)}</p>
                )}
                <input
                  type="search"
                  value={q}
                  onChange={(e) => setQueries((prev) => ({ ...prev, [mod.group_name]: e.target.value }))}
                  placeholder="Buscar gusto…"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm mb-2 outline-none focus:border-primary"
                />
                {catsList.length > 0 && (
                  <div className="flex gap-1.5 overflow-x-auto pb-2 mb-1">
                    <button
                      type="button"
                      onClick={() => setCats((prev) => ({ ...prev, [mod.group_name]: null }))}
                      className={`flex-shrink-0 text-xs px-2.5 py-1 rounded-full border transition-colors ${!activeCat ? "border-primary bg-primary/10 text-primary font-medium" : "border-border text-muted-foreground"}`}
                    >
                      Todas
                    </button>
                    {catsList.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setCats((prev) => ({ ...prev, [mod.group_name]: c }))}
                        className={`flex-shrink-0 text-xs px-2.5 py-1 rounded-full border transition-colors ${activeCat === c ? "border-primary bg-primary/10 text-primary font-medium" : "border-border text-muted-foreground"}`}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                )}
                <div className="space-y-1.5 max-h-64 overflow-y-auto pr-0.5">
                  {visible.map((opt) => {
                    const isChecked = groupSelected.some((o) => o.label === opt.label);
                    return (
                      <button
                        key={opt.label}
                        type="button"
                        onClick={() => toggleOption(mod.group_name, opt, max)}
                        className={`w-full flex items-center justify-between rounded-lg border px-3 py-2 text-sm transition-colors bg-card ${
                          isChecked
                            ? "border-primary bg-primary/5"
                            : "border-border hover:border-primary/50"
                        }`}
                      >
                        <span className="flex items-center gap-2 min-w-0">
                          <span
                            className={`h-4 w-4 rounded-full border flex items-center justify-center flex-shrink-0 ${
                              isChecked ? "border-primary bg-primary" : "border-muted-foreground"
                            }`}
                          >
                            {isChecked && (
                              <svg className="h-2.5 w-2.5 text-white" fill="currentColor" viewBox="0 0 20 20">
                                <path d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" />
                              </svg>
                            )}
                          </span>
                          <span className="truncate">{opt.label}</span>
                        </span>
                        {opt.price_mod > 0 && (
                          <span className="text-muted-foreground flex-shrink-0 ml-2">
                            +${opt.price_mod.toLocaleString("es-AR")}
                          </span>
                        )}
                      </button>
                    );
                  })}
                  {visible.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-3">
                      Sin resultados para “{q}”
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="border-t border-border px-6 py-3 shrink-0 bg-card space-y-2">
          {selectedChips.length > 0 && (
            <div className="flex flex-wrap gap-1.5 max-h-16 overflow-y-auto">
              {selectedChips.map((c, i) => (
                <button
                  key={`${c.group}|${c.label}|${i}`}
                  type="button"
                  onClick={() => removeOption(c.group, c.label)}
                  className="text-[11px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium hover:bg-primary/20 transition-colors"
                  title="Quitar"
                >
                  {c.label} ✕
                </button>
              ))}
            </div>
          )}
          <div className="flex items-center justify-between">
            <div>
              <span className="text-sm text-muted-foreground">Total: </span>
              <span className="font-bold">
                ${(basePrice + totalModPrice).toLocaleString("es-AR")}
              </span>
            </div>
            <div className="flex gap-2">
              <button
                onClick={onCancel}
                className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-muted"
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirm}
                disabled={!allMinMet}
                className="px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Agregar{!allMinMet && totalMissing > 0 ? ` (${totalMissing === 1 ? "falta 1" : `faltan ${totalMissing}`})` : ""}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
