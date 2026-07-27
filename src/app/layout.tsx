import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Navigation } from "@/components/nav/navigation";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "conectaMOS — Mercado hiperlocal",
  description:
    "Conecta con tu barrio. Encuentra productos, servicios, mano de obra y comida cerca de vos.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body className={`${inter.className} antialiased min-h-screen flex flex-col`}>
        <Navigation />
        <main className="flex-1">{children}</main>
        <footer className="border-t py-6 text-center text-sm text-gray-500">
          © {new Date().getFullYear()} conectaMOS — Mercado hiperlocal
        </footer>
      </body>
    </html>
  );
}