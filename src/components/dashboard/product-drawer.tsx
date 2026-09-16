"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Drawer } from "@/components/ui/drawer";

type DrawerTab = "datos" | "opciones" | "receta";

/**
 * Drawer lateral de producto (solo escritorio): datos básicos, opciones
 * (modificadores) y receta (costo/food-cost) en solapas internas.
 * Los contenidos llegan ya armados por el padre (`MenuStudio`).
 */
export function ProductDrawer({
  open,
  title,
  subtitle,
  isNew,
  hasRecipes,
  onClose,
  datosNode,
  opcionesNode,
  recetaNode,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  /** true cuando se está creando (Opciones/Receta se habilitan al guardar). */
  isNew: boolean;
  /** false → la solapa Receta muestra bloqueo de plan. */
  hasRecipes: boolean;
  onClose: () => void;
  datosNode: ReactNode;
  opcionesNode: ReactNode;
  recetaNode: ReactNode;
}) {
  const [tab, setTab] = useState<DrawerTab>("datos");

  // Cada vez que se abre, vuelve a Datos (evita quedar en una solapa rara
  // al cambiar de producto o al crear uno nuevo).
  useEffect(() => {
    if (open) setTab("datos");
  }, [open, title]);

  const TABS: { id: DrawerTab; icon: string; label: string; disabled?: boolean }[] = [
    { id: "datos", icon: "📝", label: "Datos" },
    { id: "opciones", icon: "⚙️", label: "Opciones", disabled: isNew },
    { id: "receta", icon: hasRecipes ? "🧪" : "🔒", label: "Receta", disabled: isNew },
  ];

  return (
    <Drawer open={open} onClose={onClose} title={title} subtitle={subtitle}>
      <div className="space-y-4">
        <div className="flex rounded-xl border border-border overflow-hidden text-sm font-medium">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              disabled={t.disabled}
              onClick={() => setTab(t.id)}
              className={`flex-1 px-3 py-2 text-xs sm:text-sm transition-colors ${
                tab === t.id
                  ? "bg-primary text-primary-foreground"
                  : t.disabled
                    ? "text-muted-foreground/50 cursor-not-allowed"
                    : "text-muted-foreground hover:bg-muted/60"
              }`}
              title={t.disabled ? "Guardá el plato primero" : undefined}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {tab === "datos" && datosNode}
        {tab === "opciones" && !isNew && opcionesNode}
        {tab === "receta" && !isNew && recetaNode}

        {isNew && tab !== "datos" ? (
          <p className="text-xs text-muted-foreground">
            Guardá el plato primero; después le asignás opciones y receta.
          </p>
        ) : null}
      </div>
    </Drawer>
  );
}
