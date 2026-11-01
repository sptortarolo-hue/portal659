"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { TONE_CHIP, type PanelTone } from "./tones";

export type BadgeTone = PanelTone;

const TONE = TONE_CHIP;

/** Badge de estado del spec: radio 12, 11px, semibold. */
export function Badge({
  tone = "neutral",
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span className={cn("ts-badge", TONE[tone], className)} {...props}>
      {children}
    </span>
  );
}

/** Chip de categoría (pill). `active` pinta el fondo en el verde --secondary del spec. */
export function Chip({
  active = false,
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      className={cn(active ? "ts-chip ts-chip-active" : "ts-chip", className)}
      {...props}
    >
      {children}
    </button>
  );
}

/** Punto de color para estados (pedidos, turnos, caja). */
export function StatusDot({ tone = "neutral", className }: { tone?: BadgeTone; className?: string }) {
  const color =
    tone === "neutral"
      ? "var(--color-muted-foreground)"
      : `var(--ts-${tone})`;
  return (
    <span
      className={cn("inline-block h-2 w-2 shrink-0 rounded-full", className)}
      style={{ backgroundColor: color }}
    />
  );
}
