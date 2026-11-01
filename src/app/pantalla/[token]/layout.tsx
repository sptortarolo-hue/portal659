import type { Metadata } from "next";
import { queryOne } from "@/lib/db";
import { findScreenByToken } from "@/lib/tv-data";

/**
 * Layout de la Pantalla TV: sin chrome del portal (es una pantalla de local,
 * no una página web) y fuera de los índices de buscadores.
 * Lleva el reset de la página + el ocultado del chrome server-rendered que no
 * puede auto-excluirse (los keyframes del reproductor viven en `TvCanvas`).
 *
 * El manifest es PROPIO de cada pantalla (`/pantalla/<token>/manifest.webmanifest`):
 * el del portal abre el home del portal al instalarse, y en una tele eso
 * significa un ícono que no muestra la carta. Ver la ruta del manifest.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  let title = "Pantalla TV — Portal 659";
  try {
    const screen = await findScreenByToken(token);
    if (screen) {
      const vendor = await queryOne<any>(
        `SELECT store_name FROM vendors WHERE id = $1 LIMIT 1`,
        [screen.vendor_id]
      ).catch(() => null);
      const name = String(vendor?.store_name ?? "").trim();
      if (name) title = `${name} — Carta TV`;
    }
  } catch {
    /* sin metadata: el título por defecto */
  }

  return {
    robots: { index: false, follow: false },
    title,
    manifest: `/pantalla/${token}/manifest.webmanifest`,
    appleWebApp: { capable: true, title: "Carta TV", statusBarStyle: "black-translucent" },
  };
}

export default function TvLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <style
        dangerouslySetInnerHTML={{
          // Reset de la página + defensa del chrome del portal: el layout raíz
          // (server-rendered) mete <main> con padding y <footer> que no pueden
          // short-circuitearse por pathname, así que acá se ocultan por atributo.
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
