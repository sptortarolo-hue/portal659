import type { Metadata } from "next";
import DevUiGallery from "./dev-ui-gallery";

export const metadata: Metadata = {
  title: "Diseño del panel — galería | Portal 659",
  robots: { index: false, follow: false },
};

/**
 * Galería del diseño nuevo del panel (Tasty Station UI). Es una página de
 * desarrollo: aprueba el look de los componentes antes de tocar pantallas
 * reales. En producción muestra solo este aviso (el diseño se prueba en
 * local con `npm run dev`).
 */
export default function DevUiPage() {
  if (process.env.NODE_ENV === "production") {
    return (
      <div className="container mx-auto max-w-lg px-4 py-24 text-center">
        <h1 className="text-lg font-semibold">Galería solo en desarrollo</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Este preview se corre con <code>npm run dev</code> (localhost:3000). En
          producción el diseño del panel se prueba con el interruptor de la
          barra lateral, que solo prende en tu navegadora.
        </p>
      </div>
    );
  }

  return <DevUiGallery />;
}
