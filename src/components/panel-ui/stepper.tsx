import * as React from "react";
import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

/** Stepper de cantidad del spec: pill con − / + y el número en el medio. */
export function Stepper({
  value,
  onChange,
  min = 0,
  max = 99,
  step = 1,
  className,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  className?: string;
}) {
  return (
    <div className={cn("ts-stepper", className)}>
      <button
        type="button"
        aria-label="Quitar uno"
        className="flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - step))}
      >
        <Minus className="h-3.5 w-3.5" />
      </button>
      <span className="ts-body-strong min-w-6 text-center tabular-nums">{value}</span>
      <button
        type="button"
        aria-label="Sumar uno"
        className="flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, value + step))}
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/** Estado vacío: ícono, título, explicación y acción opcional. */
export function EmptyState({
  icon: Icon,
  title,
  hint,
  action,
  className,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  hint?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 px-6 py-12 text-center", className)}>
      {Icon ? (
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Icon className="h-6 w-6" />
        </span>
      ) : null}
      <p className="ts-body-strong">{title}</p>
      {hint ? <p className="ts-body max-w-sm text-muted-foreground">{hint}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
