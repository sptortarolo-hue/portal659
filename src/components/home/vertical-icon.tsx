import {
  Hammer,
  HeartPulse,
  Scissors,
  Shirt,
  Store,
  UtensilsCrossed,
  Wrench,
  type LucideIcon,
} from "lucide-react";

/** Íconos vectoriales por vertical. El dato `VERTICALS[].emoji` queda intacto;
 *  acá solo se decide qué se dibuja en el nuevo diseño público. */
const VERTICAL_ICONS: Record<string, LucideIcon> = {
  gastronomia: UtensilsCrossed,
  comercio: Store,
  servicio: Wrench,
  moda: Shirt,
  salud: HeartPulse,
  estetica: Scissors,
  taller: Hammer,
};

/** Para cabeceras que esperan un componente de ícono (LucideIcon). */
export function verticalIconComponent(slug: string): LucideIcon {
  return VERTICAL_ICONS[slug] || Store;
}

export function VerticalIcon({
  slug,
  className = "h-6 w-6",
}: {
  slug: string;
  className?: string;
}) {
  const Icon = verticalIconComponent(slug);
  return <Icon className={className} strokeWidth={1.8} aria-hidden="true" />;
}
