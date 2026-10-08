"use client";

/**
 * Precio "desde" refinado: versalitas gris sobre el precio en negrita,
 * en vez de la palabra suelta "Desde $X". Se muestra solo cuando hay
 * spread real (max > min); con precio único se usa el precio plano.
 */
export function FromPrice({
  min,
  max,
  valueClassName = "font-bold",
}: {
  min: number;
  max?: number | null;
  valueClassName?: string;
}) {
  const money = (n: number) => `$${n.toLocaleString("es-AR")}`;
  return (
    <span className="inline-flex flex-col leading-tight">
      <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        Desde
      </span>
      <span className={valueClassName}>
        {max != null && max !== min ? `${money(min)} – ${money(max)}` : money(min)}
      </span>
    </span>
  );
}
