import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Inter, Fraunces, DM_Sans, Space_Mono } from "next/font/google";
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
import { BottomNav } from "@/components/nav/bottom-nav";
import { OnboardingOverlay } from "@/components/onboarding/onboarding-overlay";
import { MicroFeedback } from "@/components/ui/micro-feedback";
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

// Tipografías del diseño neo-brutalista del panel (tokens .ts-ui). Solo se
// aplican dentro de .ts-ui, así el sitio público sigue con Inter/Fraunces y
// no paga el peso de estas fuentes.
const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
  display: "swap",
});

const spaceMono = Space_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-space-mono",
  display: "swap",
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
    // mostraba una foto de producto al azar). Es el logo del portal en 1200x630
    // y JPEG liviano: WhatsApp corta la preview si el og:image pasa de ~300KB
    // (el PNG original pesa 1.1MB y no se mostraba). Se regenera con
    // `node scripts/gen-og-logo.mjs` si cambia public/Portal659Logo.png.
    images: [{ url: "/og-logo.jpg", width: 1200, height: 630, alt: "Portal 659 — El centro comercial de tu barrio" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Portal 659 — El centro comercial de tu barrio",
    description: "Comida, almacenes y servicios del barrio, con pedido o contacto directo por WhatsApp.",
    images: ["/og-logo.jpg"],
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
        {/* fb:app_id: lo pide el Sharing Debugger de FB/WhatsApp. Es el ID
            numérico de una app de Facebook (se crea gratis en
            developers.facebook.com/apps) — no se puede inventar. Va en <head>
            directo porque `metadata.openGraph` de Next no tiene campo appId y
            `metadata.other` emite name= en vez de property=. Sin la env el
            meta no sale: el share funciona igual, sólo falta Insights. */}
        {process.env.FB_APP_ID ? (
          <meta property="fb:app_id" content={process.env.FB_APP_ID} />
        ) : null}
        <meta name="theme-color" media="(prefers-color-scheme: light)" content="#ffffff" />
        <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#000000" />
        <meta name="color-scheme" content="light dark" />
        <meta name="mobile-web-app-capable" content="yes" />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var s=0;function send(m,st){if(s>5)return;s++;try{fetch("/api/client-error",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message:String(m).slice(0,500),stack:String(st||"").slice(0,2000),url:location.href}),keepalive:true}).catch(function(){})}catch(e){}}window.onerror=function(m,src,line,col,err){send(m,err&&err.stack);return false};window.onunhandledrejection=function(e){send("UnhandledRejection: "+(e.reason&&e.reason.message?e.reason.message:e.reason),e.reason&&e.reason.stack)}}catch(e){}})()`,
          }}
        />
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
        className={`${inter.variable} ${fraunces.variable} ${dmSans.variable} ${spaceMono.variable} antialiased min-h-screen flex flex-col`}
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
              <BottomNav />
              <MicroFeedback />
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
                {/* Contacto del portal: sección fija (no flotante), visible en
                    todas las páginas públicas. Reemplaza el botón flotante. */}
                <div className="container mx-auto px-4 mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs" data-portal-contacto>
                  <span className="font-medium text-foreground">Contacto del portal</span>
                  <a
                    href="https://wa.me/5492212010898?text=Hola%2C%20tengo%20una%20consulta%20sobre%20Portal%20659"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 hover:text-foreground transition-colors"
                  >
                    <svg className="h-3.5 w-3.5 text-[#25D366]" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                    </svg>
                    WhatsApp 22 1201 0898
                  </a>
                  <a href="mailto:info@portal659.com.ar" className="inline-flex items-center gap-1.5 hover:text-foreground transition-colors">
                    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <rect x="2" y="4" width="20" height="16" rx="2" />
                      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                    </svg>
                    info@portal659.com.ar
                  </a>
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
