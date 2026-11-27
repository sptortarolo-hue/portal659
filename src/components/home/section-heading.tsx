import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

/** Cabecera uniforme de las secciones de la Home (solo presentación). */
export function SectionHeading({
  icon: Icon,
  eyebrow,
  title,
  description,
  count,
  live = false,
  rightSlot,
}: {
  icon?: LucideIcon;
  eyebrow?: string;
  title: string;
  description?: string;
  count?: number;
  live?: boolean;
  rightSlot?: ReactNode;
}) {
  return (
    <div className="pv2-section-heading">
      <div className="flex min-w-0 items-center gap-3">
        {live && (
          <span className="relative mr-1 flex h-2.5 w-2.5 flex-shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--pv2-accent)] opacity-60" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[var(--pv2-accent)]" />
          </span>
        )}
        {Icon && (
          <span className="pv2-section-icon">
            <Icon className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" />
          </span>
        )}
        <div className="min-w-0">
          {eyebrow && <p className="pv2-eyebrow mb-1">{eyebrow}</p>}
          <h2 className="pv2-title text-xl sm:text-2xl">{title}</h2>
          {description && <p className="pv2-subtitle mt-1">{description}</p>}
        </div>
      </div>
      {rightSlot ?? (count != null && <span className="pv2-count">{count}</span>)}
    </div>
  );
}
