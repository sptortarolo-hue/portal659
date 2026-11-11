import type { Metadata } from "next";

// Página con datos por token: nunca debe indexarse.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function PresupuestoPublicLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
