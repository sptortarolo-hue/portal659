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
  title: "SeMorfa App — El delivery de nuestro barrio",
  description:
    "SeMorfa App, la galería gastronómica de tu barrio. Pedí comida casera y regional directo a los productores de la zona: el pedido cae en el WhatsApp del local, sin comisiones.",
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
            © {new Date().getFullYear()} SeMorfa App — El delivery de nuestro
            barrio · 0% comisión
          </footer>
        </CartProvider>
      </body>
    </html>
  );
}
