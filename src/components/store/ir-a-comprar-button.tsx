"use client";

/**
 * Botón "Ir a comprar" del micrositio (gastronomía): scrollea hasta el menú,
 * dejándolo justo debajo del nav sticky de categorías (mismo destino que el
 * link compartido por WhatsApp con ?menu=1).
 */
export function IrAComprarButton() {
  function goToMenu() {
    const el = document.getElementById("menu");
    if (!el) return;
    const isMobile = window.innerWidth < 640;
    const offset = isMobile ? 104 : 64;
    const top = el.getBoundingClientRect().top + window.scrollY - offset;
    window.scrollTo({ top, behavior: "smooth" });
  }

  return (
    <button
      type="button"
      onClick={goToMenu}
      className="inline-flex items-center gap-1.5 rounded-full bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium hover:bg-primary/90 transition-colors"
    >
      🛒 Ir a comprar
    </button>
  );
}