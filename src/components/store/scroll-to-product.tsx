"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

/**
 * Cuando el link llega con ?oferta={id}, scrollea hasta el producto con ese id
 * (elemento `#product-{id}`) y lo destaca con un anillo pulsante que se
 * desvanece a los ~2.5s.
 */
export function ScrollToProduct() {
  const params = useSearchParams();
  const [highlightId, setHighlightId] = useState<string | null>(null);

  useEffect(() => {
    const offerId = params.get("oferta");
    if (!offerId) return;
    const target = document.getElementById(`product-${offerId}`);
    if (!target) {
      // El menú tarda en hidratar las filas (server component): reintentamos.
      const retry = window.setInterval(() => {
        const el = document.getElementById(`product-${offerId}`);
        if (el) {
          window.clearInterval(retry);
          doScroll(el, offerId);
        }
      }, 150);
      window.setTimeout(() => window.clearInterval(retry), 5000);
      return () => window.clearInterval(retry);
    }
    doScroll(target, offerId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  function doScroll(el: HTMLElement, id: string) {
    // Centrar el producto en el medio vertical de la pantalla.
    const rect = el.getBoundingClientRect();
    const top = window.scrollY + rect.top - (window.innerHeight - rect.height) / 2;
    const max = (document.scrollingElement?.scrollHeight ?? 0) - window.innerHeight;
    window.scrollTo({ top: Math.max(0, Math.min(top, max)), behavior: "smooth" });
    setHighlightId(id);
    window.setTimeout(() => setHighlightId(null), 2600);
  }

  return <HighlightEffect highlightId={highlightId} />;
}

// Aplica el anillo pulsante a la fila objetivo; el resto de la app no lo ve.
function HighlightEffect({ highlightId }: { highlightId: string | null }) {
  useEffect(() => {
    if (!highlightId) return;
    const el = document.getElementById(`product-${highlightId}`);
    if (!el) return;
    el.classList.add("oferta-highlight");
    return () => el.classList.remove("oferta-highlight");
  }, [highlightId]);

  return null;
}