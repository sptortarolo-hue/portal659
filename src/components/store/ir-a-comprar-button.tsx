"use client";

/**
 * Botón del micrositio que scrollea hasta el menú, dejándolo justo debajo del
 * nav sticky de categorías (mismo destino que el link compartido por WhatsApp
 * con ?menu=1). El label varía: con carrito "🛒 Ir a comprar", en modo lectura
 * (venta online apagada) "📋 Ver la carta".
 */
export function IrAComprarButton({ label }: { label?: string }) {
  function goToMenu() {
    const el = document.getElementById("menu");
    if (!el) return;
    const isMobile = window.innerWidth < 640;
    // 152 = nav mobile (104) + barra de marca (48); desktop nav = 64.
    const offset = isMobile ? 152 : 64;
    const top = el.getBoundingClientRect().top + window.scrollY - offset;
    window.scrollTo({ top, behavior: "smooth" });
  }

  return (
    <button
      type="button"
      onClick={goToMenu}
      className="inline-flex items-center gap-1.5 rounded-full bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium hover:bg-primary/90 transition-colors"
    >
      {label ?? "🛒 Ir a comprar"}
    </button>
  );
}
