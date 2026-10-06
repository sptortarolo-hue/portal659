import type { Metadata } from "next";

// Pantalla privada del usuario: nunca debe indexarse.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function FavoritosLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
