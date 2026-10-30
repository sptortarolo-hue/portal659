import type { Metadata } from "next";

/**
 * Layout de la Pantalla TV: sin chrome del portal (es una pantalla de local,
 * no una página web) y fuera de los índices de buscadores.
 * Lleva los keyframes del reproductor (rotación, respiración del ticker).
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  title: "Pantalla TV — Portal 659",
};

export default function TvLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <style
        dangerouslySetInnerHTML={{
          __html: `
@keyframes tv-progress { from { width: 0% } to { width: 100% } }
@keyframes tv-breathe { 0%, 100% { opacity: .62 } 50% { opacity: 1 } }
@keyframes tv-fade-in { from { opacity: 0; transform: translateY(12px) } to { opacity: 1; transform: none } }
html, body { margin: 0; background: #000; overflow: hidden; }
.tv-slide-enter { animation: tv-fade-in 420ms ease-out both; }
@media (prefers-reduced-motion: reduce) {
  .tv-slide-enter, [style*="tv-breathe"], [style*="tv-progress"] { animation: none !important; }
}
`,
        }}
      />
      {children}
    </>
  );
}
