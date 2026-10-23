import type { Metadata } from "next";

// Página de estado de cuenta: sin valor de indexación.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function VerificadoLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
