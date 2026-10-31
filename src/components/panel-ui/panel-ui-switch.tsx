"use client";

import { Palette } from "lucide-react";
import { usePanelUi } from "./panel-ui-provider";

/**
 * Switch de diseño del panel: Clásico ↔ Tasty (nuevo). Persiste por
 * navegador (cookie `portal659-panel-ui`); en producción solo lo ve quien
 * lo prende. Se usa en el footer de la sidebar del comercio y del admin.
 */
export function PanelUiSwitch({ compact = false }: { compact?: boolean }) {
  const { ui, toggle, ready } = usePanelUi();
  const tasty = ui === "tasty";

  return (
    <button
      type="button"
      onClick={toggle}
      title={
        tasty
          ? "Volver al diseño clásico del panel"
          : "Probar el diseño nuevo del panel (solo en esta navegadora)"
      }
      aria-pressed={tasty}
      className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <Palette className="h-5 w-5 flex-shrink-0 text-primary" />
      <span className="flex-1 truncate text-left">Diseño del panel</span>
      <span className="flex-shrink-0 rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider">
        {ready ? (tasty ? "Nuevo" : "Clásico") : "…"}
      </span>
    </button>
  );
}
