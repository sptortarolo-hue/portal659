"use client";

import { useState } from "react";

export function CollapsibleSection({
  icon,
  title,
  defaultOpen = false,
  badge,
  children,
  open,
  onToggle,
  id,
}: {
  icon: string;
  title: string;
  defaultOpen?: boolean;
  badge?: string;
  children: React.ReactNode;
  /** Controlado (si se pasa, gana sobre el estado interno). */
  open?: boolean;
  onToggle?: (open: boolean) => void;
  id?: string;
}) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const isControlled = open !== undefined;
  const currentOpen = isControlled ? open : internalOpen;

  const handleClick = () => {
    const next = !currentOpen;
    if (!isControlled) setInternalOpen(next);
    onToggle?.(next);
  };

  return (
    <div id={id} className="border border-border rounded-xl overflow-hidden bg-card scroll-mt-24">
      <button
        type="button"
        onClick={handleClick}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/50 transition-colors"
      >
        <span className="text-lg">{icon}</span>
        <span className="font-medium flex-1">{title}</span>
        {badge && (
          <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">
            {badge}
          </span>
        )}
        <svg
          className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${
            currentOpen ? "rotate-180" : ""
          }`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {currentOpen && <div className="px-4 pb-4 pt-1 border-t border-border">{children}</div>}
    </div>
  );
}
