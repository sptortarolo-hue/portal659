import type { Metadata } from "next";

// Página de autenticación: sin valor de indexación.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function RegisterLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
