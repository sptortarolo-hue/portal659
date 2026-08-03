import type { Metadata } from "next";
import { Inter, Fraunces } from "next/font/google";
import "./globals.css";
import { Navigation } from "@/components/nav/navigation";
import { CartProvider } from "@/lib/cart";
import { CartButton } from "@/components/cart/cart-button";
import { CartDrawer } from "@/components/cart/cart-drawer";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
});

export const metadata: Metadata = {
  title: "conectaMOS — Gastronomía de barrio",
  description:
    "La galería gastronómica de tu barrio. Pedí comida casera y regional directo a los productores de la zona.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body
        className={`${inter.variable} ${fraunces.variable} antialiased min-h-screen flex flex-col`}
      >
        <CartProvider>
          <Navigation />
          <main className="flex-1">{children}</main>
          <CartButton />
          <CartDrawer />
          <footer className="border-t border-border py-6 text-center text-sm text-muted-foreground bg-card">
            © {new Date().getFullYear()} conectaMOS — La galería gastronómica de
            tu barrio · 0% comisión
          </footer>
        </CartProvider>
      </body>
    </html>
  );
}
