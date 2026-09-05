"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";

export function DropdownMenu({
  trigger,
  items,
}: {
  trigger: React.ReactNode;
  items: { label: string; icon?: string; onClick: () => void; destructive?: boolean }[];
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setPos(null);
  }, []);

  useEffect(() => {
    function handle(e: MouseEvent) {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t)) return;
      if (panelRef.current?.contains(t)) return;
      close();
    }
    if (open) document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open, close]);

  useEffect(() => {
    if (!open) return;
    const onScrollOrResize = () => close();
    document.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      document.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open, close]);

  function toggle(e: React.MouseEvent) {
    if (open) {
      close();
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    setPos({ top: rect.bottom + 4, left: rect.right });
    setOpen(true);
  }

  return (
    <div ref={triggerRef} className="relative">
      <button type="button" onClick={toggle} className="p-1 rounded-md hover:bg-muted">
        {trigger}
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            className="fixed z-[999]"
            style={{ top: pos.top, left: pos.left, transform: "translateX(-100%)" }}
          >
            <div className="bg-card border border-border rounded-xl shadow-lg py-1 min-w-[160px]">
              {items.map((item, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => {
                    item.onClick();
                    close();
                  }}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-muted/50 ${
                    item.destructive ? "text-red-600" : ""
                  }`}
                >
                  {item.icon && <span>{item.icon}</span>}
                  {item.label}
                </button>
              ))}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}