import * as React from "react";
import { cn } from "@/lib/utils";
import { TONE_CHIP, type PanelTone } from "./tones";

/**
 * KPI del panel: etiqueta chica, número grande, ícono en círculo.
 *
 * El círculo sigue el TONO del KPI (ventas=verde, pedidos=azul, avisos=ámbar)
 * con su tinte al 15%: antes todos los círculos eran del mismo lima y no se
 * distinguían entre sí.
 */
export function KpiCard({
  label,
  value,
  sub,
  icon: Icon,
  accent = "primary",
  className,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  accent?: PanelTone;
  className?: string;
}) {
  return (
    <div className={cn("ts-card rounded-lg p-4", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="ts-caption uppercase tracking-wider text-muted-foreground">{label}</p>
          <p className="ts-title mt-1 truncate">{value}</p>
          {sub ? <p className="ts-body mt-0.5 text-muted-foreground">{sub}</p> : null}
        </div>
        {Icon ? (
          <span
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
              TONE_CHIP[accent],
            )}
          >
            <Icon className="h-5 w-5" />
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** Encabezado de sección: título + acción opcional a la derecha. */
export function SectionHeader({
  title,
  hint,
  action,
  className,
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-3", className)}>
      <div className="min-w-0">
        <h2 className="ts-subtitle truncate">{title}</h2>
        {hint ? <p className="ts-body text-muted-foreground">{hint}</p> : null}
      </div>
      {action}
    </div>
  );
}
