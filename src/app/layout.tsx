import type { Metadata, Viewport } from "next";
import { Inter, Fraunces } from "next/font/google";
import "./globals.css";
import { Navigation } from "@/components/nav/navigation";
import { CartProvider } from "@/lib/cart";
import { CartDrawer } from "@/components/cart/cart-drawer";
import { CartFooter } from "@/components/cart/cart-footer";
import { ServiceWorkerRegistration } from "@/components/pwa/service-worker-registration";
import { ToastProvider } from "@/lib/toast";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { ThemeProvider } from "@/components/ui/theme-provider";
import { ScrollToTop } from "@/components/ui/scroll-to-top";
import { BottomNav } from "@/components/nav/bottom-nav";

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
      <body
        className={`${inter.variable} ${fraunces.variable} antialiased min-h-screen flex flex-col`}
      >
        <ThemeProvider>
          <CartProvider>
            <ToastProvider>
              <ServiceWorkerRegistration />
              <Navigation />
              <ErrorBoundary>
                <main className="flex-1 pb-20">{children}</main>
              </ErrorBoundary>
              <CartFooter />
              <CartDrawer />
              <ScrollToTop />
              <BottomNav />
              <footer className="border-t border-border py-6 text-center text-sm text-muted-foreground bg-card">
                © {new Date().getFullYear()} Portal 659 — El centro comercial de
                tu barrio · 0% comisión
              </footer>
            </ToastProvider>
          </CartProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
