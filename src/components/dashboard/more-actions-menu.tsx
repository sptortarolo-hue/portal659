"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";

export type ActionItem = {
  label: string;
  icon?: string;
  onClick: () => void;
  destructive?: boolean;
  /** Acción sin sentido en el momento (ej: no hay productos): no ejecuta ni cierra. */
  disabled?: boolean;
  /** Texto secundario (ej: cuántos productos quedan tras los filtros). */
  detail?: string;
};

export type ActionGroup = {
  label: string;
  items: ActionItem[];
};

/**
 * Menú de acciones masivas unificado (patrón Shopify/Square).
 * Desktop: dropdown popover anclado al trigger.
 * Mobile: sheet bottom (desliza desde abajo).
 */
export function MoreActionsMenu({
  groups,
  triggerLabel = "⋯",
}: {
  groups: ActionGroup[];
  triggerLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t)) return;
      if (panelRef.current?.contains(t)) return;
      close();
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open, close]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  // Lock scroll on mobile sheet
  useEffect(() => {
    if (open && isMobile) {
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = ""; };
    }
  }, [open, isMobile]);

  return (
    <div ref={triggerRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 rounded-lg border border-border bg-card px-2.5 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        aria-label="Más acciones"
      >
        <span className="text-base leading-none">{triggerLabel}</span>
        <span className="hidden sm:inline text-xs">Más</span>
      </button>

      {open && !isMobile && createPortal(
        <div
          ref={panelRef}
          className="fixed z-[999]"
          style={{
            top: triggerRef.current ? triggerRef.current.getBoundingClientRect().bottom + 4 : 0,
            left: triggerRef.current ? triggerRef.current.getBoundingClientRect().right : 0,
            transform: "translateX(-100%)",
          }}
        >
          <div className="bg-card border border-border rounded-xl shadow-lg py-1 min-w-[220px] max-h-[70vh] overflow-y-auto">
            {groups.map((group, gi) => (
              <div key={gi}>
                {gi > 0 && <div className="border-t border-border my-1" />}
                <p className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {group.label}
                </p>
                {group.items.map((item, ii) => (
                  <button
                    key={ii}
                    type="button"
                    disabled={item.disabled}
                    onClick={() => { if (item.disabled) return; item.onClick(); close(); }}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors ${
                      item.disabled ? "opacity-40 cursor-not-allowed" : "hover:bg-muted/50"
                    } ${item.destructive ? "text-red-600" : "text-foreground"}`}
                  >
                    {item.icon && <span className="text-base">{item.icon}</span>}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{item.label}</span>
                      {item.detail && <span className="block text-[11px] text-muted-foreground truncate">{item.detail}</span>}
                    </span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>,
        document.body
      )}

      {open && isMobile && createPortal(
        <div className="fixed inset-0 z-[999]">
          <div className="absolute inset-0 bg-black/50" onClick={close} />
          <div
            ref={panelRef}
            className="absolute bottom-0 left-0 right-0 bg-card rounded-t-2xl border-t border-border max-h-[80vh] overflow-y-auto animate-in slide-in-from-bottom duration-200"
          >
            <div className="flex justify-center py-2">
              <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
            </div>
            {groups.map((group, gi) => (
              <div key={gi} className="px-4 pb-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  {group.label}
                </p>
                <div className="space-y-1">
                  {group.items.map((item, ii) => (
                    <button
                      key={ii}
                      type="button"
                      disabled={item.disabled}
                      onClick={() => { if (item.disabled) return; item.onClick(); close(); }}
                      className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl text-sm text-left transition-colors ${
                        item.disabled ? "opacity-40 cursor-not-allowed" : "hover:bg-muted/50"
                      } ${item.destructive ? "text-red-600" : "text-foreground"}`}
                    >
                      {item.icon && <span className="text-lg">{item.icon}</span>}
                      <span className="min-w-0 flex-1">
                        <span className="block">{item.label}</span>
                        {item.detail && <span className="block text-[11px] text-muted-foreground">{item.detail}</span>}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <div className="px-4 pb-6 pt-2">
              <button
                type="button"
                onClick={close}
                className="w-full py-3 rounded-xl border border-border text-sm font-medium text-muted-foreground hover:bg-muted"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
