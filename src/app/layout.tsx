import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Inter, Fraunces } from "next/font/google";
import "./globals.css";
import { Navigation } from "@/components/nav/navigation";
import { CartProvider } from "@/lib/cart";
import { CartDrawer } from "@/components/cart/cart-drawer";
import { CartFooter } from "@/components/cart/cart-footer";
import { ServiceWorkerRegistration } from "@/components/pwa/service-worker-registration";
import { PushSubscribe } from "@/components/pwa/push-subscribe";
import { ToastProvider } from "@/lib/toast";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { ThemeProvider } from "@/components/ui/theme-provider";
import { ThemeColorSync } from "@/components/ui/theme-color-sync";
import { WhatsAppFloat } from "@/components/ui/whatsapp-float";
import { BottomNav } from "@/components/nav/bottom-nav";
import { OnboardingOverlay } from "@/components/onboarding/onboarding-overlay";
import { AnalyticsBeacon } from "@/components/analytics/analytics-beacon";
import { PANEL_UI_PRE_PAINT } from "@/lib/panel-ui";
import { PanelUiProvider } from "@/components/panel-ui/panel-ui-provider";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  // Sin themeColor acá: hay UN solo meta theme-color (el de abajo, con id),
  // gestionado por el script pre-paint + ThemeColorSync. Con dos metas
  // compitiendo, Chrome usa una sola y las actualizaciones pegaban en otra.
};

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://www.portal659.com.ar"),
  title: "Portal 659 — Comercios, kioscos y delivery en Sicardi y Garibaldi",
  description:
    "Portal 659: el centro comercial de Sicardi y Garibaldi en tu pantalla. Kioscos, almacenes, gastronomía, moda y servicios del barrio, con pedido o contacto directo por WhatsApp y 0% comisión.",
  keywords: [
    "comercios de barrio",
    "kiosco",
    "almacén",
    "delivery de barrio",
    "gastronomía",
    "rotisería",
    "servicios y oficios",
    "centro comercial",
    "Sicardi",
    "Garibaldi",
    "La Plata",
  ],
  authors: [{ name: "Portal 659" }],
  // SIN canonical acá a propósito: un canonical en el layout raíz se hereda a
  // TODA página que no defina el suyo (manuales, privacidad, auth...) y las
  // hacía canonicalizar a la home ("Página alternativa con etiqueta canónica"
  // en Search Console). La home define el suyo en page.tsx; cada página
  // pública importante define el propio.
  // Verificación de Google Search Console (meta tag). Se setea por env
  // GOOGLE_SITE_VERIFICATION (solo el token `content`, sin la etiqueta).
  ...(process.env.GOOGLE_SITE_VERIFICATION
    ? { verification: { google: process.env.GOOGLE_SITE_VERIFICATION } }
    : {}),
  openGraph: {
    title: "Portal 659 — El centro comercial de tu barrio",
    description: "Comida, kioscos, almacenes y servicios de Sicardi y Garibaldi, con pedido o contacto directo por WhatsApp.",
    type: "website",
    locale: "es_AR",
    siteName: "Portal 659",
    url: "/",
    // Tarjeta de marca para WhatsApp/redes (sin esto, WA rasca el HTML y
    // mostraba una foto de producto al azar). Estática: /og-cover.jpg.
    images: [{ url: "/og-cover.jpg", width: 1200, height: 630, alt: "Portal 659 — El centro comercial de tu barrio" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Portal 659 — El centro comercial de tu barrio",
    description: "Comida, almacenes y servicios del barrio, con pedido o contacto directo por WhatsApp.",
    images: ["/og-cover.jpg"],
  },
  robots: {
    index: true,
    follow: true,
  },
  manifest: "/manifest.json",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="Portal659" />
        <meta name="theme-color" media="(prefers-color-scheme: light)" content="#ffffff" />
        <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#000000" />
        <meta name="color-scheme" content="light dark" />
        <meta name="mobile-web-app-capable" content="yes" />
        <script
          dangerouslySetInnerHTML={{
            // Pre-paint del diseño del panel: cookie `portal659-panel-ui`,
            // localStorage o `?ui=tasty|classic` → data-panel-ui en <html>
            // (default clásico). Mismo patrón que el tema de abajo.
            __html: PANEL_UI_PRE_PAINT,
          }}
        />
        <script
          dangerouslySetInnerHTML={{
            // Pre-paint (antes del primer frame): resuelve el tema con la
            // misma lógica del ThemeProvider. Las barras del sistema usan el
            // color del modo (negro en oscuro, blanco en claro); el fondo del
            // <html> usa el fondo de página para mimetizarse con el contenido.
            // Sin esto, al refrescar repintan después (parpadeo). Las metas
            // con media ya cubren el caso por defecto sin JS; acá se corrige
            // la preferencia guardada. ThemeColorSync mantiene runtime.
            __html: `(function(){try{var t=localStorage.getItem("portal659-theme-v2");var d=t==="dark"||(t==="system"&&matchMedia("(prefers-color-scheme: dark)").matches)||(!t&&matchMedia("(min-width: 1024px)").matches);if(d)document.documentElement.classList.add("dark");var bar=d?"#000000":"#ffffff";var bg=d?"#0f1117":"#ffffff";var ms=document.querySelectorAll('meta[name="theme-color"]');for(var i=0;i<ms.length;i++)ms[i].setAttribute("content",bar);document.documentElement.style.backgroundColor=bg}catch(e){}})()`,
          }}
        />
      </head>
      <body
        className={`${inter.variable} ${fraunces.variable} antialiased min-h-screen flex flex-col`}
        suppressHydrationWarning
      >
        <ThemeProvider>
          <PanelUiProvider>
          <ThemeColorSync />
          <CartProvider>
            <ToastProvider>
              <ServiceWorkerRegistration />
              <PushSubscribe />
              <AnalyticsBeacon />
              <OnboardingOverlay />
              <Navigation />
              <ErrorBoundary>
                <main className="flex-1 pb-28" data-portal-main>{children}</main>
              </ErrorBoundary>
              <CartFooter />
              <CartDrawer />
              {/* On/off global del botón: /admin/config (setting wa_float). */}
              <WhatsAppFloat />
              <BottomNav />
              <footer className="border-t border-border py-6 text-center text-sm text-muted-foreground bg-card" data-portal-chrome>
                <div className="container mx-auto px-4 flex flex-col sm:flex-row items-center justify-center gap-2">
                  <span>© {new Date().getFullYear()} Portal 659 — El centro comercial de tu barrio · 0% comisión</span>
                  <span className="hidden sm:inline text-border">·</span>
                  <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
                    <Link href="/" className="hover:text-foreground transition-colors">Inicio</Link>
                    <Link href="/buscar" className="hover:text-foreground transition-colors">Comercios</Link>
                    <Link href="/barrio" className="hover:text-foreground transition-colors">Info del barrio</Link>
                    <Link href="/planes" className="hover:text-foreground transition-colors">Planes</Link>
                    <Link href="/manuales" className="hover:text-foreground transition-colors">Manuales</Link>
                    <Link href="/comercios" className="hover:text-foreground transition-colors">Sistema para comercios</Link>
                    <Link href="/logisticas" className="hover:text-foreground transition-colors">Logísticas</Link>
                    <Link href="/privacidad" className="hover:text-foreground transition-colors">Privacidad</Link>
                  </div>
                </div>
              </footer>
            </ToastProvider>
          </CartProvider>
          </PanelUiProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
