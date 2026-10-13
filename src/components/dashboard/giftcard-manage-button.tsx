"use client";

/**
 * Atajo a la pestaña Tarjetas (fuente única de las giftcards): montos,
 * foto, pausar y borrar. Las filas del catálogo no gobiernan tarjetas.
 */
export function GiftcardManageButton({
  label = "Personalizar en Tarjetas",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event("portal:go-tarjetas"))}
      className={
        className ??
        "inline-flex items-center gap-1.5 rounded-md border border-violet-200 bg-violet-50 px-2.5 py-1.5 text-xs font-medium text-violet-700 hover:bg-violet-100 transition-colors"
      }
      title="Montos, foto, pausar y borrar en la pestaña Tarjetas"
    >
      🎁 {label}
    </button>
  );
}
