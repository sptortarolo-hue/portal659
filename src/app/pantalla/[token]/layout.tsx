import type { Metadata } from "next";

/**
 * Layout de la Pantalla TV: sin chrome del portal (es una pantalla de local,
 * no una página web) y fuera de los índices de buscadores.
 * Lleva el reset de la página + el ocultado del chrome server-rendered que no
 * puede auto-excluirse (los keyframes del reproductor viven en `TvCanvas`).
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
          // Reset de la página + defensa del chrome del portal: el layout raíz
          // (server-rendered) mete <main> con padding y <footer> que no pueden
          // short-circuitear por pathname, así que acá se ocultan por atributo.
          // El resto del chrome (nav, carrito, WA, bienvenida) ya no se
          // renderiza: los componentes preguntan isImmersivePath().
          __html: `
html, body { margin: 0; background: #000; overflow: hidden; }
[data-portal-chrome] { display: none !important; }
main[data-portal-main] { padding-bottom: 0 !important; }
`,
        }}
      />
      {children}
    </>
  );
}
