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
import { ScrollToTop } from "@/components/ui/scroll-to-top";
import { BottomNav } from "@/components/nav/bottom-nav";
import { OnboardingOverlay } from "@/components/onboarding/onboarding-overlay";

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
  themeColor: "#4f46e5",
};

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://www.portal659.com.ar"),
  title: "Portal 659 — El centro comercial de tu barrio",
  description:
    "Portal 659: el centro comercial de Sicardi y Garibaldi en tu pantalla. Comida, almacenes y servicios del barrio, con pedido o contacto directo por WhatsApp y 0% comisión.",
  keywords: ["centro comercial", "barrio", "delivery", "whatsapp", "gastronomía", "comercio", "servicios", "Sicardi", "Garibaldi"],
  authors: [{ name: "Portal 659" }],
  openGraph: {
    title: "Portal 659 — El centro comercial de tu barrio",
    description: "Comida, almacenes y servicios del barrio, con pedido o contacto directo por WhatsApp.",
    type: "website",
    locale: "es_AR",
    siteName: "Portal 659",
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    title: "Portal 659 — El centro comercial de tu barrio",
    description: "Comida, almacenes y servicios del barrio, con pedido o contacto directo por WhatsApp.",
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
        <meta name="theme-color" content="#4f46e5" />
        <meta name="mobile-web-app-capable" content="yes" />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("portal659-theme");if(t==="dark"||(t==="system"&&matchMedia("(prefers-color-scheme: dark)").matches))document.documentElement.classList.add("dark")}catch(e){}})()`,
          }}
        />
      </head>
      <body
        className={`${inter.variable} ${fraunces.variable} antialiased min-h-screen flex flex-col`}
        suppressHydrationWarning
      >
        <ThemeProvider>
          <CartProvider>
            <ToastProvider>
              <ServiceWorkerRegistration />
              <PushSubscribe />
              <OnboardingOverlay />
              <Navigation />
              <ErrorBoundary>
                <main className="flex-1 pb-28">{children}</main>
              </ErrorBoundary>
              <CartFooter />
              <CartDrawer />
              <ScrollToTop />
              <BottomNav />
              <footer className="border-t border-border py-6 text-center text-sm text-muted-foreground bg-card">
                <div className="container mx-auto px-4 flex flex-col sm:flex-row items-center justify-center gap-2">
                  <span>© {new Date().getFullYear()} Portal 659 — El centro comercial de tu barrio · 0% comisión</span>
                  <span className="hidden sm:inline text-border">·</span>
                  <div className="flex items-center gap-3">
                    <Link href="/" className="hover:text-foreground transition-colors">Inicio</Link>
                    <Link href="/buscar" className="hover:text-foreground transition-colors">Comercios</Link>
                    <Link href="/barrio" className="hover:text-foreground transition-colors">Info del barrio</Link>
                    <Link href="/planes" className="hover:text-foreground transition-colors">Planes</Link>
                    <Link href="/privacidad" className="hover:text-foreground transition-colors">Privacidad</Link>
                  </div>
                </div>
              </footer>
            </ToastProvider>
          </CartProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
