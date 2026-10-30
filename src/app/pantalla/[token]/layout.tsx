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
          // Solo el reset de la página: los keyframes del reproductor viven en
          // `TvCanvas` para que el preview del panel use los mismos.
          __html: `
html, body { margin: 0; background: #000; overflow: hidden; }
`,
        }}
      />
      {children}
    </>
  );
}
