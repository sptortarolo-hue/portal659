"use client";

import { useState } from "react";
import type { ProductModifier, ModifierOption } from "@/types/database";
import type { CartModifier } from "@/lib/cart";

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

  function toggleOption(groupName: string, option: ModifierOption, max: number, required: boolean) {
    setSelected((prev) => {
      const current = prev[groupName] || [];
      const exists = current.find((o) => o.label === option.label);
      let next: ModifierOption[];
      if (exists) {
        next = current.filter((o) => o.label !== option.label);
      } else {
        if (current.length >= max) return prev;
        next = [...current, option];
      }
      return { ...prev, [groupName]: next };
    });
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

  const allRequiredMet = modifiers
    .filter((m) => m.required)
    .every((m) => (selected[m.group_name] || []).length > 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-card rounded-2xl border border-border p-6 w-full max-w-sm mx-4 max-h-[80vh] overflow-y-auto">
        <h3 className="font-display text-lg font-semibold mb-1">{productName}</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Personalizá tu pedido
        </p>

        {modifiers.map((mod) => {
          const groupSelected = selected[mod.group_name] || [];
          return (
            <div key={mod.id} className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium">{mod.group_name}</span>
                <span className="text-xs text-muted-foreground">
                  {mod.required ? "Obligatorio" : "Opcional"}
                  {mod.max_selections > 1 && ` · Hasta ${mod.max_selections}`}
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
                        toggleOption(mod.group_name, opt, mod.max_selections, mod.required)
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
            </div>
          );
        })}

        <div className="border-t border-border pt-3 mt-4 flex items-center justify-between">
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
              disabled={!allRequiredMet}
              className="px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Agregar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
